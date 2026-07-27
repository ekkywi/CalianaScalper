// apps/frontend/src/components/emergency/ManualOrderEntry.tsx
// Manual order entry → POST /api/orders (spot sandbox)

'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
import { placeOrder } from '@/services/api-extended';

export default function ManualOrderEntry() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP_LOSS'>('MARKET');
  const [quantity, setQuantity] = useState(0.0002);
  const [price, setPrice] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setMessage(null);
    setError(null);
    try {
      const result = await placeOrder({
        symbol,
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
    } catch (err: any) {
      setError(err.message || 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <Send className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Manual Order Entry</h2>
          <p className="text-[10px] text-slate-500">
            Spot testnet · BUY opens LONG · SELL closes/reduces LONG
          </p>
        </div>
      </div>

      <div className="space-y-3.5">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Symbol</label>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setSide('buy')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              side === 'buy' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            BUY
          </button>
          <button
            onClick={() => setSide('sell')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              side === 'sell' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            SELL
          </button>
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Order Type</label>
          <div className="flex gap-1.5">
            {(['MARKET', 'LIMIT', 'STOP_LOSS'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setOrderType(type)}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  orderType === type
                    ? 'bg-blue-600 text-white'
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
          <label className="text-xs text-slate-400 mb-1.5 block">Quantity</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            step={0.0001}
            min={0}
            className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
          />
        </div>

        {orderType !== 'MARKET' && (
          <div>
            <label className="text-xs text-slate-400 mb-1.5 block">Price (USDT)</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || orderType === 'STOP_LOSS'}
          className={`w-full py-3 rounded-lg text-sm font-bold text-white transition-all ${
            side === 'buy'
              ? 'bg-emerald-600 hover:bg-emerald-700'
              : 'bg-red-600 hover:bg-red-700'
          } disabled:opacity-50`}
        >
          {submitting
            ? 'Submitting...'
            : `${side === 'buy' ? 'BUY' : 'SELL'} ${symbol}`}
        </button>

        {message && <p className="text-xs text-emerald-400">{message}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
