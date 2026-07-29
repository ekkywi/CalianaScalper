'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, Play } from 'lucide-react';
import { formatUSD, getChangeColor } from '@/lib/utils';
import {
  emergencyStopAll,
  fetchAccountBalance,
  fetchPositions,
  resumeTrading,
  type AccountBalanceResponse,
} from '@/services/api-extended';
import { socket } from '@/services/socket';
import { useAppStore } from '@/store/app-store';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type PositionRow = {
  symbol: string;
  side: 'LONG';
  entryPrice: number;
  quantity: number;
  unrealizedPnL: number;
};

function safeMoney(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export default function CriticalStatusStrip() {
  const { tradingHalted, haltReason, syncTradingHalt, addAlert, addLog } = useAppStore();
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [balance, setBalance] = useState<AccountBalanceResponse | null>(null);
  const [balanceError, setBalanceError] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resumeConfirmOpen, setResumeConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPositions = useCallback(async () => {
    try {
      const data = await fetchPositions();
      setPositions(Array.isArray(data) ? data : []);
    } catch {
      // Keep last known positions; strip stays honest without fake numbers
    }
  }, []);

  const loadBalance = useCallback(async () => {
    try {
      const data = await fetchAccountBalance();
      setBalance(data);
      setBalanceError(false);
    } catch {
      setBalanceError(true);
    }
  }, []);

  useEffect(() => {
    loadPositions();
    loadBalance();
    const onChange = () => {
      loadPositions();
      loadBalance();
    };
    const onPrice = (candle: { symbol: string; close: number }) => {
      setPositions((prev) =>
        prev.map((p) => {
          if (p.symbol !== candle.symbol) return p;
          const pnl =
            p.side === 'LONG'
              ? (candle.close - Number(p.entryPrice)) * Number(p.quantity)
              : 0;
          return { ...p, unrealizedPnL: pnl };
        }),
      );
    };
    socket.on('position-opened', onChange);
    socket.on('position-closed', onChange);
    socket.on('realtime-price', onPrice);
    socket.on('trading-mode-changed', loadBalance);
    const interval = setInterval(() => {
      loadPositions();
      loadBalance();
    }, 15000);
    return () => {
      socket.off('position-opened', onChange);
      socket.off('position-closed', onChange);
      socket.off('realtime-price', onPrice);
      socket.off('trading-mode-changed', loadBalance);
      clearInterval(interval);
    };
  }, [loadPositions, loadBalance]);

  const totalPnl = positions.reduce((sum, p) => sum + (Number(p.unrealizedPnL) || 0), 0);
  const free = safeMoney(balance?.free);
  const modeLabel = balance?.mode === 'live' ? 'live' : balance?.mode === 'paper' ? 'paper' : null;

  const handleEmergencyStop = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await emergencyStopAll();
      syncTradingHalt(true, res?.haltReason || 'EMERGENCY_STOP');
      setConfirmOpen(false);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to execute emergency stop';
      setError(message);
      addLog({
        id: `log-${Date.now()}`,
        level: 'ERROR',
        message: `EMERGENCY STOP FAILED: ${message}`,
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
      syncTradingHalt(false, null);
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resume trading';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="sticky top-[53px] z-[9] bg-[#0a0a0f]/95 backdrop-blur-sm border-b border-slate-800/50 -mx-4 lg:-mx-6 px-4 lg:px-6 py-2.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4 sm:gap-6">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Open P&L</p>
              <p className={`text-sm font-semibold font-mono tabular-nums ${getChangeColor(totalPnl)}`}>
                {totalPnl >= 0 ? '+' : ''}
                {formatUSD(totalPnl).replace('$', '')} USDT
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Positions</p>
              <p className="text-sm font-semibold text-white tabular-nums">
                {positions.length}
                <Link
                  href="/dashboard/positions"
                  className="ml-2 text-[10px] font-normal text-sky-400 hover:text-sky-300"
                >
                  View
                </Link>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">
                Free USDT{modeLabel ? ` · ${modeLabel}` : ''}
              </p>
              <p className="text-sm font-semibold text-white font-mono tabular-nums">
                {free != null
                  ? formatUSD(free).replace('$', '')
                  : balanceError
                    ? 'N/A'
                    : '—'}
              </p>
            </div>
            {tradingHalted && (
              <div className="px-2 py-1 rounded bg-red-500/10 border border-red-500/30">
                <p className="text-[10px] font-medium text-red-400">
                  HALTED{haltReason ? ` · ${haltReason}` : ''}
                </p>
              </div>
            )}
            {error && <p className="text-[10px] text-red-400 max-w-[200px] truncate">{error}</p>}
          </div>

          {tradingHalted ? (
            <button
              type="button"
              onClick={() => setResumeConfirmOpen(true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              Resume
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-colors"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
              Emergency Stop
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Emergency Stop All Trading?"
        description="This will halt all trading activity and close all open positions immediately. This action cannot be undone from the client."
        confirmLabel="Confirm Emergency Stop"
        variant="danger"
        loading={loading}
        onConfirm={handleEmergencyStop}
        onCancel={() => {
          if (!loading) setConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={resumeConfirmOpen}
        title="Resume Trading?"
        description="Trading will be re-enabled on the backend. Ensure risk limits and market conditions are acceptable before continuing."
        confirmLabel="Resume Trading"
        variant="default"
        loading={loading}
        onConfirm={handleResume}
        onCancel={() => {
          if (!loading) setResumeConfirmOpen(false);
        }}
      />
    </>
  );
}
