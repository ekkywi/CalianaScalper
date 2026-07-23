// apps/backend/src/app.controller.ts

import { Controller, Get, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MARKET_EVENTS, type CandleData } from './core/domain/market.types';

@Controller('debug')
export class AppController {
  private readonly logger = new Logger('DebugController');

  constructor(private eventEmitter: EventEmitter2) {}

  @Get('trigger-candle')
  triggerMockCandle() {
    this.logger.warn(`[DEBUG] Mesimulasikan penutupan cadle 15m...`);

    const mockCandle: CandleData = {
      symbol: 'BTCUSDT',
      startTime: Date.now() - 900000,
      closeTime: Date.now(),
      open: 65000,
      high: 65500,
      low: 64900,
      close: 65400,
      volume: 120.5,
      isClosed: true,
    };

    this.eventEmitter.emit(MARKET_EVENTS.CANDLE_CLOSED, mockCandle);

    return {
      status: 'Simulasi dikirim',
      data: mockCandle
    };
  }
}