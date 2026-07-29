// apps/backend/src/infrastructure/strategy/strategy.service.ts
/** Trading profiles + ML model registry + per-symbol active bindings */

import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnEvent } from '@nestjs/event-emitter';
import { TradingProfileEntity } from '../database/trading-profile.entity';
import { MlModelRegistryEntity } from '../database/ml-model-registry.entity';
import { SymbolStrategyBindingEntity } from '../database/symbol-strategy-binding.entity';
import { SymbolEntity } from '../database/symbol.entity';
import {
  DEFAULT_EXECUTION_PARAMS,
  MlLabelConfigPayload,
  StrategyPairStatus,
  paramsMatch,
  horizonForTakeProfit,
} from '../../core/domain/market.types';
import { MlEngineService } from '../ml/ml-engine.service';

@Injectable()
export class StrategyService implements OnModuleInit {
  private readonly logger = new Logger(StrategyService.name);
  /** Hot cache for sync position sizing / openPosition */
  private executionCache = new Map<
    string,
    {
      stopLossPercent: number;
      takeProfitPercent: number;
      maxHorizonCandles: number;
      profileId: string;
    }
  >();

  constructor(
    @InjectRepository(TradingProfileEntity)
    private readonly profileRepo: Repository<TradingProfileEntity>,
    @InjectRepository(MlModelRegistryEntity)
    private readonly modelRepo: Repository<MlModelRegistryEntity>,
    @InjectRepository(SymbolStrategyBindingEntity)
    private readonly bindingRepo: Repository<SymbolStrategyBindingEntity>,
    @Inject(forwardRef(() => MlEngineService))
    private readonly mlEngine: MlEngineService,
  ) {}

  async onModuleInit() {
    await this.syncModelsFromEngine();
    await this.warmExecutionCache();
  }

  private async warmExecutionCache() {
    const bindings = await this.bindingRepo.find();
    for (const b of bindings) {
      if (!b.activeProfileId) continue;
      const profile = await this.profileRepo.findOne({
        where: { id: b.activeProfileId },
      });
      if (profile) {
        this.executionCache.set(b.symbol, {
          stopLossPercent: profile.stopLossPercent,
          takeProfitPercent: profile.takeProfitPercent,
          maxHorizonCandles: profile.maxHorizonCandles,
          profileId: profile.id,
        });
      }
    }
  }

  private setExecutionCache(symbol: string, profile: TradingProfileEntity) {
    this.executionCache.set(symbol.toUpperCase(), {
      stopLossPercent: profile.stopLossPercent,
      takeProfitPercent: profile.takeProfitPercent,
      maxHorizonCandles: profile.maxHorizonCandles,
      profileId: profile.id,
    });
  }

  private clearExecutionCache(symbol: string) {
    this.executionCache.delete(symbol.toUpperCase());
  }

  /** Sync accessor for PositionManager */
  getActiveExecutionSync(symbol: string) {
    return this.executionCache.get(symbol.toUpperCase()) ?? null;
  }

  // ─── Profiles ─────────────────────────────────────────────

  async listProfiles(symbol?: string): Promise<TradingProfileEntity[]> {
    const where = symbol ? { symbol: symbol.toUpperCase() } : {};
    return this.profileRepo.find({ where, order: { updatedAt: 'DESC' } });
  }

