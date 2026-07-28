// apps/backend/src/infrastructure/database/trading-profile.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('trading_profiles')
export class TradingProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ length: 20 })
  symbol: string;

  @Column({ length: 120 })
  name: string;

  /** Live execution stop loss as fraction (0.03 = 3%) */
  @Column({ type: 'float' })
  stopLossPercent: number;

  @Column({ type: 'float' })
  takeProfitPercent: number;

  /** Aligns with ML label horizon for mismatch checks */
  @Column({ type: 'int', default: 96 })
  maxHorizonCandles: number;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
