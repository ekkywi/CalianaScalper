// apps/backend/src/infrastructure/risk/position-manager.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Between } from 'typeorm';
import { 
    Position, 
    RiskConfig, 
    DEFAULT_RISK_CONFIG, 
    MARKET_EVENTS,
    AccountBalance,
    CandleData,
} from '../../core/domain/market.types';
import { OrderEntity } from '../database/order.entity';

@Injectable()
export class PositionManagerService {
    private readonly logger = new Logger(PositionManagerService.name);
    
    // In-memory positions for fast access (also persisted to DB via events)
    private positions: Map<string, Position> = new Map();
    private riskConfig: RiskConfig;
    private tradingHalted: boolean = false;
    private dailyStats: { date: string; trades: number; loss: number; peakBalance: number } = {
        date: this.getTodayDate(),
        trades: 0,
        loss: 0,
        peakBalance: 0,
    };

    constructor(
        private readonly eventEmitter: EventEmitter2,
        @InjectRepository(OrderEntity)
        private readonly orderRepo: Repository<OrderEntity>,
    ) {
        this.riskConfig = { ...DEFAULT_RISK_CONFIG };
    }

    private getTodayDate(): string {
        return new Date().toISOString().split('T')[0];
    }

    private resetDailyStatsIfNeeded(): void {
        const today = this.getTodayDate();
        if (this.dailyStats.date !== today) {
            this.dailyStats = {
                date: today,
                trades: 0,
                loss: 0,
                peakBalance: 0,
            };
        }
    }

    /**
     * Update risk configuration at runtime
     */
    updateRiskConfig(config: Partial<RiskConfig>): void {
        this.riskConfig = { ...this.riskConfig, ...config };
        this.logger.log(`[RISK] Konfigurasi risiko diperbarui: ${JSON.stringify(config)}`);
    }

    /**
     * Get current risk configuration
     */
    getRiskConfig(): RiskConfig {
        return { ...this.riskConfig };
    }

    /**
     * Check if trading is currently halted
     */
    isTradingHalted(): boolean {
        return this.tradingHalted;
    }

    /**
     * Get all open positions
     */
    getOpenPositions(): Position[] {
        return Array.from(this.positions.values()).filter(p => p.status === 'OPEN');
    }

    /**
     * Get open position for a specific symbol
     */
    getPosition(symbol: string): Position | undefined {
        return this.positions.get(symbol);
    }

    /**
     * Check if a symbol already has an open position (prevents double-order)
     */
    hasOpenPosition(symbol: string): boolean {
        const pos = this.positions.get(symbol);
        return pos !== undefined && pos.status === 'OPEN';
    }

    /**
     * Calculate position size based on account balance and risk config
     */
    calculatePositionSize(balance: AccountBalance, entryPrice: number): number {
        const riskAmount = balance.total * this.riskConfig.maxPositionSizePercent;
        const stopLossDistance = entryPrice * this.riskConfig.stopLossPercent;
        
        // Position size = risk amount / distance to SL
        const positionSize = riskAmount / stopLossDistance;
        
        // Round to reasonable precision (Binance spot typically 6 decimal places for BTC)
        const roundedSize = Math.floor(positionSize * 1000000) / 1000000;
        
        this.logger.log(
            `[POSITION-SIZING] Balance: ${balance.total} USDT | ` +
            `RiskAmount: ${riskAmount.toFixed(2)} USDT | ` +
            `EntryPrice: ${entryPrice} | SL Distance: ${stopLossDistance.toFixed(2)} | ` +
            `Size: ${roundedSize}`
        );
        
        return Math.max(roundedSize, 0);
    }

    /**
     * Open a new position with full risk management checks
     */
    async openPosition(
        symbol: string,
        side: 'LONG',
        entryPrice: number,
        quantity: number,
        balance: AccountBalance,
    ): Promise<Position | null> {
        this.resetDailyStatsIfNeeded();

        // CHECK 1: Is trading halted?
        if (this.tradingHalted) {
            this.logger.warn(`[RISK] Trading sedang dihentikan. Tidak bisa membuka posisi untuk ${symbol}`);
            return null;
        }

        // CHECK 2: Already have position for this symbol?
        if (this.hasOpenPosition(symbol)) {
            this.logger.warn(`[RISK] Posisi ${symbol} sudah terbuka. Mencegah double-order.`);
            return null;
        }

        // CHECK 3: Max open positions reached?
        if (this.getOpenPositions().length >= this.riskConfig.maxOpenPositions) {
            this.logger.warn(`[RISK] Maksimum ${this.riskConfig.maxOpenPositions} posisi terbuka. Tidak bisa membuka posisi baru.`);
            return null;
        }

        // CHECK 4: Max daily trades reached?
        if (this.dailyStats.trades >= this.riskConfig.maxTradesPerDay) {
            this.logger.warn(`[RISK] Maksimum ${this.riskConfig.maxTradesPerDay} trade per hari tercapai. Trading dihentikan.`);
            this.haltTrading('MAX_DAILY_TRADES');
            return null;
        }

        // CHECK 5: Max daily loss reached?
        if (this.dailyStats.loss >= balance.total * this.riskConfig.maxDailyLossPercent) {
            this.logger.warn(`[RISK] Kerugian harian ${this.dailyStats.loss.toFixed(2)} USDT melebihi batas. Trading dihentikan.`);
            this.haltTrading('MAX_DAILY_LOSS');
            return null;
        }

        // CHECK 6: Sufficient balance?
        const requiredAmount = entryPrice * quantity;
        if (balance.free < requiredAmount) {
            this.logger.error(`[RISK] Saldo tidak cukup. Butuh ${requiredAmount.toFixed(2)} USDT, tersedia ${balance.free.toFixed(2)} USDT`);
            return null;
        }

        // Calculate SL and TP
        const stopLoss = side === 'LONG' 
            ? entryPrice * (1 - this.riskConfig.stopLossPercent)
            : entryPrice * (1 + this.riskConfig.stopLossPercent);
        
        const takeProfit = side === 'LONG'
            ? entryPrice * (1 + this.riskConfig.takeProfitPercent)
            : entryPrice * (1 - this.riskConfig.takeProfitPercent);

        const position: Position = {
            symbol,
            side,
            entryPrice,
            quantity,
            stopLoss,
            takeProfit,
            entryTime: Date.now(),
            status: 'OPEN',
            unrealizedPnL: 0,
            realizedPnL: 0,
        };

        this.positions.set(symbol, position);
        this.dailyStats.trades++;

        this.logger.log(
            `[POSITION-OPENED] ${symbol} ${side} | Entry: ${entryPrice} | Qty: ${quantity} | ` +
            `SL: ${stopLoss.toFixed(2)} | TP: ${takeProfit.toFixed(2)}`
        );

        this.eventEmitter.emit(MARKET_EVENTS.POSITION_OPENED, position);
        return position;
    }

