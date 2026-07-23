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

export const MARKET_EVENTS = {
    CANDLE_TICK: 'market.candle.tick',
    CANDLE_CLOSED: 'market.candle.closed',
};