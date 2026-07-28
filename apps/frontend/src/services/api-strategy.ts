// apps/frontend/src/services/api-strategy.ts
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
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export type TradingProfileRow = {
  id: string;
  symbol: string;
  name: string;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxHorizonCandles: number;
  notes?: string | null;
  isActive?: boolean;
  compatibleModelCount?: number;
  hasCompatibleModel?: boolean;
};

export type StrategyModelRow = {
  id: string;
  symbol: string;
  name: string;
  engineModelId: string;
  algorithm: string;
  labelConfig: {
    stop_loss_percent: number;
    take_profit_percent: number;
    max_horizon_candles: number;
  };
  metrics?: Record<string, unknown> | null;
  trainedAt: number;
  isActive?: boolean;
  compatibleProfileCount?: number;
  hasCompatibleProfile?: boolean;
};

export type StrategyPairStatus = {
  symbol: string;
  status: string;
  fields: string[];
  blockBuy: boolean;
  message: string;
  profile: {
    id: string | null;
    name: string | null;
    stopLossPercent: number | null;
    takeProfitPercent: number | null;
    maxHorizonCandles: number | null;
  };
  model: {
    id: string | null;
    name: string | null;
    engineModelId: string | null;
    labelConfig: StrategyModelRow['labelConfig'] | null;
  };
};

export async function fetchTradingProfiles(symbol?: string) {
  const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  return getJson(`/strategy/profiles${q}`) as Promise<{ profiles: TradingProfileRow[] }>;
}

export async function createTradingProfile(body: Record<string, unknown>) {
  return sendJson('/strategy/profiles', 'POST', body);
}

export async function deleteTradingProfile(id: string) {
  return sendJson(`/strategy/profiles/${encodeURIComponent(id)}`, 'DELETE');
}

export async function activateTradingProfile(id: string) {
  return sendJson(`/strategy/profiles/${encodeURIComponent(id)}/activate`, 'POST');
}

export async function fetchCompatibleModels(profileId: string) {
  return getJson(`/strategy/profiles/${encodeURIComponent(profileId)}/compatible-models`);
}

export async function fetchStrategyModels(symbol?: string) {
  const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : '';
  return getJson(`/strategy/models${q}`) as Promise<{ models: StrategyModelRow[] }>;
}

export async function activateStrategyModel(id: string) {
  return sendJson(`/strategy/models/${encodeURIComponent(id)}/activate`, 'POST');
}

export async function deleteStrategyModel(id: string) {
  return sendJson(`/strategy/models/${encodeURIComponent(id)}`, 'DELETE');
}

export async function fetchCompatibleProfiles(modelId: string) {
  return getJson(`/strategy/models/${encodeURIComponent(modelId)}/compatible-profiles`);
}

export async function syncStrategyModels() {
  return sendJson('/strategy/models/sync', 'POST');
}

export async function fetchStrategyPairs() {
  return getJson('/strategy/pairs') as Promise<{ pairs: StrategyPairStatus[] }>;
}

export async function strategyTrain(body: Record<string, unknown>) {
  return sendJson('/strategy/train', 'POST', body);
}

export async function strategyLabelPreview(params: Record<string, string | number>) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => q.set(k, String(v)));
  return getJson(`/strategy/label-preview?${q.toString()}`);
}

export async function createProfileFromModel(input: {
  symbol: string;
  name: string;
  fromModelId: string;
}) {
  return createTradingProfile(input);
}
