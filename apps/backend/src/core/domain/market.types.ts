// src/code/domain/market.types.ts

export interface CandleData {
    symbol: string;
    startTime: number;
    closeTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    isClosed: boolean;
}

export interface Position {
    symbol: string;
    side: 'LONG';
    entryPrice: number;
    quantity: number;
    stopLoss: number;
    takeProfit: number;
    entryTime: number;
    status: 'OPEN' | 'CLOSED_BY_TP' | 'CLOSED_BY_SL' | 'CLOSED_BY_SIGNAL' | 'CLOSED_BY_MANUAL';
    closePrice?: number;
    closeTime?: number;
    unrealizedPnL: number;
    realizedPnL: number;
    /** Set when position opened from ML orchestrator BUY */
    mlSignal?: string;
    mlConfidence?: number;
    mlAlgorithm?: string;
}

export interface MlTradeContext {
    signal: string;
    confidence: number;
    algorithm?: string;
}

export interface OrderResult {
    id: string;
    symbol: string;
    side: 'buy' | 'sell';
    type: 'MARKET' | 'LIMIT' | 'STOP_LOSS';
    quantity: number;
    filledQuantity: number;
    price: number;
    averagePrice: number;
    status: 'NEW' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED';
    timestamp: number;
}

export interface AccountBalance {
    asset: string;
    free: number;
    used: number;
    total: number;
}

export interface RiskConfig {
    maxPositionSizePercent: number;
    maxDailyLossPercent: number;
    maxDrawdownPercent: number;
    /** Daily drawdown limit — resets at midnight UTC. 0 = disabled. */
    maxDailyDrawdownPercent: number;
    /** Weekly drawdown limit — resets Monday 00:00 UTC. 0 = disabled. */
    maxWeeklyDrawdownPercent: number;
    maxOpenPositions: number;
    maxTradesPerDay: number;
    minConfidenceThreshold: number;
    slippageProtectionPercent: number;
    mlShadowMode: boolean;
    mlRegimeGateEnabled: boolean;
    /** Cooldown minutes after drawdown halt before resume is allowed. 0 = immediate. */
    drawdownCooldownMinutes: number;
    /**
     * Gradual sizing tiers: at N% of max drawdown consumed, scale position size.
     * E.g. [{ threshold: 0.5, scale: 0.5 }, { threshold: 0.75, scale: 0.25 }]
     * means at 50% of max drawdown → 50% sizing, at 75% → 25% sizing.
     */
    drawdownThrottleTiers: DrawdownThrottleTier[];
    /**
     * @deprecated Not used for live execution. Kept for DB backward compatibility only.
     * Live SL/TP live on TradingProfileEntity.
     */
    stopLossPercent?: number;
    /**
     * @deprecated Not used for live execution. Kept for DB backward compatibility only.
     */
    takeProfitPercent?: number;
}

export interface DrawdownThrottleTier {
    /** Fraction of maxDrawdownPercent consumed (0–1). E.g. 0.5 = 50% of limit used. */
    threshold: number;
    /** Scale factor for position size (0–1). E.g. 0.5 = half normal size. */
    scale: number;
}

export interface DrawdownSnapshot {
    timestamp: number;
    equity: number;
    peakBalance: number;
    dailyPeak: number;
    weeklyPeak: number;
    drawdownPercent: number;
    dailyDrawdownPercent: number;
    weeklyDrawdownPercent: number;
    throttleScale: number;
    layer: 'ok' | 'daily' | 'weekly' | 'max';
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
    maxPositionSizePercent: 0.01,
    maxDailyLossPercent: 0.05,
    maxDrawdownPercent: 0.15,
    maxDailyDrawdownPercent: 0.05,
    maxWeeklyDrawdownPercent: 0.10,
    maxOpenPositions: 3,
    maxTradesPerDay: 10,
    minConfidenceThreshold: 0.65,
    slippageProtectionPercent: 0.005,
    mlShadowMode: false,
    mlRegimeGateEnabled: true,
    drawdownCooldownMinutes: 60,
    drawdownThrottleTiers: [
        { threshold: 0.5, scale: 0.5 },
        { threshold: 0.75, scale: 0.25 },
    ],
    stopLossPercent: 0.03,
    takeProfitPercent: 0.06,
};

/** Defaults when creating a trading profile manually (not from Risk). */
export const DEFAULT_EXECUTION_PARAMS = {
    stopLossPercent: 0.03,
    takeProfitPercent: 0.06,
    maxHorizonCandles: 96,
} as const;

/** Snake_case payload for ML engine label_config / drift compare */
export interface MlLabelConfigPayload {
    stop_loss_percent: number;
    take_profit_percent: number;
    max_horizon_candles: number;
    label_mode?: string;
    round_trip_fee_percent?: number;
}

export type DriftStatus = 'ok' | 'mismatch' | 'unknown' | 'incomplete';

export interface StrategyPairStatus {
    symbol: string;
    status: DriftStatus;
    fields: string[];
    blockBuy: boolean;
    profile: {
        id: string | null;
        name: string | null;
        stopLossPercent: number | null;
        takeProfitPercent: number | null;
        maxHorizonCandles: number | null;
    };
    model: {
        id: string | null;
        name: string | null;
        engineModelId: string | null;
        labelConfig: MlLabelConfigPayload | null;
    };
    message: string;
}

export function horizonForTakeProfit(takeProfitPercent: number): number {
    return Math.max(96, Math.ceil(takeProfitPercent * 800));
}

export function paramsMatch(
    a: { stopLossPercent: number; takeProfitPercent: number; maxHorizonCandles: number },
    b: MlLabelConfigPayload,
    eps = 1e-6,
): { ok: boolean; fields: string[] } {
    const fields: string[] = [];
    if (Math.abs(a.stopLossPercent - b.stop_loss_percent) >= eps) fields.push('stop_loss_percent');
    if (Math.abs(a.takeProfitPercent - b.take_profit_percent) >= eps) fields.push('take_profit_percent');
    if (Math.abs(a.maxHorizonCandles - b.max_horizon_candles) >= eps) fields.push('max_horizon_candles');
    return { ok: fields.length === 0, fields };
}

/** Paper = Binance spot testnet/sandbox; Live = spot mainnet real capital */
export type TradingMode = 'paper' | 'live';

export const MARKET_EVENTS = {
    CANDLE_TICK: 'market.candle.tick',
    CANDLE_CLOSED: 'market.candle.closed',
    POSITION_OPENED: 'position.opened',
    POSITION_CLOSED: 'position.closed',
    ORDER_FILLED: 'order.filled',
    ORDER_REJECTED: 'order.rejected',
    RISK_BREACHED: 'risk.breached',
    TRADING_HALTED: 'trading.halted',
    TRADING_RESUMED: 'trading.resumed',
    TRADING_MODE_CHANGED: 'trading.mode.changed',
    DRAWDOWN_ALERT: 'drawdown.alert',
    DRAWDOWN_SNAPSHOT: 'drawdown.snapshot',
};