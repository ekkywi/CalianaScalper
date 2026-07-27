// apps/backend/src/infrastructure/database/system-config.entity.ts
// Entity untuk menyimpan konfigurasi sistem yang persisten (risk config, dll)
// Menggantikan DEFAULT_RISK_CONFIG yang dihardcode

import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('system_config')
export class SystemConfigEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 50, unique: true })
    key: string; // e.g., 'risk_config', 'trading_settings'

    @Column({ type: 'jsonb' })
    value: Record<string, any>;

    @Column({ type: 'bigint', default: 0 })
    updatedAt: number;
}