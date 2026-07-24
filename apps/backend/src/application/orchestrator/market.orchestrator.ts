// src/application/orchestrator/market.orchestrator.ts

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MARKET_EVENTS, type CandleData } from '../../core/domain/market.types';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import { BinanceExecutionService } from '../../infrastructure/exchange/binance-execution.service';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';

@Injectable()
export class MarketOrchestrator {
    private readonly logger = new Logger(MarketOrchestrator.name);

    private lastExecutedCandleTime: Map<string, number> = new Map();
    private mlEngineDownCount: Map<string, number> = new Map();
    private readonly MAX_ML_RETRIES = 3;

    constructor(
        private readonly mlEngine: MlEngineService,
        private readonly executionService: BinanceExecutionService,
        private readonly positionManager: PositionManagerService,
    ) {}

    @OnEvent(MARKET_EVENTS.CANDLE_CLOSED)
    async handleCandleClosed(candle: CandleData) {
        try {
            // STEP 1: Mutex check - prevent duplicate candle processing
            const lastTime = this.lastExecutedCandleTime.get(candle.symbol) || 0;
            if (candle.closeTime <= lastTime) {
                this.logger.warn(
                    `[MUTEX] Event ganda terdeteksi untuk ${candle.symbol} pada timestamp ${candle.closeTime}. Eksekusi dibatalkan.`
                );
                return;
            }
            this.lastExecutedCandleTime.set(candle.symbol, candle.closeTime);

            this.logger.log(`[ORCHESTRATOR] Candle 15m ditutup untuk ${candle.symbol}. Memulai analisis...`);

            // STEP 2: Check if trading is halted due to risk breach
            if (this.positionManager.isTradingHalted()) {
                this.logger.warn(`[ORCHESTRATOR] Trading sedang dihentikan. Melewati analisis untuk ${candle.symbol}.`);
                return;
            }

            // STEP 3: Check existing positions for SL/TP hits
            await this.positionManager.checkPositions(candle);

            // STEP 4: Check if we already have an open position for this symbol
            if (this.positionManager.hasOpenPosition(candle.symbol)) {
                this.logger.log(
                    `[ORCHESTRATOR] Posisi ${candle.symbol} sudah terbuka. Melewati sinyal baru.`
                );
                return;
            }

            // STEP 5: Get ML prediction with retry logic
            const prediction = await this.getPredictionWithRetry(candle);
            
            if (!prediction) {
                this.logger.warn(`[ORCHESTRATOR] Tidak ada prediksi untuk ${candle.symbol}. Melewati candle ini.`);
                return;
            }

            // STEP 6: Validate prediction confidence against risk threshold
            const riskConfig = this.positionManager.getRiskConfig();
            if (prediction.confidence < riskConfig.minConfidenceThreshold) {
                this.logger.log(
                    `[ORCHESTRATOR] Keyakinan ${(prediction.confidence * 100).toFixed(1)}% ` +
                    `di bawah threshold ${(riskConfig.minConfidenceThreshold * 100).toFixed(1)}%. HOLD.`
                );
                return;
            }

            // STEP 7: Execute trade based on signal
            if (prediction.signal === 'BUY') {
                await this.executeBuySignal(candle, prediction.confidence);
            } else if (prediction.signal === 'SELL') {
                await this.executeSellSignal(candle, prediction.confidence);
            } else {
                this.logger.log(`[ORCHESTRATOR] Sinyal HOLD untuk ${candle.symbol}.`);
            }

        } catch (error) {
            this.logger.error(`[ORCHESTRATOR] Error memproses candle ${candle.symbol}: ${error.message}`);
        }
    }

