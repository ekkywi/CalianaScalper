// apps/frontend/src/components/strategy/MlModelManagement.tsx
// Panel untuk mengelola model ML

'use client';

import { useState } from 'react';
import { Brain, RefreshCw, BarChart3, Clock, CheckCircle, XCircle } from 'lucide-react';
import { timeAgo } from '@/lib/utils';

const MOCK_MODELS = [
  { symbol: 'BTCUSDT', status: 'ready' as const, accuracy: 0.724, lastTraining: Date.now() / 1000 - 86400 * 2, bufferSize: 100 },
  { symbol: 'SOLUSDT', status: 'ready' as const, accuracy: 0.691, lastTraining: Date.now() / 1000 - 86400 * 3, bufferSize: 100 },
  { symbol: 'ETHUSDT', status: 'training' as const, accuracy: 0, lastTraining: Date.now() / 1000 - 86400 * 7, bufferSize: 85 },
  { symbol: 'ADAUSDT', status: 'error' as const, accuracy: 0, lastTraining: Date.now() / 1000 - 86400 * 14, bufferSize: 45 },
];

export default function MlModelManagement() {
  const [training, setTraining] = useState<string | null>(null);

  const handleRetrain = async (symbol: string) => {
    setTraining(symbol);
    await new Promise((r) => setTimeout(r, 2000));
    setTraining(null);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready': return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: CheckCircle, label: 'Ready' };
      case 'training': return { bg: 'bg-blue-500/10', text: 'text-blue-400', icon: RefreshCw, label: 'Training' };
      case 'error': return { bg: 'bg-red-500/10', text: 'text-red-400', icon: XCircle, label: 'Error' };
      default: return { bg: 'bg-slate-500/10', text: 'text-slate-400', icon: XCircle, label: 'Unknown' };
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
          <Brain className="w-4 h-4 text-purple-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">ML Model Management</h2>
          <p className="text-[10px] text-slate-500">{MOCK_MODELS.filter((m) => m.status === 'ready').length} models active</p>
        </div>
      </div>

      <div className="space-y-2.5">
        {MOCK_MODELS.map((model) => {
          const badge = getStatusBadge(model.status);
          const Icon = badge.icon;
          const isTraining = training === model.symbol;

          return (
            <div key={model.symbol} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{model.symbol.replace('USDT', '')}</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.bg} ${badge.text}`}>
                    <Icon className={`w-3 h-3 ${model.status === 'training' ? 'animate-spin' : ''}`} />
                    {badge.label}
                  </span>
                </div>
                <button
                  onClick={() => handleRetrain(model.symbol)}
                  disabled={isTraining || model.status === 'training'}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg transition-colors"
                >
                  {isTraining ? 'Training...' : 'Retrain'}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <BarChart3 className="w-3 h-3 text-slate-500" />
                  <span className="text-slate-500">Accuracy:</span>
                  <span className="text-slate-300 font-mono">{model.accuracy > 0 ? `${(model.accuracy * 100).toFixed(1)}%` : '--'}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span className="text-slate-500">Trained:</span>
                  <span className="text-slate-300 font-mono">{timeAgo(model.lastTraining)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Buffer:</span>
                  <span className="text-slate-300 font-mono">{model.bufferSize}/100</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}