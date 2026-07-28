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
                `[PREDIKSI] Sinyal: ${normalized.signal} | Keyakinan: ${(normalized.confidence * 100).toFixed(1)}%` +
                (prediction.regime ? ` | Regime: ${prediction.regime}` : ''),
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

    async retrain(
        symbol: string,
        algorithm?: string,
        labelConfig?: Record<string, number>,
    ): Promise<any | null> {
        try {
            const body: Record<string, unknown> = {};
            if (algorithm) body.algorithm = algorithm;
            if (labelConfig) body.label_config = labelConfig;
            const response = await firstValueFrom(
                this.httpService.post(`${this.ML_BASE}/train/${symbol}`, body, {
                    timeout: 10000,
                }),
            );
            return response.data;
        } catch (error) {
            this.logger.error(`[ML-ENGINE] Retrain ${symbol} failed: ${error.message}`);
            return null;
        }
    }

    async listAlgorithms(): Promise<any | null> {
        try {
            const response = await firstValueFrom(
                this.httpService.get(`${this.ML_BASE}/algorithms`, { timeout: 3000 }),
            );
            return response.data;
        } catch (error) {
            this.logger.warn(`[ML-ENGINE] Algorithms list failed: ${error.message}`);
            return null;
        }
    }

    async deleteModel(symbol: string): Promise<any> {
        try {
            const response = await firstValueFrom(
                this.httpService.delete(
                    `${this.ML_BASE}/model/${encodeURIComponent(symbol)}`,
                    { timeout: 10000 },
                ),
            );
            this.latestPredictions.delete(symbol.toUpperCase());
            return response.data;
        } catch (error: any) {
            this.logger.error(`[ML-ENGINE] Delete ${symbol} failed: ${error.message}`);
            throw error;
        }
    }

    async evaluateModel(
        symbol: string,
        minConfidence = 0.65,
        labelConfig?: {
            stop_loss_percent: number;
            take_profit_percent: number;
            max_horizon_candles?: number;
        },
    ): Promise<any | null> {
        try {
            const params: Record<string, number> = {
                min_confidence: minConfidence,
            };
            if (labelConfig) {
                params.stop_loss_percent = labelConfig.stop_loss_percent;
                params.take_profit_percent = labelConfig.take_profit_percent;
                if (labelConfig.max_horizon_candles != null) {
                    params.max_horizon_candles = labelConfig.max_horizon_candles;
                }
            }
            const response = await firstValueFrom(
                this.httpService.get(
                    `${this.ML_BASE}/eval/${encodeURIComponent(symbol)}`,
                    {
                        params,
                        timeout: 60000,
                    },
                ),
            );
            return response.data;
        } catch (error: any) {
            this.logger.warn(`[ML-ENGINE] Eval ${symbol} failed: ${error.message}`);
            return null;
        }
    }

    async getLabelPreview(
        symbol: string,
        labelConfig?: Record<string, number>,
    ): Promise<any | null> {
        try {
            const params: Record<string, number> = {};
            if (labelConfig) {
                if (labelConfig.stop_loss_percent != null) {
                    params.stop_loss_percent = labelConfig.stop_loss_percent;
                }
                if (labelConfig.take_profit_percent != null) {
                    params.take_profit_percent = labelConfig.take_profit_percent;
                }
                if (labelConfig.max_horizon_candles != null) {
                    params.max_horizon_candles = labelConfig.max_horizon_candles;
                }
            }
            const response = await firstValueFrom(
                this.httpService.get(
                    `${this.ML_BASE}/label-preview/${encodeURIComponent(symbol)}`,
                    { params, timeout: 30000 },
                ),
            );
            return response.data;
        } catch (error: any) {
            this.logger.warn(
                `[ML-ENGINE] Label preview ${symbol} failed: ${error.message}`,
            );
            return null;
        }
    }
}