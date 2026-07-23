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

    async backfillCandles(symbol: string, interval: string = '15m', limit: number = 500) {
        this.logger.log(`Memulai backfill ${limit} candle historis untuk ${symbol}...`);

        try {
            const response = await axios.get(this.REST_URL, {
                params: { symbol: symbol.toUpperCase(), interval, limit},
            });

            const rawData = response.data;
            const candlesToSave = rawData.map((k: any[]) => {
                return this.candleRepo.create({
                    symbol: symbol.toUpperCase(),
                    startTime: k[0],
                    closeTime: k[6],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                });
            });

            await this.candleRepo
                .createQueryBuilder()
                .insert()
                .into(CandleEntity)
                .values(candlesToSave)
                .orIgnore()
                .execute();
            
            this.logger.log(`Backfill selesai. ${candlesToSave.length} candle tersimpan di database.`);
        } catch (error) {
            this.logger.error(`Gagal menarik data historis: ${error.message}`);
        }
    }
}