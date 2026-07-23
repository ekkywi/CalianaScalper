// apps/backend/src/infrastructure/exchange/binance-ws.service.ts

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import WebSocket from 'ws';
import { CandleData, MARKET_EVENTS } from '../../core/domain/market.types';

@Injectable()
export class BinanceWsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(BinanceWsService.name);
    private ws: WebSocket;
    private readonly streamUrl = 'wss://stream.binance.com:9443/ws/btcusdt@kline_15m';

    constructor(private eventEmitter: EventEmitter2) {}

    onModuleInit() {
        this.connect();
    }

    private connect() {
        this.logger.log(`Menuhubungkan ke Exchange Adapter: ${this.streamUrl}`);
        this.ws = new WebSocket(this.streamUrl);
        
        this.ws.on('open', () => this.logger.log('Exchange Adapter Terhubung'));

        this.ws.on('message', (data: WebSocket.RawData) => {
            const parsed = JSON.parse(data.toString());
            if (parsed.e === 'kline') {
                this.processKline(parsed);
            }
        });

        this.ws.on('close', () => {
            this.logger.warn('Koneksi terputus, Reconnecting...');
            setTimeout(() => this.connect(), 5000);
        });

        this.ws.on('error', () => this.ws.close());
    }

    private processKline(data: any) {
        const k = data.k;
        const candle: CandleData = {
            symbol: data.s,
            startTime: k.t,
            closeTime: k.T,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            isClosed: k.x,
        };

        if (candle.isClosed) {
            this.eventEmitter.emit(MARKET_EVENTS.CANDLE_CLOSED, candle);
        } else {
            this.eventEmitter.emit(MARKET_EVENTS.CANDLE_TICK, candle);
        }
    }

    onModuleDestroy() {
        if(this.ws) this.ws.close()
    }
}