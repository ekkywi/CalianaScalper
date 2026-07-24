// apps/frontend/src/components/notifications/SystemLogsViewer.tsx
// Viewer log real-time dengan level filter

'use client';

import { useState } from 'react';
import { Terminal, Download, Search, Filter } from 'lucide-react';
import { formatTime } from '@/lib/utils';

const LOG_LEVELS = ['ALL', 'DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

const MOCK_LOGS = Array.from({ length: 30 }, (_, i) => ({
  id: `log-${i}`,
  level: ['DEBUG', 'INFO', 'WARN', 'ERROR'][Math.floor(Math.random() * 4)] as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  message: [
    'Candle 15m closed for BTCUSDT. Starting analysis...',
    'ML prediction received: BUY signal with 78.3% confidence',
    'Order ID: 12345 filled successfully. Avg price: 67450.00',
    'Position BTCUSDT closed by TP. PnL: +$117.00',
    'WebSocket reconnecting in 5 seconds...',
    'Risk check passed for SOLUSDT. Opening position...',
    'Daily loss limit approaching: 4.2% of 5% max',
    'Database connection established successfully',
    'ML Engine health check: OK',
    'Rate limit remaining: 1120/1200',
  ][Math.floor(Math.random() * 10)],
  timestamp: Date.now() / 1000 - Math.random() * 3600,
  source: ['system', 'orchestrator', 'execution', 'risk', 'ml'][Math.floor(Math.random() * 5)],
}));

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: 'text-slate-500',
  INFO: 'text-blue-400',
  WARN: 'text-amber-400',
  ERROR: 'text-red-400',
};

export default function SystemLogsViewer() {
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const filtered = MOCK_LOGS
    .filter((l) => levelFilter === 'ALL' || l.level === levelFilter)
    .filter((l) => l.message.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-500/10 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">System Logs</h2>
            <p className="text-[10px] text-slate-500">Real-time event log stream</p>
          </div>
        </div>
        <button className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors">
          <Download className="w-3.5 h-3.5" />
          Download
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-white pl-8 pr-3 py-1.5 rounded-lg text-[10px] focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex gap-1">
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
                levelFilter === level ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      {/* Logs */}
      <div className="bg-black/40 rounded-lg border border-slate-800/50 max-h-96 overflow-y-auto custom-scrollbar font-mono">
        {filtered.map((log) => (
          <div key={log.id} className="flex items-start gap-3 px-3 py-1.5 border-b border-slate-800/30 hover:bg-slate-800/20 text-[10px]">
            <span className="text-slate-600 shrink-0 w-16">{formatTime(log.timestamp)}</span>
            <span className={`shrink-0 w-10 font-medium ${LEVEL_COLORS[log.level]}`}>{log.level}</span>
            <span className="text-slate-600 shrink-0 w-20">{log.source}</span>
            <span className="text-slate-300">{log.message}</span>
          </div>
        ))}
      </div>

      {/* Auto-scroll toggle */}
      <label className="flex items-center gap-2 mt-2 cursor-pointer">
        <input
          type="checkbox"
          checked={autoScroll}
          onChange={(e) => setAutoScroll(e.target.checked)}
          className="w-3 h-3 rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
        />
        <span className="text-[10px] text-slate-500">Auto-scroll to latest</span>
      </label>
    </div>
  );
}