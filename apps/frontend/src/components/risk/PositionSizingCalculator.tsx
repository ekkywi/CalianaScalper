// apps/frontend/src/components/risk/PositionSizingCalculator.tsx
// Kalkulator visual untuk menghitung ukuran posisi ideal

'use client';

import { useState, useMemo } from 'react';
import { Calculator, DollarSign, Percent, Target } from 'lucide-react';
import { formatUSD } from '@/lib/utils';

export default function PositionSizingCalculator() {
  const [accountBalance, setAccountBalance] = useState(10000);
  const [riskPercent, setRiskPercent] = useState(2);
  const [stopLossDistance, setStopLossDistance] = useState(3);
  const [entryPrice, setEntryPrice] = useState(50000);

  const positionSize = useMemo(() => {
    const riskAmount = accountBalance * (riskPercent / 100);
    const slPriceDistance = entryPrice * (stopLossDistance / 100);
    if (slPriceDistance <= 0) return 0;
    return riskAmount / slPriceDistance;
  }, [accountBalance, riskPercent, stopLossDistance, entryPrice]);

  const riskAmount = accountBalance * (riskPercent / 100);
  const positionValue = positionSize * entryPrice;
  const riskRatio = riskPercent / stopLossDistance;

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <Calculator className="w-4 h-4 text-blue-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">Position Sizing Calculator</h2>
          <p className="text-[10px] text-slate-500">Calculate ideal position size based on risk</p>
        </div>
      </div>

      {/* Input Fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Account Balance (USDT)</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="number"
              value={accountBalance}
              onChange={(e) => setAccountBalance(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 text-white pl-9 pr-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Risk Per Trade (%)</label>
          <div className="relative">
            <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="number"
              value={riskPercent}
              onChange={(e) => setRiskPercent(Number(e.target.value))}
              step={0.1}
              min={0.1}
              max={100}
              className="w-full bg-slate-800 border border-slate-700 text-white pl-9 pr-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Stop Loss Distance (%)</label>
          <div className="relative">
            <Target className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="number"
              value={stopLossDistance}
              onChange={(e) => setStopLossDistance(Number(e.target.value))}
              step={0.1}
              min={0.1}
              className="w-full bg-slate-800 border border-slate-700 text-white pl-9 pr-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400 mb-1.5 block">Entry Price (USDT)</label>
          <div className="relative">
            <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="number"
              value={entryPrice}
              onChange={(e) => setEntryPrice(Number(e.target.value))}
              className="w-full bg-slate-800 border border-slate-700 text-white pl-9 pr-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ResultBox label="Position Size" value={`${positionSize.toFixed(6)}`} sub={`${formatUSD(positionValue)}`} color="text-emerald-400" />
        <ResultBox label="Risk Amount" value={formatUSD(riskAmount)} color="text-red-400" />
        <ResultBox label="Risk/Reward Ratio" value={riskRatio.toFixed(2)} sub="per 1% SL" color="text-blue-400" />
        <ResultBox label="SL Price" value={formatUSD(entryPrice * (1 - stopLossDistance / 100))} color="text-amber-400" />
      </div>

      {/* Visual Gauge */}
      <div className="mt-4 p-3 bg-slate-800/50 rounded-lg">
        <div className="flex justify-between text-[10px] text-slate-500 mb-1.5">
          <span>Risk Gauge</span>
          <span className={riskPercent > 5 ? 'text-red-400' : riskPercent > 2 ? 'text-amber-400' : 'text-emerald-400'}>
            {riskPercent <= 2 ? 'Conservative' : riskPercent <= 5 ? 'Moderate' : 'Aggressive'}
          </span>
        </div>
        <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              riskPercent <= 2 ? 'bg-emerald-500' : riskPercent <= 5 ? 'bg-amber-500' : 'bg-red-500'
            }`}
            style={{ width: `${Math.min(riskPercent * 10, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function ResultBox({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-sm font-semibold font-mono ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  );
}