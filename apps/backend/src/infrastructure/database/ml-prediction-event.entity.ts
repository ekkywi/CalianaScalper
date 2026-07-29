// apps/backend/src/infrastructure/database/ml-prediction-event.entity.ts
// Persisted ML decision log (predictions + shadow / blocked outcomes)

import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('ml_prediction_events')
@Index(['symbol', 'candleCloseTime'], { unique: true })
@Index(['createdAt'])
@Index(['blockedBy', 'createdAt'])
export class MlPredictionEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  symbol: string;

  @Column({ type: 'varchar', length: 10 })
  signal: string;

  @Column({ type: 'decimal', precision: 8, scale: 4 })
  confidence: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
  probUp: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  algorithm: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  regime: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  regimeReason: string | null;

  @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
  effectiveMinConfidence: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  blockedBy: string | null;

  @Column({ type: 'boolean', default: false })
  wouldExecute: boolean;

  @Column({ type: 'boolean', default: false })
  executed: boolean;

  @Column({ type: 'varchar', length: 10, default: 'paper' })
  tradingMode: string;

  @Column({ type: 'bigint' })
  candleCloseTime: number;

  @Column({ type: 'bigint' })
  createdAt: number;
}
