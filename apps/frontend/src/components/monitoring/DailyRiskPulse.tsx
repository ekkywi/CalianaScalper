'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Shield, RefreshCw } from 'lucide-react';
import {
  fetchExchangeOpenOrders,
  fetchRiskStatus,
} from '@/services/api-extended';
import { formatUSD } from '@/lib/utils';

type RiskStatus = {
  halted?: boolean;
  openPositions?: number;
  dailyStats?: {
    date?: string;
    trades?: number;
    loss?: number;
    peakBalance?: number;
  };
  riskConfig?: {
    maxTradesPerDay?: number;
    maxDailyLossPercent?: number;
  };
};

function safeNum(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Compact risk pulse for dashboard overview.
 * Read-only — no config mutation (avoids accidental risk changes).
 */
export default function DailyRiskPulse() {
  const [status, setStatus] = useState<RiskStatus | null>(null);
  const [openOrders, setOpenOrders] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [risk, orders] = await Promise.all([
        fetchRiskStatus(),
        fetchExchangeOpenOrders().catch(() => null),
      ]);
      setStatus(risk && typeof risk === 'object' ? risk : null);
      setOpenOrders(Array.isArray(orders) ? orders.length : null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load risk status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const trades = safeNum(status?.dailyStats?.trades);
  const maxTrades = safeNum(status?.riskConfig?.maxTradesPerDay) || 0;
  const dailyLoss = safeNum(status?.dailyStats?.loss);
  const peak = safeNum(status?.dailyStats?.peakBalance);
  const maxLossPct = safeNum(status?.riskConfig?.maxDailyLossPercent);
  const lossLimit = peak > 0 && maxLossPct > 0 ? peak * maxLossPct : 0;
  const lossNearLimit = lossLimit > 0 && dailyLoss / lossLimit >= 0.8;
  const tradesNearLimit = maxTrades > 0 && trades / maxTrades >= 0.8;
  const halted = Boolean(status?.halted);

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-xs font-medium text-white">Risk pulse</span>
          {halted && (
            <span className="text-[10px] font-medium text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
              HALTED
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/risk" className="text-[10px] text-sky-400 hover:text-sky-300">
            Risk settings
          </Link>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800"
            title="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="text-[10px] text-red-400 mt-2">{error}</p>}

      {!error && (
        <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Trades today</p>
            <p
              className={`text-xs font-semibold font-mono tabular-nums ${
                tradesNearLimit ? 'text-amber-400' : 'text-white'
              }`}
            >
              {status ? `${trades}${maxTrades > 0 ? ` / ${maxTrades}` : ''}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Daily loss</p>
            <p
              className={`text-xs font-semibold font-mono tabular-nums ${
                lossNearLimit ? 'text-amber-400' : dailyLoss > 0 ? 'text-red-400' : 'text-white'
              }`}
            >
              {status
                ? `${formatUSD(dailyLoss).replace('$', '')}${
                    lossLimit > 0 ? ` / ${formatUSD(lossLimit).replace('$', '')}` : ''
                  }`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Open orders</p>
            <p className="text-xs font-semibold font-mono tabular-nums text-white">
              {openOrders == null ? 'N/A' : openOrders}
              <Link
                href="/dashboard/orders"
                className="ml-1.5 text-[10px] font-normal text-sky-400 hover:text-sky-300"
              >
                Orders
              </Link>
            </p>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Ledger positions</p>
            <p className="text-xs font-semibold font-mono tabular-nums text-white">
              {status?.openPositions != null ? status.openPositions : '—'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
