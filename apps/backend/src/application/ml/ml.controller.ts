// apps/backend/src/application/ml/ml.controller.ts

import { Controller, Get, Post, Param, Logger, ServiceUnavailableException } from '@nestjs/common';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';

@Controller('api/ml')
export class MlController {
  private readonly logger = new Logger(MlController.name);

  constructor(private readonly mlEngine: MlEngineService) {}

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
    for (const symbol of symbols) {
      const info = await this.mlEngine.getModelInfo(symbol);
      models.push(
        info || {
          symbol,
          status: health.training_status?.[symbol] || 'idle',
        },
      );
    }
    const trainingStatus = health.training_status || {};
    for (const symbol of Object.keys(trainingStatus)) {
      if (!symbols.includes(symbol)) {
        models.push({
          symbol,
          status: trainingStatus[symbol],
        });
      }
    }
    return { models, training_status: trainingStatus };
  }

  @Get('model/:symbol')
  async modelInfo(@Param('symbol') symbol: string) {
    const info = await this.mlEngine.getModelInfo(symbol);
    if (!info) {
      throw new ServiceUnavailableException(`No model info for ${symbol}`);
    }
    return info;
  }

  @Post('train/:symbol')
  async train(@Param('symbol') symbol: string) {
    this.logger.log(`[ML-CTRL] Retrain requested for ${symbol}`);
    const result = await this.mlEngine.retrain(symbol);
    if (!result) {
      throw new ServiceUnavailableException(`Failed to start training for ${symbol}`);
    }
    return result;
  }

  @Get('predictions')
  async latestPredictions() {
    return { predictions: this.mlEngine.getLatestPredictions() };
  }
}
