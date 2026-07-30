// apps/backend/src/infrastructure/database/ml-model-registry.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('ml_model_registry')
export class MlModelRegistryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 20 })
  symbol: string;

  /** Stable id used by ML engine filesystem (not the DB uuid) */
  @Index({ unique: true })
  @Column({ length: 64 })
  engineModelId: string;

  @Column({ length: 120 })
  name: string;

  @Column({ length: 40, default: 'ensemble' })
  algorithm: string;

  @Column({ type: 'jsonb' })
  labelConfig: {
    stop_loss_percent: number;
    take_profit_percent: number;
    max_horizon_candles: number;
    label_mode?: string;
    round_trip_fee_percent?: number;
  };

  @Column({ type: 'jsonb', nullable: true })
  metrics: Record<string, unknown> | null;

  /** Last holdout Eval snapshot (ML vs EMA) — survives refresh; cleared with model delete */
  @Column({ type: 'jsonb', nullable: true })
  lastEval: Record<string, unknown> | null;

  @Column({ type: 'bigint', default: 0 })
  trainedAt: number;

  @Column({ type: 'varchar', length: 20, default: 'ready' })
  status: 'ready' | 'error' | 'missing';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
