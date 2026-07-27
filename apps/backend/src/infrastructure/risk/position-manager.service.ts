// apps/backend/src/infrastructure/risk/position-manager.service.ts
// Position Manager dengan database persistence — menggantikan in-memory Map

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { 
    Position, 
    RiskConfig, 
    DEFAULT_RISK_CONFIG, 
    MARKET_EVENTS,
    AccountBalance,
    CandleData,
} from '../../core/domain/market.types';
import { OrderEntity } from '../database/order.entity';
import { PositionEntity } from '../database/position.entity';
import { TradeEntity } from '../database/trade.entity';
import { SystemConfigEntity } from '../database/system-config.entity';
import { BinanceExecutionService } from '../exchange/binance-execution.service';

@Injectable()
export class PositionManagerService implements OnModuleInit {
    private readonly logger = new Logger(PositionManagerService.name);
    
    // Cache in-memory untuk akses cepat (sinkron dengan DB)
    private positionsCache: Map<string, Position> = new Map();
    private riskConfig: RiskConfig;
    private tradingHalted: boolean = false;
    private dailyStats: { date: string; trades: number; loss: number; peakBalance: number } = {
        date: this.getTodayDate(),
        trades: 0,
        loss: 0,
        peakBalance: 0,
    };

    private static readonly HALT_CONFIG_KEY = 'trading_halted';
    private static readonly PEAK_BALANCE_KEY = 'peak_balance';

    constructor(
        private readonly eventEmitter: EventEmitter2,
        @InjectRepository(OrderEntity)
        private readonly orderRepo: Repository<OrderEntity>,
        @InjectRepository(PositionEntity)
        private readonly positionRepo: Repository<PositionEntity>,
        @InjectRepository(TradeEntity)
        private readonly tradeRepo: Repository<TradeEntity>,
        @InjectRepository(SystemConfigEntity)
        private readonly configRepo: Repository<SystemConfigEntity>,
        private readonly executionService: BinanceExecutionService,
    ) {
        this.riskConfig = { ...DEFAULT_RISK_CONFIG };
    }

    /**
     * On module init, load persisted state from database
     */
    async onModuleInit() {
        await this.loadPersistedState();
    }

    /**
     * Load risk config, open positions, and daily stats from database
     */
    private async loadPersistedState(): Promise<void> {
        try {
            // 1. Load risk config
            const configEntity = await this.configRepo.findOne({ where: { key: 'risk_config' } });
            if (configEntity?.value) {
                this.riskConfig = { ...DEFAULT_RISK_CONFIG, ...configEntity.value as RiskConfig };
                this.logger.log('[PERSIST] Risk config loaded from database');
            }

            // 2. Load open positions into cache
            const openPositions = await this.positionRepo.find({ where: { status: 'OPEN' } });
            for (const entity of openPositions) {
                this.positionsCache.set(entity.symbol, this.entityToDomain(entity));
            }
            this.logger.log(`[PERSIST] ${openPositions.length} open positions loaded from database`);

            // 3. Load daily stats from today's trades
            const today = this.getTodayDate();
            const todayStart = new Date(today).getTime();
            const todayTrades = await this.tradeRepo.find({
                where: { closeTime: MoreThan(todayStart) },
            });
            let totalLoss = 0;
            for (const trade of todayTrades) {
                if (Number(trade.pnl) < 0) totalLoss += Math.abs(Number(trade.pnl));
            }

            // 4. Load peak balance for drawdown tracking
            const peakEntity = await this.configRepo.findOne({
                where: { key: PositionManagerService.PEAK_BALANCE_KEY },
            });
            const peakBalance = peakEntity?.value
                ? Number((peakEntity.value as { peakBalance?: number }).peakBalance) || 0
                : 0;

            this.dailyStats = {
                date: today,
                trades: todayTrades.length,
                loss: totalLoss,
                peakBalance,
            };

            // 5. Load trading halt flag (survives restart)
            const haltEntity = await this.configRepo.findOne({
                where: { key: PositionManagerService.HALT_CONFIG_KEY },
            });
            if (haltEntity?.value) {
                this.tradingHalted = Boolean(
                    (haltEntity.value as { halted?: boolean }).halted,
                );
                if (this.tradingHalted) {
                    this.logger.warn('[PERSIST] Trading was halted — remaining halted after restart');
                }
            }

            this.logger.log(`[PERSIST] Daily stats loaded: ${todayTrades.length} trades today`);
        } catch (err) {
            this.logger.error(`[PERSIST] Failed to load persisted state: ${err.message}`);
        }
    }

