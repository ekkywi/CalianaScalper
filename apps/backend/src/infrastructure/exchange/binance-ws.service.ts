// apps/backend/src/infrastructure/exchange/binance-ws.service.ts

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import WebSocket from 'ws';
import { MARKET_EVENTS, type CandleData } from '../../core/domain/market.types';
import { SymbolService } from '../../application/symbol/symbol.service';
import { BinanceRestService } from './binance-rest.service';
import { SymbolEntity } from '../database/symbol.entity';

@Injectable()
export class BinanceWsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BinanceWsService.name);
    private ws: WebSocket | null = null;
    private readonly TIMEFRAME = '15m';
    private isIdle = true;
    private isDestroyed = false;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly symbolService: SymbolService,
        private readonly binanceRestService: BinanceRestService,
    ) {}

    async onModuleInit() {
        await this.connect();
    }

    onModuleDestroy() {
        this.isDestroyed = true;
        this.clearReconnectTimer();
        this.closeSocket(false);
    }

    private clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    private closeSocket(allowReconnect: boolean) {
        if (!this.ws) return;
        const socket = this.ws;
        this.ws = null;
        socket.removeAllListeners();
        if (!allowReconnect) {
            socket.on('close', () => {});
        }
        socket.close();
    }

    private goIdle(reason: string) {
        this.isIdle = true;
        this.clearReconnectTimer();
        this.closeSocket(false);
        this.logger.log(`[WS] Idle — ${reason}`);
    }

    private scheduleReconnect() {
        if (this.isDestroyed || this.isIdle) return;
        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect();
        }, 5000);
    }

    private async connect() {
        if (this.isDestroyed) return;

        try {
            const activeSymbols = await this.symbolService.getActiveSymbols();
            if (activeSymbols.length === 0) {
                this.goIdle('No active symbols — add a symbol to start market data');
                return;
            }

            this.isIdle = false;
            this.clearReconnectTimer();
            this.closeSocket(false);

            const baseStream = `${activeSymbols[0].symbol.toLowerCase()}@kline_${this.TIMEFRAME}`;
            const url = `wss://stream.binance.com:9443/ws/${baseStream}`;
            const socket = new WebSocket(url);
            this.ws = socket;

            socket.on('open', () => {
                this.logger.log(`Terhubung ke Binance WebSocket (Base: ${baseStream})`);
                if (activeSymbols.length > 1) {
                    const symbols = activeSymbols.slice(1).map((s) => s.symbol);
                    this.subscribeToSymbols(symbols);
                }
            });

            socket.on('message', (data: WebSocket.RawData) => {
                this.handleMessage(data);
            });

            socket.on('close', () => {
                if (this.ws === socket) {
                    this.ws = null;
                }
                if (this.isDestroyed || this.isIdle) {
                    return;
                }
                this.logger.warn(
                    'Koneksi WebSocket terputus. Mencoba reconnect dalam 5 detik...',
                );
                this.scheduleReconnect();
            });

            socket.on('error', (error) => {
                this.logger.error(`WebSocket Error: ${error.message}`);
            });
        } catch (error) {
            this.logger.error(`Gagal menginisialisasi WebSocket: ${error.message}`);
            if (!this.isDestroyed && !this.isIdle) {
                this.scheduleReconnect();
            }
        }
    }

    private isSocketOpen(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }

    private subscribeToSymbols(symbols: string[]) {
        if (!this.isSocketOpen() || symbols.length === 0) return;

        const streams = symbols.map((s) => `${s.toLowerCase()}@kline_${this.TIMEFRAME}`);
        const payload = {
            method: 'SUBSCRIBE',
            params: streams,
            id: Date.now(),
        };

        this.ws!.send(JSON.stringify(payload));
        this.logger.log(`[WS] Subscribe ke: ${symbols.join(', ')}`);
    }

    private unsubscribeFromSymbols(symbols: string[]) {
        if (!this.isSocketOpen() || symbols.length === 0) return;

        const streams = symbols.map((s) => `${s.toLowerCase()}@kline_${this.TIMEFRAME}`);
        const payload = {
            method: 'UNSUBSCRIBE',
            params: streams,
            id: Date.now(),
        };

        this.ws!.send(JSON.stringify(payload));
        this.logger.log(`[WS] Unsubscribed dari: ${symbols.join(', ')}`);
    }

    private async syncConnectionAfterSymbolChange() {
        const activeSymbols = await this.symbolService.getActiveSymbols();
        if (activeSymbols.length === 0) {
            this.goIdle('No active symbols remaining');
        }
    }

    private handleMessage(data: WebSocket.RawData) {
        const parsed = JSON.parse(data.toString());
        if (!parsed.e || parsed.e !== 'kline') return;
        const k = parsed.k;
        const candle: CandleData = {
            symbol: parsed.s,
            startTime: k.t,
            closeTime: k.T,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            isClosed: k.x,
        };

        this.eventEmitter.emit(MARKET_EVENTS.CANDLE_TICK, candle);

        if (candle.isClosed) {
            this.eventEmitter.emit(MARKET_EVENTS.CANDLE_CLOSED, candle);
        }
    }

    @OnEvent('SYMBOL_ADDED')
    async handleSymbolAdded(symbol: SymbolEntity) {
        this.logger.log(
            `[WS] Menyiapkan infrastruktur untuk simbol baru: ${symbol.symbol}`,
        );

        await this.binanceRestService.backfillCandles(symbol.symbol, this.TIMEFRAME, 1000);

        if (this.isIdle || !this.isSocketOpen()) {
            await this.connect();
            return;
        }

        this.subscribeToSymbols([symbol.symbol]);
    }

    @OnEvent('SYMBOL_STATUS_CHANGED')
    async handleSymbolStatusChanged(symbol: SymbolEntity) {
        if (symbol.isActive) {
            if (this.isIdle || !this.isSocketOpen()) {
                await this.connect();
                return;
            }
            this.subscribeToSymbols([symbol.symbol]);
            return;
        }

        this.unsubscribeFromSymbols([symbol.symbol]);
        await this.syncConnectionAfterSymbolChange();
    }

    @OnEvent('SYMBOL_REMOVED')
    async handleSymbolRemoved(symbol: SymbolEntity) {
        this.unsubscribeFromSymbols([symbol.symbol]);
        await this.syncConnectionAfterSymbolChange();
    }
}
