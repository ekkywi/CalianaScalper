// apps/backend/src/app.controller.ts

import { Controller, Get, Query, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MARKET_EVENTS } from './core/domain/market.types';
import { BinanceRestService } from './infrastructure/exchange/binance-rest.service';

@Controller('debug')
export class AppController {
  private readonly logger = new Logger('DebugController');

  constructor(
    private eventEmitter: EventEmitter2,
    private readonly binanceRestService: BinanceRestService
  ) {}

  @Get('trigger-candle')
  async triggerLiveCandle(@Query('symbol') symbol: string = 'BTCUSDT') {
    const targetSymbol = symbol.toUpperCase();
    this.logger.warn(`[DEBUG] Menarik candle aktual dari Binance untuk simulasi penutupan ${targetSymbol}...`);

    try {
      const liveCandle = await this.binanceRestService.fetchLatestCandle(targetSymbol, '15m');
      
      if (!liveCandle) {
        return { status: `Gagal menarik data dari Binance untuk ${targetSymbol}` };
      }

      // Paksa status menjadi tertutup untuk memicu MarketOrchestrator
      const payload = { ...liveCandle, isClosed: true };

      this.eventEmitter.emit(MARKET_EVENTS.CANDLE_CLOSED, payload);

      return {
        status: 'Simulasi dikirim dengan data market aktual',
        data: payload
      };
    } catch (error) {
      this.logger.error(`[DEBUG] Error: ${error.message}`);
      return { status: 'Error', message: error.message };
    }
  }
}