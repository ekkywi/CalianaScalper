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
      haltReason: this.positionManager.getHaltReason(),
    };
  }

  @Post('resume')
  async resumeTrading(@Body() body?: { force?: boolean }) {
    this.logger.log('[RISK-CTRL] Resume trading dipicu dari UI');
    const result = await this.positionManager.resumeTrading(body?.force ?? false);
    if (!result.resumed) {
      return {
        status: 'cooldown',
        message: `Resume blocked — cooldown ${Math.ceil(result.cooldownRemainingMs / 60000)} minutes remaining. Use force=true to override.`,
        halted: true,
        haltReason: this.positionManager.getHaltReason(),
        cooldownRemainingMs: result.cooldownRemainingMs,
      };
    }
    return {
      status: 'ok',
      message: 'Trading resumed.',
      halted: false,
      haltReason: null,
      cooldownRemainingMs: 0,
    };
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
      haltReason: this.positionManager.getHaltReason(),
    };
  }

  @Get('status')
  getStatus() {
    return {
      halted: this.positionManager.isTradingHalted(),
      haltReason: this.positionManager.getHaltReason(),
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

  // ─── Drawdown Management ────────────────────────────────────

  @Get('drawdown/status')
  getDrawdownStatus() {
    return this.positionManager.getDrawdownStatus();
  }

  @Get('drawdown/history')
  getDrawdownHistory() {
    return this.positionManager.getDrawdownHistory();
  }

  @Get('drawdown/per-symbol')
  getPerSymbolDrawdown() {
    return this.positionManager.getPerSymbolDrawdown();
  }

  @Post('drawdown/reset-peak')
  async resetPeakBalance(@Body() body?: { newPeak?: number }) {
    this.logger.warn(`[RISK-CTRL] Peak balance reset requested`);
    await this.positionManager.resetPeakBalance(body?.newPeak);
    return {
      status: 'ok',
      message: 'Peak balance reset successfully.',
      drawdown: this.positionManager.getDrawdownStatus(),
    };
  }
}
