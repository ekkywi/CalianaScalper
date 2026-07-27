// apps/backend/src/application/market/market.controller.ts

import { BadRequestException, Controller, Get, Logger, Query } from '@nestjs/common';
import { BinanceRestService } from '../../infrastructure/exchange/binance-rest.service';

@Controller('api/market')
export class MarketController {
  private readonly logger = new Logger(MarketController.name);

  constructor(private readonly binanceRest: BinanceRestService) {}

  @Get('depth')
  async depth(
    @Query('symbol') symbol?: string,
    @Query('limit') limit?: string,
  ) {
    if (!symbol?.trim()) {
      throw new BadRequestException('symbol is required');
    }
    try {
      return await this.binanceRest.fetchOrderBook(
        symbol.trim(),
        limit ? Number(limit) : 20,
      );
    } catch (err: any) {
      this.logger.error(`[DEPTH] ${err.message}`);
      throw new BadRequestException(err.message || 'Failed to fetch order book');
    }
  }
}
