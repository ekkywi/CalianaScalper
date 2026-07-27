// apps/frontend/src/components/emergency/EmergencyCircuitBreaker.tsx
// Panel darurat dengan tombol kill switch — TERHUBUNG ke backend API

'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/app-store';
import { AlertTriangle, Ban, Play, ShieldAlert, Activity, Loader2 } from 'lucide-react';
import { emergencyStopAll, resumeTrading } from '@/services/api-extended';

export default function EmergencyCircuitBreaker() {
  const { isEmergencyStopped, setEmergencyStopped, tradingHalted, setTradingHalted, addLog, addAlert } = useAppStore();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoTriggerRules, setAutoTriggerRules] = useState({
    drawdown: true,
    dailyLoss: true,
    maxTrades: false,
  });

  const handleEmergencyStop = async () => {
    setLoading(true);
    setError(null);
    try {
      await emergencyStopAll();
      setEmergencyStopped(true);
      setTradingHalted(true);
      setConfirming(false);
      addAlert({
        id: `emergency-${Date.now()}`,
        type: 'system',
        title: 'EMERGENCY STOP ACTIVATED',
        message: 'All trading has been halted via backend. Positions are being closed.',
        severity: 'critical',
        timestamp: Math.floor(Date.now() / 1000),
        read: false,
        action: 'resume',
      });
      addLog({
        id: `log-${Date.now()}`,
        level: 'ERROR',
        message: 'EMERGENCY STOP triggered by user — backend confirmed',
        timestamp: Math.floor(Date.now() / 1000),
        source: 'circuit-breaker',
      });
    } catch (err: any) {
      setError(err.message || 'Failed to execute emergency stop');
      addLog({
        id: `log-${Date.now()}`,
        level: 'ERROR',
        message: `EMERGENCY STOP FAILED: ${err.message}`,
        timestamp: Math.floor(Date.now() / 1000),
        source: 'circuit-breaker',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    setLoading(true);
    setError(null);
    try {
      await resumeTrading();
      setEmergencyStopped(false);
      setTradingHalted(false);
      addAlert({
        id: `resume-${Date.now()}`,
        type: 'system',
        title: 'Trading Resumed',
        message: 'Trading has been resumed via backend.',
        severity: 'info',
        timestamp: Math.floor(Date.now() / 1000),
        read: false,
      });
      addLog({
        id: `log-${Date.now()}`,
        level: 'INFO',
        message: 'Trading resumed by user — backend confirmed',
        timestamp: Math.floor(Date.now() / 1000),
        source: 'circuit-breaker',
      });
    } catch (err: any) {
      setError(err.message || 'Failed to resume trading');
    } finally {
      setLoading(false);
    }
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

      {/* Error Banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}

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
          disabled={isEmergencyStopped || loading}
          className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-all hover:scale-[1.02] active:scale-95 mb-4 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <AlertTriangle className="w-5 h-5" />}
          {loading ? 'Processing...' : 'EMERGENCY STOP ALL'}
        </button>
      ) : (
        <div className="space-y-2 mb-4">
          <p className="text-xs text-red-400 font-medium text-center">
            Are you sure? This will halt all trading and close all open positions immediately.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleEmergencyStop}
              disabled={loading}
              className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirm Stop
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={loading}
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
          disabled={loading}
          className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2 mb-4"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? 'Resuming...' : 'Resume Trading'}
        </button>
      )}

      {/* Auto-Trigger Rules */}
      <div>
        <p className="text-xs text-slate-400 font-medium mb-2">Auto-Trigger Rules</p>
        <p className="text-[10px] text-slate-600 mb-2">(Applied server-side — these are read-only indicators)</p>
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