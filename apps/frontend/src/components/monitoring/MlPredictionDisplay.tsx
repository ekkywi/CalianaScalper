// apps/frontend/src/components/monitoring/MlPredictionDisplay.tsx
// Widget prediksi ML untuk symbol aktif

'use client';

import { useState } from 'react';
import { Brain, TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';

const MOCK_PREDICTIONS = [
  { symbol: 'BTCUSDT', signal: 'BUY' as const, confidence: 0.78, timestamp: Date.now() / 1000, accuracy: 67.5 },
  { symbol: 'SOLUSDT', signal: 'HOLD' as const, confidence: 0.55, timestamp: Date.now() / 1000 - 300, accuracy: 71.2 },
  { symbol: 'ETHUSDT', signal: 'SELL' as const, confidence: 0.65, timestamp: Date.now() / 1000 - 600, accuracy: 63.8 },
];

export default function MlPredictionDisplay() {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'BUY': return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: TrendingUp, label: 'BUY' };
      case 'SELL': return { bg: 'bg-red-500/10', text: 'text-red-400', icon: TrendingDown, label: 'SELL' };
      default: return { bg: 'bg-slate-500/10', text: 'text-slate-400', icon: Minus, label: 'HOLD' };
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
            <p className="text-[10px] text-slate-500">AI-powered signal analysis</p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-2.5">
        {MOCK_PREDICTIONS.map((pred) => {
          const s = getSignalColor(pred.signal);
          const Icon = s.icon;
          const confidencePercent = (pred.confidence * 100).toFixed(0);
          const timeAgo = Math.floor((Date.now() / 1000 - pred.timestamp) / 60);

          return (
            <div key={pred.symbol} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">{pred.symbol.replace('USDT', '')}</span>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
                  <Icon className="w-3 h-3" />
                  {s.label}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-500">Confidence</span>
                  <div className="mt-1">
                    <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          pred.confidence >= 0.7 ? 'bg-emerald-500' : pred.confidence >= 0.5 ? 'bg-amber-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${confidencePercent}%` }}
                      />
                    </div>
                    <p className="text-slate-300 font-mono mt-0.5">{confidencePercent}%</p>
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Accuracy</span>
                  <p className="text-slate-300 font-mono mt-1">{pred.accuracy.toFixed(1)}%</p>
                </div>
                <div>
                  <span className="text-slate-500">Updated</span>
                  <p className="text-slate-300 font-mono mt-1">{timeAgo}m ago</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}