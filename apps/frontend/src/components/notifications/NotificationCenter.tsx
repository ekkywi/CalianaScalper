// apps/frontend/src/components/notifications/NotificationCenter.tsx
// Alert feed from Zustand (no fabricated MOCK alerts)

'use client';

import { useState } from 'react';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store/app-store';
import { timeAgo } from '@/lib/utils';

export default function NotificationCenter() {
  const alerts = useAppStore((s) => s.alerts);
  const markAlertRead = useAppStore((s) => s.markAlertRead);
  const clearAlerts = useAppStore((s) => s.clearAlerts);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const visible = alerts.filter((a) => (filter === 'all' ? true : !a.read));
  const unreadCount = alerts.filter((a) => !a.read).length;

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Bell className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Notifications</h2>
            <p className="text-[10px] text-slate-500">
              {unreadCount} unread · multi-channel alerts deferred (Phase 4)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => alerts.forEach((a) => markAlertRead(a.id))}
            className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
            title="Mark all read"
          >
            <CheckCheck className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={clearAlerts}
            className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Clear"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-3">
        {(['all', 'unread'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 text-[10px] rounded-md ${
              filter === f ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-xs text-slate-500 py-8 text-center">
          No alerts yet. Emergency stop and risk events can push here later.
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((alert) => (
            <button
              key={alert.id}
              onClick={() => markAlertRead(alert.id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                alert.read
                  ? 'bg-slate-800/30 border-slate-800/50'
                  : 'bg-slate-800/60 border-slate-700/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-medium text-white">{alert.title}</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {timeAgo(alert.timestamp)}
                </span>
              </div>
              <p className="text-[10px] text-slate-400">{alert.message}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
