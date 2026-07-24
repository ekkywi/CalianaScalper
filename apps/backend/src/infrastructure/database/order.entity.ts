// apps/backend/src/infrastructure/database/order.entity.ts

import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('orders')
@Index(['symbol', 'timestamp'], { unique: false })
export class OrderEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 20 })
    symbol: string;

    @Column({ type: 'varchar', length: 10 })
    side: string;

    @Column({ type: 'varchar', length: 20 })
    type: string;

    @Column({ type: 'decimal', precision: 18, scale: 8 })
    quantity: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    filledQuantity: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    price: number;

    @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
    averagePrice: number;

    @Column({ type: 'varchar', length: 20 })
    status: string;

    @Column({ type: 'bigint' })
    timestamp: number;

    @Column({ type: 'varchar', length: 100, nullable: true })
    exchangeOrderId: string;

    @Column({ type: 'text', nullable: true })
    errorMessage: string;
}