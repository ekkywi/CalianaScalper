// src/application/orchestrator/market.orchestrator.ts

import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MARKET_EVENTS, type CandleData } from '../../core/domain/market.types';
import { MlEngineService } from '../../infrastructure/ml/ml-engine.service';
import type { MlPrediction } from '../../infrastructure/ml/ml-engine.service';
import {
  MlPredictionLogService,
  type MlBlockedBy,
} from '../../infrastructure/ml/ml-prediction-log.service';
import { BinanceExecutionService } from '../../infrastructure/exchange/binance-execution.service';
import { PositionManagerService } from '../../infrastructure/risk/position-manager.service';
import { StrategyService } from '../../infrastructure/strategy/strategy.service';
import { SymbolService } from '../symbol/symbol.service';

type GateResult = {
  allowExecute: boolean;
  wouldExecute: boolean;
  effectiveMinConfidence: number;
  blockedBy: MlBlockedBy;
  logMessage: string | null;
};

@Injectable()
export class MarketOrchestrator {
  private readonly logger = new Logger(MarketOrchestrator.name);

  private lastExecutedCandleTime: Map<string, number> = new Map();
  private mlEngineDownCount: Map<string, number> = new Map();
  private readonly MAX_ML_RETRIES = 3;

  constructor(
    private readonly mlEngine: MlEngineService,
    private readonly mlLog: MlPredictionLogService,
    private readonly executionService: BinanceExecutionService,
    private readonly positionManager: PositionManagerService,
    private readonly symbolService: SymbolService,
    @Inject(forwardRef(() => StrategyService))
    private readonly strategy: StrategyService,
  ) {}

  @OnEvent(MARKET_EVENTS.CANDLE_CLOSED)
  async handleCandleClosed(candle: CandleData) {
    try {
      const activeSymbols = await this.symbolService.getActiveSymbols();
      const isActive = activeSymbols.some((s) => s.symbol === candle.symbol);
      if (!isActive) {
        this.logger.warn(
          `[ORCHESTRATOR] ${candle.symbol} is not an active symbol — skipping candle close.`,
        );
        return;
      }

      // STEP 1: Mutex — prevent duplicate candle processing
      const lastTime = this.lastExecutedCandleTime.get(candle.symbol) || 0;
      if (candle.closeTime <= lastTime) {
        this.logger.warn(
          `[MUTEX] Event ganda terdeteksi untuk ${candle.symbol} pada timestamp ${candle.closeTime}. Eksekusi dibatalkan.`,
        );
        return;
      }
      this.lastExecutedCandleTime.set(candle.symbol, candle.closeTime);

      this.logger.log(
        `[ORCHESTRATOR] Candle 15m ditutup untuk ${candle.symbol}. Memulai analisis...`,
      );

      // STEP 2: Global halt
      if (this.positionManager.isTradingHalted()) {
        this.logger.warn(
          `[ORCHESTRATOR] Trading sedang dihentikan. Melewati analisis untuk ${candle.symbol}.`,
        );
        return;
      }

      // STEP 3: SL/TP first (highest priority exit)
      await this.positionManager.checkPositions(candle);

      // STEP 4: Always predict + persist (flat or holding) so UI stays fresh
      const prediction = await this.getPredictionWithRetry(candle);
      if (!prediction) {
        this.logger.warn(
          `[ORCHESTRATOR] Tidak ada prediksi untuk ${candle.symbol}. Melewati candle ini.`,
        );
        return;
      }

      const riskConfig = this.positionManager.getRiskConfig();
      const hasOpen = this.positionManager.hasOpenPosition(candle.symbol);

      if (hasOpen) {
        await this.handleHoldingPath(candle, prediction, riskConfig);
      } else {
        await this.handleEntryPath(candle, prediction, riskConfig);
      }
    } catch (error) {
      this.logger.error(
        `[ORCHESTRATOR] Error memproses candle ${candle.symbol}: ${error.message}`,
      );
    }
  }

