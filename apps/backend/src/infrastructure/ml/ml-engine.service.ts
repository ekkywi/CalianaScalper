// apps/backend/src/infrastructure/ml/ml-engine.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type { CandleData } from '../../core/domain/market.types';

export interface MlPrediction {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  timestamp: number;
  raw?: Record<string, unknown>;
}

@Injectable()
export class MlEngineService {
    private readonly logger = new Logger(MlEngineService.name);
    private readonly ML_BASE = 'http://127.0.0.1:8000';
    private readonly latestPredictions = new Map<string, MlPrediction>();

    constructor(private readonly httpService: HttpService) {}

    async getPrediction(candle: CandleData): Promise<MlPrediction | null> {
        try {
            this.logger.log(`[ML-ENGINE] Meminta inferensi model untuk ${candle.symbol}...`);

            const response = await firstValueFrom(
                this.httpService.post(`${this.ML_BASE}/predict`, candle, {
                    timeout: 5000,
                }),
            );

            const prediction = response.data;
            const normalized: MlPrediction = {
                symbol: candle.symbol,
                signal: prediction.signal,
                confidence: Number(prediction.confidence) || 0,
                timestamp: Date.now(),
                raw: prediction,
            };

            this.latestPredictions.set(candle.symbol, normalized);
            this.logger.log(
                `[PREDIKSI] Sinyal: ${normalized.signal} | Keyakinan: ${(normalized.confidence * 100).toFixed(1)}%`,
            );

            return normalized;
        } catch (error) {
            this.logger.error(
                `[ML-ENGINE] Gagal menghubungi Python FastAPI: ${error.message}`,
            );
            return null;
        }
    }

    getLatestPredictions(): MlPrediction[] {
        return Array.from(this.latestPredictions.values()).sort(
            (a, b) => b.timestamp - a.timestamp,
        );
    }

    async getHealth(): Promise<any | null> {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.ML_BASE}/health`, { timeout: 3000 }),
            );
            return response.data;
        } catch (error) {
            this.logger.warn(`[ML-ENGINE] Health check failed: ${error.message}`);
            return null;
        }
    }

    async getModelInfo(symbol: string): Promise<any | null> {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.ML_BASE}/model/${symbol}/info`, {
                    timeout: 5000,
                }),
            );
            return { symbol, ...response.data };
        } catch (error) {
            this.logger.warn(`[ML-ENGINE] Model info ${symbol} failed: ${error.message}`);
            return null;
        }
    }

    async retrain(symbol: string): Promise<any | null> {
        try {
            const response = await firstValueFrom(
                this.httpService.post(`${this.ML_BASE}/train/${symbol}`, null, {
                    timeout: 10000,
                }),
            );
            return response.data;
        } catch (error) {
            this.logger.error(`[ML-ENGINE] Retrain ${symbol} failed: ${error.message}`);
            return null;
        }
    }
}
