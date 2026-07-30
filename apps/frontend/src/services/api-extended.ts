// apps/frontend/src/services/api-extended.ts
// Extended API service for risk, performance, ML, and system endpoints

const API_BASE = 'http://localhost:3001/api';

async function getJson(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Request failed: ${path} (${res.status})`);
  return res.json();
}

async function sendJson(path: string, method: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = text || `Request failed: ${path} (${res.status})`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.message) {
        msg = Array.isArray(parsed.message) ? parsed.message.join(', ') : String(parsed.message);
      }
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.json();
}

// ============================================================
// Risk Management
// ============================================================

export async function fetchRiskConfig() {
  return getJson('/risk/config');
}

export async function updateRiskConfig(config: Record<string, unknown>) {
  return sendJson('/risk/config', 'PUT', config);
}

export async function fetchPositions() {
  return getJson('/risk/positions');
}

export async function fetchDailyStats() {
  return getJson('/risk/daily-stats');
}

export async function fetchRiskStatus() {
  return getJson('/risk/status');
}

export async function emergencyStopAll() {
  return sendJson('/risk/emergency-stop', 'POST');
}

export async function resumeTrading(force = false) {
  return sendJson('/risk/resume', 'POST', { force });
}

export async function fetchDrawdownStatus() {
  return getJson('/risk/drawdown/status');
}

export async function fetchDrawdownHistory() {
  return getJson('/risk/drawdown/history');
}

export async function fetchPerSymbolDrawdown() {
  return getJson('/risk/drawdown/per-symbol');
}

export async function resetPeakBalance(newPeak?: number) {
  return sendJson('/risk/drawdown/reset-peak', 'POST', newPeak != null ? { newPeak } : {});
}

export async function closePosition(symbol: string) {
  return sendJson(`/risk/positions/${encodeURIComponent(symbol)}`, 'DELETE');
}

export async function closeAllPositions() {
  return sendJson('/risk/positions', 'DELETE');
}

export async function updatePositionSlTp(
  symbol: string,
  stopLoss?: number,
  takeProfit?: number,
) {
  return sendJson(`/risk/positions/${encodeURIComponent(symbol)}`, 'PATCH', {
    stopLoss,
    takeProfit,
  });
}

// ============================================================
// Orders & Trading (Phase 4 deferred — stubs throw clearly)
// ============================================================

export async function placeOrder(order: {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS';
  quantity: number;
  price?: number;
}) {
  return sendJson('/orders', 'POST', order);
}

export async function fetchOrders(params?: {
  symbol?: string;
  limit?: number;
  status?: string;
}) {
  const query = new URLSearchParams();
  if (params?.symbol) query.set('symbol', params.symbol);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.status) query.set('status', params.status);
  const qs = query.toString();
  return getJson(`/orders${qs ? `?${qs}` : ''}`);
}

export type ExchangeOrder = {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  status: string;
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  timestamp: number;
};

export async function fetchExchangeOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
  const query = new URLSearchParams();
  if (symbol) query.set('symbol', symbol);
  const qs = query.toString();
  return getJson(`/orders/exchange/open${qs ? `?${qs}` : ''}`);
}

export async function fetchExchangeRecentOrders(
  symbol?: string,
  limit: number = 50,
): Promise<ExchangeOrder[]> {
  const query = new URLSearchParams();
  if (symbol) query.set('symbol', symbol);
  query.set('limit', String(limit));
  return getJson(`/orders/exchange/recent?${query.toString()}`);
}

export async function cancelExchangeOrder(orderId: string, symbol: string) {
  return sendJson(
    `/orders/exchange/${encodeURIComponent(orderId)}?symbol=${encodeURIComponent(symbol)}`,
    'DELETE',
  );
}

export type OrderBookLevel = { price: number; quantity: number };

export type OrderBookResponse = {
  symbol: string;
  source: string;
  lastUpdateId: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
};

export async function fetchOrderBook(
  symbol: string,
  limit: number = 20,
): Promise<OrderBookResponse> {
  const query = new URLSearchParams({
    symbol,
    limit: String(limit),
  });
  return getJson(`/market/depth?${query.toString()}`);
}

// ============================================================
// ML Engine
// ============================================================

export async function fetchMlModels() {
  return getJson('/ml/models');
}

export async function retrainModel(symbol: string, algorithm?: string) {
  return sendJson(`/ml/train/${encodeURIComponent(symbol)}`, 'POST', {
    ...(algorithm ? { algorithm } : {}),
  });
}

export async function deleteMlModel(symbol: string) {
  return sendJson(`/ml/model/${encodeURIComponent(symbol)}`, 'DELETE');
}

export async function fetchModelInfo(symbol: string) {
  return getJson(`/ml/model/${encodeURIComponent(symbol)}`);
}

export async function fetchMlLabelPreview(symbol: string) {
  return getJson(`/ml/label-preview/${encodeURIComponent(symbol)}`);
}

export async function fetchMlEval(symbol: string, modelId?: string) {
  const query = new URLSearchParams();
  if (modelId) query.set('modelId', modelId);
  const qs = query.toString();
  return getJson(
    `/ml/eval/${encodeURIComponent(symbol)}${qs ? `?${qs}` : ''}`,
  );
}

export type MlTradeStats = {
  period: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number | null;
  totalPnl: number;
  avgConfidence: number | null;
  bySymbol: Record<string, { trades: number; pnl: number; wins: number }>;
  disclaimer: string;
};

export async function fetchMlTradeStats(
  period: '1d' | '1w' | '1m' | 'all' = 'all',
): Promise<MlTradeStats> {
  return getJson(`/ml/trade-stats?period=${period}`);
}

export async function fetchMlPredictions() {
  return getJson('/ml/predictions');
}

export async function fetchMlShadowPredictions(limit = 50) {
  return getJson(`/ml/shadow-predictions?limit=${limit}`);
}

export type MlDecisionEvent = {
  id: string;
  symbol: string;
  signal: string;
  confidence: number;
  algorithm: string | null;
  regime: string | null;
  regimeReason: string | null;
  effectiveMinConfidence: number | null;
  blockedBy: string | null;
  wouldExecute: boolean;
  executed: boolean;
  tradingMode: string;
  candleCloseTime: number;
  createdAt: number;
};

export async function fetchMlPredictionEvents(params?: {
  symbol?: string;
  blockedBy?: string;
  executed?: 'true' | 'false' | '';
  limit?: number;
}): Promise<{ events: MlDecisionEvent[]; disclaimer?: string }> {
  const query = new URLSearchParams();
  if (params?.symbol) query.set('symbol', params.symbol);
  if (params?.blockedBy) query.set('blockedBy', params.blockedBy);
  if (params?.executed === 'true' || params?.executed === 'false') {
    query.set('executed', params.executed);
  }
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return getJson(`/ml/prediction-events${qs ? `?${qs}` : ''}`);
}

export async function fetchMlHealth() {
  return getJson('/ml/health');
}

/** @deprecated Prefer /api/strategy pair status — kept type alias for older UI snippets */
export type SymbolDriftReport = {
  symbol: string;
  status: 'ok' | 'mismatch' | 'unknown' | 'incomplete';
  fields: string[];
  blockBuy: boolean;
  message?: string;
};

// ============================================================
// Performance
// ============================================================

export async function fetchPerformanceStats(period: '1d' | '1w' | '1m' | 'all' = 'all') {
  return getJson(`/performance/stats?period=${period}`);
}

export async function fetchTradeHistory(params?: {
  symbol?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}) {
  const query = new URLSearchParams();
  if (params?.symbol) query.set('symbol', params.symbol);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  return getJson(`/performance/trades${qs ? `?${qs}` : ''}`);
}

export async function fetchEquityCurve() {
  return getJson('/performance/equity-curve');
}

// ============================================================
// System Health / Trading Mode
// ============================================================

export type TradingMode = 'paper' | 'live';

export type TradingModeStatus = {
  mode: TradingMode;
  liveAllowed: boolean;
  liveBlockReason: string | null;
  openPositions: number;
  openOrders: number;
  canSwitch: boolean;
  switchBlockReason: string | null;
};

export type AccountBalanceResponse = {
  mode: TradingMode;
  asset: string;
  free: number;
  used: number;
  total: number;
};

export async function fetchSystemHealth() {
  return getJson('/system/health');
}

export async function fetchTradingMode(): Promise<TradingModeStatus> {
  return getJson('/system/trading-mode');
}

export async function setTradingMode(
  mode: TradingMode,
  confirm?: string,
): Promise<TradingModeStatus> {
  return sendJson('/system/trading-mode', 'PUT', { mode, confirm });
}

export async function fetchLogs(params?: {
  level?: string;
  limit?: number;
  source?: string;
}) {
  const query = new URLSearchParams();
  if (params?.level) query.set('level', params.level);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.source) query.set('source', params.source);
  const qs = query.toString();
  return getJson(`/system/logs${qs ? `?${qs}` : ''}`);
}

// ============================================================
// Strategies / Account / Config — Phase 4 deferred
// ============================================================

export async function fetchStrategies() {
  throw new Error('Strategies API not implemented yet (Phase 4 deferred)');
}

export async function saveStrategy(_strategy: Record<string, unknown>) {
  throw new Error('Strategies API not implemented yet (Phase 4 deferred)');
}

export async function toggleStrategy(_id: string, _enabled: boolean) {
  throw new Error('Strategies API not implemented yet (Phase 4 deferred)');
}

export async function fetchAccountBalance(): Promise<AccountBalanceResponse> {
  return getJson('/system/balance');
}

export async function testConnection() {
  throw new Error('Connection test API not implemented yet (Phase 4 deferred)');
}

export async function exportConfig() {
  throw new Error('Config export not implemented yet (Phase 4 deferred)');
}

export async function importConfig(_configFile: File) {
  throw new Error('Config import not implemented yet (Phase 4 deferred)');
}