    private async persistHaltState(): Promise<void> {
        try {
            const existing = await this.configRepo.findOne({
                where: { key: PositionManagerService.HALT_CONFIG_KEY },
            });
            const value = { halted: this.tradingHalted };
            if (existing) {
                existing.value = value as any;
                existing.updatedAt = Date.now();
                await this.configRepo.save(existing);
            } else {
                await this.configRepo.save({
                    key: PositionManagerService.HALT_CONFIG_KEY,
                    value: value as any,
                    updatedAt: Date.now(),
                });
            }
        } catch (err) {
            this.logger.error(`[PERSIST] Failed to persist halt state: ${err.message}`);
        }
    }

    private async persistPeakBalance(): Promise<void> {
        try {
            const existing = await this.configRepo.findOne({
                where: { key: PositionManagerService.PEAK_BALANCE_KEY },
            });
            const value = { peakBalance: this.dailyStats.peakBalance };
            if (existing) {
                existing.value = value as any;
                existing.updatedAt = Date.now();
                await this.configRepo.save(existing);
            } else {
                await this.configRepo.save({
                    key: PositionManagerService.PEAK_BALANCE_KEY,
                    value: value as any,
                    updatedAt: Date.now(),
                });
            }
        } catch (err) {
            this.logger.error(`[PERSIST] Failed to persist peak balance: ${err.message}`);
        }
    }

    /**
     * Update equity peak and halt if max drawdown is breached.
     */
    async updateEquityAndCheckDrawdown(currentBalance: number): Promise<boolean> {
        if (currentBalance <= 0) return !this.tradingHalted;

        if (currentBalance > this.dailyStats.peakBalance) {
            this.dailyStats.peakBalance = currentBalance;
            await this.persistPeakBalance();
        }

        const peak = this.dailyStats.peakBalance;
        if (peak > 0) {
            const drawdown = (peak - currentBalance) / peak;
            if (drawdown >= this.riskConfig.maxDrawdownPercent) {
                this.logger.error(
                    `[DRAWDOWN] Drawdown ${(drawdown * 100).toFixed(2)}% >= ` +
                    `max ${(this.riskConfig.maxDrawdownPercent * 100).toFixed(2)}%`,
                );
                await this.haltTrading('MAX_DRAWDOWN');
                return false;
            }
        }
        return !this.tradingHalted;
    }

    /**
     * Pre-flight risk checks before placing an exchange order.
     * Does not mutate state except possibly halting on daily limits.
     */
    async canOpenPosition(
        symbol: string,
        entryPrice: number,
        quantity: number,
        balance: AccountBalance,
    ): Promise<{ allowed: boolean; reason?: string }> {
        this.resetDailyStatsIfNeeded();

        if (this.tradingHalted) {
            return { allowed: false, reason: 'TRADING_HALTED' };
        }
        if (this.hasOpenPosition(symbol)) {
            return { allowed: false, reason: 'POSITION_ALREADY_OPEN' };
        }
        if (this.getOpenPositions().length >= this.riskConfig.maxOpenPositions) {
            return { allowed: false, reason: 'MAX_OPEN_POSITIONS' };
        }
        if (this.dailyStats.trades >= this.riskConfig.maxTradesPerDay) {
            await this.haltTrading('MAX_DAILY_TRADES');
            return { allowed: false, reason: 'MAX_DAILY_TRADES' };
        }
        if (this.dailyStats.loss >= balance.total * this.riskConfig.maxDailyLossPercent) {
            await this.haltTrading('MAX_DAILY_LOSS');
            return { allowed: false, reason: 'MAX_DAILY_LOSS' };
        }
        const requiredAmount = entryPrice * quantity;
        if (balance.free < requiredAmount) {
            return { allowed: false, reason: 'INSUFFICIENT_BALANCE' };
        }

        const drawdownOk = await this.updateEquityAndCheckDrawdown(balance.total);
        if (!drawdownOk) {
            return { allowed: false, reason: 'MAX_DRAWDOWN' };
        }

        return { allowed: true };
    }

