'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  Brain,
  CheckCircle,
  ExternalLink,
  Loader2,
  Minus,
  RefreshCw,
  Shield,
  Target,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { formatDate, formatUSD, getChangeColor } from '@/lib/utils';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useState } from 'react';
import type { SymbolOpsState } from './useSymbolOps';

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(2)}%`;
}

function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price === 0) return '—';
  if (price >= 1000) {
    return price.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

function pairBadge(pair: SymbolOpsState['pair']) {
  if (!pair) {
    return {
      label: 'NO PAIR',
      className: 'bg-slate-700/50 text-slate-400',
      hint: 'No active profile/model binding for this symbol',
    };
  }
  if (pair.blockBuy) {
    return {
      label: pair.status === 'mismatch' ? 'MISMATCH' : 'BLOCKED',
      className: 'bg-red-500/15 text-red-400',
      hint: pair.message,
    };
  }
  if (pair.status === 'ok') {
    return {
      label: 'READY',
      className: 'bg-emerald-500/15 text-emerald-400',
      hint: pair.message || 'Profile and model aligned — BUY allowed',
    };
  }
  return {
    label: pair.status.toUpperCase(),
    className: 'bg-amber-500/15 text-amber-400',
    hint: pair.message,
  };
}

type Props = {
  symbol: string;
  ops: SymbolOpsState;
  lastPrice?: number;
};

export default function SymbolOpsPanel({ symbol, ops, lastPrice }: Props) {
  const { pair, position, prediction, trades, loading, error, closing, reload, handleClose } =
    ops;
  const [closeConfirm, setCloseConfirm] = useState(false);
  const badge = pairBadge(pair);

  const livePnl =
    position && Number.isFinite(lastPrice) && (lastPrice ?? 0) > 0
      ? (lastPrice! - position.entryPrice) * position.quantity
      : position?.unrealizedPnL ?? 0;

  const signalMeta = (() => {
    const s = prediction?.signal ?? null;
    if (s === 'BUY') {
      return { label: 'BUY', color: 'text-emerald-400', bg: 'bg-emerald-500/10', Icon: TrendingUp };
    }
    if (s === 'SELL') {
      return { label: 'SELL', color: 'text-red-400', bg: 'bg-red-500/10', Icon: TrendingDown };
    }
    if (s === 'HOLD') {
      return { label: 'HOLD', color: 'text-slate-400', bg: 'bg-slate-500/10', Icon: Minus };
    }
    return null;
  })();

  const wins = trades.filter((t) => t.pnl > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : null;

  return (
    <aside className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white">Symbol Ops</h2>
          <p className="text-[10px] text-slate-500">Strategy · position · ML · trades</p>
        </div>
        <button
          type="button"
          onClick={() => reload()}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Strategy pair */}
      <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-sky-400" />
            <h3 className="text-xs font-semibold text-white">Strategy Pair</h3>
          </div>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.className}`}>
            {badge.label}
          </span>
        </div>

        {loading && !pair ? (
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <p
              className={`text-[10px] leading-relaxed flex items-start gap-1.5 ${
                pair?.blockBuy ? 'text-red-400' : 'text-slate-400'
              }`}
            >
              {pair?.blockBuy ? (
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              ) : (
                <CheckCircle className="w-3 h-3 mt-0.5 shrink-0 text-emerald-400" />
              )}
              {badge.hint}
            </p>

            <div className="grid grid-cols-1 gap-2">
              <div className="rounded-lg bg-slate-950/50 border border-slate-800/60 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                    Profile
                  </span>
                  <Link
                    href="/dashboard/trading-profiles"
                    className="text-[10px] text-sky-400 hover:text-sky-300 inline-flex items-center gap-0.5"
                  >
                    Manage <ExternalLink className="w-2.5 h-2.5" />
                  </Link>
                </div>
                {pair?.profile?.id ? (
                  <>
                    <p className="text-xs text-white font-medium truncate">
                      {pair.profile.name ?? '—'}
                    </p>
                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                      SL {pct(pair.profile.stopLossPercent)} · TP{' '}
                      {pct(pair.profile.takeProfitPercent)} ·{' '}
                      {pair.profile.maxHorizonCandles ?? '—'}c
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-amber-400">No active profile</p>
                )}
              </div>

              <div className="rounded-lg bg-slate-950/50 border border-slate-800/60 p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">
                    Model
                  </span>
                  <Link
                    href="/dashboard/ml-models"
                    className="text-[10px] text-sky-400 hover:text-sky-300 inline-flex items-center gap-0.5"
                  >
                    Manage <ExternalLink className="w-2.5 h-2.5" />
                  </Link>
                </div>
                {pair?.model?.id ? (
                  <>
                    <p className="text-xs text-white font-medium truncate">
                      {pair.model.name ?? '—'}
                    </p>
                    {pair.model.labelConfig && (
                      <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                        SL {pct(pair.model.labelConfig.stop_loss_percent)} · TP{' '}
                        {pct(pair.model.labelConfig.take_profit_percent)} ·{' '}
                        {pair.model.labelConfig.max_horizon_candles}c
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-amber-400">No active model</p>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Position */}
      <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-red-400" />
            <h3 className="text-xs font-semibold text-white">Position</h3>
          </div>
          <span
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
              position ? 'bg-sky-500/15 text-sky-400' : 'bg-slate-700/50 text-slate-500'
            }`}
          >
            {position ? 'LONG' : 'FLAT'}
          </span>
        </div>

        {!position ? (
          <p className="text-[10px] text-slate-500">No open position on this symbol.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div>
                <p className="text-slate-500">Entry</p>
                <p className="text-white font-mono tabular-nums">
                  ${formatPrice(position.entryPrice)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Qty</p>
                <p className="text-white font-mono tabular-nums">
                  {Number(position.quantity).toFixed(6)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Unrealized</p>
                <p className={`font-mono tabular-nums font-medium ${getChangeColor(livePnl)}`}>
                  {formatUSD(livePnl)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Notional</p>
                <p className="text-white font-mono tabular-nums">
                  {formatUSD(position.entryPrice * position.quantity)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Stop Loss</p>
                <p className="text-red-400 font-mono tabular-nums">
                  ${formatPrice(position.stopLoss)}
                </p>
              </div>
              <div>
                <p className="text-slate-500">Take Profit</p>
                <p className="text-emerald-400 font-mono tabular-nums">
                  ${formatPrice(position.takeProfit)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCloseConfirm(true)}
              disabled={closing}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-red-400 hover:text-red-300 font-medium px-2.5 py-2 bg-red-500/10 hover:bg-red-500/15 rounded-lg transition-colors disabled:opacity-40"
            >
              {closing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <X className="w-3.5 h-3.5" />
              )}
              Flatten position
            </button>
          </>
        )}
      </section>

      {/* ML signal */}
      <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain className="w-3.5 h-3.5 text-purple-400" />
            <h3 className="text-xs font-semibold text-white">ML Signal</h3>
          </div>
          <Link
            href="/dashboard/ml-predictions"
            className="text-[10px] text-sky-400 hover:text-sky-300"
          >
            All
          </Link>
        </div>

        {!prediction || !signalMeta ? (
          <p className="text-[10px] text-slate-500">
            No prediction yet — waits for next closed 15m candle.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${signalMeta.bg} ${signalMeta.color}`}
              >
                <signalMeta.Icon className="w-3 h-3" />
                {signalMeta.label}
              </span>
              <span className="text-[10px] text-slate-500">
                {Math.max(0, Math.floor((Date.now() - Number(prediction.timestamp)) / 60000))}m
                ago
              </span>
            </div>
            <div>
              <div className="flex items-center justify-between text-[10px] mb-1">
                <span className="text-slate-500">Confidence</span>
                <span className="text-white tabular-nums">
                  {(prediction.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    prediction.confidence >= 0.7
                      ? 'bg-emerald-500'
                      : prediction.confidence >= 0.5
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.min(100, prediction.confidence * 100)}%` }}
                />
              </div>
            </div>
            {pair?.blockBuy && prediction.signal === 'BUY' && (
              <p className="text-[10px] text-red-400 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                BUY would be blocked by pair guard
              </p>
            )}
            {prediction.raw?.regime && (
              <p className="text-[10px] text-slate-500">
                Regime: <span className="text-slate-300">{prediction.raw.regime}</span>
              </p>
            )}
          </>
        )}
      </section>

      {/* Recent trades */}
      <section className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-white">Recent Trades</h3>
          {winRate != null && (
            <span className="text-[10px] text-slate-500">
              WR {winRate.toFixed(0)}% · {trades.length} shown
            </span>
          )}
        </div>

        {trades.length === 0 ? (
          <p className="text-[10px] text-slate-500">No closed trades for {symbol} yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {trades.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-950/40 border border-slate-800/40 px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 truncate">
                    {formatDate(
                      Number(t.closeTime) > 1e12
                        ? Number(t.closeTime) / 1000
                        : Number(t.closeTime),
                    )}{' '}
                    · {t.closeReason.replace(/_/g, ' ')}
                  </p>
                  <p className="text-[10px] font-mono text-slate-500 tabular-nums">
                    {formatPrice(t.entryPrice)} → {formatPrice(t.exitPrice)}
                  </p>
                </div>
                <span
                  className={`text-xs font-mono tabular-nums shrink-0 ${getChangeColor(t.pnl)}`}
                >
                  {formatUSD(t.pnl)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={closeConfirm}
        title={`Flatten ${symbol}?`}
        description="Market-sell the open position on the exchange, then close the ledger. Confirm only if you intend to exit now."
        confirmLabel="Flatten"
        variant="danger"
        loading={closing}
        onConfirm={() => {
          void (async () => {
            await handleClose();
            setCloseConfirm(false);
          })();
        }}
        onCancel={() => setCloseConfirm(false)}
      />
    </aside>
  );
}