  async getProfile(id: string): Promise<TradingProfileEntity> {
    const p = await this.profileRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`Trading profile ${id} not found`);
    return p;
  }

  async createProfile(input: {
    symbol: string;
    name: string;
    stopLossPercent?: number;
    takeProfitPercent?: number;
    maxHorizonCandles?: number;
    notes?: string;
    fromModelId?: string;
  }): Promise<TradingProfileEntity> {
    const symbol = input.symbol.toUpperCase();
    let sl = input.stopLossPercent ?? DEFAULT_EXECUTION_PARAMS.stopLossPercent;
    let tp = input.takeProfitPercent ?? DEFAULT_EXECUTION_PARAMS.takeProfitPercent;
    let horizon =
      input.maxHorizonCandles ?? DEFAULT_EXECUTION_PARAMS.maxHorizonCandles;

    if (input.fromModelId) {
      const model = await this.getModel(input.fromModelId);
      if (model.symbol !== symbol) {
        throw new BadRequestException('Model symbol does not match profile symbol');
      }
      sl = model.labelConfig.stop_loss_percent;
      tp = model.labelConfig.take_profit_percent;
      horizon = model.labelConfig.max_horizon_candles;
    }

    const entity = this.profileRepo.create({
      symbol,
      name: input.name.trim() || `${symbol} profile`,
      stopLossPercent: sl,
      takeProfitPercent: tp,
      maxHorizonCandles: Math.max(48, Math.min(384, Math.floor(horizon))),
      notes: input.notes ?? null,
    });
    const saved = await this.profileRepo.save(entity);
    this.logger.log(`[PROFILE] Created ${saved.id} for ${symbol}`);
    return saved;
  }

  async updateProfile(
    id: string,
    patch: Partial<
      Pick<
        TradingProfileEntity,
        'name' | 'stopLossPercent' | 'takeProfitPercent' | 'maxHorizonCandles' | 'notes'
      >
    >,
  ): Promise<TradingProfileEntity> {
    const p = await this.getProfile(id);
    Object.assign(p, patch);
    if (patch.maxHorizonCandles != null) {
      p.maxHorizonCandles = Math.max(48, Math.min(384, Math.floor(patch.maxHorizonCandles)));
    }
    const saved = await this.profileRepo.save(p);
    const bindings = await this.bindingRepo.find({ where: { activeProfileId: id } });
    for (const b of bindings) {
      this.setExecutionCache(b.symbol, saved);
    }
    return saved;
  }

  async deleteProfile(id: string): Promise<void> {
    const p = await this.getProfile(id);
    const bindings = await this.bindingRepo.find({ where: { activeProfileId: id } });
    for (const b of bindings) {
      b.activeProfileId = null;
      await this.bindingRepo.save(b);
      this.clearExecutionCache(b.symbol);
    }
    await this.profileRepo.remove(p);
  }

  // ─── Models ───────────────────────────────────────────────

  async listModels(symbol?: string): Promise<MlModelRegistryEntity[]> {
    const where = symbol ? { symbol: symbol.toUpperCase() } : {};
    return this.modelRepo.find({ where, order: { trainedAt: 'DESC' } });
  }

  async getModel(id: string): Promise<MlModelRegistryEntity> {
    const m = await this.modelRepo.findOne({ where: { id } });
    if (!m) throw new NotFoundException(`Model ${id} not found`);
    return m;
  }

  async getModelByEngineId(engineModelId: string): Promise<MlModelRegistryEntity | null> {
    return this.modelRepo.findOne({ where: { engineModelId } });
  }

  async upsertModelFromTrain(input: {
    symbol: string;
    engineModelId: string;
    name: string;
    algorithm: string;
    labelConfig: MlLabelConfigPayload;
    metrics?: Record<string, unknown> | null;
    trainedAt: number;
  }): Promise<MlModelRegistryEntity> {
    const symbol = input.symbol.toUpperCase();
    let row = await this.modelRepo.findOne({
      where: { engineModelId: input.engineModelId },
    });
    if (!row) {
      row = this.modelRepo.create({
        symbol,
        engineModelId: input.engineModelId,
        name: input.name,
        algorithm: input.algorithm,
        labelConfig: input.labelConfig,
        metrics: input.metrics ?? null,
        trainedAt: input.trainedAt,
        status: 'ready',
      });
    } else {
      row.name = input.name;
      row.algorithm = input.algorithm;
      row.labelConfig = input.labelConfig;
      row.metrics = input.metrics ?? null;
      row.trainedAt = input.trainedAt;
      row.status = 'ready';
    }
    return this.modelRepo.save(row);
  }

  async deleteModel(id: string): Promise<void> {
    const m = await this.getModel(id);
    const symbol = m.symbol.toUpperCase();
    const siblings = await this.modelRepo.find({ where: { symbol } });
    const binding = await this.getBinding(symbol);
    const isActive = binding?.activeModelId === id;
    const isLastForSymbol = siblings.length <= 1;

    // Active version cannot be removed while other library versions remain
    if (isActive && !isLastForSymbol) {
      throw new ConflictException(
        `Cannot delete active model “${m.name}” while other versions exist for ${symbol}. Activate another version first.`,
      );
    }

    try {
      if (isLastForSymbol) {
        // Last (or only) version — wipe hot artifact + all versions on engine
        await this.mlEngine.deleteModel(symbol);
      } else {
        await this.mlEngine.deleteLibraryModel(symbol, m.engineModelId);
      }
    } catch (err: any) {
      const status = err?.response?.status as number | undefined;
      const detail =
        err?.response?.data?.detail ||
        err?.response?.data?.message ||
        err?.message ||
        'ML engine delete failed';
      if (status === 409) {
        throw new ConflictException(String(detail));
      }
      if (status === 404) {
        this.logger.warn(
          `[MODEL] Engine already missing ${symbol}/${m.engineModelId} — removing registry row`,
        );
      } else {
        throw new ServiceUnavailableException(
          `Failed to delete model on ML engine: ${detail}`,
        );
      }
    }

    if (binding && binding.activeModelId === id) {
      binding.activeModelId = null;
      await this.bindingRepo.save(binding);
    }

    if (isLastForSymbol) {
      await this.modelRepo.delete({ symbol });
    } else {
      await this.modelRepo.remove(m);
    }
  }

  async syncModelsFromEngine(): Promise<number> {
    const lib = await this.mlEngine.getModelLibrary();
    if (!lib?.libraries) return 0;
    let n = 0;
    for (const entry of lib.libraries) {
      const symbol = String(entry.symbol || '').toUpperCase();
      if (!symbol) continue;
      const models = Array.isArray(entry.models) ? entry.models : [];
      for (const m of models) {
        const engineModelId = String(m.model_id || '');
        if (!engineModelId) continue;
        const label = m.label_config as MlLabelConfigPayload | undefined;
        if (!label?.stop_loss_percent && label?.stop_loss_percent !== 0) continue;
        await this.upsertModelFromTrain({
          symbol,
          engineModelId,
          name: String(m.name || `${symbol}-${engineModelId.slice(0, 6)}`),
          algorithm: String(m.algorithm || 'ensemble'),
          labelConfig: {
            stop_loss_percent: Number(label.stop_loss_percent),
            take_profit_percent: Number(label.take_profit_percent),
            max_horizon_candles: Number(label.max_horizon_candles || 96),
            label_mode: label.label_mode,
            round_trip_fee_percent: label.round_trip_fee_percent,
          },
          metrics: (m.metrics_summary as Record<string, unknown>) || null,
          trainedAt: Number(m.trained_at) || Date.now(),
        });
        n++;
      }
      // Keep Nest binding aligned with engine hot/active model
      const activeEngineId = entry.active_model_id
        ? String(entry.active_model_id)
        : null;
      if (activeEngineId) {
        const reg = await this.getModelByEngineId(activeEngineId);
        if (reg) {
          const binding = await this.ensureBinding(symbol);
          if (binding.activeModelId !== reg.id) {
            binding.activeModelId = reg.id;
            await this.bindingRepo.save(binding);
            this.logger.log(
              `[MODEL] Binding ${symbol} → active engine model ${activeEngineId}`,
            );
          }
        }
      }
    }
    this.logger.log(`[MODEL] Synced ${n} model(s) from ML engine library`);
    return n;
  }

  /**
   * After background train starts: poll ML health until ready/error, then sync registry.
   * Production-safe replacement for a single fixed setTimeout.
   */
  schedulePostTrainSync(symbol: string): void {
    const sym = symbol.toUpperCase();
    const started = Date.now();
    const maxMs = 15 * 60 * 1000;
    const intervalMs = 5000;

    const tick = async () => {
      try {
        const health = await this.mlEngine.getHealth();
        const status = health?.training_status?.[sym];
        if (status === 'training') {
          if (Date.now() - started > maxMs) {
            this.logger.warn(`[MODEL] Post-train sync timed out for ${sym}`);
            return;
          }
          setTimeout(() => {
            void tick();
          }, intervalMs);
          return;
        }
        const n = await this.syncModelsFromEngine();
        this.logger.log(
          `[MODEL] Post-train sync for ${sym} (status=${status ?? 'unknown'}, synced=${n})`,
        );
      } catch (err: any) {
        this.logger.warn(`[MODEL] Post-train sync ${sym}: ${err.message}`);
        if (Date.now() - started < maxMs) {
          setTimeout(() => {
            void tick();
          }, intervalMs);
        }
      }
    };

    setTimeout(() => {
      void tick();
    }, intervalMs);
  }

  // ─── Bindings ─────────────────────────────────────────────

  async ensureBinding(symbol: string): Promise<SymbolStrategyBindingEntity> {
    const sym = symbol.toUpperCase();
    let b = await this.bindingRepo.findOne({ where: { symbol: sym } });
    if (!b) {
      b = this.bindingRepo.create({
        symbol: sym,
        activeProfileId: null,
        activeModelId: null,
      });
      b = await this.bindingRepo.save(b);
    }
    return b;
  }

  async getBinding(symbol: string): Promise<SymbolStrategyBindingEntity> {
    return this.ensureBinding(symbol);
  }

  async activateProfile(symbol: string, profileId: string): Promise<StrategyPairStatus> {
    const sym = symbol.toUpperCase();
    const profile = await this.getProfile(profileId);
    if (profile.symbol !== sym) {
      throw new BadRequestException('Profile symbol mismatch');
    }
    const binding = await this.ensureBinding(sym);
    binding.activeProfileId = profileId;
    await this.bindingRepo.save(binding);
    this.setExecutionCache(sym, profile);
    return this.getPairStatus(sym);
  }

  async activateModel(symbol: string, modelId: string): Promise<StrategyPairStatus> {
    const sym = symbol.toUpperCase();
    const model = await this.getModel(modelId);
    if (model.symbol !== sym) {
      throw new BadRequestException('Model symbol mismatch');
    }
    const activated = await this.mlEngine.activateLibraryModel(sym, model.engineModelId);
    if (!activated) {
      throw new BadRequestException(`Failed to activate model ${model.engineModelId} on ML engine`);
    }
    const binding = await this.ensureBinding(sym);
    binding.activeModelId = modelId;
    await this.bindingRepo.save(binding);
    return this.getPairStatus(sym);
  }

  async clearActiveProfile(symbol: string): Promise<StrategyPairStatus> {
    const binding = await this.ensureBinding(symbol);
    binding.activeProfileId = null;
    await this.bindingRepo.save(binding);
    this.clearExecutionCache(symbol);
    return this.getPairStatus(symbol);
  }

  async clearActiveModel(symbol: string): Promise<StrategyPairStatus> {
    const binding = await this.ensureBinding(symbol);
    binding.activeModelId = null;
    await this.bindingRepo.save(binding);
    return this.getPairStatus(symbol);
  }

  /** Live execution levels from active profile — null if incomplete */
  async getActiveExecution(symbol: string): Promise<{
    stopLossPercent: number;
    takeProfitPercent: number;
    maxHorizonCandles: number;
    profileId: string;
  } | null> {
    const binding = await this.ensureBinding(symbol);
    if (!binding.activeProfileId) return null;
    const profile = await this.profileRepo.findOne({
      where: { id: binding.activeProfileId },
    });
    if (!profile) return null;
    return {
      stopLossPercent: profile.stopLossPercent,
      takeProfitPercent: profile.takeProfitPercent,
      maxHorizonCandles: profile.maxHorizonCandles,
      profileId: profile.id,
    };
  }

  async getPairStatus(symbol: string): Promise<StrategyPairStatus> {
    const sym = symbol.toUpperCase();
    const binding = await this.ensureBinding(sym);
    const profile = binding.activeProfileId
      ? await this.profileRepo.findOne({ where: { id: binding.activeProfileId } })
      : null;
    const model = binding.activeModelId
      ? await this.modelRepo.findOne({ where: { id: binding.activeModelId } })
      : null;

    const base: StrategyPairStatus = {
      symbol: sym,
      status: 'incomplete',
      fields: [],
      blockBuy: true,
      profile: {
        id: profile?.id ?? null,
        name: profile?.name ?? null,
        stopLossPercent: profile?.stopLossPercent ?? null,
        takeProfitPercent: profile?.takeProfitPercent ?? null,
        maxHorizonCandles: profile?.maxHorizonCandles ?? null,
      },
      model: {
        id: model?.id ?? null,
        name: model?.name ?? null,
        engineModelId: model?.engineModelId ?? null,
        labelConfig: model?.labelConfig ?? null,
      },
      message: '',
    };

    if (!profile && !model) {
      return {
        ...base,
        message: 'No active trading profile or ML model — assign both before trading.',
      };
    }
    if (!profile) {
      return {
        ...base,
        message:
          'No active trading profile. Create one manually or from the active model.',
      };
    }
    if (!model) {
      return {
        ...base,
        message:
          'No active ML model. Train one (manual or from profile) and activate it.',
      };
    }

    const match = paramsMatch(
      {
        stopLossPercent: profile.stopLossPercent,
        takeProfitPercent: profile.takeProfitPercent,
        maxHorizonCandles: profile.maxHorizonCandles,
      },
      model.labelConfig,
    );

    if (!match.ok) {
      return {
        ...base,
        status: 'mismatch',
        fields: match.fields,
        blockBuy: true,
        message: `Profile and model params differ (${match.fields.join(', ')}). BUY blocked — align or create matching profile/model.`,
      };
    }

    return {
      ...base,
      status: 'ok',
      fields: [],
      blockBuy: false,
      message: 'Profile and model are aligned — trading allowed (subject to risk gates).',
    };
  }

  async listPairStatuses(symbols: string[]): Promise<StrategyPairStatus[]> {
    const out: StrategyPairStatus[] = [];
    for (const s of symbols) {
      out.push(await this.getPairStatus(s));
    }
    return out;
  }

  /** Models whose label_config matches a profile */
  async findCompatibleModels(profileId: string): Promise<MlModelRegistryEntity[]> {
    const profile = await this.getProfile(profileId);
    const models = await this.listModels(profile.symbol);
    return models.filter((m) => {
      const r = paramsMatch(
        {
          stopLossPercent: profile.stopLossPercent,
          takeProfitPercent: profile.takeProfitPercent,
          maxHorizonCandles: profile.maxHorizonCandles,
        },
        m.labelConfig,
      );
      return r.ok;
    });
  }

  async findCompatibleProfiles(modelId: string): Promise<TradingProfileEntity[]> {
    const model = await this.getModel(modelId);
    const profiles = await this.listProfiles(model.symbol);
    return profiles.filter((p) => {
      const r = paramsMatch(
        {
          stopLossPercent: p.stopLossPercent,
          takeProfitPercent: p.takeProfitPercent,
          maxHorizonCandles: p.maxHorizonCandles,
        },
        model.labelConfig,
      );
      return r.ok;
    });
  }

  labelConfigFromProfile(profile: TradingProfileEntity): MlLabelConfigPayload {
    return {
      stop_loss_percent: profile.stopLossPercent,
      take_profit_percent: profile.takeProfitPercent,
      max_horizon_candles: profile.maxHorizonCandles,
    };
  }

  @OnEvent('SYMBOL_ADDED')
  async onSymbolAdded(entity: SymbolEntity) {
    if (!entity?.symbol) return;
    await this.ensureBinding(entity.symbol);
    this.logger.log(`[BINDING] Ensured strategy binding for ${entity.symbol}`);
  }
}

export { horizonForTakeProfit };
