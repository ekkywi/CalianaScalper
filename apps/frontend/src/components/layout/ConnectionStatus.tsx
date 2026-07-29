'use client';

import { useEffect, useState } from 'react';
import { fetchSystemHealth, type TradingMode } from '@/services/api-extended';
import { socket } from '@/services/socket';
import { binanceTickerWS } from '@/services/binance-ws';
import { useAppStore } from '@/store/app-store';

type Lamp = {
  key: string;
  label: string;
  ok: boolean;
};

export default function ConnectionStatus() {
  const syncTradingHalt = useAppStore((s) => s.syncTradingHalt);
  const [apiOk, setApiOk] = useState(false);
  const [socketOk, setSocketOk] = useState(false);
  const [marketOk, setMarketOk] = useState(false);
  const [tradingMode, setTradingMode] = useState<TradingMode>('paper');

  useEffect(() => {
    let cancelled = false;

    const pollApi = async () => {
      try {
        const health = await fetchSystemHealth();
        if (!cancelled) {
          setApiOk(true);
          if (health?.tradingMode === 'paper' || health?.tradingMode === 'live') {
            setTradingMode(health.tradingMode);
          }
          if (typeof health?.tradingHalted === 'boolean') {
            syncTradingHalt(
              health.tradingHalted,
              health.tradingHaltReason ?? null,
            );
          }
        }
      } catch {
        if (!cancelled) setApiOk(false);
      }
    };

    pollApi();
    const interval = setInterval(pollApi, 10000);

    const onConnect = () => setSocketOk(true);
    const onDisconnect = () => setSocketOk(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setSocketOk(socket.connected);
    setMarketOk(binanceTickerWS.getConnected());

    const onMode = (event: { mode?: TradingMode }) => {
      if (event?.mode === 'paper' || event?.mode === 'live') {
        setTradingMode(event.mode);
      }
    };
    socket.on('trading-mode-changed', onMode);

    const onHalted = (event: { reason?: string }) => {
      syncTradingHalt(true, event?.reason || 'UNKNOWN');
    };
    const onResumed = () => {
      syncTradingHalt(false, null);
    };
    socket.on('trading-halted', onHalted);
    socket.on('trading-resumed', onResumed);

    const unsubMarket = binanceTickerWS.onStatusChange((connected) => {
      setMarketOk(connected);
    });
    binanceTickerWS.connect();

    return () => {
      cancelled = true;
      clearInterval(interval);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('trading-mode-changed', onMode);
      socket.off('trading-halted', onHalted);
      socket.off('trading-resumed', onResumed);
      unsubMarket();
    };
  }, [syncTradingHalt]);

  const lamps: Lamp[] = [
    { key: 'api', label: 'Backend API', ok: apiOk },
    { key: 'ws', label: 'Socket.IO', ok: socketOk },
    { key: 'mkt', label: 'Market data', ok: marketOk },
  ];

  const exchangeOk = tradingMode === 'paper' || tradingMode === 'live';

  return (
    <div className="flex items-center gap-2" aria-label="Connection status">
      {lamps.map((lamp) => (
        <span
          key={lamp.key}
          className={`w-2 h-2 rounded-full shrink-0 ${
            lamp.ok ? 'bg-emerald-400' : 'bg-red-400'
          }`}
          title={`${lamp.label}: ${lamp.ok ? 'Connected' : 'Disconnected'}`}
          aria-label={`${lamp.label}: ${lamp.ok ? 'Connected' : 'Disconnected'}`}
        />
      ))}
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          exchangeOk
            ? tradingMode === 'live'
              ? 'bg-red-400'
              : 'bg-amber-400'
            : 'bg-red-400'
        }`}
        title={`Exchange: ${tradingMode === 'live' ? 'LIVE mainnet' : 'Paper testnet'}`}
        aria-label={`Exchange: ${tradingMode}`}
      />
    </div>
  );
}
