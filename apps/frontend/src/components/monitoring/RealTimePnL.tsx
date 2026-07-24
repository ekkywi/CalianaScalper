// apps/frontend/src/components/monitoring/RealTimePnL.tsx
// Widget P&L real-time untuk posisi terbuka

'use client';

import { useAppStore } from '@/store/app-store';
import { formatUSD, formatPercent, getChangeColor } from '@/lib/utils';
import { TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

const MOCK_POSITIONS = [
  { symbol: 'BTCUSDT', side: 'LONG' as const, entryPrice: 67450, markPrice: 68230, quantity: 0.15, pnl: 117.00, pnlPercent: 1.16, liquidationPrice: 52100 },
  { symbol: 'SOLUSDT', side: 'LONG' as const, entryPrice: 145.20, markPrice: 142.80, quantity: 5, pnl: -12.00, pnlPercent: -1.65, liquidationPrice: 112.00 },
];

export default function RealTimePnL() {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Real-Time P&L</h2>
          <p className="text-[10px] text-slate-500">Open positions tracker</p>
        </div>
      </div>

      <div className="space-y-3">
        {MOCK_POSITIONS.map((pos) => {
          const isPositive = pos.pnl >= 0;
          return (
            <div key={pos.symbol} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{pos.symbol.replace('USDT', '')}</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-medium">{pos.side}</span>
                </div>
                <div className={`text-right ${getChangeColor(pos.pnl)}`}>
                  <p className="text-sm font-bold font-mono">{isPositive ? '+' : ''}{pos.pnl.toFixed(2)}</p>
                  <p className="text-[10px] font-mono">{isPositive ? '+' : ''}{pos.pnlPercent.toFixed(2)}%</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-500">Entry</span>
                  <p className="text-slate-300 font-mono">{formatUSD(pos.entryPrice)}</p>
                </div>
                <div>
                  <span className="text-slate-500">Mark</span>
                  <p className="text-slate-300 font-mono">{formatUSD(pos.markPrice)}</p>
                </div>
                <div>
                  <span className="text-slate-500">Qty</span>
                  <p className="text-slate-300 font-mono">{pos.quantity}</p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span className="text-[10px] text-amber-400">Liq: {formatUSD(pos.liquidationPrice)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}