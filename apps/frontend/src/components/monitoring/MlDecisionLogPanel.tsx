'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ListFilter, RefreshCw } from 'lucide-react';
import {
  fetchMlPredictionEvents,
  type MlDecisionEvent,
} from '@/services/api-extended';
import { formatDate } from '@/lib/utils';

const BLOCKED_OPTIONS = [
  { value: '', label: 'All outcomes' },
  { value: 'any', label: 'Any block' },
  { value: 'none', label: 'Not blocked' },
  { value: 'confidence', label: 'confidence' },
  { value: 'regime', label: 'regime' },
  { value: 'shadow_mode', label: 'shadow_mode' },
  { value: 'drift', label: 'drift (pair)' },
  { value: 'holding', label: 'holding' },
  { value: 'trading_halted', label: 'trading_halted' },
  { value: 'max_positions', label: 'max_positions' },
  { value: 'max_trades', label: 'max_trades' },
  { value: 'daily_loss', label: 'daily_loss' },
  { value: 'drawdown', label: 'drawdown' },
  { value: 'insufficient_balance', label: 'insufficient_balance' },
  { value: 'sizing', label: 'sizing' },
  { value: 'exchange', label: 'exchange' },
  { value: 'ledger', label: 'ledger' },
  { value: 'risk', label: 'risk' },
];

function msToSec(ts: number): number {
  return ts > 1e12 ? ts / 1000 : ts;
}

function signalClass(signal: string): string {
  if (signal === 'BUY') return 'bg-emerald-500/10 text-emerald-400';
  if (signal === 'SELL') return 'bg-red-500/10 text-red-400';
  return 'bg-slate-500/10 text-slate-400';
}

function blockedClass(blockedBy: string | null): string {
  if (!blockedBy) return 'bg-emerald-500/10 text-emerald-400';
  if (blockedBy === 'shadow_mode') return 'bg-amber-500/10 text-amber-400';
  return 'bg-red-500/10 text-red-400';
}

export default function MlDecisionLogPanel() {
  const [events, setEvents] = useState<MlDecisionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [blockedBy, setBlockedBy] = useState('');
  const [executed, setExecuted] = useState<'' | 'true' | 'false'>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMlPredictionEvents({
        symbol: symbol.trim() || undefined,
        blockedBy: blockedBy || undefined,
        executed: executed || undefined,
        limit: 80,
      });
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load decision log');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [symbol, blockedBy, executed]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
            <ListFilter className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Decision Log</h2>
            <p className="text-[10px] text-slate-500">
              Candle-close decisions from ml_prediction_events (~30d retention)
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load();
          }}
          placeholder="Symbol e.g. BTCUSDT"
          className="bg-slate-800 border border-slate-700 text-white px-2.5 py-1.5 rounded-lg text-xs w-36 focus:outline-none focus:border-sky-500 font-mono"
        />
        <select
          value={blockedBy}
          onChange={(e) => setBlockedBy(e.target.value)}
          className="bg-slate-800 border border-slate-700 text-white px-2.5 py-1.5 rounded-lg text-xs focus:outline-none focus:border-sky-500"
        >
          {BLOCKED_OPTIONS.map((o) => (
            <option key={o.value || 'all'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={executed}
          onChange={(e) => setExecuted(e.target.value as '' | 'true' | 'false')}
          className="bg-slate-800 border border-slate-700 text-white px-2.5 py-1.5 rounded-lg text-xs focus:outline-none focus:border-sky-500"
        >
          <option value="">Executed: all</option>
          <option value="true">Executed only</option>
          <option value="false">Not executed</option>
        </select>
        <button
          type="button"
          onClick={() => load()}
          className="px-2.5 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors"
        >
          Apply
        </button>
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      {!loading && events.length === 0 && !error && (
        <p className="text-xs text-slate-500 py-8 text-center">
          No events yet — wait for a closed 15m candle on an active symbol.
        </p>
      )}

      {events.length > 0 && (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800/50">
                <th className="text-left py-2 pr-3 text-slate-500 font-medium text-[10px] uppercase tracking-wider">
                  Candle
                </th>
                <th className="text-left py-2 px-2 text-slate-500 font-medium text-[10px] uppercase tracking-wider">
                  Symbol
                </th>
                <th className="text-center py-2 px-2 text-slate-500 font-medium text-[10px] uppercase tracking-wider">
                  Signal
                </th>
                <th className="text-right py-2 px-2 text-slate-500 font-medium text-[10px] uppercase tracking-wider">
                  Conf
                </th>
                <th className="text-center py-2 px-2 text-slate-500 font-medium text-[10px] uppercase tracking-wider">
                  Blocked
                </th>
                <th className="text-center py-2 px-2 text-slate-500 font-medium text-[10px] uppercase tracking-wider">
                  Exec
                </th>
                <th className="text-left py-2 pl-2 text-slate-500 font-medium text-[10px] uppercase tracking-wider">
                  Regime / note
                </th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const confPct = (Number(ev.confidence) * 100).toFixed(0);
                const minPct =
                  ev.effectiveMinConfidence != null
                    ? (Number(ev.effectiveMinConfidence) * 100).toFixed(0)
                    : null;
                return (
                  <tr
                    key={ev.id}
                    className="border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors"
                  >
                    <td className="py-2.5 pr-3 text-slate-400 font-mono text-[10px] whitespace-nowrap">
                      {formatDate(msToSec(ev.candleCloseTime))}
                    </td>
                    <td className="py-2.5 px-2">
                      <Link
                        href={`/dashboard/${encodeURIComponent(ev.symbol)}`}
                        className="text-white font-medium hover:text-sky-400"
                      >
                        {ev.symbol.replace('USDT', '')}
                        <span className="text-slate-500">/USDT</span>
                      </Link>
                      <span className="block text-[9px] text-slate-600 font-mono">
                        {ev.tradingMode}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${signalClass(ev.signal)}`}
                      >
                        {ev.signal}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-slate-300 tabular-nums">
                      {confPct}%
                      {minPct != null && (
                        <span className="block text-[9px] text-slate-600">
                          min {minPct}%
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${blockedClass(ev.blockedBy)}`}
                      >
                        {ev.blockedBy ?? '—'}
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      {ev.executed ? (
                        <span className="text-emerald-400 text-[10px] font-medium">yes</span>
                      ) : ev.wouldExecute ? (
                        <span className="text-amber-400 text-[10px]">would</span>
                      ) : (
                        <span className="text-slate-600 text-[10px]">no</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-2 text-[10px] text-slate-500 max-w-[220px]">
                      {ev.regime && (
                        <span className="text-slate-400 font-mono">{ev.regime}</span>
                      )}
                      {ev.regimeReason && (
                        <span className="block truncate" title={ev.regimeReason}>
                          {ev.regimeReason}
                        </span>
                      )}
                      {!ev.regime && !ev.regimeReason && (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {events.length > 0 && (
        <p className="text-center text-[10px] text-slate-500 mt-3">
          Showing {events.length} event{events.length === 1 ? '' : 's'}
        </p>
      )}
    </div>
  );
}
