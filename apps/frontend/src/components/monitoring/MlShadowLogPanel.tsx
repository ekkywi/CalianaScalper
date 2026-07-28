'use client';

import { useEffect, useState } from 'react';
import { Eye, RefreshCw } from 'lucide-react';
import { fetchMlShadowPredictions } from '@/services/api-extended';

type ShadowRow = {
  symbol: string;
  signal: string;
  confidence: number;
  regime?: string;
  regimeReason?: string;
  wouldExecute: boolean;
  blockedBy?: string | null;
  timestamp: number;
};

export default function MlShadowLogPanel() {
  const [rows, setRows] = useState<ShadowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMlShadowPredictions(30);
      setRows(Array.isArray(data.predictions) ? data.predictions : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load shadow log');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Eye className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Shadow ML Log</h2>
            <p className="text-[10px] text-slate-500">
              Would-be BUY when shadow mode is on (no orders placed)
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
      {!loading && rows.length === 0 && !error && (
        <p className="text-xs text-slate-500 py-4 text-center">
          Empty — enable Shadow mode on Risk page and wait for BUY signals
        </p>
      )}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {rows.map((row, i) => (
          <div
            key={`${row.symbol}-${row.timestamp}-${i}`}
            className="text-[10px] bg-slate-800/40 border border-slate-700/40 rounded-lg px-3 py-2 font-mono"
          >
            <span className="text-slate-300">{row.symbol}</span>
            <span className="text-slate-500"> · </span>
            <span className="text-amber-400">{row.signal}</span>
            <span className="text-slate-500"> · </span>
            <span className="text-slate-400">{(row.confidence * 100).toFixed(0)}%</span>
            {row.regime && (
              <>
                <span className="text-slate-600"> · </span>
                <span className="text-slate-500">{row.regime}</span>
              </>
            )}
            {row.blockedBy && (
              <>
                <span className="text-slate-600"> · </span>
                <span className="text-amber-500/80">{row.blockedBy}</span>
              </>
            )}
            {row.wouldExecute && (
              <>
                <span className="text-slate-600"> · </span>
                <span className="text-emerald-500/80">would execute</span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
