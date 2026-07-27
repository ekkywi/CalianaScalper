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

export async function resumeTrading() {
  return sendJson('/risk/resume', 'POST');
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

// ============================================================
// ML Engine
// ============================================================

export async function fetchMlModels() {
  return getJson('/ml/models');
}

export async function retrainModel(symbol: string) {
  return sendJson(`/ml/train/${encodeURIComponent(symbol)}`, 'POST');
}

export async function fetchModelInfo(symbol: string) {
  return getJson(`/ml/model/${encodeURIComponent(symbol)}`);
}

export async function fetchMlPredictions() {
  return getJson('/ml/predictions');
}

export async function fetchMlHealth() {
  return getJson('/ml/health');
}

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
// System Health
// ============================================================

export async function fetchSystemHealth() {
  return getJson('/system/health');
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

export async function fetchAccountBalance() {
  throw new Error('Account balance API not implemented yet (Phase 4 deferred)');
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