    /**
     * Flatten on exchange first, then close in DB. If exchange sell fails, leave DB OPEN.
     */
    async flattenAndClose(
        symbol: string,
        fallbackPrice: number,
        reason: Position['status'],
    ): Promise<Position | null> {
        const position = this.positionsCache.get(symbol);
        if (!position || position.status !== 'OPEN') {
            this.logger.warn(`[POSITION] Tidak ada posisi terbuka untuk ${symbol}`);
            return null;
        }

        let closePrice = fallbackPrice;
        if (this.executionService) {
            const order = await this.executionService.closePosition(
                symbol,
                Number(position.quantity),
            );
            if (!order) {
                this.logger.error(
                    `[FLATTEN] Gagal market-sell ${symbol} di exchange — posisi tetap OPEN di DB`,
                );
                return null;
            }
            closePrice =
                order.averagePrice > 0
                    ? order.averagePrice
                    : order.price > 0
                      ? order.price
                      : fallbackPrice;
        } else {
            this.logger.warn(
                `[FLATTEN] ExecutionService tidak tersedia — menutup ${symbol} di ledger saja`,
            );
        }

        return this.closePosition(symbol, closePrice, reason);
    }

    /**
     * Persist risk config to database
     */
    private async persistRiskConfig(): Promise<void> {
        try {
            const existing = await this.configRepo.findOne({ where: { key: 'risk_config' } });
            if (existing) {
                existing.value = this.riskConfig as any;
                existing.updatedAt = Date.now();
                await this.configRepo.save(existing);
            } else {
                await this.configRepo.save({
                    key: 'risk_config',
                    value: this.riskConfig as any,
                    updatedAt: Date.now(),
                });
            }
        } catch (err) {
            this.logger.error(`[PERSIST] Failed to persist risk config: ${err.message}`);
        }
    }

    /**
     * Convert domain Position to PositionEntity for DB storage
     */
    private domainToEntity(position: Position): Partial<PositionEntity> {
        return {
            symbol: position.symbol,
            side: position.side,
            entryPrice: position.entryPrice,
            quantity: position.quantity,
            stopLoss: position.stopLoss,
            takeProfit: position.takeProfit,
            entryTime: position.entryTime,
            status: position.status,
            closePrice: position.closePrice,
            closeTime: position.closeTime,
            unrealizedPnL: position.unrealizedPnL,
            realizedPnL: position.realizedPnL,
        };
    }

