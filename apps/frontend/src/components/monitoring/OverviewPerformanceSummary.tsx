'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BarChart3 } from 'lucide-react';
import { formatUSD, getChangeColor } from '@/lib/utils';
import { fetchPerformanceStats } from '@/services/api-extended';

type PerfStats = {
  totalPnl: number;
  todayPnl: number;
  winRate: number;
  totalTrades: number;
};

/** Compact today-focused performance card for dashboard overview */
export default function OverviewPerformanceSummary() {
  const [perf, setPerf] = useState<PerfStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchPerformanceStats('1d');
        if (!cancelled && data) {
          setPerf({
            totalPnl: Number(data.totalPnl) || 0,
            todayPnl: Number(data.todayPnl) || 0,
            winRate: Number(data.winRate) || 0,
            totalTrades: Number(data.totalTrades) || 0,
          });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load performance');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-500/10 flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Today</h2>
            <p className="text-[10px] text-slate-500">Closed-trade performance</p>
          </div>
        </div>
        <Link
          href="/dashboard/performance"
          className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300"
        >
          Details
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {!error && !perf && <p className="text-xs text-slate-500 py-4">Loading…</p>}

      {perf && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">P&L</p>
            <p className={`text-sm font-bold font-mono tabular-nums ${getChangeColor(perf.todayPnl)}`}>
              {formatUSD(perf.todayPnl)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Win rate</p>
            <p className="text-sm font-bold font-mono text-white tabular-nums">
              {perf.winRate.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Trades</p>
            <p className="text-sm font-bold font-mono text-white tabular-nums">{perf.totalTrades}</p>
          </div>
        </div>
      )}
    </div>
  );
}
