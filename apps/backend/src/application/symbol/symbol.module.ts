// apps/backend/src/application/symbol/symbol.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SymbolEntity } from '../../infrastructure/database/symbol.entity';
import { SymbolService } from './symbol.service';
import { SymbolController } from './symbol.controllers';

@Module({
    imports: [TypeOrmModule.forFeature([SymbolEntity])],
    providers: [SymbolService],
    controllers: [SymbolController],
    exports: [SymbolService],
})
export class SymbolModule {}