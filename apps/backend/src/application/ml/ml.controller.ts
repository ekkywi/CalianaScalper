// apps/backend/src/application/ml/ml.controller.ts
/** Legacy ML proxy endpoints — strategy library lives under /api/strategy */

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
  Inject,
  forwardRef,
} from '@nestjs/common';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import { MlPredictionLogService } from '../../infrastructure/ml/ml-prediction-log.service';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';
import { StrategyService } from '../../infrastructure/strategy/strategy.service';
import { BinanceExecutionService } from '../../infrastructure/exchange/binance-execution.service';

@Controller('api/ml')
export class MlController {
  private readonly logger = new Logger(MlController.name);

  constructor(
    private readonly mlEngine: MlEngineService,
    private readonly mlLog: MlPredictionLogService,
    @Inject(forwardRef(() => PositionManagerService))
    private readonly positionManager: PositionManagerService,
    @Inject(forwardRef(() => StrategyService))
    private readonly strategy: StrategyService,
    @Inject(forwardRef(() => BinanceExecutionService))
    private readonly executionService: BinanceExecutionService,
  ) {}

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
    // Prefer strategy registry; fall back to engine health list
    await this.strategy.syncModelsFromEngine();
    const models = await this.strategy.listModels();
    const enriched: Record<string, unknown>[] = [];
    for (const m of models) {
      const binding = await this.strategy.getBinding(m.symbol);
      const pair = await this.strategy.getPairStatus(m.symbol);
      enriched.push({
        symbol: m.symbol,
        status: binding.activeModelId === m.id ? 'ready' : 'ready',
        algorithm: m.algorithm,
        algorithm_name: m.algorithm,
        accuracy: (m.metrics as any)?.accuracy ?? null,
        precision_buy: (m.metrics as any)?.precision_buy ?? null,
        recall_buy: (m.metrics as any)?.recall_buy ?? null,
        f1_buy: (m.metrics as any)?.f1_buy ?? null,
        label_config: m.labelConfig,
        trained_at: m.trainedAt,
        name: m.name,
        id: m.id,
        engineModelId: m.engineModelId,
        isActive: binding.activeModelId === m.id,
        drift: pair,
      });
    }
    return {
      models: enriched,
      training_status: {},
      last_training_errors: {},
    };
  }

  @Get('model/:symbol')
  async modelInfo(@Param('symbol') symbol: string) {
    const info = await this.mlEngine.getModelInfo(symbol);
    if (!info) {
      throw new ServiceUnavailableException(`No model info for ${symbol}`);
    }
    const pair = await this.strategy.getPairStatus(symbol);
    return { ...info, drift: pair };
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
        return {
          status: 'ok',
          symbol: symbol.toUpperCase(),
          removed_files: [],
          errors: [],
          already_absent: true,
        };
      }
      if (status === 404) throw new NotFoundException(detail);
      if (status === 409) throw new ConflictException(detail);
      throw new ServiceUnavailableException(detail);
    }
  }

  @Get('label-preview/:symbol')
  async labelPreview(@Param('symbol') symbol: string) {
    // Prefer active profile params when available
    const exec = await this.strategy.getActiveExecution(symbol);
    const labelConfig = exec
      ? {
          stop_loss_percent: exec.stopLossPercent,
          take_profit_percent: exec.takeProfitPercent,
          max_horizon_candles: exec.maxHorizonCandles,
        }
      : {
          stop_loss_percent: 0.03,
          take_profit_percent: 0.06,
          max_horizon_candles: 96,
        };
    const result = await this.mlEngine.getLabelPreview(symbol, labelConfig);
    if (!result) {
      throw new ServiceUnavailableException(`Label preview failed for ${symbol}`);
    }
    return result;
  }

  @Post('train/:symbol')
  async train(
    @Param('symbol') symbol: string,
    @Body() body?: { algorithm?: string; name?: string; setActive?: boolean },
  ) {
    const exec = await this.strategy.getActiveExecution(symbol);
    if (!exec) {
      throw new ServiceUnavailableException(
        `No active trading profile for ${symbol}. Create/activate a profile, or train via /api/strategy/train with manual params.`,
      );
    }
    const labelConfig = {
      stop_loss_percent: exec.stopLossPercent,
      take_profit_percent: exec.takeProfitPercent,
      max_horizon_candles: exec.maxHorizonCandles,
    };
    this.logger.log(
      `[ML-CTRL] Retrain ${symbol} from active profile ` +
        `SL=${labelConfig.stop_loss_percent} TP=${labelConfig.take_profit_percent}`,
    );
    const result = await this.mlEngine.retrain(symbol, body?.algorithm, labelConfig, {
      name: body?.name,
      setActive: body?.setActive !== false,
    });
    if (!result) {
      throw new ServiceUnavailableException(`Failed to start training for ${symbol}`);
    }
    setTimeout(() => {
      this.strategy.syncModelsFromEngine().catch(() => undefined);
    }, 8000);
    return result;
  }

  @Get('algorithms')
  async algorithms() {
    const data = await this.mlEngine.listAlgorithms();
    if (!data) throw new ServiceUnavailableException('ML engine unreachable');
    return data;
  }

  @Get('eval/:symbol')
  async evaluateModel(
    @Param('symbol') symbol: string,
    @Query('modelId') modelId?: string,
  ) {
    const risk = this.positionManager.getRiskConfig();
    const exec = await this.strategy.getActiveExecution(symbol);
    const labelConfig = exec
      ? {
          stop_loss_percent: exec.stopLossPercent,
          take_profit_percent: exec.takeProfitPercent,
          max_horizon_candles: exec.maxHorizonCandles,
        }
      : undefined;
    const result = await this.mlEngine.evaluateModel(
      symbol,
      risk.minConfidenceThreshold,
      labelConfig,
    );
    if (!result) {
      throw new ServiceUnavailableException(
        `Eval failed for ${symbol} (train model first or ML engine unreachable)`,
      );
    }

    const targetId = await this.strategy.resolveEvalTargetModelId(
      symbol,
      modelId,
    );
    let persistedTo: string | null = null;
    if (targetId) {
      const saved = await this.strategy.saveModelLastEval(targetId, result);
      persistedTo = saved.id;
    }

    return {
      ...result,
      persistedTo,
      evaluatedAt: Date.now(),
      disclaimer:
        result.disclaimer ||
        'Holdout SL/TP simulation vs EMA — not live PnL. Last eval is stored on the model registry.',
    };
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
      predictions: await this.mlLog.listShadow(n),
      disclaimer:
        'Shadow log (persisted): BUY signals that would pass gates but were not executed (shadow mode). Survives Nest restarts.',
    };
  }

  @Get('prediction-events')
  async predictionEvents(
    @Query('symbol') symbol?: string,
    @Query('blockedBy') blockedBy?: string,
    @Query('executed') executed?: string,
    @Query('limit') limit?: string,
  ) {
    const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
    let executedFilter: boolean | undefined;
    if (executed === 'true' || executed === '1') executedFilter = true;
    else if (executed === 'false' || executed === '0') executedFilter = false;

    const events = await this.mlLog.listEvents({
      symbol,
      blockedBy,
      executed: executedFilter,
      limit: n,
    });
    return {
      events,
      source: 'database',
      disclaimer:
        'Decision log from ml_prediction_events — every candle close decision with blockedBy / executed. Retention ~30 days.',
    };
  }

  @Get('predictions')
  async latestPredictions() {
    const fromDb = await this.mlLog.getLatestPerSymbol();
    // Prefer DB; fall back to in-memory cache if DB empty (pre-persist era / no candles yet)
    if (fromDb.length > 0) {
      return { predictions: fromDb, source: 'database' };
    }
    return {
      predictions: this.mlEngine.getLatestPredictions(),
      source: 'memory',
    };
  }

  @Get('drift-status')
  async driftStatus() {
    return {
      tradingMode: this.executionService.getMode(),
      hint: 'Use GET /api/strategy/pairs for profile↔model alignment status',
    };
  }
}
