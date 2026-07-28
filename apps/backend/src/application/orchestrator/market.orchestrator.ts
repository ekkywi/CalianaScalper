// src/application/orchestrator/market.orchestrator.ts

import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MARKET_EVENTS, type CandleData } from '../../core/domain/market.types';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import type { MlPrediction } from '../../infrastructure/ml/ml-engine.service';
import { MlShadowService } from '../../infrastructure/ml/ml-shadow.service';
import { BinanceExecutionService } from '../../infrastructure/exchange/binance-execution.service';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';
import { StrategyService } from '../../infrastructure/strategy/strategy.service';
import { SymbolService } from '../symbol/symbol.service';

@Injectable()
export class MarketOrchestrator {
    private readonly logger = new Logger(MarketOrchestrator.name);

    private lastExecutedCandleTime: Map<string, number> = new Map();
    private mlEngineDownCount: Map<string, number> = new Map();
    private readonly MAX_ML_RETRIES = 3;

    constructor(
        private readonly mlEngine: MlEngineService,
        private readonly mlShadow: MlShadowService,
        private readonly executionService: BinanceExecutionService,
        private readonly positionManager: PositionManagerService,
        private readonly symbolService: SymbolService,
        @Inject(forwardRef(() => StrategyService))
        private readonly strategy: StrategyService,
    ) {}

