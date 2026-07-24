// apps/frontend/src/components/monitoring/SystemHealthMonitor.tsx
// Dashboard status sistem

'use client';

import { useAppStore } from '@/store/app-store';
import { Wifi, Database, Brain, Building2, Clock, Activity } from 'lucide-react';

const MOCK_HEALTH = {
  websocket: true,
  database: true,
  mlEngine: true,
  exchange: true,
  uptime: 86400 * 3 + 3600 * 5 + 60 * 23,
  lastError: undefined as string | undefined,
};

export default function SystemHealthMonitor() {
  const health = MOCK_HEALTH;
  const uptimeDays = Math.floor(health.uptime / 86400);
  const uptimeHours = Math.floor((health.uptime % 86400) / 3600);
  const uptimeMins = Math.floor((health.uptime % 3600) / 60);

  const services = [
    { key: 'websocket' as const, label: 'WebSocket', icon: Wifi, status: health.websocket },
    { key: 'database' as const, label: 'Database', icon: Database, status: health.database },
    { key: 'mlEngine' as const, label: 'ML Engine', icon: Brain, status: health.mlEngine },
    { key: 'exchange' as const, label: 'Exchange API', icon: Building2, status: health.exchange },
  ];

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
          <Activity className="w-4 h-4 text-sky-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">System Health</h2>
          <p className="text-[10px] text-slate-500">Service status monitor</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 mb-4">
        {services.map((svc) => {
          const Icon = svc.icon;
          return (
            <div
              key={svc.key}
              className={`p-3 rounded-lg border ${
                svc.status
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-red-500/5 border-red-500/20'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-4 h-4 ${svc.status ? 'text-emerald-400' : 'text-red-400'}`} />
                <span className="text-xs text-white font-medium">{svc.label}</span>
              </div>
              <p className={`text-[10px] font-mono mt-1 ${svc.status ? 'text-emerald-400' : 'text-red-400'}`}>
                {svc.status ? 'Connected' : 'Disconnected'}
              </p>
            </div>
          );
        })}
      </div>

      {/* Uptime */}
      <div className="flex items-center gap-2 p-3 bg-slate-800/50 rounded-lg">
        <Clock className="w-4 h-4 text-slate-400" />
        <div>
          <p className="text-xs text-slate-300 font-medium">System Uptime</p>
          <p className="text-[10px] text-slate-500 font-mono">
            {uptimeDays}d {uptimeHours}h {uptimeMins}m
          </p>
        </div>
      </div>
    </div>
  );
}