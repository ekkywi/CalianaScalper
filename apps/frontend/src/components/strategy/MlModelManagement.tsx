// apps/frontend/src/components/strategy/MlModelManagement.tsx
// Panel model ML via Nest proxy → FastAPI

'use client';

import { useEffect, useState } from 'react';
import { Brain, RefreshCw, BarChart3, Clock, CheckCircle, XCircle } from 'lucide-react';
import { timeAgo } from '@/lib/utils';
import { fetchMlModels, retrainModel } from '@/services/api-extended';

type ModelRow = {
  symbol: string;
  status: string;
  buffer_size?: number;
  bufferSize?: number;
  accuracy?: number;
  lastTraining?: number;
  buffer_start_time?: number | null;
};

export default function MlModelManagement() {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [training, setTraining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setError(null);
      const data = await fetchMlModels();
      setModels(Array.isArray(data.models) ? data.models : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load ML models');
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  const handleRetrain = async (symbol: string) => {
    setTraining(symbol);
    setError(null);
    try {
      await retrainModel(symbol);
      await load();
    } catch (err: any) {
      setError(err.message || `Retrain failed for ${symbol}`);
    } finally {
      setTraining(null);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: CheckCircle, label: 'Ready' };
      case 'training':
        return { bg: 'bg-blue-500/10', text: 'text-blue-400', icon: RefreshCw, label: 'Training' };
      case 'error':
        return { bg: 'bg-red-500/10', text: 'text-red-400', icon: XCircle, label: 'Error' };
      default:
        return { bg: 'bg-slate-500/10', text: 'text-slate-400', icon: XCircle, label: status || 'Unknown' };
    }
  };

  const readyCount = models.filter((m) => m.status === 'ready').length;

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Brain className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">ML Model Management</h2>
            <p className="text-[10px] text-slate-500">{readyCount} models ready</p>
          </div>
        </div>
        <button
          onClick={load}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      {!loading && models.length === 0 && !error && (
        <p className="text-xs text-slate-500 py-6 text-center">No models loaded in ML engine</p>
      )}

      <div className="space-y-2.5">
        {models.map((model) => {
          const badge = getStatusBadge(model.status);
          const Icon = badge.icon;
          const isTraining = training === model.symbol || model.status === 'training';
          const bufferSize = model.buffer_size ?? model.bufferSize ?? 0;
          const trainedAt = model.buffer_start_time
            ? Number(model.buffer_start_time) / 1000
            : model.lastTraining;

          return (
            <div key={model.symbol} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {model.symbol.replace('USDT', '')}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${badge.bg} ${badge.text}`}
                  >
                    <Icon className={`w-3 h-3 ${model.status === 'training' ? 'animate-spin' : ''}`} />
                    {badge.label}
                  </span>
                </div>
                <button
                  onClick={() => handleRetrain(model.symbol)}
                  disabled={isTraining}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[10px] font-medium rounded-lg transition-colors"
                >
                  {isTraining ? 'Training...' : 'Retrain'}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <BarChart3 className="w-3 h-3 text-slate-500" />
                  <span className="text-slate-500">Accuracy:</span>
                  <span className="text-slate-300 font-mono">
                    {model.accuracy && model.accuracy > 0
                      ? `${(model.accuracy * 100).toFixed(1)}%`
                      : 'n/a'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span className="text-slate-500">Buffer start:</span>
                  <span className="text-slate-300 font-mono">
                    {trainedAt ? timeAgo(trainedAt) : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">Buffer:</span>
                  <span className="text-slate-300 font-mono">{bufferSize}/100</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
