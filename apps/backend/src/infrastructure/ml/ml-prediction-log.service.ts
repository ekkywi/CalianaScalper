// apps/backend/src/infrastructure/ml/ml-prediction-log.service.ts
/** Persist orchestrator ML decisions to Postgres — survives Nest restarts. */

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { MlPredictionEventEntity } from '../database/ml-prediction-event.entity';
import type { CandleData } from '../../core/domain/market.types';
import type { MlPrediction } from './ml-engine.service';

export type MlBlockedBy =
  | 'shadow_mode'
  | 'regime'
  | 'confidence'
  | 'drift'
  | 'holding'
  | 'trading_halted'
  | 'max_positions'
  | 'max_trades'
  | 'daily_loss'
  | 'drawdown'
  | 'insufficient_balance'
  | 'sizing'
  | 'exchange'
  | 'ledger'
  | 'risk'
  | null;

export type MlPredictionLogInput = {
  candle: CandleData;
  prediction: MlPrediction;
  effectiveMinConfidence: number;
  blockedBy: MlBlockedBy;
  wouldExecute: boolean;
  executed: boolean;
  tradingMode: string;
};

@Injectable()
export class MlPredictionLogService {
  private readonly logger = new Logger(MlPredictionLogService.name);
  private writeCount = 0;
  private readonly pruneEvery = 50;
  private readonly retentionMs = 30 * 24 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(MlPredictionEventEntity)
    private readonly repo: Repository<MlPredictionEventEntity>,
  ) {}

  async record(input: MlPredictionLogInput): Promise<void> {
    try {
      const raw = input.prediction.raw || {};
      const now = Date.now();
      const symbol = input.prediction.symbol.toUpperCase();
      const candleCloseTime = Number(input.candle.closeTime);

      const existing = await this.repo.findOne({
        where: { symbol, candleCloseTime },
      });

      const row = existing ?? this.repo.create({ symbol, candleCloseTime });
      row.signal = input.prediction.signal;
      row.confidence = Number(input.prediction.confidence) || 0;
      row.probUp =
        raw.prob_up != null && Number.isFinite(Number(raw.prob_up))
          ? Number(raw.prob_up)
          : null;
      row.algorithm =
        typeof raw.algorithm === 'string' ? raw.algorithm : null;
      row.regime = typeof raw.regime === 'string' ? raw.regime : null;
      row.regimeReason =
        typeof raw.regime_reason === 'string'
          ? raw.regime_reason.slice(0, 255)
          : null;
      row.effectiveMinConfidence = input.effectiveMinConfidence;
      row.blockedBy = input.blockedBy;
      row.wouldExecute = Boolean(input.wouldExecute);
      row.executed = Boolean(input.executed);
      row.tradingMode = input.tradingMode || 'paper';
      row.createdAt = now;

      await this.repo.save(row);

      this.writeCount += 1;
      if (this.writeCount % this.pruneEvery === 0) {
        await this.pruneOld();
      }
    } catch (err: any) {
      this.logger.warn(
        `[ML-LOG] Failed to persist prediction ${input.prediction.symbol}: ${err?.message || err}`,
      );
    }
  }

  async getLatestPerSymbol(): Promise<
    Array<{
      symbol: string;
      signal: string;
      confidence: number;
      timestamp: number;
      raw?: Record<string, unknown>;
    }>
  > {
    const rows = await this.repo
      .createQueryBuilder('e')
      .distinctOn(['e.symbol'])
      .orderBy('e.symbol', 'ASC')
      .addOrderBy('e.candleCloseTime', 'DESC')
      .getMany();

    return rows
      .map((r) => this.toPredictionDto(r))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async listRecent(limit = 50): Promise<MlPredictionEventEntity[]> {
    const n = Math.min(Math.max(limit, 1), 200);
    return this.repo.find({
      order: { candleCloseTime: 'DESC' },
      take: n,
    });
  }

  async listEvents(params?: {
    symbol?: string;
    blockedBy?: string;
    executed?: boolean;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      symbol: string;
      signal: string;
      confidence: number;
      algorithm: string | null;
      regime: string | null;
      regimeReason: string | null;
      effectiveMinConfidence: number | null;
      blockedBy: string | null;
      wouldExecute: boolean;
      executed: boolean;
      tradingMode: string;
      candleCloseTime: number;
      createdAt: number;
    }>
  > {
    const n = Math.min(Math.max(params?.limit ?? 50, 1), 200);
    const qb = this.repo
      .createQueryBuilder('e')
      .orderBy('e.candleCloseTime', 'DESC')
      .take(n);

    if (params?.symbol?.trim()) {
      qb.andWhere('e.symbol = :symbol', {
        symbol: params.symbol.trim().toUpperCase(),
      });
    }
    if (params?.blockedBy === 'none') {
      qb.andWhere('e.blockedBy IS NULL');
    } else if (params?.blockedBy === 'any') {
      qb.andWhere('e.blockedBy IS NOT NULL');
    } else if (params?.blockedBy) {
      qb.andWhere('e.blockedBy = :blockedBy', { blockedBy: params.blockedBy });
    }
    if (params?.executed === true) {
      qb.andWhere('e.executed = true');
    } else if (params?.executed === false) {
      qb.andWhere('e.executed = false');
    }

    const rows = await qb.getMany();
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      signal: r.signal,
      confidence: Number(r.confidence),
      algorithm: r.algorithm,
      regime: r.regime,
      regimeReason: r.regimeReason,
      effectiveMinConfidence:
        r.effectiveMinConfidence != null
          ? Number(r.effectiveMinConfidence)
          : null,
      blockedBy: r.blockedBy,
      wouldExecute: Boolean(r.wouldExecute),
      executed: Boolean(r.executed),
      tradingMode: r.tradingMode,
      candleCloseTime: Number(r.candleCloseTime),
      createdAt: Number(r.createdAt),
    }));
  }

  async listShadow(limit = 50): Promise<
    Array<{
      symbol: string;
      signal: string;
      confidence: number;
      regime?: string;
      regimeReason?: string;
      effectiveMinConfidence: number;
      timestamp: number;
      candleCloseTime: number;
      blockedBy: string | null;
      wouldExecute: boolean;
    }>
  > {
    const n = Math.min(Math.max(limit, 1), 200);
    const rows = await this.repo.find({
      where: { blockedBy: 'shadow_mode' },
      order: { candleCloseTime: 'DESC' },
      take: n,
    });
    return rows.map((r) => ({
      symbol: r.symbol,
      signal: r.signal,
      confidence: Number(r.confidence),
      regime: r.regime ?? undefined,
      regimeReason: r.regimeReason ?? undefined,
      effectiveMinConfidence: Number(r.effectiveMinConfidence ?? 0),
      timestamp: Number(r.createdAt),
      candleCloseTime: Number(r.candleCloseTime),
      blockedBy: r.blockedBy,
      wouldExecute: Boolean(r.wouldExecute),
    }));
  }

  private toPredictionDto(r: MlPredictionEventEntity) {
    return {
      symbol: r.symbol,
      signal: r.signal as 'BUY' | 'SELL' | 'HOLD',
      confidence: Number(r.confidence),
      timestamp: Number(r.createdAt),
      raw: {
        algorithm: r.algorithm,
        prob_up: r.probUp != null ? Number(r.probUp) : undefined,
        regime: r.regime,
        regime_reason: r.regimeReason,
        blocked_by: r.blockedBy,
        would_execute: r.wouldExecute,
        executed: r.executed,
        trading_mode: r.tradingMode,
        candle_close_time: Number(r.candleCloseTime),
        effective_min_confidence:
          r.effectiveMinConfidence != null
            ? Number(r.effectiveMinConfidence)
            : undefined,
      },
    };
  }

  private async pruneOld(): Promise<void> {
    try {
      const cutoff = Date.now() - this.retentionMs;
      const result = await this.repo.delete({
        createdAt: LessThan(cutoff),
      });
      if (result.affected && result.affected > 0) {
        this.logger.log(
          `[ML-LOG] Pruned ${result.affected} prediction events older than 30d`,
        );
      }
    } catch (err: any) {
      this.logger.warn(`[ML-LOG] Prune failed: ${err?.message || err}`);
    }
  }
}
