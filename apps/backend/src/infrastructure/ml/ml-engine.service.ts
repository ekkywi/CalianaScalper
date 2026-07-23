// apps/backend/src/infrastructure/ml/ml-engine.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { CandleData } from '../../core/domain/market.types';

@Injectable()
export class MlEngineService {
    private readonly logger = new Logger(MlEngineService.name);
    private readonly ML_URL = 'http://127.0.0.1:8000/predict';

    constructor(private readonly httpService: HttpService) {}

    async getPrediction(candle: CandleData) {
        try {
            this.logger.log(`[ML-ENGINE] Meminta inferensi model untuk ${candle.symbol}...`);

            const response = await firstValueFrom(
                this.httpService.post(this.ML_URL, candle, {
                    timeout: 5000,
                })
            );

            const prediction = response.data;
            this.logger.log(`[PREDIKSI] Sinyal: ${prediction.signal} | Keyakinan: ${(prediction.confidence * 100).toFixed(1)}%`);

            return prediction;
        } catch (error) {
            this.logger.error(`[ML-ENGINE] Gagal menghubungi Python FastAPI: 4{error.message}`);
            return null;
        }
    }
}