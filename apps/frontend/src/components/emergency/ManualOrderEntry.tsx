// apps/frontend/src/components/emergency/ManualOrderEntry.tsx
// Manual order entry → POST /api/orders (active venue: paper or live)

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import {
  fetchAccountBalance,
  fetchTradingMode,
  placeOrder,
  type TradingMode,
} from '@/services/api-extended';
import { socket } from '@/services/socket';

type ManualOrderEntryProps = {
  symbol: string;
  onSymbolChange: (symbol: string) => void;
  onPlaced?: () => void;
};

export default function ManualOrderEntry({
  symbol,
  onSymbolChange,
  onPlaced,
}: ManualOrderEntryProps) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP_LOSS'>('MARKET');
  const [quantity, setQuantity] = useState(0.0002);
  const [price, setPrice] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<TradingMode>('paper');
  const [freeUsdt, setFreeUsdt] = useState<number | null>(null);
  const [markPrice, setMarkPrice] = useState<number | null>(null);

  const refreshBalance = useCallback(async () => {
    try {
      const [modeStatus, balance] = await Promise.all([
        fetchTradingMode(),
        fetchAccountBalance(),
      ]);
      setMode(modeStatus.mode);
      setFreeUsdt(balance.free);
    } catch {
      // keep last known
    }
  }, []);

  useEffect(() => {
    refreshBalance();
    const onMode = () => refreshBalance();
    socket.on('trading-mode-changed', onMode);
    const interval = setInterval(refreshBalance, 30000);
    return () => {
      socket.off('trading-mode-changed', onMode);
      clearInterval(interval);
    };
  }, [refreshBalance]);

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;
    const onPrice = (candle: { symbol?: string; close?: number }) => {
      if (candle?.symbol === sym && typeof candle.close === 'number') {
        setMarkPrice(candle.close);
      }
    };
    socket.on('realtime-price', onPrice);
    return () => {
      socket.off('realtime-price', onPrice);
    };
  }, [symbol]);

  const refPrice =
    orderType === 'LIMIT' && price > 0 ? price : markPrice ?? 0;
  const estimatedCost =
    side === 'buy' && quantity > 0 && refPrice > 0 ? quantity * refPrice : null;
  const insufficient =
    estimatedCost != null && freeUsdt != null && freeUsdt < estimatedCost;

  const validationHint = useMemo(() => {
    if (!symbol.trim()) return 'Enter a symbol (e.g. BTCUSDT).';
    if (!(quantity > 0)) return 'Quantity must be greater than 0.';
    if (orderType === 'STOP_LOSS')
      return 'STOP_LOSS is not available here — set SL on Position Management.';
    if (orderType === 'LIMIT' && !(price > 0)) return 'Limit price must be greater than 0.';
    if (insufficient && estimatedCost != null && freeUsdt != null) {
      return `Need ~${estimatedCost.toFixed(2)} USDT, have ${freeUsdt.toFixed(2)} free (${mode}). Qty is base asset (BTC), not USDT.`;
    }
    return null;
  }, [symbol, quantity, orderType, price, insufficient, estimatedCost, freeUsdt, mode]);

  const canSubmit = validationHint === null && !submitting && !insufficient;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await placeOrder({
        symbol: symbol.trim().toUpperCase(),
        side,
        type: orderType,
        quantity,
        price: orderType === 'MARKET' ? undefined : price,
      });
      const orderId = result?.order?.id || result?.order?.exchangeOrderId || 'n/a';
      const pos = result?.position?.symbol
        ? ` · position ${result.position.status || 'OPEN'}`
        : '';
      setMessage(`Order accepted (id ${orderId})${pos}`);
      onPlaced?.();
      refreshBalance();
    } catch (err: any) {
      setError(err.message || 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  const venueLabel =
    mode === 'live' ? 'Spot LIVE · mainnet' : 'Spot PAPER · testnet';

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6 h-full">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
          <Send className="w-4 h-4 text-sky-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Manual Order Entry</h2>
          <p className="text-[10px] text-slate-500">
            {venueLabel} · BUY opens LONG · SELL closes/reduces LONG
          </p>
        </div>
      </div>

      <div className="space-y-3.5">
        <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 px-3 py-2 text-[11px] text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            Free USDT:{' '}
            <span className="font-mono text-slate-200">
              {freeUsdt == null ? '—' : freeUsdt.toFixed(2)}
            </span>
          </span>
          {estimatedCost != null && (
            <span>
              Est. cost:{' '}
              <span
                className={`font-mono ${
                  insufficient ? 'text-red-400' : 'text-slate-200'
                }`}
              >
                ~{estimatedCost.toFixed(2)}
              </span>
            </span>
          )}
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value.toUpperCase())}
            className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-sky-500"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSide('buy')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all border ${
              side === 'buy'
                ? 'bg-emerald-600 border-emerald-500 text-white shadow-[inset_0_0_0_1px_rgba(16,185,129,0.4)]'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            BUY / LONG
          </button>
          <button
            type="button"
            onClick={() => setSide('sell')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all border ${
              side === 'sell'
                ? 'bg-red-600 border-red-500 text-white shadow-[inset_0_0_0_1px_rgba(239,68,68,0.4)]'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            SELL / CLOSE
          </button>
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Order Type</label>
          <div className="flex gap-1.5">
            {(['MARKET', 'LIMIT', 'STOP_LOSS'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setOrderType(type)}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  orderType === type
                    ? 'bg-sky-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>
          {orderType === 'STOP_LOSS' && (
            <p className="text-[10px] text-amber-400 mt-1">
              STOP_LOSS via this form is rejected — set SL on Position Management instead.
            </p>
          )}
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">
            Quantity (base asset, e.g. BTC)
          </label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            step={0.0001}
            min={0}
            className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-sky-500"
          />
        </div>

        {orderType === 'LIMIT' && (
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Price (USDT)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              min={0}
              className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-sky-500"
            />
          </div>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={`w-full py-3 rounded-lg text-sm font-bold text-white transition-all ${
            side === 'buy'
              ? 'bg-emerald-600 hover:bg-emerald-700'
              : 'bg-red-600 hover:bg-red-700'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {submitting
            ? 'Submitting...'
            : `${side === 'buy' ? 'BUY / LONG' : 'SELL / CLOSE'} ${symbol.trim() || '—'}`}
        </button>

        {validationHint && (
          <p className={`text-[10px] ${insufficient ? 'text-amber-400' : 'text-slate-500'}`}>
            {validationHint}
          </p>
        )}
        {message && <p className="text-xs text-emerald-400">{message}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
