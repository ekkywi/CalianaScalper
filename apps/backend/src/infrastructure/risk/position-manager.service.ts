// apps/backend/src/infrastructure/risk/position-manager.service.ts
// Position Manager dengan database persistence — menggantikan in-memory Map

import {
    forwardRef,
    Inject,
    Injectable,
    Logger,
    OnModuleInit,
    Optional,
} from '@nestjs/common';
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
    MlTradeContext,
    DrawdownSnapshot,
    DrawdownThrottleTier,
} from '../../core/domain/market.types';
import { OrderEntity } from '../database/order.entity';
import { PositionEntity } from '../database/position.entity';
import { TradeEntity } from '../database/trade.entity';
import { SystemConfigEntity } from '../database/system-config.entity';
import { BinanceExecutionService } from '../exchange/binance-execution.service';
import { StrategyService } from '../strategy/strategy.service';

@Injectable()
export class PositionManagerService implements OnModuleInit {
    private readonly logger = new Logger(PositionManagerService.name);
    
    // Cache in-memory untuk akses cepat (sinkron dengan DB)
    private positionsCache: Map<string, Position> = new Map();
    private riskConfig: RiskConfig;
    private tradingHalted: boolean = false;
    private haltReason: string | null = null;
    private haltedAt: number | null = null;
    private dailyStats: {
        date: string;
        trades: number;
        loss: number;
        peakBalance: number;
        dailyPeak: number;
        weeklyPeak: number;
        weekStart: string;
    } = {
        date: this.getTodayDate(),
        trades: 0,
        loss: 0,
        peakBalance: 0,
        dailyPeak: 0,
        weeklyPeak: 0,
        weekStart: this.getWeekStartDate(),
    };
    private drawdownHistory: DrawdownSnapshot[] = [];
    private perSymbolDrawdown: Map<string, { peak: number; current: number }> = new Map();
    private drawdownAlertEmitted: Set<string> = new Set();

    private static readonly HALT_CONFIG_KEY = 'trading_halted';
    private static readonly PEAK_BALANCE_KEY = 'peak_balance';
    private static readonly DRAWDOWN_PEAKS_KEY = 'drawdown_peaks';
    private static readonly DRAWDOWN_HISTORY_KEY = 'drawdown_history';

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
        @Optional()
        @Inject(forwardRef(() => StrategyService))
        private readonly strategy?: StrategyService,
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

            // 4b. Load daily/weekly peaks
            const peaksEntity = await this.configRepo.findOne({
                where: { key: PositionManagerService.DRAWDOWN_PEAKS_KEY },
            });
            const peaks = peaksEntity?.value as {
                dailyPeak?: number;
                dailyDate?: string;
                weeklyPeak?: number;
                weekStart?: string;
            } | undefined;
            const weekStart = this.getWeekStartDate();
            const dailyPeak = (peaks?.dailyDate === today ? peaks?.dailyPeak : 0) || 0;
            const weeklyPeak = (peaks?.weekStart === weekStart ? peaks?.weeklyPeak : 0) || 0;

            this.dailyStats = {
                date: today,
                trades: todayTrades.length,
                loss: totalLoss,
                peakBalance,
                dailyPeak,
                weeklyPeak,
                weekStart,
            };

            // 4c. Load drawdown history
            const histEntity = await this.configRepo.findOne({
                where: { key: PositionManagerService.DRAWDOWN_HISTORY_KEY },
            });
            if (histEntity?.value && Array.isArray((histEntity.value as any).snapshots)) {
                this.drawdownHistory = (histEntity.value as any).snapshots;
            }

