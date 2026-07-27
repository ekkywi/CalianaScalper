// apps/backend/src/application/risk/risk.controller.ts
// Risk Management Controller — menghubungkan UI ke PositionManagerService

import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';

@Controller('api/risk')
export class RiskController {
  private readonly logger = new Logger(RiskController.name);

  constructor(private readonly positionManager: PositionManagerService) {}

  @Post('emergency-stop')
  async emergencyStop() {
    this.logger.warn('[RISK-CTRL] Emergency stop dipicu dari UI');
    await this.positionManager.emergencyStop();
    return {
      status: 'ok',
      message: 'Emergency stop activated. Trading halted; positions flattening on exchange.',
      halted: this.positionManager.isTradingHalted(),
    };
  }

  @Post('resume')
  async resumeTrading() {
    this.logger.log('[RISK-CTRL] Resume trading dipicu dari UI');
    await this.positionManager.resumeTrading();
    return { status: 'ok', message: 'Trading resumed.', halted: false };
  }

  @Get('config')
  getRiskConfig() {
    return this.positionManager.getRiskConfig();
  }

  @Put('config')
  async updateRiskConfig(@Body() config: Record<string, any>) {
    this.logger.log(`[RISK-CTRL] Update risk config: ${JSON.stringify(config)}`);
    await this.positionManager.updateRiskConfig(config);
    return { status: 'ok', message: 'Risk config updated.', config: this.positionManager.getRiskConfig() };
  }

  @Get('positions')
  getOpenPositions() {
    return this.positionManager.getOpenPositions();
  }

  @Get('daily-stats')
  getDailyStats() {
    return {
      ...this.positionManager.getDailyStats(),
      halted: this.positionManager.isTradingHalted(),
    };
  }

  @Get('status')
  getStatus() {
    return {
      halted: this.positionManager.isTradingHalted(),
      openPositions: this.positionManager.getOpenPositions().length,
      dailyStats: this.positionManager.getDailyStats(),
      riskConfig: this.positionManager.getRiskConfig(),
    };
  }

  /**
   * Close one open position (exchange flatten + ledger)
   * DELETE /api/risk/positions/:symbol
   */
  @Delete('positions/:symbol')
  async closePosition(@Param('symbol') symbol: string) {
    const pos = this.positionManager.getPosition(symbol);
    if (!pos || pos.status !== 'OPEN') {
      throw new BadRequestException(`No open position for ${symbol}`);
    }
    const closed = await this.positionManager.flattenAndClose(
      symbol,
      Number(pos.entryPrice),
      'CLOSED_BY_MANUAL',
    );
    if (!closed) {
      throw new BadRequestException(
        `Failed to close ${symbol} on exchange — position left open`,
      );
    }
    return { status: 'ok', position: closed };
  }

  /**
   * Close all open positions
   * DELETE /api/risk/positions
   */
  @Delete('positions')
  async closeAllPositions() {
    const open = [...this.positionManager.getOpenPositions()];
    const results: { symbol: string; ok: boolean }[] = [];
    for (const pos of open) {
      const closed = await this.positionManager.flattenAndClose(
        pos.symbol,
        Number(pos.entryPrice),
        'CLOSED_BY_MANUAL',
      );
      results.push({ symbol: pos.symbol, ok: !!closed });
    }
    return { status: 'ok', results };
  }

  /**
   * Update SL/TP for an open position (ledger only — monitoring uses these levels)
   * PATCH /api/risk/positions/:symbol
   */
  @Patch('positions/:symbol')
  async updatePositionSlTp(
    @Param('symbol') symbol: string,
    @Body() body: { stopLoss?: number; takeProfit?: number },
  ) {
    const updated = await this.positionManager.updatePositionLevels(
      symbol,
      body.stopLoss,
      body.takeProfit,
    );
    if (!updated) {
      throw new BadRequestException(`No open position for ${symbol}`);
    }
    return { status: 'ok', position: updated };
  }
}
