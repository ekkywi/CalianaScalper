// apps/frontend/src/components/strategy/MlModelManagement.tsx
// Panel model ML via Nest proxy → FastAPI (grouped by algorithm)

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Brain,
  RefreshCw,
  BarChart3,
  Clock,
  CheckCircle,
  XCircle,
  Trash2,
} from 'lucide-react';
import { timeAgo } from '@/lib/utils';
import { fetchSymbols } from '@/services/api';
import {
  deleteMlModel,
  fetchMlEval,
  fetchMlLabelPreview,
  fetchMlModels,
  fetchMlTradeStats,
  fetchPositions,
  fetchTradingMode,
  retrainModel,
} from '@/services/api-extended';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type ModelRow = {
  symbol: string;
  status: string;
  algorithm?: string;
  algorithm_name?: string;
  accuracy?: number | null;
  precision_buy?: number | null;
  recall_buy?: number | null;
  f1_buy?: number | null;
  label_config?: {
    label_mode?: string;
    stop_loss_percent?: number;
    take_profit_percent?: number;
    max_horizon_candles?: number;
  };
  buffer_size?: number;
  bufferSize?: number;
  lastTraining?: number;
  trained_at?: number | null;
  buffer_start_time?: number | null;
  sub_models?: Record<
    string,
    { accuracy?: number | null; precision_buy?: number | null }
  >;
  ensemble_members?: string[];
  last_training_error?: string | null;
};

type LabelPreview = {
  symbol: string;
  train_rows?: number;
  n_positive?: number;
  n_negative?: number;
  positive_rate?: number | null;
  trainable?: boolean;
  hint?: string | null;
  label_config?: {
    stop_loss_percent?: number;
    take_profit_percent?: number;
    max_horizon_candles?: number;
  };
  resolved_rows?: number;
  timeout_rows?: number;
};

type EvalSummary = {
  backtest_ml?: { n_trades?: number; win_rate?: number | null; avg_return_pct?: number | null };
  backtest_baseline_ema?: { n_trades?: number; win_rate?: number | null; avg_return_pct?: number | null };
  disclaimer?: string;
};

type ConfirmKind = 'delete' | 'retrain' | null;

function isAlreadyAbsentError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /no model files found|already absent|404/i.test(message);
}

function formatAccuracy(accuracy: number | null | undefined): string {
  if (accuracy == null || !Number.isFinite(Number(accuracy))) return 'n/a';
  const v = Number(accuracy);
  // Accept 0–1 fraction or accidental 0–100
  const pct = v > 1 ? v : v * 100;
  return `${pct.toFixed(1)}%`;
}

