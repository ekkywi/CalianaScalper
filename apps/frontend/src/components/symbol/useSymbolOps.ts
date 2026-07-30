'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  closePosition,
  fetchMlPredictions,
  fetchPositions,
  fetchTradeHistory,
} from '@/services/api-extended';
import { fetchStrategyPairs, type StrategyPairStatus } from '@/services/api-strategy';
import { socket } from '@/services/socket';

export type SymbolPosition = {
  symbol: string;
  side: 'LONG';
  entryPrice: number;
  quantity: number;
  unrealizedPnL: number;
  stopLoss: number;
  takeProfit: number;
  entryTime?: number;
};

export type SymbolPrediction = {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  timestamp: number;
  raw?: {
    regime?: string;
    regime_reason?: string;
    algorithm?: string;
  };
};

export type SymbolTrade = {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  closeReason: string;
  closeTime: number;
  entryTime?: number;
};

export type SymbolOpsState = {
  pair: StrategyPairStatus | null;
  position: SymbolPosition | null;
  prediction: SymbolPrediction | null;
  trades: SymbolTrade[];
  loading: boolean;
  error: string | null;
  closing: boolean;
  reload: () => Promise<void>;
  handleClose: () => Promise<void>;
};

export function useSymbolOps(symbol: string): SymbolOpsState {
  const [pair, setPair] = useState<StrategyPairStatus | null>(null);
  const [position, setPosition] = useState<SymbolPosition | null>(null);
  const [prediction, setPrediction] = useState<SymbolPrediction | null>(null);
  const [trades, setTrades] = useState<SymbolTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const [pairsRes, positionsRes, predsRes, tradesRes] = await Promise.all([
        fetchStrategyPairs(),
        fetchPositions(),
        fetchMlPredictions(),
        fetchTradeHistory({ symbol, limit: 8 }),
      ]);

      const pairs: StrategyPairStatus[] = Array.isArray(pairsRes?.pairs)
        ? pairsRes.pairs
        : [];
      setPair(pairs.find((p) => p.symbol === symbol) ?? null);

      const positions: SymbolPosition[] = Array.isArray(positionsRes)
        ? positionsRes
        : [];
      setPosition(positions.find((p) => p.symbol === symbol) ?? null);

      const preds: SymbolPrediction[] = Array.isArray(predsRes?.predictions)
        ? predsRes.predictions
        : [];
      setPrediction(preds.find((p) => p.symbol === symbol) ?? null);

      setTrades(Array.isArray(tradesRes) ? tradesRes : []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load symbol ops');
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    setLoading(true);
    reload();

    const onChange = () => reload();
    socket.on('position-opened', onChange);
    socket.on('position-closed', onChange);

    const interval = setInterval(reload, 15000);
    return () => {
      socket.off('position-opened', onChange);
      socket.off('position-closed', onChange);
      clearInterval(interval);
    };
  }, [reload]);

  const handleClose = useCallback(async () => {
    setClosing(true);
    setError(null);
    try {
      await closePosition(symbol);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to close ${symbol}`);
    } finally {
      setClosing(false);
    }
  }, [symbol, reload]);

  return {
    pair,
    position,
    prediction,
    trades,
    loading,
    error,
    closing,
    reload,
    handleClose,
  };
}
