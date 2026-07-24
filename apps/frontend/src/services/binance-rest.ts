// apps/frontend/src/services/binance-rest.ts
// REST API calls to Binance for initial data and historical klines

export interface KlineData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const BINANCE_REST_URL = 'https://api.binance.com';

/**
 * Fetch 24hr ticker stats for a single symbol
 */
export async function fetch24hrTicker(symbol: string) {
  const res = await fetch(
    `${BINANCE_REST_URL}/api/v3/ticker/24hr?symbol=${symbol.toUpperCase()}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`Failed to fetch 24hr ticker for ${symbol}`);
  return res.json();
}

/**
 * Fetch 24hr ticker stats for multiple symbols (up to 100)
 */
export async function fetchMultiple24hrTickers(symbols: string[]) {
  const symbolsParam = JSON.stringify(symbols.map((s) => s.toUpperCase()));
  const res = await fetch(
    `${BINANCE_REST_URL}/api/v3/ticker/24hr?symbols=${encodeURIComponent(symbolsParam)}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error('Failed to fetch multiple 24hr tickers');
  return res.json();
}

/**
 * Fetch historical kline/candlestick data
 * @param symbol - e.g. BTCUSDT
 * @param interval - 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M
 * @param limit - number of candles (max 1000)
 */
export async function fetchKlines(
  symbol: string,
  interval: string = '15m',
  limit: number = 500
): Promise<KlineData[]> {
  const res = await fetch(
    `${BINANCE_REST_URL}/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`,
    { cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`Failed to fetch klines for ${symbol}`);

  const raw: any[] = await res.json();
  return raw.map((k) => ({
    time: Math.floor(k[0] / 1000), // Binance returns ms timestamps
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

/**
 * Fetch exchange info to get symbol details (e.g. status, base asset, quote asset)
 */
export async function fetchExchangeInfo() {
  const res = await fetch(`${BINANCE_REST_URL}/api/v3/exchangeInfo`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Failed to fetch exchange info');
  return res.json();
}