  /**
   * Flat: BUY may open; SELL ignored (no short); HOLD no-op.
   */
  private async handleEntryPath(
    candle: CandleData,
    prediction: MlPrediction,
    riskConfig: ReturnType<PositionManagerService['getRiskConfig']>,
  ): Promise<void> {
    const gate = this.evaluateEntryGates(candle, prediction, riskConfig);
    if (!gate.allowExecute) {
      await this.persistDecision(candle, prediction, {
        effectiveMinConfidence: gate.effectiveMinConfidence,
        blockedBy: gate.blockedBy,
        wouldExecute: gate.wouldExecute,
        executed: false,
      });
      if (gate.logMessage) this.logger.log(gate.logMessage);
      return;
    }

    if (prediction.signal === 'BUY') {
      const pair = await this.strategy.getPairStatus(candle.symbol);
      if (pair.blockBuy) {
        this.logger.warn(
          `[STRATEGY] BUY ${candle.symbol} blocked — ${pair.message}`,
        );
        await this.persistDecision(candle, prediction, {
          effectiveMinConfidence: gate.effectiveMinConfidence,
          blockedBy: 'drift',
          wouldExecute: true,
          executed: false,
        });
        return;
      }

      await this.persistDecision(candle, prediction, {
        effectiveMinConfidence: gate.effectiveMinConfidence,
        blockedBy: null,
        wouldExecute: true,
        executed: false,
      });
      const opened = await this.executeBuySignal(candle, prediction);
      if (opened) {
        await this.persistDecision(candle, prediction, {
          effectiveMinConfidence: gate.effectiveMinConfidence,
          blockedBy: null,
          wouldExecute: true,
          executed: true,
        });
      }
      return;
    }

    if (prediction.signal === 'SELL') {
      await this.persistDecision(candle, prediction, {
        effectiveMinConfidence: gate.effectiveMinConfidence,
        blockedBy: null,
        wouldExecute: false,
        executed: false,
      });
      this.logger.log(
        `[ORCHESTRATOR] SELL ${candle.symbol} diabaikan (flat — tidak ada posisi LONG).`,
      );
      return;
    }

    await this.persistDecision(candle, prediction, {
      effectiveMinConfidence: gate.effectiveMinConfidence,
      blockedBy: null,
      wouldExecute: false,
      executed: false,
    });
    this.logger.log(`[ORCHESTRATOR] Sinyal HOLD untuk ${candle.symbol}.`);
  }

  /**
   * Holding: ignore BUY; HOLD = keep; SELL may close (shadow logs would-close).
   * SL/TP already applied before this path.
   */
  private async handleHoldingPath(
    candle: CandleData,
    prediction: MlPrediction,
    riskConfig: ReturnType<PositionManagerService['getRiskConfig']>,
  ): Promise<void> {
    const effectiveMin = this.effectiveMinConfidence(prediction, riskConfig);

    if (prediction.signal === 'BUY') {
      await this.persistDecision(candle, prediction, {
        effectiveMinConfidence: effectiveMin,
        blockedBy: 'holding',
        wouldExecute: false,
        executed: false,
      });
      this.logger.log(
        `[HOLDING] BUY ${candle.symbol} diabaikan — posisi sudah terbuka (predict tetap tercatat).`,
      );
      return;
    }

    if (prediction.signal === 'HOLD') {
      await this.persistDecision(candle, prediction, {
        effectiveMinConfidence: effectiveMin,
        blockedBy: null,
        wouldExecute: false,
        executed: false,
      });
      this.logger.log(
        `[HOLDING] HOLD ${candle.symbol} — posisi tetap; SL/TP tetap aktif.`,
      );
      return;
    }

    // SELL while holding → optional ML exit
    if (prediction.confidence < effectiveMin) {
      await this.persistDecision(candle, prediction, {
        effectiveMinConfidence: effectiveMin,
        blockedBy: 'confidence',
        wouldExecute: false,
        executed: false,
      });
      this.logger.log(
        `[HOLDING] SELL ${candle.symbol} skipped — confidence ` +
          `${(prediction.confidence * 100).toFixed(1)}% < ` +
          `${(effectiveMin * 100).toFixed(1)}%`,
      );
      return;
    }

    if (riskConfig.mlShadowMode) {
      await this.persistDecision(candle, prediction, {
        effectiveMinConfidence: effectiveMin,
        blockedBy: 'shadow_mode',
        wouldExecute: true,
        executed: false,
      });
      this.logger.log(
        `[SHADOW] Would CLOSE ${candle.symbol} on SELL @ ` +
          `${(prediction.confidence * 100).toFixed(1)}% — execution skipped`,
      );
      return;
    }

    await this.persistDecision(candle, prediction, {
      effectiveMinConfidence: effectiveMin,
      blockedBy: null,
      wouldExecute: true,
      executed: true,
    });
    await this.executeSellSignal(candle, prediction.confidence);
  }

