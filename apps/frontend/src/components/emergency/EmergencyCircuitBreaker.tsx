// apps/frontend/src/components/emergency/EmergencyCircuitBreaker.tsx
// Panel darurat dengan tombol kill switch — TERHUBUNG ke backend API

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAppStore } from '@/store/app-store';
import { AlertTriangle, Ban, Play, ShieldAlert, Activity, Loader2 } from 'lucide-react';
import {
  emergencyStopAll,
  fetchRiskStatus,
  resumeTrading,
} from '@/services/api-extended';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

export default function EmergencyCircuitBreaker() {
  const {
    tradingHalted,
    haltReason,
    setEmergencyStopped,
    syncTradingHalt,
    addLog,
    addAlert,
    riskConfig,
  } = useAppStore();
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [resumeConfirmOpen, setResumeConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      try {
        const status = await fetchRiskStatus();
        if (cancelled || typeof status?.halted !== 'boolean') return;
        syncTradingHalt(status.halted, status.haltReason ?? null);
      } catch {
        // keep last known store state
      }
    };
    sync();
    const interval = setInterval(sync, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [syncTradingHalt]);

  const handleEmergencyStop = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await emergencyStopAll();
      syncTradingHalt(true, res?.haltReason || 'EMERGENCY_STOP');
      setStopConfirmOpen(false);
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

  const handleResume = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await resumeTrading(force);
      if (res.status === 'cooldown') {
        const mins = Math.ceil((res.cooldownRemainingMs || 0) / 60000);
        setError(`Cooldown active — ${mins} minutes remaining. Use "Force Resume" to override.`);
        setResumeConfirmOpen(false);
        return;
      }
      syncTradingHalt(false, null);
      setEmergencyStopped(false);
      setResumeConfirmOpen(false);
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

  const pct = (v: number) => `${(Number(v) * 100).toFixed(1)}%`;
  const reasonLabel = haltReason || 'UNKNOWN';
  const isEmergency = reasonLabel === 'EMERGENCY_STOP';

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
          <ShieldAlert className="w-4 h-4 text-red-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Circuit Breaker</h2>
          <p className="text-[10px] text-slate-500">Emergency trading controls</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}

      <div
        className={`p-4 rounded-lg border mb-4 ${
          tradingHalted
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-slate-800/50 border-slate-700/50'
        }`}
      >
        <div className="flex items-center gap-3">
          {tradingHalted ? (
            <>
              <Ban className="w-6 h-6 text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-400">
                  {isEmergency ? 'EMERGENCY STOPPED' : 'TRADING HALTED'}
                </p>
                <p className="text-[10px] text-red-400/60">
                  Reason: {reasonLabel} — resume required before new signals run
                </p>
              </div>
            </>
          ) : (
            <>
              <Activity className="w-6 h-6 text-slate-400" />
              <div>
                <p className="text-sm font-semibold text-slate-200">Systems Active</p>
                <p className="text-[10px] text-slate-500">Trading bot is running normally</p>
              </div>
            </>
          )}
        </div>
      </div>

      {!tradingHalted ? (
        <button
          onClick={() => setStopConfirmOpen(true)}
          disabled={loading}
          className="w-full py-4 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors mb-4 flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <AlertTriangle className="w-5 h-5" />}
          {loading ? 'Processing...' : 'EMERGENCY STOP ALL'}
        </button>
      ) : (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setResumeConfirmOpen(true)}
            disabled={loading}
            className="flex-1 py-3 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {loading ? 'Resuming...' : 'Resume Trading'}
          </button>
          {['MAX_DRAWDOWN', 'MAX_DAILY_DRAWDOWN', 'MAX_WEEKLY_DRAWDOWN'].includes(reasonLabel) && (
            <button
              onClick={() => handleResume(true)}
              disabled={loading}
              className="py-3 px-4 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-medium text-xs rounded-lg transition-colors"
              title="Skip cooldown and resume immediately"
            >
              Force
            </button>
          )}
        </div>
      )}

      {/* Read-only server-side limits from risk config — no fake toggles */}
      <div>
        <p className="text-xs text-slate-400 font-medium mb-1">Server-side limits</p>
        <p className="text-[10px] text-slate-600 mb-2">
          Enforced by Risk Parameters.{' '}
          <Link href="/dashboard/risk" className="text-sky-400 hover:text-sky-300">
            Edit configuration
          </Link>
        </p>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between p-2.5 bg-slate-800/50 rounded-lg">
            <span className="text-xs text-slate-300">Daily Drawdown</span>
            <span className="text-xs font-mono text-slate-400">
              {pct(riskConfig.maxDailyDrawdownPercent || 0)}
            </span>
          </div>
          <div className="flex items-center justify-between p-2.5 bg-slate-800/50 rounded-lg">
            <span className="text-xs text-slate-300">Weekly Drawdown</span>
            <span className="text-xs font-mono text-slate-400">
              {pct(riskConfig.maxWeeklyDrawdownPercent || 0)}
            </span>
          </div>
          <div className="flex items-center justify-between p-2.5 bg-slate-800/50 rounded-lg">
            <span className="text-xs text-slate-300">Max Drawdown (trailing)</span>
            <span className="text-xs font-mono text-slate-400">
              {pct(riskConfig.maxDrawdownPercent)}
            </span>
          </div>
          <div className="flex items-center justify-between p-2.5 bg-slate-800/50 rounded-lg">
            <span className="text-xs text-slate-300">Max Daily Loss</span>
            <span className="text-xs font-mono text-slate-400">
              {pct(riskConfig.maxDailyLossPercent)}
            </span>
          </div>
          <div className="flex items-center justify-between p-2.5 bg-slate-800/50 rounded-lg">
            <span className="text-xs text-slate-300">Max Trades / Day</span>
            <span className="text-xs font-mono text-slate-400">
              {riskConfig.maxTradesPerDay}x
            </span>
          </div>
          {(riskConfig.drawdownCooldownMinutes || 0) > 0 && (
            <div className="flex items-center justify-between p-2.5 bg-slate-800/50 rounded-lg">
              <span className="text-xs text-slate-300">Cooldown After Halt</span>
              <span className="text-xs font-mono text-slate-400">
                {riskConfig.drawdownCooldownMinutes}min
              </span>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={stopConfirmOpen}
        title="Emergency Stop All Trading?"
        description="This will halt all trading and close all open positions immediately. Confirm only if you intend to stop the bot now."
        confirmLabel="Confirm Emergency Stop"
        variant="danger"
        loading={loading}
        onConfirm={handleEmergencyStop}
        onCancel={() => {
          if (!loading) setStopConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={resumeConfirmOpen}
        title="Resume Trading?"
        description="Trading will be re-enabled on the backend. Ensure risk limits and market conditions are acceptable before continuing."
        confirmLabel="Resume Trading"
        variant="default"
        loading={loading}
        onConfirm={() => handleResume(false)}
        onCancel={() => {
          if (!loading) setResumeConfirmOpen(false);
        }}
      />
    </div>
  );
}
