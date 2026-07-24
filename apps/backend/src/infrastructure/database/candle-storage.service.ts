// apps/backend/src/infrastructure/database/candle-storage.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { CandleEntity } from './candle.entity';
import { MARKET_EVENTS, type CandleData } from '../../core/domain/market.types';

@Injectable()
export class CandleStorageService {
    private readonly logger = new Logger(CandleStorageService.name);

    constructor(
        @InjectRepository(CandleEntity)
        private candleRepo: Repository<CandleEntity>,
    ) {}

    @OnEvent(MARKET_EVENTS.CANDLE_CLOSED)
    async handleCandleClosed(candle: CandleData) {
        try {
            const newCandle = this.candleRepo.create({
                symbol: candle.symbol,
                startTime: candle.startTime,
                closeTime: candle.closeTime,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
            });

            await this.candleRepo
                .createQueryBuilder()
                .insert()
                .into(CandleEntity)
                .values(newCandle)
                .orIgnore()
                .execute();
            this.logger.log(`[DATABASE] Tersimpan: ${candle.symbol} pada timestamp ${candle.closeTime}`);
        } catch (error) {
            this.logger.error(`[DATABASE] Gagal menyimpan candle: ${error.message}`);
        }
    }
}