            // 5. Load trading halt flag (survives restart)
            const haltEntity = await this.configRepo.findOne({
                where: { key: PositionManagerService.HALT_CONFIG_KEY },
            });
            if (haltEntity?.value) {
                const haltVal = haltEntity.value as {
                    halted?: boolean;
                    reason?: string | null;
                    haltedAt?: number | null;
                };
                this.tradingHalted = Boolean(haltVal.halted);
                this.haltReason = this.tradingHalted
                    ? haltVal.reason || 'UNKNOWN'
                    : null;
                this.haltedAt = haltVal.haltedAt ?? null;
                if (this.tradingHalted) {
                    this.logger.warn(
                        `[PERSIST] Trading was halted (${this.haltReason}) — remaining halted after restart`,
                    );
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
            const value = {
                halted: this.tradingHalted,
                reason: this.tradingHalted ? this.haltReason : null,
                haltedAt: this.tradingHalted ? this.haltedAt : null,
            };
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
     * Compute current equity = balance + sum(unrealizedPnL of all open positions).
     */
    private computeEquity(currentBalance: number): number {
        let totalUnrealized = 0;
        for (const pos of this.positionsCache.values()) {
            if (pos.status === 'OPEN') {
                totalUnrealized += pos.unrealizedPnL || 0;
            }
        }
        return currentBalance + totalUnrealized;
    }

    /**
     * Get the drawdown throttle scale factor (1.0 = normal, <1 = reduced sizing).
     */
    getDrawdownThrottleScale(currentBalance?: number): number {
        const equity = currentBalance != null ? this.computeEquity(currentBalance) : 0;
        const peak = this.dailyStats.peakBalance;
        if (peak <= 0 || equity >= peak) return 1;

        const ddFraction = (peak - equity) / peak / this.riskConfig.maxDrawdownPercent;
        const tiers = [...(this.riskConfig.drawdownThrottleTiers || [])]
            .sort((a, b) => b.threshold - a.threshold);

        for (const tier of tiers) {
            if (ddFraction >= tier.threshold) return tier.scale;
        }
        return 1;
    }

    /**
     * Multi-layer equity-based drawdown check.
     * Layers: daily → weekly → max (all-time trailing).
     * Emits alerts at 50% and 75% of each limit.
     */
    async updateEquityAndCheckDrawdown(currentBalance: number): Promise<boolean> {
        if (currentBalance <= 0) return !this.tradingHalted;

        this.resetDrawdownPeriodsIfNeeded();
        const equity = this.computeEquity(currentBalance);

        // Update peaks
        if (equity > this.dailyStats.peakBalance) {
            this.dailyStats.peakBalance = equity;
            await this.persistPeakBalance();
        }
        if (equity > this.dailyStats.dailyPeak) {
            this.dailyStats.dailyPeak = equity;
        }
        if (equity > this.dailyStats.weeklyPeak) {
            this.dailyStats.weeklyPeak = equity;
        }
        await this.persistDrawdownPeaks();

        const peak = this.dailyStats.peakBalance;
        const dailyPeak = this.dailyStats.dailyPeak;
        const weeklyPeak = this.dailyStats.weeklyPeak;

        const ddMax = peak > 0 ? (peak - equity) / peak : 0;
        const ddDaily = dailyPeak > 0 ? (dailyPeak - equity) / dailyPeak : 0;
        const ddWeekly = weeklyPeak > 0 ? (weeklyPeak - equity) / weeklyPeak : 0;

        // Emit alerts at 50% and 75% of each limit
        this.emitDrawdownAlerts('daily', ddDaily, this.riskConfig.maxDailyDrawdownPercent);
        this.emitDrawdownAlerts('weekly', ddWeekly, this.riskConfig.maxWeeklyDrawdownPercent);
        this.emitDrawdownAlerts('max', ddMax, this.riskConfig.maxDrawdownPercent);

        const throttle = this.getDrawdownThrottleScale(currentBalance);

        // Record snapshot
        const snapshot: DrawdownSnapshot = {
            timestamp: Date.now(),
            equity,
            peakBalance: peak,
            dailyPeak,
            weeklyPeak,
            drawdownPercent: ddMax,
            dailyDrawdownPercent: ddDaily,
            weeklyDrawdownPercent: ddWeekly,
            throttleScale: throttle,
            layer: 'ok',
        };

        // Layer 1: Daily drawdown
        if (this.riskConfig.maxDailyDrawdownPercent > 0 && ddDaily >= this.riskConfig.maxDailyDrawdownPercent) {
            this.logger.error(
                `[DRAWDOWN-DAILY] ${(ddDaily * 100).toFixed(2)}% >= limit ${(this.riskConfig.maxDailyDrawdownPercent * 100).toFixed(2)}%`,
            );
            snapshot.layer = 'daily';
            this.recordDrawdownSnapshot(snapshot);
            await this.haltTrading('MAX_DAILY_DRAWDOWN');
            return false;
        }

        // Layer 2: Weekly drawdown
        if (this.riskConfig.maxWeeklyDrawdownPercent > 0 && ddWeekly >= this.riskConfig.maxWeeklyDrawdownPercent) {
            this.logger.error(
                `[DRAWDOWN-WEEKLY] ${(ddWeekly * 100).toFixed(2)}% >= limit ${(this.riskConfig.maxWeeklyDrawdownPercent * 100).toFixed(2)}%`,
            );
            snapshot.layer = 'weekly';
            this.recordDrawdownSnapshot(snapshot);
            await this.haltTrading('MAX_WEEKLY_DRAWDOWN');
            return false;
        }

        // Layer 3: Max (all-time trailing) drawdown
        if (peak > 0 && ddMax >= this.riskConfig.maxDrawdownPercent) {
            this.logger.error(
                `[DRAWDOWN] ${(ddMax * 100).toFixed(2)}% >= max ${(this.riskConfig.maxDrawdownPercent * 100).toFixed(2)}%`,
            );
            snapshot.layer = 'max';
            this.recordDrawdownSnapshot(snapshot);
            await this.haltTrading('MAX_DRAWDOWN');
            return false;
        }

        this.recordDrawdownSnapshot(snapshot);
        return !this.tradingHalted;
    }

    private emitDrawdownAlerts(layer: string, current: number, limit: number): void {
        if (limit <= 0) return;
        const pct = current / limit;
        for (const level of [0.5, 0.75]) {
            const key = `${layer}_${level}`;
            if (pct >= level && !this.drawdownAlertEmitted.has(key)) {
                this.drawdownAlertEmitted.add(key);
                const msg = `[DRAWDOWN-ALERT] ${layer} drawdown at ${(current * 100).toFixed(1)}% — ${(level * 100).toFixed(0)}% of ${(limit * 100).toFixed(1)}% limit`;
                this.logger.warn(msg);
                this.eventEmitter.emit(MARKET_EVENTS.DRAWDOWN_ALERT, {
                    layer,
                    level,
                    currentPercent: current,
                    limitPercent: limit,
                    message: msg,
                });
            }
            if (pct < level && this.drawdownAlertEmitted.has(key)) {
                this.drawdownAlertEmitted.delete(key);
            }
        }
    }

    private recordDrawdownSnapshot(snapshot: DrawdownSnapshot): void {
        this.drawdownHistory.push(snapshot);
        if (this.drawdownHistory.length > 500) {
            this.drawdownHistory = this.drawdownHistory.slice(-500);
        }
        this.eventEmitter.emit(MARKET_EVENTS.DRAWDOWN_SNAPSHOT, snapshot);
        this.persistDrawdownHistory().catch(() => {});
    }

    /**
     * Track per-symbol drawdown from realized + unrealized PnL.
     */
    updatePerSymbolDrawdown(symbol: string, equity: number): void {
        const existing = this.perSymbolDrawdown.get(symbol);
        if (!existing) {
            this.perSymbolDrawdown.set(symbol, { peak: equity, current: equity });
        } else {
            if (equity > existing.peak) existing.peak = equity;
            existing.current = equity;
        }
    }

    getPerSymbolDrawdown(): Record<string, { peak: number; current: number; drawdownPercent: number }> {
        const result: Record<string, { peak: number; current: number; drawdownPercent: number }> = {};
        for (const [sym, data] of this.perSymbolDrawdown.entries()) {
            const dd = data.peak > 0 ? (data.peak - data.current) / data.peak : 0;
            result[sym] = { ...data, drawdownPercent: dd };
        }
        return result;
    }

    private async persistDrawdownPeaks(): Promise<void> {
        try {
            const existing = await this.configRepo.findOne({
                where: { key: PositionManagerService.DRAWDOWN_PEAKS_KEY },
            });
            const value = {
                dailyPeak: this.dailyStats.dailyPeak,
                dailyDate: this.dailyStats.date,
                weeklyPeak: this.dailyStats.weeklyPeak,
                weekStart: this.dailyStats.weekStart,
            };
            if (existing) {
                existing.value = value as any;
                existing.updatedAt = Date.now();
                await this.configRepo.save(existing);
            } else {
                await this.configRepo.save({
                    key: PositionManagerService.DRAWDOWN_PEAKS_KEY,
                    value: value as any,
                    updatedAt: Date.now(),
                });
            }
        } catch (err) {
            this.logger.error(`[PERSIST] Failed to persist drawdown peaks: ${err.message}`);
        }
    }

    private async persistDrawdownHistory(): Promise<void> {
        try {
            const existing = await this.configRepo.findOne({
                where: { key: PositionManagerService.DRAWDOWN_HISTORY_KEY },
            });
            const value = { snapshots: this.drawdownHistory.slice(-200) };
            if (existing) {
                existing.value = value as any;
                existing.updatedAt = Date.now();
                await this.configRepo.save(existing);
            } else {
                await this.configRepo.save({
                    key: PositionManagerService.DRAWDOWN_HISTORY_KEY,
                    value: value as any,
                    updatedAt: Date.now(),
                });
            }
        } catch (err) {
            this.logger.error(`[PERSIST] Failed to persist drawdown history: ${err.message}`);
        }
    }

    getDrawdownHistory(): DrawdownSnapshot[] {
        return [...this.drawdownHistory];
    }

    getDrawdownStatus(): {
        equity: number;
        peakBalance: number;
        dailyPeak: number;
        weeklyPeak: number;
        drawdownPercent: number;
        dailyDrawdownPercent: number;
        weeklyDrawdownPercent: number;
        throttleScale: number;
        cooldownRemainingMs: number;
    } {
        const peak = this.dailyStats.peakBalance;
        const dailyPeak = this.dailyStats.dailyPeak;
        const weeklyPeak = this.dailyStats.weeklyPeak;
        const equity = peak;
        const dd = peak > 0 ? Math.max(0, (peak - equity) / peak) : 0;
        const ddDaily = dailyPeak > 0 ? Math.max(0, (dailyPeak - equity) / dailyPeak) : 0;
        const ddWeekly = weeklyPeak > 0 ? Math.max(0, (weeklyPeak - equity) / weeklyPeak) : 0;
        return {
            equity,
            peakBalance: peak,
            dailyPeak,
            weeklyPeak,
            drawdownPercent: dd,
            dailyDrawdownPercent: ddDaily,
            weeklyDrawdownPercent: ddWeekly,
            throttleScale: this.getDrawdownThrottleScale(),
            cooldownRemainingMs: this.getCooldownRemainingMs(),
        };
    }

    /**
     * Reset peak balance (admin action after review).
     * Optionally set to a specific value, or reset to 0 (next balance reading becomes new peak).
     */
    async resetPeakBalance(newPeak?: number): Promise<void> {
        this.dailyStats.peakBalance = newPeak ?? 0;
        this.dailyStats.dailyPeak = newPeak ?? 0;
        this.dailyStats.weeklyPeak = newPeak ?? 0;
        this.drawdownAlertEmitted.clear();
        await this.persistPeakBalance();
        await this.persistDrawdownPeaks();
        this.logger.log(`[DRAWDOWN] Peak balance reset to ${this.dailyStats.peakBalance}`);
    }

    private getCooldownRemainingMs(): number {
        if (!this.haltedAt || !this.tradingHalted) return 0;
        const cooldownMs = (this.riskConfig.drawdownCooldownMinutes || 0) * 60 * 1000;
        if (cooldownMs <= 0) return 0;
        const elapsed = Date.now() - this.haltedAt;
        return Math.max(0, cooldownMs - elapsed);
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
            mlSignal: position.mlSignal ?? null,
            mlConfidence: position.mlConfidence ?? null,
            mlAlgorithm: position.mlAlgorithm ?? null,
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
            mlSignal: entity.mlSignal ?? undefined,
            mlConfidence:
                entity.mlConfidence != null ? Number(entity.mlConfidence) : undefined,
            mlAlgorithm: entity.mlAlgorithm ?? undefined,
        };
    }

    private getTodayDate(): string {
        return new Date().toISOString().split('T')[0];
    }

    private getWeekStartDate(): string {
        const d = new Date();
        const day = d.getUTCDay();
        const diff = day === 0 ? 6 : day - 1;
        d.setUTCDate(d.getUTCDate() - diff);
        return d.toISOString().split('T')[0];
    }

    private resetDailyStatsIfNeeded(): void {
        const today = this.getTodayDate();
        const weekStart = this.getWeekStartDate();
        if (this.dailyStats.date !== today) {
            const prevPeak = this.dailyStats.peakBalance;
            const prevWeeklyPeak = this.dailyStats.weekStart === weekStart
                ? this.dailyStats.weeklyPeak
                : 0;
            this.dailyStats = {
                date: today,
                trades: 0,
                loss: 0,
                peakBalance: prevPeak,
                dailyPeak: 0,
                weeklyPeak: prevWeeklyPeak,
                weekStart,
            };
            this.drawdownAlertEmitted.clear();

            // Auto-resume daily drawdown halts at midnight
            if (this.tradingHalted && this.haltReason === 'MAX_DAILY_DRAWDOWN') {
                this.logger.log('[DRAWDOWN] Daily reset — auto-resuming from MAX_DAILY_DRAWDOWN halt');
                this.tradingHalted = false;
                this.haltReason = null;
                this.haltedAt = null;
                this.persistHaltState().catch(() => {});
                this.eventEmitter.emit(MARKET_EVENTS.TRADING_RESUMED, { reason: 'daily_reset' });
            }
        }
        if (this.dailyStats.weekStart !== weekStart) {
            this.dailyStats.weeklyPeak = 0;
            this.dailyStats.weekStart = weekStart;

            if (this.tradingHalted && this.haltReason === 'MAX_WEEKLY_DRAWDOWN') {
                this.logger.log('[DRAWDOWN] Weekly reset — auto-resuming from MAX_WEEKLY_DRAWDOWN halt');
                this.tradingHalted = false;
                this.haltReason = null;
                this.haltedAt = null;
                this.persistHaltState().catch(() => {});
                this.eventEmitter.emit(MARKET_EVENTS.TRADING_RESUMED, { reason: 'weekly_reset' });
            }
        }
    }

    private resetDrawdownPeriodsIfNeeded(): void {
        this.resetDailyStatsIfNeeded();
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

    getHaltReason(): string | null {
        return this.tradingHalted ? this.haltReason : null;
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
     * Calculate position size based on account balance and risk config.
     * Uses active trading profile SL when available.
     */
    calculatePositionSize(
        balance: AccountBalance,
        entryPrice: number,
        symbol?: string,
    ): number {
        const riskAmount = balance.total * this.riskConfig.maxPositionSizePercent;
        const exec = symbol && this.strategy
            ? this.strategy.getActiveExecutionSync(symbol)
            : null;
        if (!exec) {
            this.logger.warn(
                `[POSITION-SIZING] No active trading profile for ${symbol ?? '?'} — size=0`,
            );
            return 0;
        }
        const slPercent = exec.stopLossPercent;
        const stopLossDistance = entryPrice * slPercent;
        
        const throttle = this.getDrawdownThrottleScale(balance.total);
        const scaledRisk = riskAmount * throttle;
        const positionSize = scaledRisk / stopLossDistance;
        const roundedSize = Math.floor(positionSize * 1000000) / 1000000;
        
        this.logger.log(
            `[POSITION-SIZING] Balance: ${balance.total} USDT | ` +
            `RiskAmount: ${riskAmount.toFixed(2)} USDT | Throttle: ${throttle} | ` +
            `ScaledRisk: ${scaledRisk.toFixed(2)} USDT | ` +
            `EntryPrice: ${entryPrice} | SL ${(slPercent * 100).toFixed(2)}% Distance: ${stopLossDistance.toFixed(2)} | ` +
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
        mlContext?: MlTradeContext,
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

        // Calculate SL and TP from active trading profile (required for auto-bot)
        const exec = this.strategy?.getActiveExecutionSync(symbol);
        if (!exec) {
            this.logger.error(
                `[RISK] No active trading profile for ${symbol} — cannot open position`,
            );
            return null;
        }
        const stopLoss = side === 'LONG' 
            ? entryPrice * (1 - exec.stopLossPercent)
            : entryPrice * (1 + exec.stopLossPercent);
        
        const takeProfit = side === 'LONG'
            ? entryPrice * (1 + exec.takeProfitPercent)
            : entryPrice * (1 - exec.takeProfitPercent);

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
            ...(mlContext
                ? {
                      mlSignal: mlContext.signal,
                      mlConfidence: mlContext.confidence,
                      mlAlgorithm: mlContext.algorithm,
                  }
                : {}),
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
                positionId: symbol,
                mlSignal: position.mlSignal ?? null,
                mlConfidence: position.mlConfidence ?? null,
                mlAlgorithm: position.mlAlgorithm ?? null,
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

            // Per-symbol drawdown tracking
            const symEquity = position.entryPrice * position.quantity + position.unrealizedPnL;
            this.updatePerSymbolDrawdown(position.symbol, symEquity);

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
        this.haltReason = reason;
        this.haltedAt = Date.now();
        await this.persistHaltState();
        this.logger.error(`[RISK-BREACH] Trading dihentikan: ${reason}`);
        this.eventEmitter.emit(MARKET_EVENTS.RISK_BREACHED, { reason });
        this.eventEmitter.emit(MARKET_EVENTS.TRADING_HALTED, { reason });
    }

    /**
     * Resume trading after risk breach
     */
    async resumeTrading(force = false): Promise<{ resumed: boolean; cooldownRemainingMs: number }> {
        const remaining = this.getCooldownRemainingMs();
        const isDrawdownHalt = ['MAX_DRAWDOWN', 'MAX_DAILY_DRAWDOWN', 'MAX_WEEKLY_DRAWDOWN'].includes(this.haltReason || '');
        if (!force && isDrawdownHalt && remaining > 0) {
            this.logger.warn(
                `[RISK] Resume blocked — cooldown ${Math.ceil(remaining / 60000)}min remaining`,
            );
            return { resumed: false, cooldownRemainingMs: remaining };
        }
        this.tradingHalted = false;
        this.haltReason = null;
        this.haltedAt = null;
        this.drawdownAlertEmitted.clear();
        await this.persistHaltState();
        this.logger.log('[RISK] Trading dilanjutkan kembali.');
        this.eventEmitter.emit(MARKET_EVENTS.TRADING_RESUMED, {});
        return { resumed: true, cooldownRemainingMs: 0 };
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
     * Performance stats for trades opened via ML BUY (paper or live).
     */
    async getMlTradeStats(period: '1d' | '1w' | '1m' | 'all' = 'all') {
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
            const qb = this.tradeRepo
                .createQueryBuilder('trade')
                .where('trade.mlSignal IS NOT NULL')
                .orderBy('trade.closeTime', 'DESC');
            if (cutoff > 0) {
                qb.andWhere('trade.closeTime > :cutoff', { cutoff });
            }
            trades = await qb.getMany();
        } catch (err) {
            this.logger.error(`[DB] getMlTradeStats failed: ${err.message}`);
            trades = [];
        }

        let totalPnl = 0;
        let winningTrades = 0;
        let losingTrades = 0;
        let confidenceSum = 0;
        let confidenceCount = 0;
        const bySymbol: Record<
            string,
            { trades: number; pnl: number; wins: number }
        > = {};

        for (const t of trades) {
            const pnl = Number(t.pnl) || 0;
            totalPnl += pnl;
            if (pnl > 0) winningTrades += 1;
            else if (pnl < 0) losingTrades += 1;

            const conf = t.mlConfidence != null ? Number(t.mlConfidence) : null;
            if (conf != null && Number.isFinite(conf)) {
                confidenceSum += conf;
                confidenceCount += 1;
            }

            const sym = t.symbol;
            if (!bySymbol[sym]) {
                bySymbol[sym] = { trades: 0, pnl: 0, wins: 0 };
            }
            bySymbol[sym].trades += 1;
            bySymbol[sym].pnl += pnl;
            if (pnl > 0) bySymbol[sym].wins += 1;
        }

        const totalTrades = trades.length;
        return {
            period,
            totalTrades,
            winningTrades,
            losingTrades,
            winRate:
                totalTrades > 0
                    ? Math.round((winningTrades / totalTrades) * 1000) / 1000
                    : null,
            totalPnl: Math.round(totalPnl * 100) / 100,
            avgConfidence:
                confidenceCount > 0
                    ? Math.round((confidenceSum / confidenceCount) * 1000) / 1000
                    : null,
            bySymbol,
            disclaimer:
                'Trades opened by bot ML BUY only (mlSignal set). Manual orders excluded.',
        };
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