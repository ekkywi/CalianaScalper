'use client';
import { useEffect, useState, useCallback } from 'react';
import { fetchSymbols, deleteSymbol } from '@/services/api';
import { deleteMlModel } from '@/services/api-extended';
import { deleteStrategyModel, fetchStrategyModels } from '@/services/api-strategy';
import { fetchMultiple24hrTickers } from '@/services/binance-rest';
import { binanceTickerWS, TickerData } from '@/services/binance-ws';
import { socket } from '@/services/socket';
import AddSymbolModal from '@/components/watchlist/AddSymbolModal';
import PriceFlash from '@/components/ui/PriceFlash';
import RealTimePnL from '@/components/monitoring/RealTimePnL';
import CriticalStatusStrip from '@/components/layout/CriticalStatusStrip';
import WatchlistSummary from '@/components/watchlist/WatchlistSummary';
import DailyRiskPulse from '@/components/monitoring/DailyRiskPulse';
import OverviewPerformanceSummary from '@/components/monitoring/OverviewPerformanceSummary';
import OverviewMlSummary from '@/components/monitoring/OverviewMlSummary';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Link from 'next/link';
import {
  Trash2, TrendingUp, TrendingDown, Minus, ExternalLink, Shield,
  BarChart3, Brain, Activity, Bell, ArrowRight,
} from 'lucide-react';

interface SymbolItem {
  id: string;
  symbol: string;
  isActive: boolean;
}

interface TickerMap {
  [symbol: string]: TickerData;
}

function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price === 0) return '0.00';
  if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

function formatVolume(volume: number): string {
  if (!Number.isFinite(volume) || volume === 0) return '0.00';
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(2)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(2)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(2)}K`;
  return volume.toFixed(2);
}

function formatMarketCap(quoteVolume: number, lastPrice: number): string {
  if (!Number.isFinite(quoteVolume) || quoteVolume === 0 || !Number.isFinite(lastPrice)) return '--';
  const cap = quoteVolume * 2;
  if (cap >= 1_000_000_000_000) return `$${(cap / 1_000_000_000_000).toFixed(2)}T`;
  if (cap >= 1_000_000_000) return `$${(cap / 1_000_000_000).toFixed(2)}B`;
  if (cap >= 1_000_000) return `$${(cap / 1_000_000).toFixed(2)}M`;
  return `$${cap.toFixed(0)}`;
}

function getCryptoIconUrl(symbol: string): string {
  const base = symbol.replace('USDT', '').toLowerCase();
  return `https://assets.coincap.io/assets/icons/${base}@2x.png`;
}

const QUICK_LINKS = [
  { href: '/dashboard/risk', label: 'Risk', icon: Shield },
  { href: '/dashboard/performance', label: 'Performance', icon: BarChart3 },
  { href: '/dashboard/ml-models', label: 'ML Models', icon: Brain },
  { href: '/dashboard/ml-predictions', label: 'Predictions', icon: TrendingUp },
  { href: '/dashboard/notifications', label: 'Alerts', icon: Bell },
  { href: '/dashboard/health', label: 'Health', icon: Activity },
];

