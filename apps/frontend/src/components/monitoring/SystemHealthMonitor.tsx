// apps/frontend/src/components/monitoring/SystemHealthMonitor.tsx
// Dashboard status sistem dari /api/system/health

'use client';

import { useEffect, useState } from 'react';
import { Wifi, Database, Brain, Building2, Clock, Activity, RefreshCw } from 'lucide-react';
import { fetchSystemHealth } from '@/services/api-extended';
import { socket } from '@/services/socket';

type Health = {
  websocket: boolean;
  database: boolean;
  mlEngine: boolean;
  exchange: boolean;
  uptime: number;
  tradingHalted?: boolean;
  tradingHaltReason?: string | null;
  openPositions?: number;
  lastError?: string;
};

export default function SystemHealthMonitor() {
  const [health, setHealth] = useState<Health | null>(null);
  const [socketOk, setSocketOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setError(null);
      const data = await fetchSystemHealth();
      setHealth(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load health');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onConnect = () => setSocketOk(true);
    const onDisconnect = () => setSocketOk(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setSocketOk(socket.connected);
    const interval = setInterval(load, 10000);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      clearInterval(interval);
    };
  }, []);

  const merged: Health = {
    websocket: socketOk,
    database: health?.database ?? false,
    mlEngine: health?.mlEngine ?? false,
    exchange: health?.exchange ?? false,
    uptime: health?.uptime ?? 0,
    tradingHalted: health?.tradingHalted,
    tradingHaltReason: health?.tradingHaltReason,
    openPositions: health?.openPositions,
    lastError: health?.lastError,
  };

  const uptimeDays = Math.floor(merged.uptime / 86400);
  const uptimeHours = Math.floor((merged.uptime % 86400) / 3600);
  const uptimeMins = Math.floor((merged.uptime % 3600) / 60);

  const services = [
    { key: 'websocket' as const, label: 'WebSocket', icon: Wifi, status: merged.websocket },
    { key: 'database' as const, label: 'Database', icon: Database, status: merged.database },
    { key: 'mlEngine' as const, label: 'ML Engine', icon: Brain, status: merged.mlEngine },
    { key: 'exchange' as const, label: 'Exchange API', icon: Building2, status: merged.exchange },
  ];

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">System Health</h2>
            <p className="text-[10px] text-slate-500">Service status monitor</p>
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
              <p
                className={`text-[10px] font-mono mt-1 ${
                  svc.status ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {svc.status ? 'Connected' : 'Disconnected'}
              </p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 p-3 bg-slate-800/50 rounded-lg mb-2">
        <Clock className="w-4 h-4 text-slate-400" />
        <div>
          <p className="text-xs text-slate-300 font-medium">Backend Uptime</p>
          <p className="text-[10px] text-slate-500 font-mono">
            {uptimeDays}d {uptimeHours}h {uptimeMins}m
          </p>
        </div>
      </div>

      {merged.tradingHalted && (
        <p className="text-xs text-amber-400 mt-2">
          Trading is currently HALTED
          {merged.tradingHaltReason ? ` (${merged.tradingHaltReason})` : ''}
        </p>
      )}
      {typeof merged.openPositions === 'number' && (
        <p className="text-[10px] text-slate-500 mt-1">
          Open positions: {merged.openPositions}
        </p>
      )}
    </div>
  );
}
