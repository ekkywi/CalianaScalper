// apps/backend/src/application/candles/candles.controller.ts

import { Controller, Get, Param } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CandleEntity } from '../../infrastructure/database/candle.entity';

@Controller('api/candles')
export class CandlesController {
  constructor(
    @InjectRepository(CandleEntity)
    private readonly candleRepo: Repository<CandleEntity>,
  ) {}

  @Get(':symbol')
  async getHistoricalCandles(@Param('symbol') symbol: string) {
    return this.candleRepo.find({
      where: { symbol: symbol.toUpperCase() },
      order: { startTime: 'ASC' },
      take: 500,
    });
  }
}