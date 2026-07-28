'use client';

import Link from 'next/link';
import { ArrowRight, List, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import PriceFlash from '@/components/ui/PriceFlash';
import type { TickerData } from '@/services/binance-ws';

type SymbolItem = {
  id: string;
  symbol: string;
  isActive: boolean;
};

type WatchlistSummaryProps = {
  symbols: SymbolItem[];
  tickers: Record<string, TickerData>;
  loading?: boolean;
  maxItems?: number;
  onViewAll?: () => void;
};

function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price === 0) return '--';
  if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

function getCryptoIconUrl(symbol: string): string {
  const base = symbol.replace('USDT', '').toLowerCase();
  return `https://assets.coincap.io/assets/icons/${base}@2x.png`;
}

export default function WatchlistSummary({
  symbols,
  tickers,
  loading = false,
  maxItems = 6,
  onViewAll,
}: WatchlistSummaryProps) {
  const items = symbols.slice(0, maxItems);

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6 h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
            <List className="w-4 h-4 text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Watchlist</h2>
            <p className="text-[10px] text-slate-500">
              {symbols.length} symbol{symbols.length === 1 ? '' : 's'} monitored
            </p>
          </div>
        </div>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300 font-medium"
          >
            View all
            <ArrowRight className="w-3 h-3" />
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10">
          <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && symbols.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <List className="w-7 h-7 text-slate-700 mb-2" />
          <p className="text-xs text-slate-500">No symbols monitored yet</p>
          <p className="text-[10px] text-slate-600 mt-1">Add a coin to start watching live prices</p>
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-1">
          {items.map((item) => {
            const ticker = tickers[item.symbol];
            const lastPrice = ticker?.lastPrice ?? 0;
            const changePct = ticker?.priceChangePercent ?? 0;
            const isPositive = changePct >= 0;
            const changeColor = isPositive ? 'text-emerald-400' : 'text-red-400';

            return (
              <Link
                key={item.id}
                href={`/dashboard/${item.symbol}`}
                className="flex items-center justify-between gap-3 px-2 py-2 rounded-lg hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <img
                    src={getCryptoIconUrl(item.symbol)}
                    alt=""
                    className="w-5 h-5 rounded-full shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${item.symbol.charAt(0)}&background=1e293b&color=94a3b8&size=20`;
                    }}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">
                      {item.symbol.replace('USDT', '')}
                      <span className="text-slate-500 font-normal ml-1">/USDT</span>
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <PriceFlash value={lastPrice}>
                    <p className="text-xs font-semibold text-white tabular-nums">
                      ${formatPrice(lastPrice)}
                    </p>
                  </PriceFlash>
                  <div className={`inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums ${changeColor}`}>
                    {changePct > 0 ? (
                      <TrendingUp className="w-2.5 h-2.5" />
                    ) : changePct < 0 ? (
                      <TrendingDown className="w-2.5 h-2.5" />
                    ) : (
                      <Minus className="w-2.5 h-2.5" />
                    )}
                    {changePct >= 0 ? '+' : ''}
                    {changePct.toFixed(2)}%
                  </div>
                </div>
              </Link>
            );
          })}

          {symbols.length > maxItems && onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="w-full mt-2 py-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              +{symbols.length - maxItems} more in full watchlist
            </button>
          )}
        </div>
      )}
    </div>
  );
}
