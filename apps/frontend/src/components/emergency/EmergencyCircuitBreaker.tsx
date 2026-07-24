// apps/frontend/src/components/emergency/EmergencyCircuitBreaker.tsx
// Panel darurat dengan tombol kill switch dan auto-trigger rules

'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { AlertTriangle, Ban, Play, ShieldAlert, Activity } from 'lucide-react';

export default function EmergencyCircuitBreaker() {
  const { isEmergencyStopped, setEmergencyStopped, tradingHalted, setTradingHalted, addLog, addAlert } = useAppStore();
  const [confirming, setConfirming] = useState(false);
  const [autoTriggerRules, setAutoTriggerRules] = useState({
    drawdown: true,
    dailyLoss: true,
    maxTrades: false,
  });

  const handleEmergencyStop = () => {
    setEmergencyStopped(true);
    setTradingHalted(true);
    setConfirming(false);
    addAlert({
      id: `emergency-${Date.now()}`,
      type: 'system',
      title: 'EMERGENCY STOP ACTIVATED',
      message: 'All trading has been halted. Manual intervention required to resume.',
      severity: 'critical',
      timestamp: Math.floor(Date.now() / 1000),
      read: false,
      action: 'resume',
    });
    addLog({
      id: `log-${Date.now()}`,
      level: 'ERROR',
      message: 'EMERGENCY STOP triggered by user',
      timestamp: Math.floor(Date.now() / 1000),
      source: 'circuit-breaker',
    });
  };

  const handleResume = () => {
    setEmergencyStopped(false);
    setTradingHalted(false);
    addAlert({
      id: `resume-${Date.now()}`,
      type: 'system',
      title: 'Trading Resumed',
      message: 'Trading has been manually resumed.',
      severity: 'info',
      timestamp: Math.floor(Date.now() / 1000),
      read: false,
    });
    addLog({
      id: `log-${Date.now()}`,
      level: 'INFO',
      message: 'Trading resumed by user',
      timestamp: Math.floor(Date.now() / 1000),
      source: 'circuit-breaker',
    });
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
          <ShieldAlert className="w-4 h-4 text-red-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Circuit Breaker</h2>
          <p className="text-[10px] text-slate-500">Emergency trading controls</p>
        </div>
      </div>

      {/* Status Banner */}
      <div
        className={`p-4 rounded-lg border mb-4 ${
          isEmergencyStopped
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-emerald-500/10 border-emerald-500/30'
        }`}
      >
        <div className="flex items-center gap-3">
          {isEmergencyStopped ? (
            <>
              <Ban className="w-6 h-6 text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-400">EMERGENCY STOPPED</p>
                <p className="text-[10px] text-red-400/60">All trading activity is halted</p>
              </div>
            </>
          ) : (
            <>
              <Activity className="w-6 h-6 text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-emerald-400">All Systems Active</p>
                <p className="text-[10px] text-emerald-400/60">Trading bot is running normally</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Emergency Stop Button */}
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          disabled={isEmergencyStopped}
          className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-all hover:scale-[1.02] active:scale-95 mb-4 flex items-center justify-center gap-2"
        >
          <AlertTriangle className="w-5 h-5" />
          EMERGENCY STOP ALL
        </button>
      ) : (
        <div className="space-y-2 mb-4">
          <p className="text-xs text-red-400 font-medium text-center">
            Are you sure? This will halt all trading immediately.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleEmergencyStop}
              className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-sm rounded-lg transition-colors"
            >
              Confirm Stop
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Resume Button */}
      {isEmergencyStopped && (
        <button
          onClick={handleResume}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2 mb-4"
        >
          <Play className="w-4 h-4" />
          Resume Trading
        </button>
      )}

      {/* Auto-Trigger Rules */}
      <div>
        <p className="text-xs text-slate-400 font-medium mb-2">Auto-Trigger Rules</p>
        <div className="space-y-2">
          {[
            { key: 'drawdown' as const, label: 'Max Drawdown Reached', desc: 'Auto-stop when drawdown exceeds limit' },
            { key: 'dailyLoss' as const, label: 'Daily Loss Limit', desc: 'Auto-stop when daily loss limit hit' },
            { key: 'maxTrades' as const, label: 'Max Daily Trades', desc: 'Auto-stop when max trades per day reached' },
          ].map((rule) => (
            <label
              key={rule.key}
              className="flex items-center justify-between p-2.5 bg-slate-800/50 rounded-lg cursor-pointer hover:bg-slate-800 transition-colors"
            >
              <div>
                <p className="text-xs text-white font-medium">{rule.label}</p>
                <p className="text-[10px] text-slate-500">{rule.desc}</p>
              </div>
              <input
                type="checkbox"
                checked={autoTriggerRules[rule.key]}
                onChange={() =>
                  setAutoTriggerRules((p) => ({ ...p, [rule.key]: !p[rule.key] }))
                }
                className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0"
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}