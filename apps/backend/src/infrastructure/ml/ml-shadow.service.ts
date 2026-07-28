// apps/backend/src/infrastructure/ml/ml-shadow.service.ts
/** In-memory ring buffer of shadow (would-trade) ML decisions — Phase 2. */

import { Injectable } from '@nestjs/common';
import type { CandleData } from '../../core/domain/market.types';
import type { MlPrediction } from './ml-engine.service';

export type ShadowPredictionRecord = {
  symbol: string;
  signal: string;
  confidence: number;
  regime?: string;
  regimeReason?: string;
  effectiveMinConfidence: number;
  timestamp: number;
  candleCloseTime: number;
  blockedBy: 'shadow_mode' | 'regime' | 'confidence' | 'drift' | null;
  wouldExecute: boolean;
};

@Injectable()
export class MlShadowService {
  private readonly maxEntries = 200;
  private readonly entries: ShadowPredictionRecord[] = [];

  record(
    candle: CandleData,
    prediction: MlPrediction,
    meta: {
      effectiveMinConfidence: number;
      blockedBy: ShadowPredictionRecord['blockedBy'];
      wouldExecute: boolean;
    },
  ): void {
    const raw = prediction.raw || {};
    this.entries.unshift({
      symbol: prediction.symbol,
      signal: prediction.signal,
      confidence: prediction.confidence,
      regime: typeof raw.regime === 'string' ? raw.regime : undefined,
      regimeReason:
        typeof raw.regime_reason === 'string' ? raw.regime_reason : undefined,
      effectiveMinConfidence: meta.effectiveMinConfidence,
      timestamp: prediction.timestamp,
      candleCloseTime: candle.closeTime,
      blockedBy: meta.blockedBy,
      wouldExecute: meta.wouldExecute,
    });
    if (this.entries.length > this.maxEntries) {
      this.entries.length = this.maxEntries;
    }
  }

  list(limit = 50): ShadowPredictionRecord[] {
    return this.entries.slice(0, limit);
  }
}
