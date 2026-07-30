'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  createChart,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  CandlestickData,
  UTCTimestamp,
  LineData,
  LineStyle,
} from 'lightweight-charts';
import { fetchKlines, fetch24hrTicker } from '@/services/binance-rest';
import type { KlineData } from '@/services/binance-rest';
import { binanceTickerWS, type TickerData } from '@/services/binance-ws';
import { socket } from '@/services/socket';
import PriceFlash from '@/components/ui/PriceFlash';
import SymbolOpsPanel from '@/components/symbol/SymbolOpsPanel';
import { useSymbolOps } from '@/components/symbol/useSymbolOps';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';

const TIMEFRAMES = [
  { label: '1m', value: '1m' },
  { label: '5m', value: '5m' },
  { label: '15m', value: '15m' },
  { label: '30m', value: '30m' },
  { label: '1h', value: '1h' },
  { label: '4h', value: '4h' },
  { label: '1D', value: '1d' },
  { label: '1W', value: '1w' },
  { label: '⚡Ticker', value: 'ticker' },
];

const INDICATORS = [
  { label: 'MA 7', value: 'ma7', color: '#f59e0b' },
  { label: 'MA 25', value: 'ma25', color: '#8b5cf6' },
  { label: 'EMA 12', value: 'ema12', color: '#06b6d4' },
];

function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price === 0) return '0.00';
  if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

function calculateMA(data: CandlestickData[], period: number): (LineData | null)[] {
  const result: (LineData | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    let count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (Number.isFinite(data[j].close)) {
        sum += data[j].close;
        count++;
      }
    }
    result.push({
      time: data[i].time,
      value: count > 0 ? sum / count : 0,
    });
  }
  return result;
}

function calculateEMA(data: CandlestickData[], period: number): (LineData | null)[] {
  const result: (LineData | null)[] = [];
  const multiplier = 2 / (period + 1);
  let ema = data[0]?.close ?? 0;
  if (!Number.isFinite(ema)) ema = 0;

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push({ time: data[i].time, value: ema });
      continue;
    }
    const close = Number.isFinite(data[i].close) ? data[i].close : ema;
    ema = (close - ema) * multiplier + ema;
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

