// apps/backend/src/infrastructure/database/trade.entity.ts
// Entity untuk menyimpan riwayat trade yang sudah selesai (closed positions)
// Digunakan untuk menghitung PnL history, equity curve, dan metrik performa

import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('trades')
@Index(['symbol', 'closeTime'], { unique: false })
@Index(['closeTime'], { unique: false })
export class TradeEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 20 })
    symbol: string;

    @Column({ type: 'varchar', length: 10, default: 'LONG' })
    side: string;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    entryPrice: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    exitPrice: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    quantity: number;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    pnl: number;

    @Column({ type: 'decimal', precision: 10, scale: 4 })
    pnlPercent: number;

    @Column({ type: 'varchar', length: 30 })
    closeReason: string; // CLOSED_BY_TP | CLOSED_BY_SL | CLOSED_BY_SIGNAL | CLOSED_BY_MANUAL

    @Column({ type: 'bigint' })
    entryTime: number;

    @Column({ type: 'bigint' })
    closeTime: number;

    @Column({ type: 'bigint', default: 0 })
    duration: number; // milliseconds

    @Column({ type: 'varchar', length: 50, nullable: true })
    positionId: string; // reference to original position

    /** ML context at entry (null for manual orders) */
    @Column({ type: 'varchar', length: 10, nullable: true })
    mlSignal: string | null;

    @Column({ type: 'decimal', precision: 8, scale: 4, nullable: true })
    mlConfidence: number | null;

    @Column({ type: 'varchar', length: 32, nullable: true })
    mlAlgorithm: string | null;
}