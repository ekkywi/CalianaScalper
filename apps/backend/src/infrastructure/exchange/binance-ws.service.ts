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
    private ws: WebSocket;
    private readonly WS_URL = 'wss://stream.binance.com:9443';
    private readonly TIMEFRAME = '15m';

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly symbolService: SymbolService,
        private readonly binanceRestService: BinanceRestService,
    ) {}

    async onModuleInit() {
        await this.connect();
    }

    onModuleDestroy() {
        if (this.ws) this.ws.close();
    }

    private async connect() {
        try {
            const activeSymbols = await this.symbolService.getActiveSymbols();
            
            const baseStream = activeSymbols.length > 0 
                ? `${activeSymbols[0].symbol.toLowerCase()}@kline_${this.TIMEFRAME}` 
                : `btcusdt@kline_${this.TIMEFRAME}`;

            const url = `wss://stream.binance.com:9443/ws/${baseStream}`;
            this.ws = new WebSocket(url);

            this.ws.on('open', () => {
                this.logger.log(`Terhubung ke Binance WebSocket (Base: ${baseStream})`);

                if (activeSymbols.length > 1) {
                    const symbols = activeSymbols.slice(1).map(s => s.symbol);
                    this.subscribeToSymbols(symbols);
                }
            });

            this.ws.on('message', (data: WebSocket.RawData) => {
                this.handleMessage(data);
            });

            this.ws.on('close', () => {
                this.logger.warn('Koneksi WebSocket terputus. Mencoba reconnect dalam 5 detik...');
                setTimeout(() => this.connect(), 5000);
            });

            this.ws.on('error', (error) => {
                this.logger.error(`WebSocket Error: ${error.message}`);
            });
        } catch (error) {
            this.logger.error(`Gagal menginisialisasi WebSocket: ${error.message}`);
        }
    }

    private subscribeToSymbols(symbols: string[]) {
        if (this.ws.readyState !== WebSocket.OPEN) return;

        const streams = symbols.map(s => `${s.toLowerCase()}@kline_${this.TIMEFRAME}`);

        const payload = {
            method: 'SUBSCRIBE',
            params: streams,
            id: Date.now(),
        };

        this.ws.send(JSON.stringify(payload));
        this.logger.log(`[WS] Subscribe ke: ${symbols.join(', ')}`);
    }

    private unsubscribeFromSymbols(symbols: string[]) {
        if (this.ws.readyState !== WebSocket.OPEN) return;
        const streams = symbols.map(s => `${s.toLowerCase()}@kline_${this.TIMEFRAME}`);
        const payload = {
            method: 'UNSUBSCRIBE',
            params: streams,
            id: Date.now(),
        };
        
        this.ws.send(JSON.stringify(payload));
        this.logger.log(`[WS] Unsubscribed dari: ${symbols.join(', ')}`);
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
        this.logger.log(`[ORCHESTRATOR] Menyiapkan infrastruktur untuk simbol baru: ${symbol.symbol}`);
    
        await this.binanceRestService.backfillCandles(symbol.symbol, this.TIMEFRAME, 1000);
    
        this.subscribeToSymbols([symbol.symbol]);
    }

    @OnEvent('SYMBOL_STATUS_CHANGED')
    handleSymbolStatusChanged(symbol: SymbolEntity) {
        if (symbol.isActive) {
            this.subscribeToSymbols([symbol.symbol]);
        } else {
        this.unsubscribeFromSymbols([symbol.symbol]);
        }
    }

    @OnEvent('SYMBOL_REMOVED')
    handleSymbolRemoved(symbol: SymbolEntity) {
        this.unsubscribeFromSymbols([symbol.symbol]);
    }
}