// apps/frontend/src/components/notifications/NotificationCenter.tsx
// Panel notifikasi terpusat

'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { Bell, CheckCheck, X, AlertTriangle, Info, AlertCircle, ArrowRight } from 'lucide-react';
import { timeAgo } from '@/lib/utils';

const MOCK_ALERTS = [
  { id: '1', type: 'trade' as const, title: 'Position Closed', message: 'BTCUSDT position closed at +$117.00 (TP hit)', severity: 'info' as const, timestamp: Date.now() / 1000 - 120, read: false },
  { id: '2', type: 'signal' as const, title: 'BUY Signal Generated', message: 'SOLUSDT: Strong buy signal with 78% confidence', severity: 'info' as const, timestamp: Date.now() / 1000 - 600, read: false },
  { id: '3', type: 'error' as const, title: 'ML Engine Warning', message: 'Model accuracy dropped below 60% for ADAUSDT', severity: 'warning' as const, timestamp: Date.now() / 1000 - 1800, read: false },
  { id: '4', type: 'drawdown' as const, title: 'Drawdown Alert', message: 'Portfolio drawdown reached 8.3%, approaching limit', severity: 'warning' as const, timestamp: Date.now() / 1000 - 3600, read: true },
  { id: '5', type: 'system' as const, title: 'Trading Resumed', message: 'Trading has been automatically resumed after cooldown', severity: 'info' as const, timestamp: Date.now() / 1000 - 7200, read: true },
];

export default function NotificationCenter() {
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all');
  const { markAlertRead, clearAlerts, addAlert } = useAppStore();

  const alerts = MOCK_ALERTS.filter((a) => {
    if (filter === 'unread') return !a.read;
    if (filter === 'critical') return a.severity === 'warning';
    return true;
  });

  const unreadCount = MOCK_ALERTS.filter((a) => !a.read).length;

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return <AlertCircle className="w-4 h-4 text-red-400" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-400" />;
      default: return <Info className="w-4 h-4 text-blue-400" />;
    }
  };

  const getSeverityBorder = (severity: string) => {
    switch (severity) {
      case 'warning': return 'border-l-amber-500';
      case 'info': return 'border-l-blue-500';
      default: return 'border-l-slate-500';
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
            <Bell className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Notifications</h2>
            <p className="text-[10px] text-slate-500">{unreadCount} unread</p>
          </div>
        </div>
        <button onClick={clearAlerts} className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
          <CheckCheck className="w-4 h-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-1.5 mb-3">
        {(['all', 'unread', 'critical'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
              filter === f ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Alert List */}
      <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar pr-1">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg border-l-2 ${getSeverityBorder(alert.severity)} ${
              !alert.read ? 'ring-1 ring-slate-700' : ''
            }`}
          >
            <div className="shrink-0 mt-0.5">{getSeverityIcon(alert.severity)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-white">{alert.title}</p>
                <span className="text-[10px] text-slate-500 font-mono shrink-0 ml-2">{timeAgo(alert.timestamp)}</span>
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{alert.message}</p>
            </div>
            {!alert.read && (
              <button
                onClick={() => markAlertRead(alert.id)}
                className="shrink-0 p-1 rounded text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        {alerts.length === 0 && (
          <p className="text-center text-xs text-slate-500 py-8">No notifications</p>
        )}
      </div>
    </div>
  );
}