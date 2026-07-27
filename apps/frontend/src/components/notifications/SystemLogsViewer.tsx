// apps/frontend/src/components/notifications/SystemLogsViewer.tsx
// Log viewer — structured store not implemented (Phase 4)

'use client';

import { useEffect, useState } from 'react';
import { Search, RefreshCw, FileText } from 'lucide-react';
import { fetchLogs } from '@/services/api-extended';

export default function SystemLogsViewer() {
  const [message, setMessage] = useState('');
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLogs({ limit: 50 });
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setMessage(data.message || '');
    } catch (err: any) {
      setError(err.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-500/10 flex items-center justify-center">
            <FileText className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">System Logs</h2>
            <p className="text-[10px] text-slate-500">Structured log store deferred</p>
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
      {message && <p className="text-xs text-slate-400 mb-3">{message}</p>}

      {logs.length === 0 && !error && (
        <div className="py-10 text-center space-y-2">
          <Search className="w-5 h-5 text-slate-600 mx-auto" />
          <p className="text-xs text-slate-500">
            No in-app logs. Use NestJS / ML process stdout until a log store ships.
          </p>
        </div>
      )}
    </div>
  );
}
