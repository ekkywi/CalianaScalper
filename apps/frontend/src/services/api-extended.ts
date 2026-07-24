// apps/frontend/src/services/api-extended.ts
// Extended API service for all new UI features

const API_BASE = 'http://localhost:3001/api';

// ============================================================
// Risk Management
// ============================================================

export async function fetchRiskConfig() {
  const res = await fetch(`${API_BASE}/risk/config`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch risk config');
  return res.json();
}

export async function updateRiskConfig(config: Record<string, any>) {
  const res = await fetch(`${API_BASE}/risk/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to update risk config');
  return res.json();
}

export async function fetchPositions() {
  const res = await fetch(`${API_BASE}/risk/positions`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch positions');
  return res.json();
}

export async function fetchDailyStats() {
  const res = await fetch(`${API_BASE}/risk/daily-stats`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch daily stats');
  return res.json();
}

export async function emergencyStopAll() {
  const res = await fetch(`${API_BASE}/risk/emergency-stop`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to trigger emergency stop');
  return res.json();
}

export async function resumeTrading() {
  const res = await fetch(`${API_BASE}/risk/resume`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to resume trading');
  return res.json();
}

// ============================================================
// Orders & Trading
// ============================================================

export async function placeOrder(order: {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS';
  quantity: number;
  price?: number;
}) {
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });
  if (!res.ok) throw new Error('Failed to place order');
  return res.json();
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
  const res = await fetch(`${API_BASE}/orders?${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch orders');
  return res.json();
}

export async function closePosition(symbol: string) {
  const res = await fetch(`${API_BASE}/positions/${symbol}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to close position');
  return res.json();
}

export async function closeAllPositions() {
  const res = await fetch(`${API_BASE}/positions`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to close all positions');
  return res.json();
}

export async function updatePositionSlTp(symbol: string, stopLoss?: number, takeProfit?: number) {
  const res = await fetch(`${API_BASE}/positions/${symbol}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stopLoss, takeProfit }),
  });
  if (!res.ok) throw new Error('Failed to update position SL/TP');
  return res.json();
}

// ============================================================
// ML Engine
// ============================================================

export async function fetchMlModels() {
  const res = await fetch(`${API_BASE}/ml/models`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch ML models');
  return res.json();
}

export async function retrainModel(symbol: string) {
  const res = await fetch(`${API_BASE}/ml/train/${symbol}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to retrain model');
  return res.json();
}

export async function fetchModelInfo(symbol: string) {
  const res = await fetch(`${API_BASE}/ml/model/${symbol}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch model info');
  return res.json();
}

// ============================================================
// Performance
// ============================================================

export async function fetchPerformanceStats() {
  const res = await fetch(`${API_BASE}/performance/stats`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch performance stats');
  return res.json();
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
  const res = await fetch(`${API_BASE}/performance/trades?${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch trade history');
  return res.json();
}

export async function fetchEquityCurve() {
  const res = await fetch(`${API_BASE}/performance/equity-curve`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch equity curve');
  return res.json();
}

// ============================================================
// System Health
// ============================================================

export async function fetchSystemHealth() {
  const res = await fetch(`${API_BASE}/system/health`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch system health');
  return res.json();
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
  const res = await fetch(`${API_BASE}/system/logs?${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch logs');
  return res.json();
}

// ============================================================
// Strategies
// ============================================================

export async function fetchStrategies() {
  const res = await fetch(`${API_BASE}/strategies`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch strategies');
  return res.json();
}

export async function saveStrategy(strategy: Record<string, any>) {
  const res = await fetch(`${API_BASE}/strategies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(strategy),
  });
  if (!res.ok) throw new Error('Failed to save strategy');
  return res.json();
}

export async function toggleStrategy(id: string, enabled: boolean) {
  const res = await fetch(`${API_BASE}/strategies/${id}/toggle`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error('Failed to toggle strategy');
  return res.json();
}

// ============================================================
// Account
// ============================================================

export async function fetchAccountBalance() {
  const res = await fetch(`${API_BASE}/account/balance`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch account balance');
  return res.json();
}

export async function testConnection() {
  const res = await fetch(`${API_BASE}/account/test-connection`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Connection test failed');
  return res.json();
}

// ============================================================
// Configuration Export/Import
// ============================================================

export async function exportConfig() {
  const res = await fetch(`${API_BASE}/config/export`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to export config');
  return res.blob();
}

export async function importConfig(configFile: File) {
  const formData = new FormData();
  formData.append('config', configFile);
  const res = await fetch(`${API_BASE}/config/import`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('Failed to import config');
  return res.json();
}