// apps/backend/src/infrastructure/exchange/binance-rest.service.ts

import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CandleEntity } from '../database/candle.entity';

@Injectable()
export class BinanceRestService {
    private readonly logger = new Logger(BinanceRestService.name);
    private readonly REST_URL = 'https://api.binance.com/api/v3/klines';

    constructor(
        @InjectRepository(CandleEntity)
        private readonly candleRepo: Repository<CandleEntity>,
    ) {}

    private mapKlineRows(symbol: string, rawData: any[]): CandleEntity[] {
        return rawData.map((k: any[]) =>
            this.candleRepo.create({
                symbol: symbol.toUpperCase(),
                startTime: k[0],
                closeTime: k[6],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
            }),
        );
    }

    async backfillCandles(symbol: string, interval: string = '15m', limit: number = 500) {
        const sym = symbol.toUpperCase();
        const cappedLimit = Math.min(Math.max(limit, 1), 2000);
        this.logger.log(
            `Memulai backfill ${cappedLimit} candle historis untuk ${sym}...`,
        );

        try {
            const firstBatch = Math.min(1000, cappedLimit);
            const response1 = await axios.get(this.REST_URL, {
                params: { symbol: sym, interval, limit: firstBatch },
            });
            let rawData: any[] = response1.data ?? [];

            if (cappedLimit > 1000 && rawData.length > 0) {
                const oldestOpen = rawData[0][0];
                const secondLimit = cappedLimit - 1000;
                const response2 = await axios.get(this.REST_URL, {
                    params: {
                        symbol: sym,
                        interval,
                        limit: secondLimit,
                        endTime: Number(oldestOpen) - 1,
                    },
                });
                const older = response2.data ?? [];
                rawData = [...older, ...rawData];
            }

            const candlesToSave = this.mapKlineRows(sym, rawData);

            if (candlesToSave.length === 0) {
                this.logger.warn(`Backfill ${sym}: tidak ada candle dari Binance.`);
                return;
            }

            await this.candleRepo
                .createQueryBuilder()
                .insert()
                .into(CandleEntity)
                .values(candlesToSave)
                .orIgnore()
                .execute();

            this.logger.log(
                `Backfill selesai. ${candlesToSave.length} candle tersimpan di database.`,
            );
        } catch (error) {
            this.logger.error(`Gagal menarik data historis: ${error.message}`);
        }
    }

    async fetchLatestCandle(symbol: string, interval: string = '15m') {
        this.logger.log(`Menarik candle aktual terbaru untuk ${symbol}...`);
        try {
            const response = await axios.get(this.REST_URL, {
                params: { symbol: symbol.toUpperCase(), interval, limit: 1 },
            });

            const k = response.data[0];
            if (!k) return null;

            return {
                symbol: symbol.toUpperCase(),
                startTime: k[0],
                closeTime: k[6],
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5]),
            };
        } catch (error) {
            this.logger.error(`Gagal menarik candle terbaru: ${error.message}`);
            return null;
        }
    }

    /**
     * Public mainnet order book depth (for UI liquidity context — not testnet).
     */
    async fetchOrderBook(symbol: string, limit: number = 20) {
        const sym = symbol.toUpperCase().replace('/', '');
        const depthLimit = [5, 10, 20, 50, 100].includes(limit) ? limit : 20;
        try {
            const response = await axios.get('https://api.binance.com/api/v3/depth', {
                params: { symbol: sym, limit: depthLimit },
            });
            const data = response.data;
            return {
                symbol: sym,
                source: 'binance-mainnet' as const,
                lastUpdateId: data.lastUpdateId,
                bids: (data.bids || []).map((row: [string, string]) => ({
                    price: parseFloat(row[0]),
                    quantity: parseFloat(row[1]),
                })),
                asks: (data.asks || []).map((row: [string, string]) => ({
                    price: parseFloat(row[0]),
                    quantity: parseFloat(row[1]),
                })),
            };
        } catch (error) {
            this.logger.error(`[DEPTH] Gagal fetch order book ${sym}: ${error.message}`);
            throw error;
        }
    }
}