export default function DashboardPage() {
  const [symbols, setSymbols] = useState<SymbolItem[]>([]);
  const [tickers, setTickers] = useState<TickerMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'watchlist' | 'overview'>('overview');
  const [deleteTarget, setDeleteTarget] = useState<SymbolItem | null>(null);
  const [alsoDeleteMl, setAlsoDeleteMl] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const data = await fetchSymbols();
      setSymbols(data);
      return data;
    } catch (err) {
      console.error(err);
      return [];
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const data = await loadData();
      if (data.length > 0) {
        try {
          const symbolsList = data.map((s: SymbolItem) => s.symbol);
          const tickerData = await fetchMultiple24hrTickers(symbolsList);
          const tickerMap: TickerMap = {};
          tickerData.forEach((t: any) => {
            tickerMap[t.s] = {
              symbol: t.s,
              lastPrice: parseFloat(t.c),
              priceChange: parseFloat(t.p),
              priceChangePercent: parseFloat(t.P),
              high24h: parseFloat(t.h),
              low24h: parseFloat(t.l),
              volume24h: parseFloat(t.v),
              quoteVolume24h: parseFloat(t.q),
            };
          });
          setTickers(tickerMap);
        } catch (err) {
          console.error('Failed to fetch initial tickers:', err);
        }
      }
      setLoading(false);
    };
    init();
  }, [loadData]);

  useEffect(() => {
    const handleTicker = (ticker: TickerData) => {
      setTickers((prev) => ({ ...prev, [ticker.symbol]: ticker }));
    };
    const unsubFunctions: (() => void)[] = [];
    symbols.forEach((item) => {
      const unsub = binanceTickerWS.subscribe(item.symbol, handleTicker);
      unsubFunctions.push(unsub);
    });
    binanceTickerWS.connect();
    return () => {
      unsubFunctions.forEach((fn) => fn());
    };
  }, [symbols]);

  useEffect(() => {
    const onPrice = (data: { symbol: string; close: number }) => {
      setTickers((prev) => {
        const existing = prev[data.symbol];
        if (existing) {
          return { ...prev, [data.symbol]: { ...existing, lastPrice: data.close } };
        }
        return prev;
      });
    };
    socket.on('realtime-price', onPrice);
    return () => { socket.off('realtime-price', onPrice); };
  }, []);

  const openDeleteDialog = (item: SymbolItem) => {
    setDeleteTarget(item);
    setAlsoDeleteMl(false);
    setDeleteError(null);
  };

  const confirmWatchlistDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteSymbol(target.id);
      setDeleteTarget(null);
      setAlsoDeleteMl(false);
      if (alsoDeleteMl) {
        try {
          const { models } = await fetchStrategyModels(target.symbol);
          for (const m of models) {
            await deleteStrategyModel(m.id);
          }
          // Clear any leftover hot artifact if library was already empty
          await deleteMlModel(target.symbol).catch(() => undefined);
        } catch (err: any) {
          setDeleteError(
            err?.message ||
              `Watchlist removed, but ML model delete failed for ${target.symbol}`,
          );
        }
      }
      await loadData();
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to remove symbol from watchlist');
    } finally {
      setDeleteBusy(false);
    }
  };

  const getChangeIcon = (changePercent: number) => {
    if (changePercent > 0) return <TrendingUp className="w-3 h-3" />;
    if (changePercent < 0) return <TrendingDown className="w-3 h-3" />;
    return <Minus className="w-3 h-3" />;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0a0a0f]/95 backdrop-blur-sm border-b border-slate-800/50">
        <div className="px-4 lg:px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base lg:text-lg font-semibold text-white tracking-tight">Dashboard</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {symbols.length} {symbols.length === 1 ? 'symbol' : 'symbols'} monitored
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800">
              <button
                onClick={() => setActiveTab('overview')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeTab === 'overview' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Overview
              </button>
              <button
                onClick={() => setActiveTab('watchlist')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeTab === 'watchlist' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Watchlist
              </button>
            </div>
            <AddSymbolModal onAdded={loadData} />
          </div>
        </div>
      </div>

      <div className="px-4 lg:px-6 py-4 space-y-6">
        {activeTab === 'overview' ? (
          <>
            <CriticalStatusStrip />

            {/* Critical: PnL + Watchlist summary above the fold */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RealTimePnL />
              <WatchlistSummary
                symbols={symbols}
                tickers={tickers}
                loading={loading}
                onViewAll={() => setActiveTab('watchlist')}
              />
            </div>

            <DailyRiskPulse />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <OverviewPerformanceSummary />
              <OverviewMlSummary />
            </div>

            {/* Compact secondary links — not above the fold */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/50">
              <span className="text-[10px] text-slate-600 uppercase tracking-wider mr-1">More</span>
              {QUICK_LINKS.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-white bg-slate-900/50 border border-slate-800/50 rounded-lg hover:border-slate-700 transition-colors"
                  >
                    <Icon className="w-3 h-3" />
                    {link.label}
                    <ArrowRight className="w-2.5 h-2.5 opacity-50" />
                  </Link>
                );
              })}
            </div>
          </>
        ) : (
          /* Watchlist Table */
          <div className="overflow-x-auto custom-scrollbar">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-slate-500">Memuat data...</p>
                </div>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center py-20">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            ) : symbols.length === 0 ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <p className="text-sm text-slate-500 mb-2">Belum ada simbol yang dipantau</p>
                  <p className="text-xs text-slate-600">Klik tombol "+ Tambah Koin" untuk mulai memantau</p>
                </div>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-800/50">
                    <th className="text-left py-3 pr-4 text-slate-500 font-medium text-[11px] uppercase tracking-wider">Simbol</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-medium text-[11px] uppercase tracking-wider">Harga Terkini</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-medium text-[11px] uppercase tracking-wider">24j Perubahan</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-medium text-[11px] uppercase tracking-wider">Volume 24j</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-medium text-[11px] uppercase tracking-wider">High 24j</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-medium text-[11px] uppercase tracking-wider">Low 24j</th>
                    <th className="text-right py-3 px-4 text-slate-500 font-medium text-[11px] uppercase tracking-wider">Market Cap</th>
                    <th className="text-right py-3 pl-4 text-slate-500 font-medium text-[11px] uppercase tracking-wider">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {symbols.map((item) => {
                    const ticker = tickers[item.symbol];
                    const lastPrice = ticker?.lastPrice ?? 0;
                    const priceChange = ticker?.priceChange ?? 0;
                    const priceChangePercent = ticker?.priceChangePercent ?? 0;
                    const high24h = ticker?.high24h ?? 0;
                    const low24h = ticker?.low24h ?? 0;
                    const volume24h = ticker?.volume24h ?? 0;
                    const quoteVolume24h = ticker?.quoteVolume24h ?? 0;
                    const isPositive = priceChangePercent >= 0;
                    const changeColor = isPositive ? 'text-emerald-400' : 'text-red-400';
                    const bgChange = isPositive ? 'bg-emerald-500/10' : 'bg-red-500/10';

                    return (
                      <tr key={item.id} className="border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors group">
                        <td className="py-3 pr-4">
                          <Link href={`/dashboard/${item.symbol}`} className="flex items-center gap-2.5">
                            <img
                              src={getCryptoIconUrl(item.symbol)}
                              alt={item.symbol}
                              className="w-6 h-6 rounded-full"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${item.symbol.charAt(0)}&background=1e293b&color=94a3b8&size=24`;
                              }}
                            />
                            <div>
                              <span className="text-sm font-medium text-white">{item.symbol.replace('USDT', '')}</span>
                              <span className="text-[10px] text-slate-500 ml-1.5 font-mono">/USDT</span>
                            </div>
                          </Link>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <PriceFlash value={lastPrice}>
                            <span className="text-sm font-semibold text-white tabular-nums">${formatPrice(lastPrice)}</span>
                          </PriceFlash>
                        </td>
                        <td className={`py-3 px-4 text-right ${changeColor}`}>
                          <PriceFlash value={priceChange}>
                            <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium ${bgChange}`}>
                              {getChangeIcon(priceChangePercent)}
                              <span className="tabular-nums">{priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%</span>
                            </div>
                          </PriceFlash>
                          <div className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                            {priceChange >= 0 ? '+' : ''}${Math.abs(priceChange).toFixed(2)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-xs text-slate-300 tabular-nums">${formatVolume(volume24h)}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-xs text-slate-300 tabular-nums">${formatPrice(high24h)}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-xs text-slate-300 tabular-nums">${formatPrice(low24h)}</span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-xs text-slate-300 tabular-nums">{formatMarketCap(quoteVolume24h, lastPrice)}</span>
                        </td>
                        <td className="py-3 pl-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/dashboard/${item.symbol}`} className="p-1.5 rounded text-slate-600 hover:text-sky-400 hover:bg-sky-500/10 transition-colors" title="Buka Grafik">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                            <button onClick={() => openDeleteDialog(item)} className="p-1.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Hapus">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Remove ${deleteTarget?.symbol || ''} from watchlist?`}
        description="Stops monitoring this symbol on the dashboard. ML model files are kept unless you opt in below."
        confirmLabel="Remove"
        variant="danger"
        loading={deleteBusy}
        onConfirm={confirmWatchlistDelete}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteTarget(null);
            setAlsoDeleteMl(false);
            setDeleteError(null);
          }
        }}
      >
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={alsoDeleteMl}
            onChange={(e) => setAlsoDeleteMl(e.target.checked)}
            disabled={deleteBusy}
            className="mt-0.5 rounded border-slate-600 bg-slate-800 text-sky-500 focus:ring-sky-500/40"
          />
          <span className="text-xs text-slate-300 leading-relaxed">
            Also delete ML model files for{' '}
            <span className="font-mono text-slate-200">{deleteTarget?.symbol}</span>
          </span>
        </label>
        {deleteError && (
          <p className="text-xs text-red-400 mt-2">{deleteError}</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
