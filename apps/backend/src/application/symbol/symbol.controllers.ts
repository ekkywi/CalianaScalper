// apps/backend/src/application/symbol/symbol.controllers.ts

import { Controller, Get, Post, Body, Param, Patch, Delete } from '@nestjs/common';
import { SymbolService } from './symbol.service';

@Controller('api/symbols')
export class SymbolController {
    constructor(private readonly symbolService: SymbolService) {}

    @Post()
    async addSymbol(@Body('symbol') symbol: string) {
        return this.symbolService.addSymbol(symbol);
    }

    @Get()
    async getAllSymbols() {
        return this.symbolService.getActiveSymbols();
    }

    @Get('active')
    async getActiveSymbols() {
        return this.symbolService.getActiveSymbols();
    }

    @Patch(':id/toggle')
    async toggleSymbolStatus(
        @Param('id') id: string,
        @Body('isActive') isActive: boolean,
    ) {
        return this.symbolService.toggleSymbolStatus(id, isActive);
    }

    @Delete(':id')
    async removeSymbol(@Param('id') id: string) {
        await this.symbolService.removeSymbol(id);
        return { message: 'Berhasil dihapus' };
    }
}