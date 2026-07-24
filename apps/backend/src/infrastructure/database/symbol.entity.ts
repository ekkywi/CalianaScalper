import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('symbols')
export class SymbolEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;
    
    @Column({ unique: true, length: 20})
    symbol: string;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}