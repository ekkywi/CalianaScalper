'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { createChart, IChartApi, ISeriesApi, CandlestickData, UTCTimestamp, LineData } from 'lightweight-charts';
import { fetchKlines, fetch24hrTicker } from '@/services/binance-rest';
import type { KlineData } from '@/services/binance-rest';
import { socket } from '@/services/socket';
import PriceFlash from '@/components/ui/PriceFlash';
import Link from 'next/link';
import { ArrowLeft, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

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

  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  const klineWsRef = useRef<WebSocket | null>(null);
  const chartAliveRef = useRef(false);
  const activeIndicatorsRef = useRef<Set<string>>(new Set());

  const [timeframe, setTimeframe] = useState('15m');
  const [activeIndicators, setActiveIndicators] = useState<Set<string>>(new Set());
  const [lastPrice, setLastPrice] = useState<number>(0);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [priceChangePercent, setPriceChangePercent] = useState<number>(0);
  const [high24h, setHigh24h] = useState<number>(0);
  const [low24h, setLow24h] = useState<number>(0);
  const [volume24h, setVolume24h] = useState<number>(0);
  const [candleData, setCandleData] = useState<CandlestickData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
      setPriceChange(parseFloat(data.p) || 0);
      setPriceChangePercent(parseFloat(data.P) || 0);
      setHigh24h(parseFloat(data.h) || 0);
      setLow24h(parseFloat(data.l) || 0);
      setVolume24h(parseFloat(data.v) || 0);
    } catch (err) {
      console.error('Failed to fetch ticker data:', err);
    }
  }, [symbol]);

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
  }, [safeChartCall]);

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

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100">
      <div className="sticky top-0 z-10 bg-[#0a0a0f]/95 backdrop-blur-sm border-b border-slate-800/50">
        <div className="px-4 lg:px-6 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-sm font-semibold text-white">
                {symbol.replace('USDT', '')}
                <span className="text-slate-500 font-normal ml-1">/USDT</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <PriceFlash value={lastPrice}>
                <span className="text-lg font-semibold text-white tabular-nums">
                  {hasPriceData ? `$${formatPrice(lastPrice)}` : '--'}
                </span>
              </PriceFlash>
              {hasPriceData && (
                <div className={`flex items-center gap-1 text-xs font-medium ${changeColor} mt-0.5`}>
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
      </div>

      <div className="px-4 lg:px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-0.5 border border-slate-800">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => {
                  setTimeframe(tf.value);
                  clearIndicatorSeries();
                  setActiveIndicators(new Set());
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
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
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <StatBox label="Harga Terkini" value={hasPriceData ? `$${formatPrice(lastPrice)}` : '--'} color="text-white" />
          <StatBox
            label="Perubahan 24j"
            value={hasPriceData ? `${priceChangePercent >= 0 ? '+' : ''}${priceChangePercent.toFixed(2)}%` : '--'}
            color={changeColor}
          />
          <StatBox
            label="High 24j"
            value={Number.isFinite(high24h) && high24h > 0 ? `$${formatPrice(high24h)}` : '--'}
            color="text-slate-300"
          />
          <StatBox
            label="Low 24j"
            value={Number.isFinite(low24h) && low24h > 0 ? `$${formatPrice(low24h)}` : '--'}
            color="text-slate-300"
          />
          <StatBox
            label="Volume 24j"
            value={Number.isFinite(volume24h) && volume24h > 0 ? formatVolume(volume24h) : '--'}
            color="text-slate-300"
          />
          <StatBox
            label="Harga Buka 24j"
            value={
              candleData.length > 0 && Number.isFinite(candleData[0]?.open)
                ? `$${formatPrice(candleData[0].open)}`
                : '--'
            }
            color="text-slate-300"
          />
          <StatBox
            label="Range 24j"
            value={
              Number.isFinite(high24h) && Number.isFinite(low24h) && low24h > 0
                ? `${(((high24h - low24h) / low24h) * 100).toFixed(2)}%`
                : '--'
            }
            color="text-slate-300"
          />
          <StatBox label="Symbol" value={symbol} color="text-slate-300" />
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
