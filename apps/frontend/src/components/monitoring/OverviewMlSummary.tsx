'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Brain, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { fetchMlPredictions } from '@/services/api-extended';

type Prediction = {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  timestamp: number;
};

const MAX_ROWS = 4;

/** Compact ML signal list for dashboard overview */
export default function OverviewMlSummary() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchMlPredictions();
        if (cancelled) return;
        const list = Array.isArray(data?.predictions) ? data.predictions : [];
        setPredictions(list.slice(0, MAX_ROWS));
        setError(null);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load predictions');
        }
      }
    };
    load();
    const interval = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-500/10 flex items-center justify-center">
            <Brain className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">ML Signals</h2>
            <p className="text-[10px] text-slate-500">Latest orchestrator predictions</p>
          </div>
        </div>
        <Link
          href="/dashboard/ml-predictions"
          className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300"
        >
          Details
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {!error && predictions.length === 0 && (
        <p className="text-xs text-slate-500 py-4 text-center">
          No predictions yet — wait for a closed 15m candle (persisted)
        </p>
      )}

      <div className="space-y-1.5">
        {predictions.map((pred) => {
          const conf = Number.isFinite(pred.confidence) ? pred.confidence : 0;
          const isBuy = pred.signal === 'BUY';
          const isSell = pred.signal === 'SELL';
          const Icon = isBuy ? TrendingUp : isSell ? TrendingDown : Minus;
          const color = isBuy
            ? 'text-emerald-400'
            : isSell
              ? 'text-red-400'
              : 'text-slate-400';

          return (
            <Link
              key={pred.symbol}
              href={`/dashboard/${encodeURIComponent(pred.symbol)}`}
              className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800/50 transition-colors"
            >
              <span className="text-xs font-medium text-white">
                {String(pred.symbol).replace('USDT', '')}
              </span>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${color}`}>
                  <Icon className="w-3 h-3" />
                  {pred.signal}
                </span>
                <span className="text-[10px] font-mono text-slate-400 tabular-nums w-8 text-right">
                  {(conf * 100).toFixed(0)}%
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
