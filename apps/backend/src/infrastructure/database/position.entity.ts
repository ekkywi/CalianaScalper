// apps/backend/src/infrastructure/database/position.entity.ts
// Entity untuk menyimpan posisi trading — menggantikan in-memory Map

import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('positions')
@Index(['symbol', 'entryTime'], { unique: false })
export class PositionEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 20 })
    symbol: string;

    @Column({ type: 'varchar', length: 10, default: 'LONG' })
    side: string;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    entryPrice: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    quantity: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    stopLoss: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    takeProfit: number;

    @Column({ type: 'bigint' })
    entryTime: number;

    @Column({ type: 'varchar', length: 30, default: 'OPEN' })
    status: string;

    @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true })
    closePrice: number;

    @Column({ type: 'bigint', nullable: true })
    closeTime: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    unrealizedPnL: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    realizedPnL: number;

    @Column({ type: 'varchar', length: 10, nullable: true })
    mlSignal: string | null;

    @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
    mlConfidence: number | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    mlAlgorithm: string | null;
}