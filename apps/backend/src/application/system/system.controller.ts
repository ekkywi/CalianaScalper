// apps/backend/src/application/system/system.controller.ts

import { Controller, Get, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import { BinanceExecutionService } from '../../infrastructure/exchange/binance-execution.service';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';

@Controller('api/system')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);
  private readonly startedAt = Date.now();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mlEngine: MlEngineService,
    private readonly execution: BinanceExecutionService,
    private readonly positionManager: PositionManagerService,
  ) {}

  @Get('health')
  async health() {
    let database = false;
    try {
      await this.dataSource.query('SELECT 1');
      database = true;
    } catch (err) {
      this.logger.warn(`[HEALTH] DB check failed: ${err.message}`);
    }

    const mlHealth = await this.mlEngine.getHealth();
    const mlEngine = !!mlHealth;

    let exchange = false;
    try {
      const bal = await this.execution.getBalance('USDT');
      exchange = bal !== null;
    } catch {
      exchange = false;
    }

    return {
      websocket: true,
      database,
      mlEngine,
      exchange,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      tradingHalted: this.positionManager.isTradingHalted(),
      openPositions: this.positionManager.getOpenPositions().length,
      ml: mlHealth,
      lastError: undefined as string | undefined,
    };
  }

  @Get('logs')
  getLogs() {
    return {
      logs: [],
      message: 'Structured log store not implemented. Use backend process logs.',
    };
  }
}
