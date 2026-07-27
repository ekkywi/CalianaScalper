// apps/backend/src/application/system/system.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Put,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import { BinanceExecutionService } from '../../infrastructure/exchange/binance-execution.service';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';
import { TradingModeService } from './trading-mode.service';
import { TradingMode } from '../../core/domain/market.types';

class SetTradingModeBody {
  mode: TradingMode;
  confirm?: string;
}

@Controller('api/system')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);
  private readonly startedAt = Date.now();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mlEngine: MlEngineService,
    private readonly execution: BinanceExecutionService,
    private readonly positionManager: PositionManagerService,
    private readonly tradingMode: TradingModeService,
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

    const modeStatus = await this.tradingMode.getStatus();

    return {
      websocket: true,
      database,
      mlEngine,
      exchange,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      tradingHalted: this.positionManager.isTradingHalted(),
      tradingMode: modeStatus.mode,
      liveAllowed: modeStatus.liveAllowed,
      openPositions: this.positionManager.getOpenPositions().length,
      ml: mlHealth,
      lastError: undefined as string | undefined,
    };
  }

  @Get('trading-mode')
  async getTradingMode() {
    return this.tradingMode.getStatus();
  }

  @Put('trading-mode')
  async setTradingMode(@Body() body: SetTradingModeBody) {
    if (!body?.mode) {
      throw new BadRequestException('mode is required');
    }
    this.logger.log(`[MODE] PUT trading-mode ${JSON.stringify(body)}`);
    return this.tradingMode.setMode(body.mode, body.confirm);
  }

  @Get('balance')
  async getBalance() {
    const balance = await this.execution.getBalance('USDT');
    if (!balance) {
      throw new BadRequestException('Failed to fetch USDT balance for active mode');
    }
    return {
      mode: this.execution.getMode(),
      ...balance,
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