  private effectiveMinConfidence(
    prediction: MlPrediction,
    riskConfig: ReturnType<PositionManagerService['getRiskConfig']>,
  ): number {
    const raw = prediction.raw || {};
    const regimeBump = riskConfig.mlRegimeGateEnabled
      ? Number(raw.regime_confidence_bump) || 0
      : 0;
    return riskConfig.minConfidenceThreshold + regimeBump;
  }

  private evaluateEntryGates(
    candle: CandleData,
    prediction: MlPrediction,
    riskConfig: ReturnType<PositionManagerService['getRiskConfig']>,
  ): GateResult {
    const raw = prediction.raw || {};
    const effectiveMin = this.effectiveMinConfidence(prediction, riskConfig);

    const base: GateResult = {
      effectiveMinConfidence: effectiveMin,
      wouldExecute: false,
      blockedBy: null,
      logMessage: null,
      allowExecute: true,
    };

    if (prediction.signal !== 'BUY') {
      if (prediction.confidence < effectiveMin) {
        return {
          ...base,
          allowExecute: false,
          blockedBy: 'confidence',
          logMessage:
            `[ORCHESTRATOR] ${prediction.signal} ${candle.symbol} skipped — confidence ` +
            `${(prediction.confidence * 100).toFixed(1)}% below ` +
            `${(effectiveMin * 100).toFixed(1)}%`,
        };
      }
      return base;
    }

    const regimeBump = riskConfig.mlRegimeGateEnabled
      ? Number(raw.regime_confidence_bump) || 0
      : 0;
    const wouldPassConfidence = prediction.confidence >= effectiveMin;
    const allowLong =
      !riskConfig.mlRegimeGateEnabled || raw.regime_allow_long !== false;

    if (!wouldPassConfidence) {
      return {
        ...base,
        allowExecute: false,
        blockedBy: 'confidence',
        logMessage:
          `[ORCHESTRATOR] BUY ${candle.symbol} blocked — confidence ` +
          `${(prediction.confidence * 100).toFixed(1)}% < ` +
          `${(effectiveMin * 100).toFixed(1)}%` +
          (regimeBump > 0
            ? ` (incl. regime +${(regimeBump * 100).toFixed(0)}%)`
            : ''),
      };
    }

    if (!allowLong) {
      const regime = raw.regime || 'unknown';
      const reason = raw.regime_reason || 'regime gate';
      return {
        ...base,
        allowExecute: false,
        blockedBy: 'regime',
        logMessage: `[REGIME] BUY ${candle.symbol} blocked (${regime}): ${reason}`,
      };
    }

    if (riskConfig.mlShadowMode) {
      return {
        ...base,
        allowExecute: false,
        wouldExecute: true,
        blockedBy: 'shadow_mode',
        logMessage:
          `[SHADOW] Would BUY ${candle.symbol} @ ${(prediction.confidence * 100).toFixed(1)}% ` +
          `(regime=${raw.regime || 'n/a'}) — execution skipped`,
      };
    }

    return { ...base, wouldExecute: true };
  }

  private async persistDecision(
    candle: CandleData,
    prediction: MlPrediction,
    meta: {
      effectiveMinConfidence: number;
      blockedBy: MlBlockedBy;
      wouldExecute: boolean;
      executed: boolean;
    },
  ): Promise<void> {
    await this.mlLog.record({
      candle,
      prediction,
      effectiveMinConfidence: meta.effectiveMinConfidence,
      blockedBy: meta.blockedBy,
      wouldExecute: meta.wouldExecute,
      executed: meta.executed,
      tradingMode: this.executionService.getMode(),
    });
  }

  private async getPredictionWithRetry(candle: CandleData) {
    const symbol = candle.symbol;
    const retryCount = this.mlEngineDownCount.get(symbol) || 0;

    if (retryCount >= this.MAX_ML_RETRIES) {
      this.logger.error(
        `[ORCHESTRATOR] ML Engine untuk ${symbol} gagal ${retryCount} kali berturut-turut. ` +
          `Menunggu candle berikutnya.`,
      );
      return null;
    }

    const prediction = await this.mlEngine.getPrediction(candle);

    if (!prediction) {
      this.mlEngineDownCount.set(symbol, retryCount + 1);
      this.logger.warn(
        `[ORCHESTRATOR] ML Engine gagal (percobaan ${retryCount + 1}/${this.MAX_ML_RETRIES}) untuk ${symbol}`,
      );
      return null;
    }

    this.mlEngineDownCount.set(symbol, 0);
    return prediction;
  }

