// apps/backend/src/application/ml/ml.controller.ts

import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Param,
  Query,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  ConflictException,
} from '@nestjs/common';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import { MlShadowService } from '../../infrastructure/ml/ml-shadow.service';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';

@Controller('api/ml')
export class MlController {
  private readonly logger = new Logger(MlController.name);

  constructor(
    private readonly mlEngine: MlEngineService,
    private readonly mlShadow: MlShadowService,
    private readonly positionManager: PositionManagerService,
  ) {}

  private labelConfigFromRisk() {
    const risk = this.positionManager.getRiskConfig();
    const maxHorizonCandles = Math.max(
      96,
      Math.ceil(risk.takeProfitPercent * 800),
    );
    return {
      stop_loss_percent: risk.stopLossPercent,
      take_profit_percent: risk.takeProfitPercent,
      max_horizon_candles: maxHorizonCandles,
    };
  }

  @Get('health')
  async health() {
    const data = await this.mlEngine.getHealth();
    if (!data) {
      throw new ServiceUnavailableException('ML engine unreachable');
    }
    return data;
  }

  @Get('models')
  async listModels() {
    const health = await this.mlEngine.getHealth();
    if (!health) {
      throw new ServiceUnavailableException('ML engine unreachable');
    }
    const symbols: string[] = Array.isArray(health.symbols) ? health.symbols : [];
    const models: Record<string, unknown>[] = [];
    const trainingStatus = health.training_status || {};
    const lastErrors = health.last_training_errors || {};
    for (const symbol of symbols) {
      const info = await this.mlEngine.getModelInfo(symbol);
      models.push(
        info
          ? {
              ...info,
              last_training_error:
                info.last_training_error ?? lastErrors[symbol] ?? null,
            }
          : {
              symbol,
              status: trainingStatus[symbol] || 'idle',
              last_training_error: lastErrors[symbol] ?? null,
            },
      );
    }
    for (const symbol of Object.keys(trainingStatus)) {
      if (
        !symbols.includes(symbol) &&
        (trainingStatus[symbol] === 'training' || trainingStatus[symbol] === 'error')
      ) {
        models.push({
          symbol,
          status: trainingStatus[symbol],
          last_training_error: lastErrors[symbol] ?? null,
        });
      }
    }
    return {
      models,
      training_status: trainingStatus,
      last_training_errors: lastErrors,
    };
  }

  @Get('model/:symbol')
  async modelInfo(@Param('symbol') symbol: string) {
    const info = await this.mlEngine.getModelInfo(symbol);
    if (!info) {
      throw new ServiceUnavailableException(`No model info for ${symbol}`);
    }
    return info;
  }

  @Delete('model/:symbol')
  async deleteModel(@Param('symbol') symbol: string) {
    this.logger.log(`[ML-CTRL] Delete model ${symbol}`);
    try {
      return await this.mlEngine.deleteModel(symbol);
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      const detail =
        error?.response?.data?.detail ||
        error?.message ||
        `Failed to delete model ${symbol}`;
      if (status === 404 && /no model files found|already absent/i.test(String(detail))) {
        return { status: 'ok', symbol: symbol.toUpperCase(), removed_files: [], errors: [], already_absent: true };
      }
      if (status === 404) {
        throw new NotFoundException(detail);
      }
      if (status === 409) {
        throw new ConflictException(detail);
      }
      throw new ServiceUnavailableException(detail);
    }
  }

  @Get('label-preview/:symbol')
  async labelPreview(@Param('symbol') symbol: string) {
    const labelConfig = this.labelConfigFromRisk();
    const result = await this.mlEngine.getLabelPreview(symbol, labelConfig);
    if (!result) {
      throw new ServiceUnavailableException(
        `Label preview failed for ${symbol}`,
      );
    }
    return result;
  }

  @Post('train/:symbol')
  async train(
    @Param('symbol') symbol: string,
    @Body() body?: { algorithm?: string },
  ) {
    const labelConfig = this.labelConfigFromRisk();
    this.logger.log(
      `[ML-CTRL] Retrain ${symbol} algo=${body?.algorithm || 'default'} ` +
        `SL=${labelConfig.stop_loss_percent} TP=${labelConfig.take_profit_percent} ` +
        `horizon=${labelConfig.max_horizon_candles}`,
    );
    const result = await this.mlEngine.retrain(
      symbol,
      body?.algorithm,
      labelConfig,
    );
    if (!result) {
      throw new ServiceUnavailableException(`Failed to start training for ${symbol}`);
    }
    return result;
  }

  @Get('algorithms')
  async algorithms() {
    const data = await this.mlEngine.listAlgorithms();
    if (!data) {
      throw new ServiceUnavailableException('ML engine unreachable');
    }
    return data;
  }

  @Get('eval/:symbol')
  async evaluateModel(@Param('symbol') symbol: string) {
    const risk = this.positionManager.getRiskConfig();
    const result = await this.mlEngine.evaluateModel(
      symbol,
      risk.minConfidenceThreshold,
      this.labelConfigFromRisk(),
    );
    if (!result) {
      throw new ServiceUnavailableException(
        `Eval failed for ${symbol} (train model first or ML engine unreachable)`,
      );
    }
    return result;
  }

  @Get('trade-stats')
  async mlTradeStats(@Query('period') period?: '1d' | '1w' | '1m' | 'all') {
    const p = period && ['1d', '1w', '1m', 'all'].includes(period) ? period : 'all';
    return this.positionManager.getMlTradeStats(p);
  }

  @Get('shadow-predictions')
  async shadowPredictions(@Query('limit') limit?: string) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return {
      predictions: this.mlShadow.list(n),
      disclaimer:
        'Shadow log: BUY signals that would pass gates but were not executed (shadow mode) or were blocked.',
    };
  }

  @Get('predictions')
  async latestPredictions() {
    return { predictions: this.mlEngine.getLatestPredictions() };
  }
}
