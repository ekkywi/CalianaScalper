// src/application/orchestrator/market.orchestrator.ts

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MARKET_EVENTS, type CandleData} from '../../core/domain/market.types';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';

@Injectable()
export class MarketOrchestrator {
    private readonly logger = new Logger(MarketOrchestrator.name);

    constructor(private readonly mlEngine: MlEngineService) {}

    @OnEvent(MARKET_EVENTS.CANDLE_CLOSED)
    async handleCandleClosed(candle: CandleData) {
        this.logger.log(`[ORCHESTRATOR] Candle 15m ditutup. Memulai analisis...`);

        const prediction = await this.mlEngine.getPrediction(candle);

        if (prediction && prediction.signal !== 'HOLD') {
            this.logger.log(`[EKSEKUSI] Menyiapkan order ${prediction.signal} untuk ${candle.symbol}`);
        }
    }

    @OnEvent(MARKET_EVENTS.CANDLE_TICK)
    handleCandleTIck(candle: CandleData) {
        this.logger.debug(`[TICK] ${candle.symbol}: ${candle.close}`);
    }
}