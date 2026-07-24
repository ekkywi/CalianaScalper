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
    maxPositionSizePercent: number;      // Max % of account per position (e.g., 0.02 = 2%)
    stopLossPercent: number;             // SL as % from entry (e.g., 0.03 = 3%)
    takeProfitPercent: number;           // TP as % from entry (e.g., 0.06 = 6%)
    maxDailyLossPercent: number;         // Stop trading if daily loss exceeds this (e.g., 0.05 = 5%)
    maxDrawdownPercent: number;          // Stop trading if drawdown exceeds this (e.g., 0.15 = 15%)
    maxOpenPositions: number;            // Max concurrent positions (e.g., 3)
    maxTradesPerDay: number;             // Max trades per day (e.g., 10)
    minConfidenceThreshold: number;      // Min ML confidence to trade (e.g., 0.65)
    slippageProtectionPercent: number;   // Max acceptable slippage (e.g., 0.005 = 0.5%)
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
    maxPositionSizePercent: 0.02,
    stopLossPercent: 0.03,
    takeProfitPercent: 0.06,
    maxDailyLossPercent: 0.05,
    maxDrawdownPercent: 0.15,
    maxOpenPositions: 3,
    maxTradesPerDay: 10,
    minConfidenceThreshold: 0.65,
    slippageProtectionPercent: 0.005,
};

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
};