    @OnEvent(MARKET_EVENTS.CANDLE_CLOSED)
    async handleCandleClosed(candle: CandleData) {
        try {
            const activeSymbols = await this.symbolService.getActiveSymbols();
            const isActive = activeSymbols.some((s) => s.symbol === candle.symbol);
            if (!isActive) {
                this.logger.warn(
                    `[ORCHESTRATOR] ${candle.symbol} is not an active symbol — skipping candle close.`,
                );
                return;
            }

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

            // STEP 6: Confidence + regime gates (Phase 2)
            const riskConfig = this.positionManager.getRiskConfig();
            const gate = this.evaluateMlGates(candle, prediction, riskConfig);
            if (!gate.allowExecute) {
                if (gate.recordShadow) {
                    this.mlShadow.record(candle, prediction, {
                        effectiveMinConfidence: gate.effectiveMinConfidence,
                        blockedBy: gate.blockedBy,
                        wouldExecute: gate.wouldExecute,
                    });
                }
                if (gate.logMessage) {
                    this.logger.log(gate.logMessage);
                }
                return;
            }

            // STEP 6b: Strategy pair guard — profile + model must align (paper = live)
            if (prediction.signal === 'BUY') {
                const pair = await this.strategy.getPairStatus(candle.symbol);
                if (pair.blockBuy) {
                    this.logger.warn(
                        `[STRATEGY] BUY ${candle.symbol} blocked — ${pair.message}`,
                    );
                    this.mlShadow.record(candle, prediction, {
                        effectiveMinConfidence: gate.effectiveMinConfidence,
                        blockedBy: 'drift',
                        wouldExecute: true,
                    });
                    return;
                }
            }

            // STEP 7: Execute trade based on signal
            if (prediction.signal === 'BUY') {
                await this.executeBuySignal(candle, prediction);
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

    private evaluateMlGates(
        candle: CandleData,
        prediction: MlPrediction,
        riskConfig: ReturnType<PositionManagerService['getRiskConfig']>,
    ): {
        allowExecute: boolean;
        recordShadow: boolean;
        wouldExecute: boolean;
        effectiveMinConfidence: number;
        blockedBy: 'shadow_mode' | 'regime' | 'confidence' | 'drift' | null;
        logMessage: string | null;
    } {
        const raw = prediction.raw || {};
        const regimeBump = riskConfig.mlRegimeGateEnabled
            ? Number(raw.regime_confidence_bump) || 0
            : 0;
        const effectiveMin = riskConfig.minConfidenceThreshold + regimeBump;

        const base = {
            effectiveMinConfidence: effectiveMin,
            recordShadow: false,
            wouldExecute: false,
            blockedBy: null as 'shadow_mode' | 'regime' | 'confidence' | 'drift' | null,
            logMessage: null as string | null,
            allowExecute: true,
        };

        if (prediction.signal !== 'BUY') {
            if (prediction.confidence < effectiveMin) {
                return {
                    ...base,
                    allowExecute: false,
                    logMessage:
                        `[ORCHESTRATOR] ${prediction.signal} ${candle.symbol} skipped — confidence ` +
                        `${(prediction.confidence * 100).toFixed(1)}% below ` +
                        `${(effectiveMin * 100).toFixed(1)}%`,
                };
            }
            return base;
        }

        // BUY path
        const wouldPassConfidence = prediction.confidence >= effectiveMin;
        const allowLong =
            !riskConfig.mlRegimeGateEnabled || raw.regime_allow_long !== false;
        const wouldPassRegime = allowLong;
        const wouldExecute = wouldPassConfidence && wouldPassRegime;

        if (!wouldPassConfidence) {
            return {
                ...base,
                allowExecute: false,
                blockedBy: 'confidence',
                logMessage:
                    `[ORCHESTRATOR] BUY ${candle.symbol} blocked — confidence ` +
                    `${(prediction.confidence * 100).toFixed(1)}% < ` +
                    `${(effectiveMin * 100).toFixed(1)}%` +
                    (regimeBump > 0 ? ` (incl. regime +${(regimeBump * 100).toFixed(0)}%)` : ''),
            };
        }

        if (!wouldPassRegime) {
            const regime = raw.regime || 'unknown';
            const reason = raw.regime_reason || 'regime gate';
            return {
                ...base,
                allowExecute: false,
                blockedBy: 'regime',
                wouldExecute: false,
                logMessage:
                    `[REGIME] BUY ${candle.symbol} blocked (${regime}): ${reason}`,
            };
        }

        if (riskConfig.mlShadowMode) {
            return {
                ...base,
                allowExecute: false,
                recordShadow: true,
                wouldExecute: true,
                blockedBy: 'shadow_mode',
                logMessage:
                    `[SHADOW] Would BUY ${candle.symbol} @ ${(prediction.confidence * 100).toFixed(1)}% ` +
                    `(regime=${raw.regime || 'n/a'}) — execution skipped`,
            };
        }

        return { ...base, wouldExecute: true };
    }

    private async executeBuySignal(candle: CandleData, prediction: MlPrediction) {
        const symbol = candle.symbol;
        const confidence = prediction.confidence;
        const algorithm =
            typeof prediction.raw?.algorithm === 'string'
                ? prediction.raw.algorithm
                : undefined;
        this.logger.log(`[SINYAL] BUY ${symbol} dengan keyakinan ${(confidence * 100).toFixed(1)}%`);

        const balance = await this.executionService.getBalance('USDT');
        if (!balance) {
            this.logger.error(`[ORCHESTRATOR] Gagal mendapatkan saldo untuk eksekusi BUY ${symbol}`);
            return;
        }

        // Track equity / drawdown before trading
        const drawdownOk = await this.positionManager.updateEquityAndCheckDrawdown(balance.total);
        if (!drawdownOk) {
            this.logger.warn(`[ORCHESTRATOR] Drawdown breach — skip BUY ${symbol}`);
            return;
        }

        const entryPrice = candle.close;
        const positionSize = this.positionManager.calculatePositionSize(
            balance,
            entryPrice,
            symbol,
        );

        if (positionSize <= 0) {
            this.logger.warn(`[ORCHESTRATOR] Ukuran posisi tidak valid (${positionSize}) untuk ${symbol}`);
            return;
        }

        // Pre-flight risk checks BEFORE sending order to exchange
        const gate = await this.positionManager.canOpenPosition(
            symbol,
            entryPrice,
            positionSize,
            balance,
        );
        if (!gate.allowed) {
            this.logger.warn(
                `[ORCHESTRATOR] BUY ${symbol} ditolak pre-flight: ${gate.reason}`,
            );
            return;
        }

        const orderResult = await this.executionService.executeMarketOrder(
            symbol,
            'buy',
            positionSize,
        );

        if (!orderResult) {
            this.logger.error(`[ORCHESTRATOR] Order BUY ${symbol} gagal dieksekusi.`);
            return;
        }

        const avgPrice = orderResult.averagePrice > 0 ? orderResult.averagePrice : entryPrice;
        const filledQty =
            orderResult.filledQuantity > 0 ? orderResult.filledQuantity : positionSize;

        const position = await this.positionManager.openPosition(
            symbol,
            'LONG',
            avgPrice,
            filledQty,
            balance,
            {
                signal: prediction.signal,
                confidence,
                algorithm,
            },
        );

        if (!position) {
            // Order filled but ledger open failed — attempt immediate flatten to avoid ghost exposure
            this.logger.error(
                `[ORCHESTRATOR] Posisi ${symbol} gagal tercatat setelah fill — mencoba flatten darurat`,
            );
            await this.executionService.closePosition(symbol, filledQty);
        }
    }

    private async executeSellSignal(candle: CandleData, confidence: number) {
        const symbol = candle.symbol;
        this.logger.log(`[SINYAL] SELL ${symbol} dengan keyakinan ${(confidence * 100).toFixed(1)}%`);

        const existingPosition = this.positionManager.getPosition(symbol);

        if (existingPosition && existingPosition.status === 'OPEN') {
            this.logger.log(`[ORCHESTRATOR] Menutup posisi ${symbol} berdasarkan sinyal SELL.`);
            const closed = await this.positionManager.flattenAndClose(
                symbol,
                candle.close,
                'CLOSED_BY_SIGNAL',
            );
            if (!closed) {
                this.logger.error(`[ORCHESTRATOR] Gagal menutup ${symbol} via sinyal SELL`);
            }
        } else {
            this.logger.warn(
                `[ORCHESTRATOR] Sinyal SELL untuk ${symbol} diabaikan (mode spot, tidak ada posisi LONG terbuka).`,
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