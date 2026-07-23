// apps/backend/src/infrastructure/database/candle.entity.ts

import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';


@Entity('candles')
@Index(['symbol', 'closeTime'], { unique: true })
export class CandleEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 20 })
    symbol: string;

    @Column({ type: 'bigint' })
    startTime: number;

    @Column({ type: 'bigint' })
    closeTime: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    open: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    high: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    low: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    close: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    volume: number;
}