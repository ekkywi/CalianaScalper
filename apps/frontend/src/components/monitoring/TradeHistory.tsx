// apps/frontend/src/components/monitoring/TradeHistory.tsx
// Tabel riwayat trade lengkap dengan filter

'use client';

import { useState } from 'react';
import { Search, Download, Filter, ChevronDown } from 'lucide-react';
import { formatUSD, formatDate, getChangeColor } from '@/lib/utils';

const MOCK_TRADES = Array.from({ length: 50 }, (_, i) => ({
  id: `trade-${i}`,
  symbol: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT'][Math.floor(Math.random() * 4)],
  side: Math.random() > 0.5 ? 'buy' : 'sell' as 'buy' | 'sell',
  entryPrice: Math.random() * 50000 + 100,
  exitPrice: Math.random() * 50000 + 100,
  quantity: Math.random() * 10,
  pnl: (Math.random() - 0.4) * 500,
  timestamp: Date.now() / 1000 - Math.random() * 86400 * 30,
  status: Math.random() > 0.1 ? 'FILLED' : 'CANCELED',
}));

export default function TradeHistory() {
  const [search, setSearch] = useState('');
  const [filterSide, setFilterSide] = useState<'all' | 'buy' | 'sell'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'pnl'>('date');

  const filtered = MOCK_TRADES
    .filter((t) => t.symbol.includes(search.toUpperCase()))
    .filter((t) => filterSide === 'all' || t.side === filterSide)
    .sort((a, b) => sortBy === 'date' ? b.timestamp - a.timestamp : b.pnl - a.pnl);

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
            <Download className="w-4 h-4 text-purple-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Trade History</h2>
            <p className="text-[10px] text-slate-500">{MOCK_TRADES.length} trades recorded</p>
          </div>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors">
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search symbol..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 text-white pl-9 pr-3 py-1.5 rounded-lg text-xs focus:outline-none focus:border-blue-500"
          />
        </div>
        <select
          value={filterSide}
          onChange={(e) => setFilterSide(e.target.value as any)}
          className="bg-slate-800 border border-slate-700 text-white px-2.5 py-1.5 rounded-lg text-xs focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Sides</option>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="bg-slate-800 border border-slate-700 text-white px-2.5 py-1.5 rounded-lg text-xs focus:outline-none focus:border-blue-500"
        >
          <option value="date">Date</option>
          <option value="pnl">P&L</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800/50">
              <th className="text-left py-2 pr-3 text-slate-500 font-medium text-[10px] uppercase tracking-wider">Date</th>
              <th className="text-left py-2 px-3 text-slate-500 font-medium text-[10px] uppercase tracking-wider">Symbol</th>
              <th className="text-center py-2 px-3 text-slate-500 font-medium text-[10px] uppercase tracking-wider">Side</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium text-[10px] uppercase tracking-wider">Entry</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium text-[10px] uppercase tracking-wider">Exit</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium text-[10px] uppercase tracking-wider">Qty</th>
              <th className="text-right py-2 px-3 text-slate-500 font-medium text-[10px] uppercase tracking-wider">P&L</th>
              <th className="text-center py-2 pl-3 text-slate-500 font-medium text-[10px] uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 20).map((trade) => (
              <tr key={trade.id} className="border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors">
                <td className="py-2.5 pr-3 text-slate-400 font-mono text-[10px]">{formatDate(trade.timestamp)}</td>
                <td className="py-2.5 px-3 text-white font-medium">{trade.symbol.replace('USDT', '')}<span className="text-slate-500">/USDT</span></td>
                <td className="py-2.5 px-3 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    trade.side === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {trade.side.toUpperCase()}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-300">{formatUSD(trade.entryPrice)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-300">{formatUSD(trade.exitPrice)}</td>
                <td className="py-2.5 px-3 text-right font-mono text-slate-300">{trade.quantity.toFixed(4)}</td>
                <td className={`py-2.5 px-3 text-right font-mono font-medium ${getChangeColor(trade.pnl)}`}>
                  {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                </td>
                <td className="py-2.5 pl-3 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    trade.status === 'FILLED' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-400'
                  }`}>
                    {trade.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 20 && (
        <p className="text-center text-[10px] text-slate-500 mt-3">
          Showing 20 of {filtered.length} trades
        </p>
      )}
    </div>
  );
}