    private async getPredictionWithRetry(candle: CandleData) {
        const symbol = candle.symbol;
        const retryCount = this.mlEngineDownCount.get(symbol) || 0;

        if (retryCount >= this.MAX_ML_RETRIES) {
            this.logger.error(
                `[ORCHESTRATOR] ML Engine untuk ${symbol} gagal ${retryCount} kali berturut-turut. ` +
                `Menunggu candle berikutnya.`
            );
            return null;
        }

        const prediction = await this.mlEngine.getPrediction(candle);

        if (!prediction) {
            this.mlEngineDownCount.set(symbol, retryCount + 1);
            this.logger.warn(
                `[ORCHESTRATOR] ML Engine gagal (percobaan ${retryCount + 1}/${this.MAX_ML_RETRIES}) untuk ${symbol}`
            );
            return null;
        }

        // Reset retry count on success
        this.mlEngineDownCount.set(symbol, 0);
        return prediction;
    }

    private async executeBuySignal(candle: CandleData, confidence: number) {
        const symbol = candle.symbol;
        this.logger.log(`[SINYAL] BUY ${symbol} dengan keyakinan ${(confidence * 100).toFixed(1)}%`);

        // Get account balance
        const balance = await this.executionService.getBalance('USDT');
        if (!balance) {
            this.logger.error(`[ORCHESTRATOR] Gagal mendapatkan saldo untuk eksekusi BUY ${symbol}`);
            return;
        }

        // Calculate position size based on risk management
        const entryPrice = candle.close;
        const positionSize = this.positionManager.calculatePositionSize(balance, entryPrice);

        if (positionSize <= 0) {
            this.logger.warn(`[ORCHESTRATOR] Ukuran posisi tidak valid (${positionSize}) untuk ${symbol}`);
            return;
        }

        // Execute the order
        const orderResult = await this.executionService.executeMarketOrder(symbol, 'buy', positionSize);

        if (!orderResult) {
            this.logger.error(`[ORCHESTRATOR] Order BUY ${symbol} gagal dieksekusi.`);
            return;
        }

        // Track position in PositionManager
        const avgPrice = orderResult.averagePrice > 0 ? orderResult.averagePrice : entryPrice;
        const position = await this.positionManager.openPosition(
            symbol,
            'LONG',
            avgPrice,
            orderResult.filledQuantity,
            balance,
        );

        if (!position) {
            this.logger.warn(`[ORCHESTRATOR] Posisi ${symbol} tidak tercatat (risk check gagal setelah order).`);
            // Note: Order sudah terkirim, tapi posisi tidak tercatat karena risk check.
            // Ini perlu di-handle dengan cancel order atau manual review.
        }
    }

    private async executeSellSignal(candle: CandleData, confidence: number) {
        const symbol = candle.symbol;
        this.logger.log(`[SINYAL] SELL ${symbol} dengan keyakinan ${(confidence * 100).toFixed(1)}%`);

        // Check if we have an open position to close
        const existingPosition = this.positionManager.getPosition(symbol);
        
        if (existingPosition && existingPosition.status === 'OPEN') {
            // Close existing position
            this.logger.log(`[ORCHESTRATOR] Menutup posisi ${symbol} berdasarkan sinyal SELL.`);
            
            const orderResult = await this.executionService.executeMarketOrder(
                symbol, 
                'sell', 
                existingPosition.quantity,
            );

            if (orderResult) {
                const closePrice = orderResult.averagePrice > 0 ? orderResult.averagePrice : candle.close;
                await this.positionManager.closePosition(symbol, closePrice, 'CLOSED_BY_SIGNAL');
            }
        } else {
            // In spot mode, we can't short sell. Log warning.
            this.logger.warn(
                `[ORCHESTRATOR] Sinyal SELL untuk ${symbol} diabaikan (mode spot, tidak ada posisi LONG terbuka).`
            );
        }
    }

    @OnEvent(MARKET_EVENTS.CANDLE_TICK)
    handleCandleTick(candle: CandleData) {
        this.logger.debug(`[TICK] ${candle.symbol}: ${candle.close}`);
    }

    @OnEvent(MARKET_EVENTS.TRADING_HALTED)
    handleTradingHalted(event: { reason: string }) {
        this.logger.error(`[ORCHESTRATOR] Trading dihentikan: ${event.reason}`);
    }

    @OnEvent(MARKET_EVENTS.TRADING_RESUMED)
    handleTradingResumed() {
        this.logger.log('[ORCHESTRATOR] Trading dilanjutkan kembali.');
    }
}