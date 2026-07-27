'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  fetchTradingMode,
  setTradingMode,
  type TradingMode,
  type TradingModeStatus,
} from '@/services/api-extended';
import { socket } from '@/services/socket';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

export default function TradingModeBanner() {
  const [status, setStatus] = useState<TradingModeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingMode, setPendingMode] = useState<TradingMode | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchTradingMode();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load trading mode');
    }
  }, []);

  useEffect(() => {
    load();
    const onMode = () => load();
    socket.on('trading-mode-changed', onMode);
    const interval = setInterval(load, 60000);
    return () => {
      socket.off('trading-mode-changed', onMode);
      clearInterval(interval);
    };
  }, [load]);

  const mode: TradingMode = status?.mode ?? 'paper';
  const isLive = mode === 'live';

  const requestSwitch = (next: TradingMode) => {
    if (!status || next === status.mode || loading) return;
    if (next === 'live' && !status.liveAllowed) {
      setError(status.liveBlockReason || 'Live trading is disabled');
      return;
    }
    if (!status.canSwitch) {
      setError(status.switchBlockReason || 'Cannot switch mode');
      return;
    }
    setError(null);
    setPendingMode(next);
  };

  const confirmSwitch = async () => {
    if (!pendingMode) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await setTradingMode(
        pendingMode,
        pendingMode === 'live' ? 'LIVE' : undefined,
      );
      setStatus(updated);
      setPendingMode(null);
    } catch (err: any) {
      setError(err?.message || 'Mode switch failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        className={`shrink-0 border-b px-4 py-2 flex flex-wrap items-center gap-3 ${
          isLive
            ? 'bg-red-950/80 border-red-800/80'
            : 'bg-slate-950/90 border-amber-900/40'
        }`}
      >
        <span
          className={`text-[11px] font-bold tracking-widest px-2.5 py-1 rounded ${
            isLive
              ? 'bg-red-600 text-white'
              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
          }`}
        >
          {isLive ? 'LIVE' : 'PAPER'}
        </span>
        <p className="text-[11px] text-slate-400 flex-1 min-w-[12rem]">
          {isLive
            ? 'Real capital · Binance spot mainnet'
            : 'Paper trading · Binance spot testnet'}
          {status && !status.liveAllowed && (
            <span className="text-slate-600"> · Live locked</span>
          )}
        </p>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => requestSwitch('paper')}
            disabled={loading || mode === 'paper'}
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition disabled:opacity-40 ${
              mode === 'paper'
                ? 'bg-amber-500/30 text-amber-200'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            Paper
          </button>
          <button
            type="button"
            onClick={() => requestSwitch('live')}
            disabled={loading || mode === 'live' || status?.liveAllowed === false}
            title={
              status && !status.liveAllowed
                ? status.liveBlockReason || 'Live disabled'
                : undefined
            }
            className={`px-2.5 py-1 rounded text-[11px] font-medium transition disabled:opacity-40 ${
              mode === 'live'
                ? 'bg-red-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-red-300'
            }`}
          >
            Live
          </button>
          {loading && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />}
        </div>
      </div>

      {error && (
        <div className="shrink-0 px-4 py-1.5 bg-red-950/50 border-b border-red-900/40 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <ConfirmDialog
        open={pendingMode === 'live'}
        title="Switch to LIVE trading?"
        description="Orders will use real funds on Binance spot mainnet. Close all positions and open orders first. This cannot be undone by a refresh."
        confirmLabel="Go LIVE"
        variant="danger"
        requireTypedConfirm="LIVE"
        loading={loading}
        onConfirm={confirmSwitch}
        onCancel={() => setPendingMode(null)}
      />

      <ConfirmDialog
        open={pendingMode === 'paper'}
        title="Switch to Paper trading?"
        description="Execution moves back to Binance spot testnet. Open positions and orders must be flat first."
        confirmLabel="Use Paper"
        variant="default"
        loading={loading}
        onConfirm={confirmSwitch}
        onCancel={() => setPendingMode(null)}
      />
    </>
  );
}
