// apps/frontend/src/components/emergency/ManualOrderEntry.tsx
// Manual orders — Phase 4 deferred (no /api/orders yet)

'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';

export default function ManualOrderEntry() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT' | 'STOP_LOSS'>('MARKET');
  const [quantity, setQuantity] = useState(0.01);
  const [price, setPrice] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    setMessage(
      'Manual order API is deferred (Phase 4). Use the automated ML loop or Position Management to close.',
    );
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <Send className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Manual Order Entry</h2>
          <p className="text-[10px] text-slate-500">Deferred — no Nest /api/orders yet</p>
        </div>
      </div>

      <div className="mb-4 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <p className="text-xs text-amber-300">
          Submitting here will not place an exchange order until Phase 4 ships the orders controller.
        </p>
      </div>

      <div className="space-y-3.5 opacity-70">
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
              side === 'buy' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            BUY
          </button>
          <button
            onClick={() => setSide('sell')}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
              side === 'sell' ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-400'
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
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Quantity</label>
          <input
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
            step={0.001}
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
          className={`w-full py-3 rounded-lg text-sm font-bold text-white transition-all ${
            side === 'buy' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
          }`}
        >
          {`${side === 'buy' ? 'BUY' : 'SELL'} ${symbol}`} (disabled API)
        </button>

        {message && <p className="text-xs text-amber-400">{message}</p>}
      </div>
    </div>
  );
}
