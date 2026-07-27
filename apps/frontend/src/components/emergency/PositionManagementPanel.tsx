// apps/frontend/src/components/emergency/PositionManagementPanel.tsx
// Panel untuk mengelola posisi terbuka

'use client';

import { useEffect, useState } from 'react';
import { X, SlidersHorizontal, Target, RefreshCw } from 'lucide-react';
import { formatUSD, getChangeColor } from '@/lib/utils';
import {
  closeAllPositions,
  closePosition,
  fetchPositions,
  updatePositionSlTp,
} from '@/services/api-extended';
import { socket } from '@/services/socket';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type PositionRow = {
  symbol: string;
  side: 'LONG';
  entryPrice: number;
  quantity: number;
  unrealizedPnL: number;
  stopLoss: number;
  takeProfit: number;
};

export default function PositionManagementPanel() {
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [closing, setClosing] = useState<string | null>(null);
  const [showSlTp, setShowSlTp] = useState<string | null>(null);
  const [slDraft, setSlDraft] = useState<Record<string, string>>({});
  const [tpDraft, setTpDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [closeAllConfirmOpen, setCloseAllConfirmOpen] = useState(false);

  const load = async () => {
    try {
      setError(null);
      const data = await fetchPositions();
      const list: PositionRow[] = Array.isArray(data) ? data : [];
      setPositions(list);
      const sl: Record<string, string> = {};
      const tp: Record<string, string> = {};
      for (const p of list) {
        sl[p.symbol] = String(p.stopLoss);
        tp[p.symbol] = String(p.takeProfit);
      }
      setSlDraft(sl);
      setTpDraft(tp);
    } catch (err: any) {
      setError(err.message || 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onChange = () => load();
    socket.on('position-opened', onChange);
    socket.on('position-closed', onChange);
    const interval = setInterval(load, 15000);
    return () => {
      socket.off('position-opened', onChange);
      socket.off('position-closed', onChange);
      clearInterval(interval);
    };
  }, []);

  const handleClose = async (symbol: string) => {
    setClosing(symbol);
    setError(null);
    try {
      await closePosition(symbol);
      await load();
    } catch (err: any) {
      setError(err.message || `Failed to close ${symbol}`);
    } finally {
      setClosing(null);
    }
  };

  const handleCloseAll = async () => {
    setClosing('ALL');
    setError(null);
    try {
      await closeAllPositions();
      setCloseAllConfirmOpen(false);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to close all');
    } finally {
      setClosing(null);
    }
  };

  const handleUpdateSlTp = async (symbol: string) => {
    setError(null);
    try {
      await updatePositionSlTp(
        symbol,
        Number(slDraft[symbol]),
        Number(tpDraft[symbol]),
      );
      setShowSlTp(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to update SL/TP');
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Target className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Position Management</h2>
            <p className="text-[10px] text-slate-500">
              {positions.length} open position{positions.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setCloseAllConfirmOpen(true)}
            disabled={positions.length === 0 || closing === 'ALL'}
            className="text-xs text-red-400 hover:text-red-300 font-medium px-2.5 py-1.5 bg-red-500/10 rounded-lg transition-colors disabled:opacity-40"
          >
            Close All
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={closeAllConfirmOpen}
        title="Close All Positions?"
        description="This will market-close every open position on the exchange. Confirm only if you intend to flatten all exposure now."
        confirmLabel="Close All Positions"
        variant="danger"
        loading={closing === 'ALL'}
        onConfirm={handleCloseAll}
        onCancel={() => {
          if (closing !== 'ALL') setCloseAllConfirmOpen(false);
        }}
      />

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      {!loading && positions.length === 0 && !error && (
        <p className="text-xs text-slate-500 py-6 text-center">No open positions</p>
      )}

      <div className="space-y-3">
        {positions.map((pos) => {
          const pnl = Number(pos.unrealizedPnL) || 0;
          const isPositive = pnl >= 0;
          return (
            <div key={pos.symbol} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">
                    {pos.symbol.replace('USDT', '')}
                  </span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-medium">
                    {pos.side}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowSlTp(showSlTp === pos.symbol ? null : pos.symbol)}
                    className="p-1 rounded text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleClose(pos.symbol)}
                    disabled={closing === pos.symbol}
                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-[10px] mb-2">
                <div>
                  <span className="text-slate-500">Entry</span>
                  <p className="text-slate-300 font-mono">{formatUSD(Number(pos.entryPrice))}</p>
                </div>
                <div>
                  <span className="text-slate-500">Qty</span>
                  <p className="text-slate-300 font-mono">{Number(pos.quantity)}</p>
                </div>
                <div>
                  <span className="text-slate-500">SL / TP</span>
                  <p className="text-slate-300 font-mono">
                    {formatUSD(Number(pos.stopLoss))} / {formatUSD(Number(pos.takeProfit))}
                  </p>
                </div>
                <div className={`text-right ${getChangeColor(pnl)}`}>
                  <span className="text-slate-500">P&L</span>
                  <p className="font-mono font-medium">
                    {isPositive ? '+' : ''}
                    {pnl.toFixed(2)}
                  </p>
                </div>
              </div>

              {showSlTp === pos.symbol && (
                <div className="mt-2 p-2.5 bg-slate-900/50 rounded-lg border border-slate-700/50 space-y-2">
                  <div>
                    <label className="text-[10px] text-slate-500">Stop Loss</label>
                    <input
                      type="number"
                      value={slDraft[pos.symbol] ?? ''}
                      onChange={(e) =>
                        setSlDraft((d) => ({ ...d, [pos.symbol]: e.target.value }))
                      }
                      className="w-full bg-slate-800 border border-slate-700 text-white px-2 py-1 rounded text-xs font-mono mt-0.5 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">Take Profit</label>
                    <input
                      type="number"
                      value={tpDraft[pos.symbol] ?? ''}
                      onChange={(e) =>
                        setTpDraft((d) => ({ ...d, [pos.symbol]: e.target.value }))
                      }
                      className="w-full bg-slate-800 border border-slate-700 text-white px-2 py-1 rounded text-xs font-mono mt-0.5 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    onClick={() => handleUpdateSlTp(pos.symbol)}
                    className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition-colors"
                  >
                    Update SL/TP
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
