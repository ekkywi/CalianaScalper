// apps/frontend/src/components/monitoring/PerformanceDashboard.tsx
// Metrik performa dari trade history (tanpa Sharpe/Sortino palsu)

'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, DollarSign, BarChart3, Activity } from 'lucide-react';
import { formatUSD, formatPercent } from '@/lib/utils';
import { fetchPerformanceStats } from '@/services/api-extended';

type PerfStats = {
  totalPnl: number;
  todayPnl: number;
  weekPnl: number;
  winRate: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  avgTradeDurationMs: number;
  maxDrawdownPercent: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  calmarRatio: number | null;
};

function formatDuration(ms: number) {
  if (!ms || ms <= 0) return '—';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  }
  return `${mins}m ${secs}s`;
}

export default function PerformanceDashboard() {
  const [period, setPeriod] = useState<'1d' | '1w' | '1m' | 'all'>('1m');
  const [perf, setPerf] = useState<PerfStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchPerformanceStats(period);
        if (!cancelled) setPerf(data);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load performance');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Performance Dashboard</h2>
            <p className="text-[10px] text-slate-500">Derived from closed trades</p>
          </div>
        </div>
        <div className="flex gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800">
          {(['1d', '1w', '1m', 'all'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                period === p ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}
      {loading && !perf && <p className="text-xs text-slate-500">Loading…</p>}

      {perf && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={<DollarSign className="w-4 h-4" />}
              label="Total P&L"
              value={formatUSD(perf.totalPnl)}
              color={perf.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <StatCard
              icon={<TrendingUp className="w-4 h-4" />}
              label="Today"
              value={formatUSD(perf.todayPnl)}
              color={perf.todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <StatCard
              icon={<Activity className="w-4 h-4" />}
              label="This Week"
              value={formatUSD(perf.weekPnl)}
              color={perf.weekPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
            />
            <StatCard
              icon={<BarChart3 className="w-4 h-4" />}
              label="Win Rate"
              value={`${perf.winRate}%`}
              color="text-blue-400"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            <MetricBox label="Total Trades" value={String(perf.totalTrades)} />
            <MetricBox label="Winning" value={String(perf.winningTrades)} color="text-emerald-400" />
            <MetricBox label="Losing" value={String(perf.losingTrades)} color="text-red-400" />
            <MetricBox
              label="Profit Factor"
              value={perf.profitFactor == null ? '—' : String(perf.profitFactor)}
            />
            <MetricBox
              label="Max DD (trade equity)"
              value={formatPercent(-Math.abs(perf.maxDrawdownPercent))}
              color="text-red-400"
            />
            <MetricBox label="Avg Trade Duration" value={formatDuration(perf.avgTradeDurationMs)} />
            <MetricBox label="Avg Win" value={formatUSD(perf.avgWin)} color="text-emerald-400" />
            <MetricBox label="Avg Loss" value={formatUSD(perf.avgLoss)} color="text-red-400" />
            <MetricBox label="Sharpe Ratio" value="n/a" />
            <MetricBox label="Sortino Ratio" value="n/a" />
            <MetricBox label="Calmar Ratio" value="n/a" />
            <MetricBox
              label="Avg Trade"
              value={formatUSD(
                perf.totalTrades > 0 ? perf.totalPnl / perf.totalTrades : 0,
              )}
            />
          </div>

          <div className="bg-slate-900/50 border border-slate-800/50 rounded-lg p-4">
            <p className="text-xs text-slate-400 font-medium mb-3">Win/Loss Distribution</p>
            <div className="flex h-6 rounded-full overflow-hidden">
              <div
                className="bg-emerald-500 transition-all"
                style={{ width: `${perf.winRate || 0}%` }}
              />
              <div
                className="bg-red-500/70 transition-all"
                style={{ width: `${100 - (perf.winRate || 0)}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-slate-500 mt-1.5">
              <span className="text-emerald-400">{perf.winRate}% Wins</span>
              <span className="text-red-400">{(100 - perf.winRate).toFixed(1)}% Losses</span>
            </div>
            <p className="text-[10px] text-slate-600 mt-2">
              Sharpe / Sortino / Calmar require a returns-series engine — deferred (Phase 4).
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-slate-500">{icon}</span>
        <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      </div>
      <p className={`text-lg font-bold font-mono ${color}`}>{value}</p>
    </div>
  );
}

function MetricBox({
  label,
  value,
  color = 'text-white',
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-2.5">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-xs font-semibold font-mono ${color}`}>{value}</p>
    </div>
  );
}
