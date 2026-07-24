// apps/frontend/src/services/binance-ws.ts
// WebSocket langsung ke Binance untuk data ticker 24h real-time
// Menggunakan combined stream URL + SUBSCRIBE/UNSUBSCRIBE method
// untuk menghindari disconnect/reconnect berulang yang bisa kena rate limit

export interface TickerData {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  quoteVolume24h: number;
  marketCap?: number;
}

type TickerCallback = (data: TickerData) => void;
type StatusCallback = (connected: boolean) => void;

class BinanceTickerWS {
  private ws: WebSocket | null = null;
  private subscribedSymbols: Set<string> = new Set();
  private tickerCallbacks: Map<string, Set<TickerCallback>> = new Map();
  private statusCallbacks: Set<StatusCallback> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private isConnected = false;
  private isConnecting = false;
  private pendingSubscribe: Set<string> = new Set();
  private pendingUnsubscribe: Set<string> = new Set();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly WS_URL = 'wss://stream.binance.com:9443/ws';
  private readonly MAX_RECONNECT_DELAY = 30000; // 30 detik max

  private getStreamName(symbol: string): string {
    return `${symbol.toLowerCase()}@ticker`;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) return;

    this.isConnecting = true;

    // Build combined stream URL
    const streams = Array.from(this.subscribedSymbols).map((s) => this.getStreamName(s));
    if (streams.length === 0) {
      streams.push('btcusdt@ticker');
      this.subscribedSymbols.add('BTCUSDT');
    }

    const url = `${this.WS_URL}/${streams.join('/')}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.isConnected = true;
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      this.notifyStatus(true);
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = JSON.parse(event.data);
        if (raw.e === '24hrTicker') {
          const ticker: TickerData = {
            symbol: raw.s,
            lastPrice: parseFloat(raw.c),
            priceChange: parseFloat(raw.p),
            priceChangePercent: parseFloat(raw.P),
            high24h: parseFloat(raw.h),
            low24h: parseFloat(raw.l),
            volume24h: parseFloat(raw.v),
            quoteVolume24h: parseFloat(raw.q),
          };
          this.notifyTicker(ticker);
        }
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.isConnecting = false;
      this.notifyStatus(false);
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    this.cancelReconnect();
    this.pendingSubscribe.clear();
    this.pendingUnsubscribe.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.notifyStatus(false);
  }

  private cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[BinanceWS] Max reconnect attempts reached. Stopping.');
      return;
    }

    // Exponential backoff: 5s, 10s, 20s, 30s, 30s
    const delay = Math.min(
      5000 * Math.pow(2, this.reconnectAttempts),
      this.MAX_RECONNECT_DELAY
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  subscribe(symbol: string, callback: TickerCallback): () => void {
    const upperSymbol = symbol.toUpperCase();

    if (!this.tickerCallbacks.has(upperSymbol)) {
      this.tickerCallbacks.set(upperSymbol, new Set());
    }
    this.tickerCallbacks.get(upperSymbol)!.add(callback);

    if (!this.subscribedSymbols.has(upperSymbol)) {
      this.subscribedSymbols.add(upperSymbol);
      this.pendingSubscribe.add(upperSymbol);
      this.debounceStreamUpdate();
    }

    return () => this.unsubscribe(upperSymbol, callback);
  }

  unsubscribe(symbol: string, callback: TickerCallback) {
    const upperSymbol = symbol.toUpperCase();
    const callbacks = this.tickerCallbacks.get(upperSymbol);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.tickerCallbacks.delete(upperSymbol);
        this.subscribedSymbols.delete(upperSymbol);
        this.pendingUnsubscribe.add(upperSymbol);
        this.debounceStreamUpdate();
      }
    }
  }

  /**
   * Debounce stream updates to avoid rapid reconnect cycles.
   * Batches multiple subscribe/unsubscribe into a single reconnect.
   */
  private debounceStreamUpdate() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.applyStreamChanges();
    }, 500);
  }

  private applyStreamChanges() {
    // If we have a live connection, use SUBSCRIBE/UNSUBSCRIBE method
    if (this.ws?.readyState === WebSocket.OPEN) {
      const subscribeParams = Array.from(this.pendingSubscribe).map((s) => this.getStreamName(s));
      const unsubscribeParams = Array.from(this.pendingUnsubscribe).map((s) => this.getStreamName(s));

      if (unsubscribeParams.length > 0) {
        this.ws.send(JSON.stringify({
          method: 'UNSUBSCRIBE',
          params: unsubscribeParams,
          id: Date.now(),
        }));
      }

      if (subscribeParams.length > 0) {
        this.ws.send(JSON.stringify({
          method: 'SUBSCRIBE',
          params: subscribeParams,
          id: Date.now() + 1,
        }));
      }

      this.pendingSubscribe.clear();
      this.pendingUnsubscribe.clear();
      return;
    }

    // If not connected, just reconnect with the full stream list
    this.pendingSubscribe.clear();
    this.pendingUnsubscribe.clear();
    this.disconnect();
    this.connect();
  }

  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.add(callback);
    callback(this.isConnected);
    return () => {
      this.statusCallbacks.delete(callback);
    };
  }

  private notifyTicker(ticker: TickerData) {
    const callbacks = this.tickerCallbacks.get(ticker.symbol);
    if (callbacks) {
      callbacks.forEach((cb) => cb(ticker));
    }
  }

  private notifyStatus(connected: boolean) {
    this.statusCallbacks.forEach((cb) => cb(connected));
  }

  getConnected(): boolean {
    return this.isConnected;
  }
}

// Singleton instance
export const binanceTickerWS = new BinanceTickerWS();