export default function MlModelManagement() {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [trainSymbol, setTrainSymbol] = useState('');
  const [training, setTraining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [openPositionCount, setOpenPositionCount] = useState(0);
  const [previousAccuracy, setPreviousAccuracy] = useState<
    Record<string, number | null | undefined>
  >({});
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null);
  const [confirmSymbol, setConfirmSymbol] = useState<string | null>(null);
  const [confirmAlgo, setConfirmAlgo] = useState<string | undefined>();
  const [evalBySymbol, setEvalBySymbol] = useState<Record<string, EvalSummary>>({});
  const [evalLoading, setEvalLoading] = useState<string | null>(null);
  const [previewBySymbol, setPreviewBySymbol] = useState<Record<string, LabelPreview>>({});
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [mlTradeStats, setMlTradeStats] = useState<{
    totalTrades: number;
    winRate: number | null;
    totalPnl: number;
    avgConfidence: number | null;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [mlData, symbols, tradeStats] = await Promise.all([
        fetchMlModels(),
        fetchSymbols().catch(() => []),
        fetchMlTradeStats('all').catch(() => null),
      ]);
      setModels(Array.isArray(mlData.models) ? mlData.models : []);
      if (tradeStats && typeof tradeStats.totalTrades === 'number') {
        setMlTradeStats({
          totalTrades: tradeStats.totalTrades,
          winRate: tradeStats.winRate,
          totalPnl: tradeStats.totalPnl,
          avgConfidence: tradeStats.avgConfidence,
        });
      }
      const syms = Array.isArray(symbols)
        ? symbols.map((s: { symbol: string }) => String(s.symbol).toUpperCase())
        : [];
      setWatchlist(syms);
    } catch (err: any) {
      setError(err.message || 'Failed to load ML models');
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshGuards = useCallback(async () => {
    try {
      const [mode, positions] = await Promise.all([
        fetchTradingMode(),
        fetchPositions().catch(() => []),
      ]);
      setIsLive(mode?.mode === 'live');
      const list = Array.isArray(positions)
        ? positions
        : Array.isArray((positions as any)?.positions)
          ? (positions as any).positions
          : [];
      setOpenPositionCount(list.length);
    } catch {
      /* keep last known */
    }
  }, []);

  useEffect(() => {
    load();
    refreshGuards();
    const interval = setInterval(() => {
      load();
      refreshGuards();
    }, 20000);
    return () => clearInterval(interval);
  }, [load, refreshGuards]);

  const modelSymbols = useMemo(
    () => new Set(models.map((m) => m.symbol.toUpperCase())),
    [models],
  );

  const trainableSymbols = useMemo(
    () => watchlist.filter((s) => !modelSymbols.has(s)).sort(),
    [watchlist, modelSymbols],
  );

  useEffect(() => {
    if (trainableSymbols.length === 0) {
      setTrainSymbol('');
      return;
    }
    if (!trainableSymbols.includes(trainSymbol)) {
      setTrainSymbol(trainableSymbols[0]);
    }
  }, [trainableSymbols, trainSymbol]);

  const runTrain = async (symbol: string, algorithm?: string) => {
    setTraining(symbol);
    setError(null);
    const existing = models.find((m) => m.symbol === symbol);
    setPreviousAccuracy((prev) => ({
      ...prev,
      [symbol]: existing?.accuracy,
    }));
    try {
      await retrainModel(symbol, algorithm);
      setTimeout(() => load(), 1500);
      await load();
    } catch (err: any) {
      setError(err.message || `Train failed for ${symbol}`);
    } finally {
      setTraining(null);
    }
  };

  const requestRetrain = async (symbol: string, algorithm?: string) => {
    let live = false;
    let posCount = openPositionCount;
    try {
      const [mode, positions] = await Promise.all([
        fetchTradingMode(),
        fetchPositions().catch(() => []),
      ]);
      live = mode?.mode === 'live';
      setIsLive(live);
      const list = Array.isArray(positions)
        ? positions
        : Array.isArray((positions as any)?.positions)
          ? (positions as any).positions
          : [];
      posCount = list.length;
      setOpenPositionCount(posCount);
    } catch {
      live = isLive;
    }

    if (live) {
      setError(
        'Retrain blocked in live mode. Switch to paper first — retrain replaces the active model used for BUY/SELL.',
      );
      return;
    }

    setConfirmKind('retrain');
    setConfirmSymbol(symbol);
    setConfirmAlgo(algorithm);
  };

  const requestDelete = (symbol: string) => {
    setConfirmKind('delete');
    setConfirmSymbol(symbol);
    setConfirmAlgo(undefined);
  };

  const handleConfirm = async () => {
    if (!confirmSymbol || !confirmKind) return;
    const symbol = confirmSymbol;
    const kind = confirmKind;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'delete') {
        try {
          await deleteMlModel(symbol);
        } catch (err) {
          if (!isAlreadyAbsentError(err)) {
            throw err;
          }
        }
        setPreviousAccuracy((prev) => {
          const next = { ...prev };
          delete next[symbol];
          return next;
        });
        await load();
      } else {
        await runTrain(symbol, confirmAlgo);
      }
      setConfirmKind(null);
      setConfirmSymbol(null);
    } catch (err: any) {
      setError(
        err.message ||
          (kind === 'delete'
            ? `Delete failed for ${symbol}`
            : `Retrain failed for ${symbol}`),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleTrainFromWatchlist = async () => {
    if (!trainSymbol) return;
    await refreshGuards();
    try {
      const mode = await fetchTradingMode();
      if (mode?.mode === 'live') {
        setIsLive(true);
        setError(
          'Train blocked in live mode. Switch to paper first — training installs a new active model.',
        );
        return;
      }
    } catch {
      /* allow attempt */
    }
    await runTrain(trainSymbol);
  };

  const handleHoldoutEval = async (symbol: string) => {
    setEvalLoading(symbol);
    setError(null);
    try {
      const data = await fetchMlEval(symbol);
      setEvalBySymbol((prev) => ({ ...prev, [symbol]: data }));
    } catch (err: any) {
      setError(err.message || `Holdout eval failed for ${symbol}`);
    } finally {
      setEvalLoading(null);
    }
  };

  const handleLabelPreview = async (symbol: string) => {
    setPreviewLoading(symbol);
    setError(null);
    try {
      const data = await fetchMlLabelPreview(symbol);
      setPreviewBySymbol((prev) => ({ ...prev, [symbol]: data }));
    } catch (err: any) {
      setError(err.message || `Label preview failed for ${symbol}`);
    } finally {
      setPreviewLoading(null);
    }
  };

  const formatPctSmall = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(Number(v))) return 'n/a';
    return `${(Number(v) * 100).toFixed(1)}%`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return {
          bg: 'bg-emerald-500/10',
          text: 'text-emerald-400',
          icon: CheckCircle,
          label: 'Ready',
        };
      case 'training':
        return {
          bg: 'bg-sky-500/10',
          text: 'text-sky-400',
          icon: RefreshCw,
          label: 'Training',
        };
      case 'error':
        return {
          bg: 'bg-red-500/10',
          text: 'text-red-400',
          icon: XCircle,
          label: 'Error',
        };
      default:
        return {
          bg: 'bg-slate-500/10',
          text: 'text-slate-400',
          icon: XCircle,
          label: status || 'Unknown',
        };
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; items: ModelRow[] }>();
    for (const model of models) {
      const id = model.algorithm || 'unknown';
      const label = model.algorithm_name || model.algorithm || 'Unknown';
      if (!map.has(id)) map.set(id, { label, items: [] });
      map.get(id)!.items.push(model);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [models]);

  const readyCount = models.filter((m) => m.status === 'ready').length;

  const retrainDescription = (() => {
    const sym = confirmSymbol || 'SYMBOL';
    const posWarn =
      openPositionCount > 0
        ? ` You have ${openPositionCount} open position(s) — next BUY/SELL signals may change while flat is safer.`
        : '';
    return `Retrain ${sym}? This replaces the active model used for signals. Accuracy & signals may change.${posWarn}`;
  })();

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-500/10 flex items-center justify-center">
            <Brain className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">ML Model Management</h2>
            <p className="text-[10px] text-slate-500">
              {readyCount} ready · grouped by algorithm
              {isLive ? ' · retrain blocked (live)' : ''}
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            load();
            refreshGuards();
          }}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      <div className="mb-4 p-3 rounded-lg bg-slate-800/30 border border-slate-700/30 text-[10px] text-slate-500 leading-relaxed space-y-2">
        <p>
          <span className="text-slate-400">Label:</span> TP hit before SL — uses Risk SL/TP % and
          label horizon (default 96×15m). Timeouts excluded from training rows.
        </p>
        <p>
          <span className="text-slate-400">Default train:</span> Ensemble (XGBoost + LightGBM +
          LogReg fused). Single-algo models still supported via API.
        </p>
        <p>
          <span className="text-slate-400">Thresholds:</span> ML engine BUY band (~0.55–0.65 by vol);
          orchestrator also requires min confidence from Risk settings.
        </p>
        {mlTradeStats && (
          <p className="text-slate-400 border-t border-slate-700/40 pt-2 mt-2">
            <span className="text-slate-300">Paper/live ML trades:</span>{' '}
            {mlTradeStats.totalTrades} closed · win{' '}
            {mlTradeStats.winRate != null
              ? `${(mlTradeStats.winRate * 100).toFixed(0)}%`
              : 'n/a'}{' '}
            · PnL {mlTradeStats.totalPnl >= 0 ? '+' : ''}
            {mlTradeStats.totalPnl.toFixed(2)} USDT
            {mlTradeStats.avgConfidence != null &&
              ` · avg conf ${(mlTradeStats.avgConfidence * 100).toFixed(0)}%`}
          </p>
        )}
      </div>

      {/* Train from watchlist */}
      {trainableSymbols.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 p-3 rounded-lg bg-slate-800/40 border border-slate-700/40">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">
            Train from watchlist
          </span>
          <select
            value={trainSymbol}
            onChange={(e) => setTrainSymbol(e.target.value)}
            disabled={!!training || isLive}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1.5 font-mono focus:outline-none focus:border-sky-500 disabled:opacity-50"
          >
            {trainableSymbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => handleLabelPreview(trainSymbol)}
            disabled={!trainSymbol || !!training || !!previewLoading || isLive}
            className="px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-[10px] font-medium rounded-lg transition-colors"
          >
            {previewLoading === trainSymbol ? 'Preview...' : 'Preview label'}
          </button>
          <button
            type="button"
            onClick={handleTrainFromWatchlist}
            disabled={!trainSymbol || !!training || isLive}
            className="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg transition-colors"
            title={
              isLive
                ? 'Switch to paper mode to train'
                : 'Train a new model for this watchlist symbol'
            }
          >
            {training === trainSymbol ? 'Training...' : 'Train'}
          </button>
          {trainSymbol && previewBySymbol[trainSymbol] && (
            <p className="text-[10px] text-slate-500 w-full mt-2 leading-relaxed">
              Preview {trainSymbol}:{' '}
              <span className="text-slate-300 font-mono">
                {previewBySymbol[trainSymbol].n_positive ?? 0} pos /{' '}
                {previewBySymbol[trainSymbol].train_rows ?? 0} train rows
              </span>
              {previewBySymbol[trainSymbol].label_config?.max_horizon_candles != null && (
                <>
                  {' '}
                  · horizon{' '}
                  {previewBySymbol[trainSymbol].label_config?.max_horizon_candles}c
                </>
              )}
              {previewBySymbol[trainSymbol].trainable
                ? ' · trainable'
                : previewBySymbol[trainSymbol].hint
                  ? ` · ${previewBySymbol[trainSymbol].hint}`
                  : ' · not trainable'}
            </p>
          )}
        </div>
      )}

      {!loading && models.length === 0 && !error && (
        <div className="py-8 text-center space-y-2">
          <p className="text-xs text-slate-400">
            No models — train a watchlist symbol
          </p>
          {trainableSymbols.length === 0 && (
            <p className="text-[10px] text-slate-600">
              Add a symbol on the dashboard watchlist first, then train it here.
            </p>
          )}
        </div>
      )}

      <div className="space-y-5">
        {grouped.map(([algoId, group]) => (
          <div key={algoId}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
                {group.label}
              </span>
              <span className="text-[10px] text-slate-600 font-mono">{algoId}</span>
              <span className="text-[10px] text-slate-600">({group.items.length})</span>
            </div>
            <div className="space-y-2.5">
              {group.items.map((model) => {
                const badge = getStatusBadge(model.status);
                const Icon = badge.icon;
                const isTraining =
                  training === model.symbol || model.status === 'training';
                const bufferSize = model.buffer_size ?? model.bufferSize ?? 0;
                const trainedAtMs = model.trained_at
                  ? Number(model.trained_at)
                  : model.buffer_start_time
                    ? Number(model.buffer_start_time)
                    : model.lastTraining
                      ? Number(model.lastTraining) * 1000
                      : null;
                const prev = previousAccuracy[model.symbol];
                const canCompare =
                  prev != null &&
                  Number.isFinite(Number(prev)) &&
                  model.accuracy != null &&
                  Number.isFinite(Number(model.accuracy)) &&
                  model.status === 'ready';

                const evalData = evalBySymbol[model.symbol];

                return (
                  <div
                    key={model.symbol}
                    className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">
                          {model.symbol.replace('USDT', '')}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.bg} ${badge.text}`}
                        >
                          <Icon
                            className={`w-3 h-3 ${model.status === 'training' ? 'animate-spin' : ''}`}
                          />
                          {badge.label}
                        </span>
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-700/50 text-slate-300">
                          {model.algorithm_name || model.algorithm || '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleHoldoutEval(model.symbol)}
                          disabled={isTraining || evalLoading === model.symbol}
                          title="Holdout backtest vs EMA baseline (not live PnL)"
                          className="px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 text-[10px] font-medium rounded-lg transition-colors"
                        >
                          {evalLoading === model.symbol ? 'Eval...' : 'Eval'}
                        </button>
                        <button
                          type="button"
                          onClick={() => requestRetrain(model.symbol)}
                          disabled={isTraining || isLive || busy}
                          title={
                            isLive
                              ? 'Retrain blocked in live mode'
                              : 'Retrain replaces the active model'
                          }
                          className="px-2.5 py-1 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg transition-colors"
                        >
                          {isTraining ? 'Training...' : 'Retrain'}
                        </button>
                        <button
                          type="button"
                          onClick={() => requestDelete(model.symbol)}
                          disabled={isTraining || busy}
                          title={`Delete model files for ${model.symbol}`}
                          className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px] mb-2">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <BarChart3 className="w-3 h-3 text-slate-500" />
                          <span className="text-slate-500">Val acc:</span>
                          <span className="text-slate-300 font-mono">
                            {formatAccuracy(model.accuracy)}
                          </span>
                          {canCompare && (
                            <span className="text-slate-500 font-mono">
                              (was {formatAccuracy(prev)})
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Prec BUY:</span>
                        <span className="text-slate-300 font-mono">
                          {formatAccuracy(model.precision_buy)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Recall BUY:</span>
                        <span className="text-slate-300 font-mono">
                          {formatAccuracy(model.recall_buy)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span className="text-slate-500">Trained:</span>
                        <span className="text-slate-300 font-mono">
                          {trainedAtMs ? timeAgo(trainedAtMs / 1000) : '—'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-600">
                      <span>Validation metrics — not live PnL</span>
                      <span>Buffer: {bufferSize}/100</span>
                      {model.label_config?.label_mode && (
                        <span className="font-mono">{model.label_config.label_mode}</span>
                      )}
                      {model.label_config?.max_horizon_candles != null && (
                        <span className="font-mono">
                          horizon {model.label_config.max_horizon_candles}c
                        </span>
                      )}
                    </div>
                    {model.status === 'error' && model.last_training_error && (
                      <p className="mt-2 text-[10px] text-red-400/90 leading-relaxed">
                        {model.last_training_error}
                      </p>
                    )}
                    {model.sub_models && Object.keys(model.sub_models).length > 0 && (
                      <div className="mt-2 text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-1">
                        {Object.entries(model.sub_models).map(([id, m]) => (
                          <span key={id} className="font-mono">
                            {id}: prec {formatAccuracy(m.precision_buy)} acc{' '}
                            {formatAccuracy(m.accuracy)}
                          </span>
                        ))}
                      </div>
                    )}
                    {evalData && (
                      <div className="mt-2 pt-2 border-t border-slate-700/40 text-[10px] grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-slate-500 block mb-0.5">ML holdout (sim SL/TP)</span>
                          <span className="text-slate-300 font-mono">
                            {evalData.backtest_ml?.n_trades ?? 0} trades · win{' '}
                            {formatPctSmall(evalData.backtest_ml?.win_rate ?? null)} · avg{' '}
                            {evalData.backtest_ml?.avg_return_pct != null
                              ? `${(evalData.backtest_ml.avg_return_pct * 100).toFixed(2)}%`
                              : 'n/a'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block mb-0.5">EMA baseline</span>
                          <span className="text-slate-300 font-mono">
                            {evalData.backtest_baseline_ema?.n_trades ?? 0} trades · win{' '}
                            {formatPctSmall(evalData.backtest_baseline_ema?.win_rate ?? null)} · avg{' '}
                            {evalData.backtest_baseline_ema?.avg_return_pct != null
                              ? `${(evalData.backtest_baseline_ema.avg_return_pct * 100).toFixed(2)}%`
                              : 'n/a'}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmKind === 'delete' && !!confirmSymbol}
        title={`Delete model ${confirmSymbol || ''}?`}
        description={`Removes ${confirmSymbol} artifact files from disk and memory. The model will not reappear after restart. Watchlist entry is kept.`}
        confirmLabel="Delete"
        variant="danger"
        loading={busy}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (!busy) {
            setConfirmKind(null);
            setConfirmSymbol(null);
          }
        }}
      />

      <ConfirmDialog
        open={confirmKind === 'retrain' && !!confirmSymbol}
        title={`Retrain ${confirmSymbol || ''}?`}
        description={retrainDescription}
        confirmLabel="Retrain"
        variant="default"
        loading={busy}
        onConfirm={handleConfirm}
        onCancel={() => {
          if (!busy) {
            setConfirmKind(null);
            setConfirmSymbol(null);
          }
        }}
      />
    </div>
  );
}
