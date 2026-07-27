// apps/backend/src/application/performance/performance.controller.ts

import { Controller, Get, Query, Logger } from '@nestjs/common';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';

@Controller('api/performance')
export class PerformanceController {
  private readonly logger = new Logger(PerformanceController.name);

  constructor(private readonly positionManager: PositionManagerService) {}

  @Get('stats')
  async getStats(@Query('period') period?: string) {
    const p = (['1d', '1w', '1m', 'all'].includes(period || '')
      ? period
      : 'all') as '1d' | '1w' | '1m' | 'all';
    return this.positionManager.getPerformanceStats(p);
  }

  @Get('trades')
  async getTrades(
    @Query('symbol') symbol?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.positionManager.getTradeHistory({
      symbol,
      startDate,
      endDate,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('equity-curve')
  async getEquityCurve() {
    // Rebuild simple cumulative PnL series from closed trades (no snapshot table)
    const trades = await this.positionManager.getTradeHistory({ limit: 500 });
    const chronological = [...trades].sort(
      (a, b) => Number(a.closeTime) - Number(b.closeTime),
    );
    let equity = 0;
    return chronological.map((t) => {
      equity += Number(t.pnl) || 0;
      return {
        time: Number(t.closeTime),
        equity,
        pnl: Number(t.pnl) || 0,
        symbol: t.symbol,
      };
    });
  }
}
