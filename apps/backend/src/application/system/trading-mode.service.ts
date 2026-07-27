// apps/backend/src/application/system/trading-mode.service.ts

import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import {
  MARKET_EVENTS,
  TradingMode,
} from '../../core/domain/market.types';
import { SystemConfigEntity } from '../../infrastructure/database/system-config.entity';
import { BinanceExecutionService } from '../../infrastructure/exchange/binance-execution.service';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';

const TRADING_MODE_KEY = 'trading_mode';

export type TradingModeStatus = {
  mode: TradingMode;
  liveAllowed: boolean;
  liveBlockReason: string | null;
  openPositions: number;
  openOrders: number;
  canSwitch: boolean;
  switchBlockReason: string | null;
};

@Injectable()
export class TradingModeService implements OnModuleInit {
  private readonly logger = new Logger(TradingModeService.name);

  constructor(
    @InjectRepository(SystemConfigEntity)
    private readonly configRepo: Repository<SystemConfigEntity>,
    private readonly execution: BinanceExecutionService,
    private readonly positionManager: PositionManagerService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    const persisted = await this.loadPersistedMode();
    const target = persisted ?? this.execution.getMode();

    if (target === 'live' && !this.execution.isLiveAllowed()) {
      this.logger.warn(
        `[MODE] Persisted LIVE but live is blocked — falling back to PAPER`,
      );
      this.execution.applyMode('paper');
      await this.persistMode('paper');
      return;
    }

    try {
      this.execution.applyMode(target);
      if (!persisted) {
        await this.persistMode(target);
      }
    } catch (err) {
      this.logger.error(`[MODE] Failed to apply ${target}: ${err.message}`);
      this.execution.applyMode('paper');
      await this.persistMode('paper');
    }
  }

  /**
   * Lightweight status for polling — does NOT hit the exchange for open orders.
   * canSwitch is based on open positions only; actual switch does a full check.
   */
  async getStatus(): Promise<TradingModeStatus> {
    const mode = this.execution.getMode();
    const liveBlockReason = this.execution.getLiveBlockReason();
    const openPositions = this.positionManager.getOpenPositions().length;

    let switchBlockReason: string | null = null;
    if (openPositions > 0) {
      switchBlockReason = `Close ${openPositions} open position(s) before switching mode`;
    }

    return {
      mode,
      liveAllowed: liveBlockReason === null,
      liveBlockReason,
      openPositions,
      openOrders: -1,
      canSwitch: switchBlockReason === null,
      switchBlockReason,
    };
  }

  /** Full status including exchange open-orders check — only for switch validation. */
  private async getStatusForSwitch(): Promise<TradingModeStatus> {
    const mode = this.execution.getMode();
    const liveBlockReason = this.execution.getLiveBlockReason();
    const openPositions = this.positionManager.getOpenPositions().length;
    let openOrders = 0;
    try {
      openOrders = (await this.execution.fetchOpenOrders()).length;
    } catch {
      openOrders = 0;
    }

    let switchBlockReason: string | null = null;
    if (openPositions > 0) {
      switchBlockReason = `Close ${openPositions} open position(s) before switching mode`;
    } else if (openOrders > 0) {
      switchBlockReason = `Cancel ${openOrders} open order(s) before switching mode`;
    }

    return {
      mode,
      liveAllowed: liveBlockReason === null,
      liveBlockReason,
      openPositions,
      openOrders,
      canSwitch: switchBlockReason === null,
      switchBlockReason,
    };
  }

  async setMode(
    mode: TradingMode,
    confirm?: string,
  ): Promise<TradingModeStatus> {
    if (mode !== 'paper' && mode !== 'live') {
      throw new BadRequestException('mode must be paper or live');
    }

    const current = this.execution.getMode();
    if (mode === current) {
      return this.getStatus();
    }

    if (mode === 'live') {
      if (confirm !== 'LIVE') {
        throw new BadRequestException(
          'Switching to LIVE requires confirm: "LIVE"',
        );
      }
      const liveReason = this.execution.getLiveBlockReason();
      if (liveReason) {
        throw new BadRequestException(`Live trading blocked: ${liveReason}`);
      }
    }

    const status = await this.getStatusForSwitch();
    if (!status.canSwitch) {
      throw new BadRequestException(
        status.switchBlockReason || 'Cannot switch trading mode',
      );
    }

    this.execution.applyMode(mode);
    await this.persistMode(mode);

    this.eventEmitter.emit(MARKET_EVENTS.TRADING_MODE_CHANGED, {
      mode,
      previousMode: current,
      timestamp: Date.now(),
    });

    this.logger.log(`[MODE] Switched ${current} → ${mode}`);
    return this.getStatus();
  }

  private async loadPersistedMode(): Promise<TradingMode | null> {
    try {
      const row = await this.configRepo.findOne({
        where: { key: TRADING_MODE_KEY },
      });
      const mode = row?.value?.mode;
      if (mode === 'paper' || mode === 'live') {
        return mode;
      }
    } catch (err) {
      this.logger.warn(`[MODE] Failed to load persisted mode: ${err.message}`);
    }
    return null;
  }

  private async persistMode(mode: TradingMode): Promise<void> {
    try {
      const existing = await this.configRepo.findOne({
        where: { key: TRADING_MODE_KEY },
      });
      const value = { mode };
      const updatedAt = Date.now();
      if (existing) {
        existing.value = value;
        existing.updatedAt = updatedAt;
        await this.configRepo.save(existing);
      } else {
        await this.configRepo.save({
          key: TRADING_MODE_KEY,
          value,
          updatedAt,
        });
      }
    } catch (err) {
      this.logger.error(`[MODE] Failed to persist mode: ${err.message}`);
    }
  }
}
