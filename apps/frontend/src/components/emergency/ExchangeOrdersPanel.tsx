'use client';

import { useCallback, useEffect, useState } from 'react';
import { Inbox, RefreshCw, X } from 'lucide-react';
import {
  cancelExchangeOrder,
  fetchExchangeOpenOrders,
  fetchExchangeRecentOrders,
  fetchTradingMode,
  type ExchangeOrder,
  type TradingMode,
} from '@/services/api-extended';
import { socket } from '@/services/socket';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type ExchangeOrdersPanelProps = {
  symbol: string;
  refreshKey?: number;
};

function formatTime(ts: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatNum(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

export default function ExchangeOrdersPanel({ symbol, refreshKey = 0 }: ExchangeOrdersPanelProps) {
  const [tab, setTab] = useState<'open' | 'recent'>('open');
  const [openOrders, setOpenOrders] = useState<ExchangeOrder[]>([]);
  const [recentOrders, setRecentOrders] = useState<ExchangeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ExchangeOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [mode, setMode] = useState<TradingMode>('paper');

  useEffect(() => {
    const loadMode = async () => {
      try {
        const s = await fetchTradingMode();
        setMode(s.mode);
      } catch {
        /* keep last */
      }
    };
    loadMode();
    const onMode = (event: { mode?: TradingMode }) => {
      if (event?.mode === 'paper' || event?.mode === 'live') setMode(event.mode);
      loadMode();
    };
    socket.on('trading-mode-changed', onMode);
    return () => {
      socket.off('trading-mode-changed', onMode);
    };
  }, []);

  const venueLabel = mode === 'live' ? 'LIVE mainnet' : 'Paper testnet';

  const load = useCallback(async () => {
    const sym = symbol.trim().toUpperCase() || undefined;
    try {
      setError(null);
      const [open, recent] = await Promise.all([
        fetchExchangeOpenOrders(sym),
        fetchExchangeRecentOrders(sym, 50),
      ]);
      setOpenOrders(Array.isArray(open) ? open : []);
      setRecentOrders(Array.isArray(recent) ? recent : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load exchange orders');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    setLoading(true);
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelExchangeOrder(cancelTarget.id, cancelTarget.symbol || symbol);
      setCancelTarget(null);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  const rows = tab === 'open' ? openOrders : recentOrders;

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Inbox className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">My Orders</h2>
            <p className="text-[10px] text-slate-500">
              Binance Spot · {venueLabel} · live from exchange
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800">
            <button
              type="button"
              onClick={() => setTab('open')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                tab === 'open' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Open ({openOrders.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('recent')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                tab === 'recent' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Recent
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="p-1.5 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      {!loading && rows.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Inbox className="w-8 h-8 text-slate-700 mb-2" />
          <p className="text-sm text-slate-500">
            {tab === 'open'
              ? `No open orders on ${venueLabel} for this filter`
              : `No recent orders returned from ${venueLabel}`}
          </p>
          <p className="text-[10px] text-slate-600 mt-1">
            Place a LIMIT order to verify it appears here
          </p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800/50 text-slate-500">
                <th className="text-left py-2 pr-3 font-medium">Time</th>
                <th className="text-left py-2 px-3 font-medium">Symbol</th>
                <th className="text-left py-2 px-3 font-medium">Side</th>
                <th className="text-left py-2 px-3 font-medium">Type</th>
                <th className="text-right py-2 px-3 font-medium">Price</th>
                <th className="text-right py-2 px-3 font-medium">Amount</th>
                <th className="text-right py-2 px-3 font-medium">Filled</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
                <th className="text-right py-2 pl-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((order) => (
                <tr key={`${order.id}-${order.timestamp}`} className="border-b border-slate-800/30">
                  <td className="py-2 pr-3 text-slate-400 whitespace-nowrap">{formatTime(order.timestamp)}</td>
                  <td className="py-2 px-3 text-white font-mono">{order.symbol}</td>
                  <td className={`py-2 px-3 font-medium uppercase ${order.side === 'buy' ? 'text-emerald-400' : 'text-red-400'}`}>
                    {order.side}
                  </td>
                  <td className="py-2 px-3 text-slate-300">{order.type}</td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{formatNum(order.price, 4)}</td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{formatNum(order.amount)}</td>
                  <td className="py-2 px-3 text-right font-mono text-slate-300">{formatNum(order.filled)}</td>
                  <td className="py-2 px-3 text-slate-400">{order.status}</td>
                  <td className="py-2 pl-3 text-right">
                    {tab === 'open' ? (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(order)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-red-400 hover:text-red-300 bg-red-500/10 rounded transition-colors"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </button>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel Open Order?"
        description={
          cancelTarget
            ? `Cancel ${cancelTarget.side.toUpperCase()} ${cancelTarget.type} ${cancelTarget.symbol} @ ${formatNum(cancelTarget.price, 4)} on ${venueLabel}?`
            : ''
        }
        confirmLabel="Cancel Order"
        variant="danger"
        loading={cancelling}
        onConfirm={handleCancel}
        onCancel={() => {
          if (!cancelling) setCancelTarget(null);
        }}
      />
    </div>
  );
}
