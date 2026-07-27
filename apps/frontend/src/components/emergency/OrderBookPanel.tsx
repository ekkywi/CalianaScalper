'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import { fetchOrderBook, type OrderBookLevel } from '@/services/api-extended';

type OrderBookPanelProps = {
  symbol: string;
};

function formatQty(n: number): string {
  if (!Number.isFinite(n)) return '--';
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function formatPx(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '--';
  if (n >= 1000) return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function DepthRows({
  levels,
  side,
  maxQty,
}: {
  levels: OrderBookLevel[];
  side: 'bid' | 'ask';
  maxQty: number;
}) {
  const barColor = side === 'bid' ? 'bg-emerald-500/15' : 'bg-red-500/15';
  const textColor = side === 'bid' ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className="space-y-0.5">
      {levels.map((level, idx) => {
        const width = maxQty > 0 ? Math.min(100, (level.quantity / maxQty) * 100) : 0;
        return (
          <div key={`${side}-${level.price}-${idx}`} className="relative grid grid-cols-2 gap-2 px-1 py-0.5 text-[10px] font-mono">
            <div
              className={`absolute inset-y-0 ${side === 'bid' ? 'right-0' : 'left-0'} ${barColor}`}
              style={{ width: `${width}%` }}
            />
            <span className={`relative tabular-nums ${textColor}`}>{formatPx(level.price)}</span>
            <span className="relative text-right text-slate-300 tabular-nums">{formatQty(level.quantity)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function OrderBookPanel({ symbol }: OrderBookPanelProps) {
  const [bids, setBids] = useState<OrderBookLevel[]>([]);
  const [asks, setAsks] = useState<OrderBookLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!symbol.trim()) return;
    try {
      setError(null);
      const data = await fetchOrderBook(symbol.trim().toUpperCase(), 20);
      setBids(data.bids || []);
      setAsks(data.asks || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load order book');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 2500);
    return () => clearInterval(interval);
  }, [load]);

  const askView = [...asks].slice(0, 10).reverse();
  const bidView = bids.slice(0, 10);
  const maxQty = Math.max(
    0,
    ...askView.map((l) => l.quantity),
    ...bidView.map((l) => l.quantity),
  );
  const bestAsk = asks[0]?.price;
  const bestBid = bids[0]?.price;
  const mid =
    Number.isFinite(bestAsk) && Number.isFinite(bestBid)
      ? ((bestAsk as number) + (bestBid as number)) / 2
      : null;

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-slate-500/10 flex items-center justify-center">
            <BookOpen className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Order Book</h2>
            <p className="text-[10px] text-slate-500">
              Mainnet depth · {symbol || '—'} (not your orders)
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            load();
          }}
          className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      {!error && (
        <>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500 px-1 mb-1">
            <span>Price</span>
            <span className="text-right">Size</span>
          </div>

          <DepthRows levels={askView} side="ask" maxQty={maxQty} />

          <div className="my-2 py-1.5 text-center border-y border-slate-800/80">
            <p className="text-xs font-mono font-semibold text-white tabular-nums">
              {mid != null ? formatPx(mid) : '—'}
            </p>
            <p className="text-[10px] text-slate-500">mid (mainnet)</p>
          </div>

          <DepthRows levels={bidView} side="bid" maxQty={maxQty} />
        </>
      )}

      {!loading && !error && bids.length === 0 && asks.length === 0 && (
        <p className="text-xs text-slate-500 text-center py-6">No depth data for this symbol</p>
      )}
    </div>
  );
}
