// apps/frontend/src/components/emergency/PositionManagementPanel.tsx
// Panel untuk mengelola posisi terbuka

'use client';

import { useState } from 'react';
import { X, SlidersHorizontal, AlertTriangle, Target } from 'lucide-react';
import { formatUSD, getChangeColor } from '@/lib/utils';

const MOCK_OPEN_POSITIONS = [
  { symbol: 'BTCUSDT', side: 'LONG' as const, entryPrice: 67450, markPrice: 68230, quantity: 0.15, pnl: 117.00, pnlPercent: 1.16, stopLoss: 64500, takeProfit: 71000 },
  { symbol: 'SOLUSDT', side: 'LONG' as const, entryPrice: 145.20, markPrice: 142.80, quantity: 5, pnl: -12.00, pnlPercent: -1.65, stopLoss: 138.00, takeProfit: 155.00 },
];

export default function PositionManagementPanel() {
  const [closing, setClosing] = useState<string | null>(null);
  const [showSlTp, setShowSlTp] = useState<string | null>(null);

  const handleClose = async (symbol: string) => {
    setClosing(symbol);
    await new Promise((r) => setTimeout(r, 500));
    setClosing(null);
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Target className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Position Management</h2>
            <p className="text-[10px] text-slate-500">{MOCK_OPEN_POSITIONS.length} open positions</p>
          </div>
        </div>
        <button className="text-xs text-red-400 hover:text-red-300 font-medium px-2.5 py-1.5 bg-red-500/10 rounded-lg transition-colors">
          Close All
        </button>
      </div>

      <div className="space-y-3">
        {MOCK_OPEN_POSITIONS.map((pos) => {
          const isPositive = pos.pnl >= 0;
          return (
            <div key={pos.symbol} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{pos.symbol.replace('USDT', '')}</span>
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-medium">{pos.side}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setShowSlTp(showSlTp === pos.symbol ? null : pos.symbol)}
                    className="p-1 rounded text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleClose(pos.symbol)}
                    disabled={closing === pos.symbol}
                    className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-[10px] mb-2">
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
                <div className={`text-right ${getChangeColor(pos.pnl)}`}>
                  <span className="text-slate-500">P&L</span>
                  <p className="font-mono font-medium">{isPositive ? '+' : ''}{pos.pnl.toFixed(2)}</p>
                </div>
              </div>

              {/* SL/TP Adjustment */}
              {showSlTp === pos.symbol && (
                <div className="mt-2 p-2.5 bg-slate-900/50 rounded-lg border border-slate-700/50 space-y-2">
                  <div>
                    <label className="text-[10px] text-slate-500">Stop Loss</label>
                    <input
                      type="number"
                      defaultValue={pos.stopLoss}
                      className="w-full bg-slate-800 border border-slate-700 text-white px-2 py-1 rounded text-xs font-mono mt-0.5 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500">Take Profit</label>
                    <input
                      type="number"
                      defaultValue={pos.takeProfit}
                      className="w-full bg-slate-800 border border-slate-700 text-white px-2 py-1 rounded text-xs font-mono mt-0.5 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <button className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded transition-colors">
                    Update SL/TP
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}