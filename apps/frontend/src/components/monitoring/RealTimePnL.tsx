// apps/frontend/src/components/monitoring/RealTimePnL.tsx
// Widget P&L real-time untuk posisi terbuka

'use client';

import { useEffect, useState } from 'react';
import { formatUSD, getChangeColor } from '@/lib/utils';
import { TrendingUp, RefreshCw } from 'lucide-react';
import { fetchPositions } from '@/services/api-extended';
import { socket } from '@/services/socket';

type PositionRow = {
  symbol: string;
  side: 'LONG';
  entryPrice: number;
  quantity: number;
  unrealizedPnL: number;
  stopLoss: number;
  takeProfit: number;
};

export default function RealTimePnL() {
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const data = await fetchPositions();
      setPositions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onChange = () => load();
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
    const interval = setInterval(load, 15000);
    return () => {
      socket.off('position-opened', onChange);
      socket.off('position-closed', onChange);
      socket.off('realtime-price', onPrice);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Real-Time P&L</h2>
            <p className="text-[10px] text-slate-500">
              {positions.length} open position{positions.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <button
          onClick={load}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-3">{error}</p>
      )}

      {!loading && positions.length === 0 && !error && (
        <p className="text-xs text-slate-500 py-6 text-center">No open positions</p>
      )}

      <div className="space-y-3">
        {positions.map((pos) => {
          const pnl = Number(pos.unrealizedPnL) || 0;
          const entry = Number(pos.entryPrice) || 0;
          const qty = Number(pos.quantity) || 0;
          const notional = entry * qty;
          const pnlPercent = notional > 0 ? (pnl / notional) * 100 : 0;
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
                <div className={`text-right ${getChangeColor(pnl)}`}>
                  <p className="text-sm font-bold font-mono">
                    {isPositive ? '+' : ''}
                    {pnl.toFixed(2)}
                  </p>
                  <p className="text-[10px] font-mono">
                    {isPositive ? '+' : ''}
                    {pnlPercent.toFixed(2)}%
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-500">Entry</span>
                  <p className="text-slate-300 font-mono">{formatUSD(entry)}</p>
                </div>
                <div>
                  <span className="text-slate-500">SL / TP</span>
                  <p className="text-slate-300 font-mono">
                    {formatUSD(Number(pos.stopLoss))} / {formatUSD(Number(pos.takeProfit))}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Qty</span>
                  <p className="text-slate-300 font-mono">{qty}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