  private async executeBuySignal(
    candle: CandleData,
    prediction: MlPrediction,
  ): Promise<boolean> {
    const symbol = candle.symbol;
    const confidence = prediction.confidence;
    const algorithm =
      typeof prediction.raw?.algorithm === 'string'
        ? prediction.raw.algorithm
        : undefined;
    this.logger.log(
      `[SINYAL] BUY ${symbol} dengan keyakinan ${(confidence * 100).toFixed(1)}%`,
    );

    const balance = await this.executionService.getBalance('USDT');
    if (!balance) {
      this.logger.error(
        `[ORCHESTRATOR] Gagal mendapatkan saldo untuk eksekusi BUY ${symbol}`,
      );
      return false;
    }

    const drawdownOk =
      await this.positionManager.updateEquityAndCheckDrawdown(balance.total);
    if (!drawdownOk) {
      this.logger.warn(`[ORCHESTRATOR] Drawdown breach — skip BUY ${symbol}`);
      return false;
    }

    const entryPrice = candle.close;
    const positionSize = this.positionManager.calculatePositionSize(
      balance,
      entryPrice,
      symbol,
    );

    if (positionSize <= 0) {
      this.logger.warn(
        `[ORCHESTRATOR] Ukuran posisi tidak valid (${positionSize}) untuk ${symbol}`,
      );
      return false;
    }

    const gate = await this.positionManager.canOpenPosition(
      symbol,
      entryPrice,
      positionSize,
      balance,
    );
    if (!gate.allowed) {
      this.logger.warn(
        `[ORCHESTRATOR] BUY ${symbol} ditolak pre-flight: ${gate.reason}`,
      );
      return false;
    }

    const orderResult = await this.executionService.executeMarketOrder(
      symbol,
      'buy',
      positionSize,
    );

    if (!orderResult) {
      this.logger.error(`[ORCHESTRATOR] Order BUY ${symbol} gagal dieksekusi.`);
      return false;
    }

    const avgPrice =
      orderResult.averagePrice > 0 ? orderResult.averagePrice : entryPrice;
    const filledQty =
      orderResult.filledQuantity > 0
        ? orderResult.filledQuantity
        : positionSize;

    const position = await this.positionManager.openPosition(
      symbol,
      'LONG',
      avgPrice,
      filledQty,
      balance,
      {
        signal: prediction.signal,
        confidence,
        algorithm,
      },
    );

    if (!position) {
      this.logger.error(
        `[ORCHESTRATOR] Posisi ${symbol} gagal tercatat setelah fill — mencoba flatten darurat`,
      );
      await this.executionService.closePosition(symbol, filledQty);
      return false;
    }
    return true;
  }

  private async executeSellSignal(candle: CandleData, confidence: number) {
    const symbol = candle.symbol;
    this.logger.log(
      `[SINYAL] SELL ${symbol} dengan keyakinan ${(confidence * 100).toFixed(1)}% — menutup posisi`,
    );

    const existingPosition = this.positionManager.getPosition(symbol);

    if (existingPosition && existingPosition.status === 'OPEN') {
      const closed = await this.positionManager.flattenAndClose(
        symbol,
        candle.close,
        'CLOSED_BY_SIGNAL',
      );
      if (!closed) {
        this.logger.error(
          `[ORCHESTRATOR] Gagal menutup ${symbol} via sinyal SELL`,
        );
      }
    } else {
      this.logger.warn(
        `[ORCHESTRATOR] SELL ${symbol} diabaikan (tidak ada posisi LONG terbuka).`,
      );
    }
  }

  @OnEvent(MARKET_EVENTS.CANDLE_TICK)
  handleCandleTick(candle: CandleData) {
    this.logger.debug(`[TICK] ${candle.symbol}: ${candle.close}`);
  }

  @OnEvent(MARKET_EVENTS.TRADING_HALTED)
  handleTradingHalted(event: { reason: string }) {
    this.logger.error(`[ORCHESTRATOR] Trading dihentikan: ${event.reason}`);
  }

  @OnEvent(MARKET_EVENTS.TRADING_RESUMED)
  handleTradingResumed() {
    this.logger.log('[ORCHESTRATOR] Trading dilanjutkan kembali.');
  }
}
