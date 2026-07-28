// apps/backend/src/infrastructure/database/symbol-strategy-binding.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('symbol_strategy_bindings')
export class SymbolStrategyBindingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 20 })
  symbol: string;

  @Column({ type: 'uuid', nullable: true })
  activeProfileId: string | null;

  @Column({ type: 'uuid', nullable: true })
  activeModelId: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
