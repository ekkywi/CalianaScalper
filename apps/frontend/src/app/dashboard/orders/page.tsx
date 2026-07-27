'use client';

import { useEffect, useState } from 'react';
import ManualOrderEntry from '@/components/emergency/ManualOrderEntry';
import OrderBookPanel from '@/components/emergency/OrderBookPanel';
import ExchangeOrdersPanel from '@/components/emergency/ExchangeOrdersPanel';
import { fetchTradingMode, type TradingMode } from '@/services/api-extended';
import { socket } from '@/services/socket';

export default function OrdersPage() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<TradingMode>('paper');

  useEffect(() => {
    const load = async () => {
      try {
        const s = await fetchTradingMode();
        setMode(s.mode);
      } catch {
        /* keep */
      }
    };
    load();
    const onMode = (event: { mode?: TradingMode }) => {
      if (event?.mode === 'paper' || event?.mode === 'live') setMode(event.mode);
    };
    socket.on('trading-mode-changed', onMode);
    return () => {
      socket.off('trading-mode-changed', onMode);
    };
  }, []);

  const venue =
    mode === 'live'
      ? 'Binance spot LIVE (mainnet)'
      : 'Binance spot PAPER (testnet)';

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Orders</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Place on {venue} · My Orders verify exchange fills · Order book shows mainnet depth
          (context only)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <ManualOrderEntry
          symbol={symbol}
          onSymbolChange={setSymbol}
          onPlaced={() => setRefreshKey((k) => k + 1)}
        />
        <OrderBookPanel symbol={symbol} />
      </div>

      <ExchangeOrdersPanel symbol={symbol} refreshKey={refreshKey} />
    </div>
  );
}