    /**
     * Close an existing position
     */
    async closePosition(
        symbol: string,
        closePrice: number,
        reason: Position['status'],
    ): Promise<Position | null> {
        const position = this.positions.get(symbol);
        if (!position || position.status !== 'OPEN') {
            this.logger.warn(`[POSITION] Tidak ada posisi terbuka untuk ${symbol}`);
            return null;
        }

        const pnl = position.side === 'LONG'
            ? (closePrice - position.entryPrice) * position.quantity
            : (position.entryPrice - closePrice) * position.quantity;

        position.status = reason;
        position.closePrice = closePrice;
        position.closeTime = Date.now();
        position.realizedPnL = pnl;
        position.unrealizedPnL = 0;

        // Track daily loss
        if (pnl < 0) {
            this.dailyStats.loss += Math.abs(pnl);
        }

        this.logger.log(
            `[POSITION-CLOSED] ${symbol} | Reason: ${reason} | ` +
            `Entry: ${position.entryPrice} | Close: ${closePrice} | ` +
            `PnL: ${pnl.toFixed(2)} USDT (${((pnl / (position.entryPrice * position.quantity)) * 100).toFixed(2)}%)`
        );

        this.eventEmitter.emit(MARKET_EVENTS.POSITION_CLOSED, position);
        return position;
    }

    /**
     * Check all open positions against current price for SL/TP hits
     */
    async checkPositions(currentCandle: CandleData): Promise<void> {
        const openPositions = this.getOpenPositions();
        
        for (const position of openPositions) {
            if (position.symbol !== currentCandle.symbol) continue;

            const currentPrice = currentCandle.close;

            // Update unrealized PnL
            position.unrealizedPnL = position.side === 'LONG'
                ? (currentPrice - position.entryPrice) * position.quantity
                : (position.entryPrice - currentPrice) * position.quantity;

            // Check STOP LOSS
            if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
                this.logger.warn(`[SL-HIT] ${position.symbol} | Harga: ${currentPrice} <= SL: ${position.stopLoss}`);
                await this.closePosition(position.symbol, currentPrice, 'CLOSED_BY_SL');
                continue;
            }

            // Check TAKE PROFIT
            if (position.side === 'LONG' && currentPrice >= position.takeProfit) {
                this.logger.log(`[TP-HIT] ${position.symbol} | Harga: ${currentPrice} >= TP: ${position.takeProfit}`);
                await this.closePosition(position.symbol, currentPrice, 'CLOSED_BY_TP');
                continue;
            }
        }
    }

    /**
     * Halt all trading due to risk breach
     */
    private haltTrading(reason: string): void {
        this.tradingHalted = true;
        this.logger.error(`[RISK-BREACH] Trading dihentikan: ${reason}`);
        this.eventEmitter.emit(MARKET_EVENTS.RISK_BREACHED, { reason });
        this.eventEmitter.emit(MARKET_EVENTS.TRADING_HALTED, { reason });
    }

    /**
     * Resume trading after risk breach
     */
    resumeTrading(): void {
        this.tradingHalted = false;
        this.logger.log('[RISK] Trading dilanjutkan kembali.');
        this.eventEmitter.emit(MARKET_EVENTS.TRADING_RESUMED, {});
    }

    /**
     * Get daily trading stats
     */
    getDailyStats() {
        this.resetDailyStatsIfNeeded();
        return { ...this.dailyStats };
    }

    /**
     * Get total realized PnL from all closed positions
     */
    getTotalRealizedPnL(): number {
        let total = 0;
        for (const pos of this.positions.values()) {
            if (pos.status !== 'OPEN') {
                total += pos.realizedPnL;
            }
        }
        return total;
    }
}