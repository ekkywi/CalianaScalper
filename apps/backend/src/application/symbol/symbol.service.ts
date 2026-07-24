// apps/backend/src/application/symbol/symbol.service.ts

import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SymbolEntity } from '../../infrastructure/database/symbol.entity';

@Injectable()
export class SymbolService {
    private readonly logger = new Logger(SymbolService.name);

    constructor(
        @InjectRepository(SymbolEntity)
        private readonly symbolRepo: Repository<SymbolEntity>,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    async addSymbol(symbol: string): Promise<SymbolEntity> {
        const normalizedSymbol = symbol.toUpperCase();

        const existing = await this.symbolRepo.findOne({ where: { symbol: normalizedSymbol } });

        if (existing) {
            throw new ConflictException(`Simbol ${normalizedSymbol} sudah terdaftar.`);
        }

        const newSymbol = this.symbolRepo.create({ symbol: normalizedSymbol, isActive: true });
        await this.symbolRepo.save(newSymbol);

        this.logger.log(`[CRUD] Simbol baru ditambahkan: ${normalizedSymbol}`);

        this.eventEmitter.emit('SYMBOL_ADDED', newSymbol);

        return newSymbol;
    }

    async getActiveSymbols(): Promise<SymbolEntity[]> {
        return this.symbolRepo.find({ where: { isActive: true } });
    }

    async getAllSymbols(): Promise<SymbolEntity[]> {
        return this.symbolRepo.find();
    }

    async toggleSymbolStatus(id: string, isActive: boolean): Promise<SymbolEntity> {
        const symbol = await this.symbolRepo.findOne({ where: { id } });
        if (!symbol) {
            throw new NotFoundException('Simbol tidak ditemukan');
        }

        symbol.isActive = isActive;
        await this.symbolRepo.save(symbol);

        this.logger.log(`[CRUD] Status ${symbol.symbol} diubah menjadi isActive: ${isActive}`);
        this.eventEmitter.emit('SYMBOL_STATUS_CHANGED', symbol);

        return symbol;
    }

    async removeSymbol(id: string): Promise<void> {
        const symbol = await this.symbolRepo.findOne({ where: { id } });
        if (!symbol) return;

        await this.symbolRepo.remove(symbol);
        this.logger.log(`[CRUD] Simbol dihapus: ${symbol.symbol}`);
        this.eventEmitter.emit('SYMBOL_REMOVED', symbol);
    }
}