// apps/frontend/src/components/monitoring/MlPredictionDisplay.tsx
// Prediksi ML terakhir dari orchestrator cache

'use client';

import { useEffect, useState } from 'react';
import { Brain, TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';
import { fetchMlPredictions } from '@/services/api-extended';

type Prediction = {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  timestamp: number;
  raw?: {
    regime?: string;
    regime_reason?: string;
    regime_confidence_bump?: number;
    algorithm?: string;
  };
};

export default function MlPredictionDisplay() {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await fetchMlPredictions();
      setPredictions(Array.isArray(data.predictions) ? data.predictions : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load predictions');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'BUY':
        return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: TrendingUp, label: 'BUY' };
      case 'SELL':
        return { bg: 'bg-red-500/10', text: 'text-red-400', icon: TrendingDown, label: 'SELL' };
      default:
        return { bg: 'bg-slate-500/10', text: 'text-slate-400', icon: Minus, label: 'HOLD' };
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Brain className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">ML Predictions</h2>
            <p className="text-[10px] text-slate-500">Last signals from orchestrator</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      {!refreshing && predictions.length === 0 && !error && (
        <p className="text-xs text-slate-500 py-6 text-center">
          No predictions yet — wait for a closed 15m candle
        </p>
      )}

      <div className="space-y-2.5">
        {predictions.map((pred) => {
          const s = getSignalColor(pred.signal);
          const Icon = s.icon;
          const confidencePercent = (pred.confidence * 100).toFixed(0);
          const ageMin = Math.max(
            0,
            Math.floor((Date.now() - Number(pred.timestamp)) / 60000),
          );

          return (
            <div key={pred.symbol} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">
                  {pred.symbol.replace('USDT', '')}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}
                >
                  <Icon className="w-3 h-3" />
                  {s.label}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-500">Confidence</span>
                  <div className="mt-1">
                    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          pred.confidence >= 0.7
                            ? 'bg-emerald-500'
                            : pred.confidence >= 0.5
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                        }`}
                        style={{ width: `${confidencePercent}%` }}
                      />
                    </div>
                    <p className="text-slate-300 font-mono mt-0.5">{confidencePercent}%</p>
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Updated</span>
                  <p className="text-slate-300 font-mono mt-1">{ageMin}m ago</p>
                </div>
              </div>
              {pred.raw?.regime && (
                <p className="text-[10px] text-slate-500 mt-2 font-mono">
                  regime: {pred.raw.regime}
                  {pred.raw.regime_confidence_bump
                    ? ` (+${(Number(pred.raw.regime_confidence_bump) * 100).toFixed(0)}% min conf)`
                    : ''}
                  {pred.raw.regime_reason ? ` — ${pred.raw.regime_reason}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