export default function ChartPage() {
  const params = useParams();
  const symbol = (params.symbol as string).toUpperCase();
  const ops = useSymbolOps(symbol);

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const priceLinesRef = useRef<{ entry?: IPriceLine; sl?: IPriceLine; tp?: IPriceLine }>({});
  const klineWsRef = useRef<WebSocket | null>(null);
  const chartAliveRef = useRef(false);
  const activeIndicatorsRef = useRef<Set<string>>(new Set());

  const [timeframe, setTimeframe] = useState('15m');
  const [activeIndicators, setActiveIndicators] = useState<Set<string>>(new Set());
  const [lastPrice, setLastPrice] = useState<number>(0);
  const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
  const [high24h, setHigh24h] = useState<number>(0);
  const [low24h, setLow24h] = useState<number>(0);
  const [volume24h, setVolume24h] = useState<number>(0);
  const [candleData, setCandleData] = useState<CandlestickData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [chartReady, setChartReady] = useState(false);

  activeIndicatorsRef.current = activeIndicators;

  const safeChartCall = useCallback((fn: () => void) => {
    if (!chartAliveRef.current || !chartRef.current) return;
    try {
      fn();
    } catch {
      // Chart/series may already be disposed (Strict Mode / navigation)
    }
  }, []);

  const clearIndicatorSeries = useCallback(() => {
    safeChartCall(() => {
      indicatorSeriesRef.current.forEach((series) => {
        try {
          chartRef.current?.removeSeries(series);
        } catch {
          // ignore disposed series
        }
      });
    });
    indicatorSeriesRef.current.clear();
  }, [safeChartCall]);

  const fetchTickerData = useCallback(async () => {
    try {
      const data = await fetch24hrTicker(symbol);
      setLastPrice(parseFloat(data.c) || 0);
      setPriceChangePercent(parseFloat(data.P) || 0);
      setHigh24h(parseFloat(data.h) || 0);
      setLow24h(parseFloat(data.l) || 0);
      // Prefer quote volume (USDT) so the $ formatting is meaningful
      const quoteVol = parseFloat(data.q);
      setVolume24h(Number.isFinite(quoteVol) && quoteVol > 0 ? quoteVol : parseFloat(data.v) || 0);
    } catch (err) {
      console.error('Failed to fetch ticker data:', err);
    }
  }, [symbol]);

  const applyTickerStats = useCallback((ticker: TickerData) => {
    if (ticker.symbol !== symbol) return;
    if (Number.isFinite(ticker.lastPrice) && ticker.lastPrice > 0) {
      setLastPrice(ticker.lastPrice);
    }
    if (Number.isFinite(ticker.priceChangePercent)) {
      setPriceChangePercent(ticker.priceChangePercent);
    }
    if (Number.isFinite(ticker.high24h) && ticker.high24h > 0) {
      setHigh24h(ticker.high24h);
    }
    if (Number.isFinite(ticker.low24h) && ticker.low24h > 0) {
      setLow24h(ticker.low24h);
    }
    const vol =
      Number.isFinite(ticker.quoteVolume24h) && ticker.quoteVolume24h > 0
        ? ticker.quoteVolume24h
        : ticker.volume24h;
    if (Number.isFinite(vol) && vol > 0) {
      setVolume24h(vol);
    }
  }, [symbol]);

  // Live 24h stats via shared Binance ticker WS (REST often blocked in browser)
  useEffect(() => {
    const unsub = binanceTickerWS.subscribe(symbol, applyTickerStats);
    binanceTickerWS.connect();
    return () => {
      unsub();
    };
  }, [symbol, applyTickerStats]);

  const clearPriceLines = useCallback(() => {
    const series = candleSeriesRef.current;
    if (!series) {
      priceLinesRef.current = {};
      return;
    }
    (['entry', 'sl', 'tp'] as const).forEach((key) => {
      const line = priceLinesRef.current[key];
      if (!line) return;
      try {
        series.removePriceLine(line);
      } catch {
        // disposed
      }
    });
    priceLinesRef.current = {};
  }, []);

  const fetchCandleData = useCallback(async (tf: string) => {
    setIsLoading(true);
    try {
      const actualTf = tf === 'ticker' ? '1m' : tf;
      const data = await fetchKlines(symbol, actualTf, 500);
      const formatted: CandlestickData[] = data.map((k: KlineData) => ({
        time: k.time as UTCTimestamp,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      }));
      setCandleData(formatted);
      return formatted;
    } catch (err) {
      console.error('Failed to fetch klines:', err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [symbol]);

  const updateIndicator = useCallback(
    (indicator: string, data: CandlestickData[]) => {
      if (!chartAliveRef.current || !chartRef.current || data.length === 0) return;

      let indicatorData: (LineData | null)[] = [];
      switch (indicator) {
        case 'ma7':
          indicatorData = calculateMA(data, 7);
          break;
        case 'ma25':
          indicatorData = calculateMA(data, 25);
          break;
        case 'ema12':
          indicatorData = calculateEMA(data, 12);
          break;
        default:
          return;
      }

      const validData = indicatorData.filter((d): d is LineData => d !== null);

      safeChartCall(() => {
        const series = indicatorSeriesRef.current.get(indicator);
        if (series) {
          series.setData(validData);
          return;
        }
        const indConfig = INDICATORS.find((i) => i.value === indicator);
        if (!indConfig || !chartRef.current) return;
        const newSeries = chartRef.current.addLineSeries({
          color: indConfig.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        newSeries.setData(validData);
        indicatorSeriesRef.current.set(indicator, newSeries);
      });
    },
    [safeChartCall],
  );

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Clear leftover DOM nodes from Strict Mode remount
    chartContainerRef.current.replaceChildren();

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#0f172a' },
        textColor: '#94a3b8',
        fontSize: 11,
        fontFamily: 'Geist, Inter, system-ui, sans-serif',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 520,
      crosshair: {
        mode: 0,
        vertLine: {
          color: '#475569',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: '#475569',
          width: 1,
          style: 2,
          labelBackgroundColor: '#1e293b',
        },
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        scaleMargins: { top: 0.05, bottom: 0.25 },
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: { vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
    });

    chartRef.current = chart;
    chartAliveRef.current = true;
    setChartReady(true);

    const handleResize = () => {
      if (!chartAliveRef.current || !chartContainerRef.current) return;
      safeChartCall(() => {
        chart.applyOptions({ width: chartContainerRef.current!.clientWidth });
      });
    };
    window.addEventListener('resize', handleResize);

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    return () => {
      window.removeEventListener('resize', handleResize);
      chartAliveRef.current = false;
      setChartReady(false);
      clearPriceLines();
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      indicatorSeriesRef.current.clear();
      chartRef.current = null;
      try {
        chart.remove();
      } catch {
        // already disposed
      }
    };
  }, [safeChartCall, clearPriceLines]);

  // Entry / SL / TP overlays from open position
  useEffect(() => {
    if (!chartReady || !chartAliveRef.current || !candleSeriesRef.current) return;

    clearPriceLines();
    const pos = ops.position;
    if (!pos) return;

    const series = candleSeriesRef.current;
    safeChartCall(() => {
      if (Number.isFinite(pos.entryPrice) && pos.entryPrice > 0) {
        priceLinesRef.current.entry = series.createPriceLine({
          price: pos.entryPrice,
          color: '#38bdf8',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'Entry',
        });
      }
      if (Number.isFinite(pos.stopLoss) && pos.stopLoss > 0) {
        priceLinesRef.current.sl = series.createPriceLine({
          price: pos.stopLoss,
          color: '#ef4444',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'SL',
        });
      }
      if (Number.isFinite(pos.takeProfit) && pos.takeProfit > 0) {
        priceLinesRef.current.tp = series.createPriceLine({
          price: pos.takeProfit,
          color: '#10b981',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'TP',
        });
      }
    });
  }, [ops.position, chartReady, clearPriceLines, safeChartCall]);

  // Load data when timeframe or symbol changes
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      await fetchTickerData();
      if (cancelled) return;
      const data = await fetchCandleData(timeframe);
      if (cancelled || !chartAliveRef.current) return;
      if (data.length === 0 || !candleSeriesRef.current || !volumeSeriesRef.current) return;

      safeChartCall(() => {
        candleSeriesRef.current?.setData(data);
        volumeSeriesRef.current?.setData(
          data.map((d) => ({
            time: d.time,
            value: 0,
            color: d.close >= d.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
          })),
        );
      });

      activeIndicatorsRef.current.forEach((ind) => {
        updateIndicator(ind, data);
      });
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe, fetchTickerData, fetchCandleData, safeChartCall, updateIndicator]);

  // Setup real-time WebSocket (do not depend on activeIndicators — use ref)
  useEffect(() => {
    if (klineWsRef.current) {
      klineWsRef.current.close();
      klineWsRef.current = null;
    }

    const isTickerMode = timeframe === 'ticker';
    const streamName = isTickerMode
      ? `${symbol.toLowerCase()}@ticker`
      : `${symbol.toLowerCase()}@kline_${timeframe}`;

    const wsUrl = `wss://stream.binance.com:9443/ws/${streamName}`;
    const ws = new WebSocket(wsUrl);
    klineWsRef.current = ws;

    let tickerLineSeries: ISeriesApi<'Line'> | null = null;

    ws.onmessage = (event: MessageEvent) => {
      if (!chartAliveRef.current) return;
      try {
        const raw = JSON.parse(event.data);

        if (isTickerMode && raw.e === '24hrTicker') {
          const close = parseFloat(raw.c);
          const currentTime = Math.floor(Date.now() / 1000) as UTCTimestamp;

          if (Number.isFinite(close)) {
            setLastPrice(close);
          }

          safeChartCall(() => {
            if (!chartRef.current) return;
            if (!tickerLineSeries) {
              candleSeriesRef.current?.applyOptions({ visible: false });
              volumeSeriesRef.current?.applyOptions({ visible: false });
              tickerLineSeries = chartRef.current.addLineSeries({
                color: '#10b981',
                lineWidth: 2,
                priceLineVisible: false,
                lastValueVisible: true,
                crosshairMarkerVisible: true,
                crosshairMarkerRadius: 4,
                crosshairMarkerBorderColor: '#10b981',
                crosshairMarkerBackgroundColor: '#0f172a',
              });
            }
            tickerLineSeries.update({
              time: currentTime,
              value: close,
            });
          });
        } else if (!isTickerMode && raw.e === 'kline') {
          const k = raw.k;
          const close = parseFloat(k.c);
          const open = parseFloat(k.o);
          const high = parseFloat(k.h);
          const low = parseFloat(k.l);
          const volume = parseFloat(k.v);
          const startTime = Math.floor(k.t / 1000) as UTCTimestamp;

          if (Number.isFinite(close)) {
            setLastPrice(close);
          }

          if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

          const candleUpdate = {
            time: startTime,
            open: Number.isFinite(open) ? open : 0,
            high: Number.isFinite(high) ? high : 0,
            low: Number.isFinite(low) ? low : 0,
            close: Number.isFinite(close) ? close : 0,
          };

          safeChartCall(() => {
            candleSeriesRef.current?.update(candleUpdate);
            volumeSeriesRef.current?.update({
              time: startTime,
              value: Number.isFinite(volume) ? volume : 0,
              color: close >= open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
            });
          });

          const indicators = activeIndicatorsRef.current;
          if (indicators.size > 0) {
            setCandleData((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].time === startTime) {
                updated[lastIdx] = candleUpdate;
              } else {
                updated.push(candleUpdate);
              }
              indicators.forEach((ind) => {
                updateIndicator(ind, updated);
              });
              return updated;
            });
          }
        }
      } catch {
        // ignore parse / disposed errors
      }
    };

    ws.onerror = () => {
      // Silently handle errors
    };

    return () => {
      ws.close();
      if (klineWsRef.current === ws) {
        klineWsRef.current = null;
      }
      safeChartCall(() => {
        if (tickerLineSeries && chartRef.current) {
          try {
            chartRef.current.removeSeries(tickerLineSeries);
          } catch {
            // ignore
          }
        }
        try {
          candleSeriesRef.current?.applyOptions({ visible: true });
          volumeSeriesRef.current?.applyOptions({ visible: true });
        } catch {
          // ignore disposed
        }
      });
      tickerLineSeries = null;
    };
  }, [symbol, timeframe, safeChartCall, updateIndicator]);

  // Backend socket for candle ticks (fallback)
  useEffect(() => {
    const handleCandleTick = (data: { symbol?: string; close?: number }) => {
      if (data.symbol === symbol && Number.isFinite(data.close)) {
        setLastPrice(data.close as number);
      }
    };

    socket.on('realtime-price', handleCandleTick);
    return () => {
      socket.off('realtime-price', handleCandleTick);
    };
  }, [symbol]);

  const toggleIndicator = (indicator: string) => {
    const newSet = new Set(activeIndicators);
    if (newSet.has(indicator)) {
      newSet.delete(indicator);
      const series = indicatorSeriesRef.current.get(indicator);
      if (series) {
        safeChartCall(() => {
          chartRef.current?.removeSeries(series);
        });
        indicatorSeriesRef.current.delete(indicator);
      }
    } else {
      newSet.add(indicator);
      if (candleData.length > 0) {
        updateIndicator(indicator, candleData);
      }
    }
    setActiveIndicators(newSet);
  };

  const hasPriceData = Number.isFinite(lastPrice) && lastPrice > 0;
  const isPositiveChange = priceChangePercent >= 0;
  const changeColor = isPositiveChange ? 'text-emerald-400' : 'text-red-400';

  const pairReady = ops.pair && !ops.pair.blockBuy;
  const pairBlocked = ops.pair?.blockBuy;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100">
      <div className="sticky top-0 z-10 bg-[#0a0a0f]/95 backdrop-blur-sm border-b border-slate-800/50">
        <div className="px-4 lg:px-6 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/dashboard"
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold text-white truncate">
                  {symbol.replace('USDT', '')}
                  <span className="text-slate-500 font-normal ml-1">/USDT</span>
                </h1>
                {ops.position && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 shrink-0">
                    LONG
                  </span>
                )}
                {pairBlocked && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 shrink-0">
                    <AlertTriangle className="w-2.5 h-2.5" />
                    BUY blocked
                  </span>
                )}
                {pairReady && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 shrink-0">
                    <CheckCircle className="w-2.5 h-2.5" />
                    Ready
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-500 truncate">
                Bot TF 15m
                {ops.prediction
                  ? ` · last signal ${ops.prediction.signal} (${(ops.prediction.confidence * 100).toFixed(0)}%)`
                  : ''}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <PriceFlash value={lastPrice}>
              <span className="text-lg font-semibold text-white tabular-nums">
                {hasPriceData ? `$${formatPrice(lastPrice)}` : '--'}
              </span>
            </PriceFlash>
            {hasPriceData && (
              <div className={`flex items-center justify-end gap-1 text-xs font-medium ${changeColor} mt-0.5`}>
                {isPositiveChange ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span className="tabular-nums">
                  {priceChangePercent >= 0 ? '+' : ''}
                  {priceChangePercent.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 lg:px-6 py-4">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800 overflow-x-auto">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.value}
                    type="button"
                    onClick={() => {
                      setTimeframe(tf.value);
                      clearIndicatorSeries();
                      setActiveIndicators(new Set());
                    }}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      timeframe === tf.value
                        ? 'bg-sky-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                {INDICATORS.map((ind) => (
                  <button
                    key={ind.value}
                    type="button"
                    onClick={() => toggleIndicator(ind.value)}
                    className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors border ${
                      activeIndicators.has(ind.value)
                        ? 'bg-slate-800 text-white border-slate-700'
                        : 'text-slate-500 hover:text-slate-300 border-transparent hover:border-slate-800'
                    }`}
                    style={{
                      borderColor: activeIndicators.has(ind.value) ? ind.color : undefined,
                      color: activeIndicators.has(ind.value) ? ind.color : undefined,
                    }}
                  >
                    {ind.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              {isLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm rounded-xl">
                  <div className="flex flex-col items-center gap-2">
                    <RefreshCw className="w-5 h-5 text-sky-400 animate-spin" />
                    <span className="text-xs text-slate-400">Memuat data...</span>
                  </div>
                </div>
              )}
              <div
                ref={chartContainerRef}
                className="w-full min-h-[520px] bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-2xl"
              />
              {ops.position && (
                <div className="absolute bottom-3 left-3 flex items-center gap-2 text-[10px] pointer-events-none">
                  <span className="px-1.5 py-0.5 rounded bg-slate-950/80 text-sky-400 border border-slate-700/50">
                    Entry
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-950/80 text-red-400 border border-slate-700/50">
                    SL
                  </span>
                  <span className="px-1.5 py-0.5 rounded bg-slate-950/80 text-emerald-400 border border-slate-700/50">
                    TP
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatBox
                label="24h Change"
                value={
                  hasPriceData
                    ? `${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%`
                    : '--'
                }
                color={changeColor}
              />
              <StatBox
                label="High 24h"
                value={Number.isFinite(high24h) && high24h > 0 ? `$${formatPrice(high24h)}` : '--'}
                color="text-slate-300"
              />
              <StatBox
                label="Low 24h"
                value={Number.isFinite(low24h) && low24h > 0 ? `$${formatPrice(low24h)}` : '--'}
                color="text-slate-300"
              />
              <StatBox
                label="Volume 24h"
                value={Number.isFinite(volume24h) && volume24h > 0 ? formatVolume(volume24h) : '--'}
                color="text-slate-300"
              />
            </div>
          </div>

          <SymbolOpsPanel symbol={symbol} ops={ops} lastPrice={lastPrice} />
        </div>
      </div>
    </div>
  );
}

function formatVolume(volume: number): string {
  if (!Number.isFinite(volume) || volume === 0) return '--';
  if (volume >= 1_000_000_000) return `$${(volume / 1_000_000_000).toFixed(2)}B`;
  if (volume >= 1_000_000) return `$${(volume / 1_000_000).toFixed(2)}M`;
  if (volume >= 1_000) return `$${(volume / 1_000).toFixed(2)}K`;
  return `$${volume.toFixed(2)}`;
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-lg p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-xs font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}