    /**
     * Convert PositionEntity to domain Position
     */
    private entityToDomain(entity: PositionEntity): Position {
        return {
            symbol: entity.symbol,
            side: entity.side as 'LONG',
            entryPrice: entity.entryPrice,
            quantity: entity.quantity,
            stopLoss: entity.stopLoss,
            takeProfit: entity.takeProfit,
            entryTime: entity.entryTime,
            status: entity.status as Position['status'],
            closePrice: entity.closePrice,
            closeTime: entity.closeTime,
            unrealizedPnL: entity.unrealizedPnL,
            realizedPnL: entity.realizedPnL,
        };
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
     * Update risk configuration at runtime — persisted to database
     */
    async updateRiskConfig(config: Partial<RiskConfig>): Promise<void> {
        this.riskConfig = { ...this.riskConfig, ...config };
        await this.persistRiskConfig();
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
     * Get all open positions — from cache (synced with DB)
     */
    getOpenPositions(): Position[] {
        return Array.from(this.positionsCache.values()).filter(p => p.status === 'OPEN');
    }

    /**
     * Get open position for a specific symbol
     */
    getPosition(symbol: string): Position | undefined {
        return this.positionsCache.get(symbol);
    }

    /**
     * Check if a symbol already has an open position (prevents double-order)
     */
    hasOpenPosition(symbol: string): boolean {
        const pos = this.positionsCache.get(symbol);
        return pos !== undefined && pos.status === 'OPEN';
    }

    /**
     * Calculate position size based on account balance and risk config
     */
    calculatePositionSize(balance: AccountBalance, entryPrice: number): number {
        const riskAmount = balance.total * this.riskConfig.maxPositionSizePercent;
        const stopLossDistance = entryPrice * this.riskConfig.stopLossPercent;
        
        const positionSize = riskAmount / stopLossDistance;
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
     * Open a new position with full risk management checks — persisted to DB
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
            await this.haltTrading('MAX_DAILY_TRADES');
            return null;
        }

        // CHECK 5: Max daily loss reached?
        if (this.dailyStats.loss >= balance.total * this.riskConfig.maxDailyLossPercent) {
            this.logger.warn(`[RISK] Kerugian harian ${this.dailyStats.loss.toFixed(2)} USDT melebihi batas. Trading dihentikan.`);
            await this.haltTrading('MAX_DAILY_LOSS');
            return null;
        }

        // CHECK 5b: Max drawdown
        const drawdownOk = await this.updateEquityAndCheckDrawdown(balance.total);
        if (!drawdownOk) {
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

        // Save to database
        try {
            const entity = this.domainToEntity(position);
            await this.positionRepo.save(entity);
        } catch (err) {
            this.logger.error(`[DB] Gagal menyimpan posisi baru: ${err.message}`);
            return null;
        }

        // Update cache
        this.positionsCache.set(symbol, position);
        this.dailyStats.trades++;

        this.logger.log(
            `[POSITION-OPENED] ${symbol} ${side} | Entry: ${entryPrice} | Qty: ${quantity} | ` +
            `SL: ${stopLoss.toFixed(2)} | TP: ${takeProfit.toFixed(2)}`
        );

        this.eventEmitter.emit(MARKET_EVENTS.POSITION_OPENED, position);
        return position;
    }

    /**
     * Close an existing position — persisted to DB + creates Trade record
     */
    async closePosition(
        symbol: string,
        closePrice: number,
        reason: Position['status'],
    ): Promise<Position | null> {
        const position = this.positionsCache.get(symbol);
        if (!position || position.status !== 'OPEN') {
            this.logger.warn(`[POSITION] Tidak ada posisi terbuka untuk ${symbol}`);
            return null;
        }

        const pnl = position.side === 'LONG'
            ? (closePrice - position.entryPrice) * position.quantity
            : (position.entryPrice - closePrice) * position.quantity;

        const pnlPercent = position.entryPrice > 0 
            ? (pnl / (position.entryPrice * position.quantity)) * 100 
            : 0;

        position.status = reason;
        position.closePrice = closePrice;
        position.closeTime = Date.now();
        position.realizedPnL = pnl;
        position.unrealizedPnL = 0;

        // Track daily loss
        if (pnl < 0) {
            this.dailyStats.loss += Math.abs(pnl);
        }

        // Persist to database: update position + create trade record
        try {
            // Update position in DB
            await this.positionRepo.update(
                { symbol, status: 'OPEN' },
                {
                    status: reason,
                    closePrice,
                    closeTime: position.closeTime,
                    realizedPnL: pnl,
                    unrealizedPnL: 0,
                }
            );

            // Create trade record for historical PnL
            await this.tradeRepo.save({
                symbol,
                side: position.side,
                entryPrice: position.entryPrice,
                exitPrice: closePrice,
                quantity: position.quantity,
                pnl,
                pnlPercent,
                closeReason: reason,
                entryTime: position.entryTime,
                closeTime: position.closeTime,
                duration: position.closeTime - position.entryTime,
                positionId: symbol, // simplified reference
            });
        } catch (err) {
            this.logger.error(`[DB] Gagal menyimpan penutupan posisi: ${err.message}`);
        }

        // Remove from cache
        this.positionsCache.delete(symbol);

        this.logger.log(
            `[POSITION-CLOSED] ${symbol} | Reason: ${reason} | ` +
            `Entry: ${position.entryPrice} | Close: ${closePrice} | ` +
            `PnL: ${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)`
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

            // Persist unrealized PnL to DB
            try {
                await this.positionRepo.update(
                    { symbol: position.symbol, status: 'OPEN' },
                    { unrealizedPnL: position.unrealizedPnL }
                );
            } catch (err) {
                // Non-critical, log only
            }

            // Check STOP LOSS — flatten exchange then close ledger
            if (position.side === 'LONG' && currentPrice <= position.stopLoss) {
                this.logger.warn(`[SL-HIT] ${position.symbol} | Harga: ${currentPrice} <= SL: ${position.stopLoss}`);
                await this.flattenAndClose(position.symbol, currentPrice, 'CLOSED_BY_SL');
                continue;
            }

            // Check TAKE PROFIT — flatten exchange then close ledger
            if (position.side === 'LONG' && currentPrice >= position.takeProfit) {
                this.logger.log(`[TP-HIT] ${position.symbol} | Harga: ${currentPrice} >= TP: ${position.takeProfit}`);
                await this.flattenAndClose(position.symbol, currentPrice, 'CLOSED_BY_TP');
                continue;
            }
        }
    }

    /**
     * EMERGENCY STOP — Public method yang dipanggil dari RiskController/UI.
     * Halts trading (persisted) and flattens all open positions on exchange before DB close.
     */
    async emergencyStop(): Promise<void> {
        this.logger.error('[EMERGENCY-STOP] Emergency stop dipicu. Menutup semua posisi...');

        await this.haltTrading('EMERGENCY_STOP');

        const openPositions = [...this.getOpenPositions()];
        for (const pos of openPositions) {
            try {
                const closed = await this.flattenAndClose(
                    pos.symbol,
                    Number(pos.entryPrice),
                    'CLOSED_BY_MANUAL',
                );
                if (closed) {
                    this.logger.log(`[EMERGENCY-STOP] Posisi ${pos.symbol} ditutup.`);
                } else {
                    this.logger.error(
                        `[EMERGENCY-STOP] Posisi ${pos.symbol} GAGAL ditutup di exchange — masih OPEN`,
                    );
                }
            } catch (err) {
                this.logger.error(`[EMERGENCY-STOP] Gagal menutup ${pos.symbol}: ${err.message}`);
            }
        }

        this.logger.log('[EMERGENCY-STOP] Emergency stop selesai.');
    }

    /**
     * Halt all trading due to risk breach — persisted across restarts
     */
    private async haltTrading(reason: string): Promise<void> {
        this.tradingHalted = true;
        await this.persistHaltState();
        this.logger.error(`[RISK-BREACH] Trading dihentikan: ${reason}`);
        this.eventEmitter.emit(MARKET_EVENTS.RISK_BREACHED, { reason });
        this.eventEmitter.emit(MARKET_EVENTS.TRADING_HALTED, { reason });
    }

    /**
     * Resume trading after risk breach
     */
    async resumeTrading(): Promise<void> {
        this.tradingHalted = false;
        await this.persistHaltState();
        this.logger.log('[RISK] Trading dilanjutkan kembali.');
        this.eventEmitter.emit(MARKET_EVENTS.TRADING_RESUMED, {});
    }

    /**
     * Reduce open position quantity after a partial sell (persisted).
     */
    async reduceOpenQuantity(symbol: string, soldQty: number): Promise<Position | null> {
        const position = this.positionsCache.get(symbol);
        if (!position || position.status !== 'OPEN') {
            return null;
        }
        const remaining = Number(position.quantity) - soldQty;
        if (remaining <= 1e-12) {
            const price = Number(position.entryPrice);
            return this.closePosition(symbol, price, 'CLOSED_BY_MANUAL');
        }
        position.quantity = remaining;
        try {
            await this.positionRepo.update(
                { symbol, status: 'OPEN' },
                { quantity: remaining },
            );
        } catch (err) {
            this.logger.error(`[DB] Failed to reduce qty ${symbol}: ${err.message}`);
            return null;
        }
        this.positionsCache.set(symbol, position);
        this.logger.log(`[POSITION] Reduced ${symbol} qty by ${soldQty} → ${remaining}`);
        return position;
    }

    /**
     * Update SL/TP levels on an open position (persisted). Used by UI.
     */
    async updatePositionLevels(
        symbol: string,
        stopLoss?: number,
        takeProfit?: number,
    ): Promise<Position | null> {
        const position = this.positionsCache.get(symbol);
        if (!position || position.status !== 'OPEN') {
            return null;
        }
        if (stopLoss !== undefined && Number.isFinite(stopLoss)) {
            position.stopLoss = stopLoss;
        }
        if (takeProfit !== undefined && Number.isFinite(takeProfit)) {
            position.takeProfit = takeProfit;
        }
        try {
            await this.positionRepo.update(
                { symbol, status: 'OPEN' },
                { stopLoss: position.stopLoss, takeProfit: position.takeProfit },
            );
        } catch (err) {
            this.logger.error(`[DB] Gagal update SL/TP ${symbol}: ${err.message}`);
            return null;
        }
        this.positionsCache.set(symbol, position);
        this.logger.log(
            `[POSITION] SL/TP updated ${symbol} | SL=${position.stopLoss} TP=${position.takeProfit}`,
        );
        return position;
    }

    /**
     * Basic performance stats derived from trade rows (no Sharpe/Sortino fabrication).
     */
    async getPerformanceStats(period: '1d' | '1w' | '1m' | 'all' = 'all') {
        const now = Date.now();
        const periodMs: Record<string, number> = {
            '1d': 86400000,
            '1w': 7 * 86400000,
            '1m': 30 * 86400000,
            all: 0,
        };
        const cutoff = period === 'all' ? 0 : now - periodMs[period];

        let trades: TradeEntity[];
        try {
            if (cutoff > 0) {
                trades = await this.tradeRepo.find({
                    where: { closeTime: MoreThan(cutoff) },
                    order: { closeTime: 'DESC' },
                });
            } else {
                trades = await this.tradeRepo.find({ order: { closeTime: 'DESC' } });
            }
        } catch (err) {
            this.logger.error(`[DB] getPerformanceStats failed: ${err.message}`);
            trades = [];
        }

        const todayStart = new Date(this.getTodayDate()).getTime();
        const weekStart = now - 7 * 86400000;

        let totalPnl = 0;
        let todayPnl = 0;
        let weekPnl = 0;
        let winningTrades = 0;
        let losingTrades = 0;
        let winSum = 0;
        let lossSum = 0;
        let durationSum = 0;

        for (const t of trades) {
            const pnl = Number(t.pnl) || 0;
            totalPnl += pnl;
            if (Number(t.closeTime) >= todayStart) todayPnl += pnl;
            if (Number(t.closeTime) >= weekStart) weekPnl += pnl;
            if (pnl > 0) {
                winningTrades++;
                winSum += pnl;
            } else if (pnl < 0) {
                losingTrades++;
                lossSum += pnl;
            }
            durationSum += Number(t.duration) || 0;
        }

        const totalTrades = trades.length;
        const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
        const avgWin = winningTrades > 0 ? winSum / winningTrades : 0;
        const avgLoss = losingTrades > 0 ? lossSum / losingTrades : 0;
        const grossWins = winSum;
        const grossLosses = Math.abs(lossSum);
        const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;
        const avgDurationMs = totalTrades > 0 ? durationSum / totalTrades : 0;

        const peak = this.dailyStats.peakBalance;
        let maxDrawdownPercent = 0;
        // Approximate from sequential equity of closed trades in period
        let equity = 0;
        let peakEq = 0;
        const chronological = [...trades].sort(
            (a, b) => Number(a.closeTime) - Number(b.closeTime),
        );
        for (const t of chronological) {
            equity += Number(t.pnl) || 0;
            if (equity > peakEq) peakEq = equity;
            if (peakEq > 0) {
                const dd = ((peakEq - equity) / peakEq) * 100;
                if (dd > maxDrawdownPercent) maxDrawdownPercent = dd;
            }
        }

        return {
            period,
            totalPnl,
            todayPnl,
            weekPnl,
            winRate: Math.round(winRate * 10) / 10,
            totalTrades,
            winningTrades,
            losingTrades,
            avgWin,
            avgLoss,
            profitFactor: Number.isFinite(profitFactor)
                ? Math.round(profitFactor * 100) / 100
                : null,
            avgTradeDurationMs: avgDurationMs,
            maxDrawdownPercent: Math.round(maxDrawdownPercent * 10) / 10,
            peakBalance: peak,
            // Advanced ratios intentionally omitted — no returns-series engine yet
            sharpeRatio: null,
            sortinoRatio: null,
            calmarRatio: null,
        };
    }

    /**
     * Get daily trading stats
     */
    getDailyStats() {
        this.resetDailyStatsIfNeeded();
        return { ...this.dailyStats };
    }

    /**
     * Get total realized PnL from all closed positions — from database
     */
    async getTotalRealizedPnL(): Promise<number> {
        try {
            const result = await this.tradeRepo
                .createQueryBuilder('trade')
                .select('SUM(trade.pnl)', 'total')
                .getRawOne();
            return Number(result?.total) || 0;
        } catch (err) {
            this.logger.error(`[DB] Gagal menghitung total PnL: ${err.message}`);
            return 0;
        }
    }

    /**
     * Get trade history with optional filters
     */
    async getTradeHistory(params?: {
        symbol?: string;
        startDate?: string;
        endDate?: string;
        limit?: number;
    }): Promise<TradeEntity[]> {
        try {
            const query: any = {};
            if (params?.symbol) query.symbol = params.symbol;
            if (params?.startDate) query.closeTime = MoreThan(new Date(params.startDate).getTime());
            
            return await this.tradeRepo.find({
                where: query,
                order: { closeTime: 'DESC' },
                take: params?.limit || 50,
            });
        } catch (err) {
            this.logger.error(`[DB] Gagal mengambil trade history: ${err.message}`);
            return [];
        }
    }
}