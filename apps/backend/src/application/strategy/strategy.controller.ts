// apps/backend/src/application/strategy/strategy.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Logger,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { StrategyService } from '../../infrastructure/strategy/strategy.service';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import { SymbolService } from '../symbol/symbol.service';

// Avoid circular type import — inline DTO shapes
class CreateProfileDto {
  symbol: string;
  name: string;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  maxHorizonCandles?: number;
  notes?: string;
  fromModelId?: string;
}

class UpdateProfileDto {
  name?: string;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  maxHorizonCandles?: number;
  notes?: string;
}

class TrainDto {
  symbol: string;
  algorithm?: string;
  name?: string;
  setActive?: boolean;
  /** manual | from_profile */
  source?: 'manual' | 'from_profile';
  profileId?: string;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  maxHorizonCandles?: number;
}

@Controller('api/strategy')
export class StrategyController {
  private readonly logger = new Logger(StrategyController.name);

  constructor(
    private readonly strategy: StrategyService,
    @Inject(forwardRef(() => MlEngineService))
    private readonly mlEngine: MlEngineService,
    private readonly symbols: SymbolService,
  ) {}

  // ── Profiles ──────────────────────────────────────────────

  @Get('profiles')
  async listProfiles(@Query('symbol') symbol?: string) {
    const profiles = await this.strategy.listProfiles(symbol);
    const enriched: Record<string, unknown>[] = [];
    for (const p of profiles) {
      const compatible = await this.strategy.findCompatibleModels(p.id);
      const binding = await this.strategy.getBinding(p.symbol);
      enriched.push({
        ...p,
        isActive: binding.activeProfileId === p.id,
        compatibleModelCount: compatible.length,
        hasCompatibleModel: compatible.length > 0,
      });
    }
    return { profiles: enriched };
  }

  @Post('profiles')
  async createProfile(@Body() body: CreateProfileDto) {
    if (!body?.symbol || !body?.name) {
      throw new BadRequestException('symbol and name are required');
    }
    const profile = await this.strategy.createProfile(body);
    return { status: 'ok', profile };
  }

  @Put('profiles/:id')
  async updateProfile(@Param('id') id: string, @Body() body: UpdateProfileDto) {
    const profile = await this.strategy.updateProfile(id, body || {});
    return { status: 'ok', profile };
  }

  @Delete('profiles/:id')
  async deleteProfile(@Param('id') id: string) {
    await this.strategy.deleteProfile(id);
    return { status: 'ok' };
  }

  @Post('profiles/:id/activate')
  async activateProfile(@Param('id') id: string) {
    const profile = await this.strategy.getProfile(id);
    const pair = await this.strategy.activateProfile(profile.symbol, id);
    return { status: 'ok', pair };
  }

  @Get('profiles/:id/compatible-models')
  async compatibleModels(@Param('id') id: string) {
    const models = await this.strategy.findCompatibleModels(id);
    return { models };
  }

  // ── Models ────────────────────────────────────────────────

  @Get('models')
  async listModels(@Query('symbol') symbol?: string) {
    await this.strategy.syncModelsFromEngine();
    const models = await this.strategy.listModels(symbol);
    const enriched: Record<string, unknown>[] = [];
    for (const m of models) {
      const compatible = await this.strategy.findCompatibleProfiles(m.id);
      const binding = await this.strategy.getBinding(m.symbol);
      enriched.push({
        ...m,
        isActive: binding.activeModelId === m.id,
        compatibleProfileCount: compatible.length,
        hasCompatibleProfile: compatible.length > 0,
      });
    }
    return { models: enriched };
  }

  @Post('models/sync')
  async syncModels() {
    const n = await this.strategy.syncModelsFromEngine();
    return { status: 'ok', synced: n };
  }

  @Post('models/:id/activate')
  async activateModel(@Param('id') id: string) {
    const model = await this.strategy.getModel(id);
    const pair = await this.strategy.activateModel(model.symbol, id);
    return { status: 'ok', pair };
  }

  @Delete('models/:id')
  async deleteModel(@Param('id') id: string) {
    await this.strategy.deleteModel(id);
    return { status: 'ok' };
  }

  @Get('models/:id/compatible-profiles')
  async compatibleProfiles(@Param('id') id: string) {
    const profiles = await this.strategy.findCompatibleProfiles(id);
    return { profiles };
  }

  // ── Training ──────────────────────────────────────────────

  @Post('train')
  async train(@Body() body: TrainDto) {
    if (!body?.symbol) throw new BadRequestException('symbol is required');
    const symbol = body.symbol.toUpperCase();

    let labelConfig: {
      stop_loss_percent: number;
      take_profit_percent: number;
      max_horizon_candles: number;
    };

    if (body.source === 'from_profile') {
      if (!body.profileId) {
        throw new BadRequestException('profileId required when source=from_profile');
      }
      const profile = await this.strategy.getProfile(body.profileId);
      if (profile.symbol !== symbol) {
        throw new BadRequestException('Profile symbol mismatch');
      }
      labelConfig = this.strategy.labelConfigFromProfile(profile);
    } else {
      if (
        body.stopLossPercent == null ||
        body.takeProfitPercent == null ||
        body.maxHorizonCandles == null
      ) {
        throw new BadRequestException(
          'Manual train requires stopLossPercent, takeProfitPercent, maxHorizonCandles',
        );
      }
      labelConfig = {
        stop_loss_percent: body.stopLossPercent,
        take_profit_percent: body.takeProfitPercent,
        max_horizon_candles: body.maxHorizonCandles,
      };
    }

    const result = await this.mlEngine.retrain(
      symbol,
      body.algorithm,
      labelConfig,
      {
        name: body.name,
        setActive: body.setActive !== false,
      },
    );
    if (!result) {
      throw new ServiceUnavailableException('Failed to start training');
    }

    this.strategy.schedulePostTrainSync(symbol);

    return {
      status: 'ok',
      training: result,
      labelConfig,
    };
  }

  @Get('label-preview')
  async labelPreview(
    @Query('symbol') symbol: string,
    @Query('stopLossPercent') stopLossPercent?: string,
    @Query('takeProfitPercent') takeProfitPercent?: string,
    @Query('maxHorizonCandles') maxHorizonCandles?: string,
    @Query('profileId') profileId?: string,
  ) {
    if (!symbol) throw new BadRequestException('symbol is required');
    let labelConfig: Record<string, number>;
    if (profileId) {
      const profile = await this.strategy.getProfile(profileId);
      labelConfig = this.strategy.labelConfigFromProfile(profile) as any;
    } else {
      labelConfig = {
        stop_loss_percent: Number(stopLossPercent),
        take_profit_percent: Number(takeProfitPercent),
        max_horizon_candles: Number(maxHorizonCandles || 96),
      };
    }
    const result = await this.mlEngine.getLabelPreview(symbol, labelConfig);
    if (!result) {
      throw new ServiceUnavailableException('Label preview failed');
    }
    return result;
  }

  // ── Pair / bindings ───────────────────────────────────────

  @Get('pair/:symbol')
  async pairStatus(@Param('symbol') symbol: string) {
    return this.strategy.getPairStatus(symbol);
  }

  @Get('pairs')
  async allPairs() {
    const active = await this.symbols.getActiveSymbols();
    const pairs = await this.strategy.listPairStatuses(
      active.map((s) => s.symbol),
    );
    return { pairs };
  }
}
