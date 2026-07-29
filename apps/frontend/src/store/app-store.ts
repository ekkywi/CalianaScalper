// apps/frontend/src/store/app-store.ts
// Global state management for CalianaScalper trading bot

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================================
// Types
// ============================================================

export interface DrawdownThrottleTier {
  threshold: number;
  scale: number;
}

export interface RiskConfig {
  maxPositionSizePercent: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  maxDailyLossPercent: number;
  maxDrawdownPercent: number;
  maxDailyDrawdownPercent: number;
  maxWeeklyDrawdownPercent: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  minConfidenceThreshold: number;
  slippageProtectionPercent: number;
  mlShadowMode: boolean;
  mlRegimeGateEnabled: boolean;
  drawdownCooldownMinutes: number;
  drawdownThrottleTiers: DrawdownThrottleTier[];
}

export interface Position {
  symbol: string;
  side: 'LONG';
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  entryTime: number;
  status: 'OPEN' | 'CLOSED_BY_TP' | 'CLOSED_BY_SL' | 'CLOSED_BY_SIGNAL' | 'CLOSED_BY_MANUAL';
  closePrice?: number;
  closeTime?: number;
  unrealizedPnL: number;
  realizedPnL: number;
}

export interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  quantity: number;
  filledQuantity: number;
  price: number;
  averagePrice: number;
  status: string;
  timestamp: number;
  pnl?: number;
  pnlPercent?: number;
}

export interface Alert {
  id: string;
  type: 'price' | 'pnl' | 'drawdown' | 'signal' | 'error' | 'system' | 'trade';
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  read: boolean;
  symbol?: string;
  action?: string;
}

export interface NotificationRule {
  id: string;
  triggerType: 'price_above' | 'price_below' | 'pnl_threshold' | 'drawdown' | 'signal' | 'error';
  symbol?: string;
  condition: string;
  channel: 'in_app' | 'telegram' | 'discord' | 'email';
  enabled: boolean;
  cooldown: number;
}

export interface MlModelInfo {
  symbol: string;
  status: 'idle' | 'training' | 'ready' | 'error';
  accuracy?: number;
  lastTraining?: number;
  bufferSize?: number;
}

export interface StrategyConfig {
  id: string;
  name: string;
  type: 'scalping' | 'ml_based' | 'grid' | 'dca';
  enabled: boolean;
  symbols: string[];
  params: Record<string, any>;
}

export interface SystemHealth {
  websocket: boolean;
  database: boolean;
  mlEngine: boolean;
  exchange: boolean;
  uptime: number;
  lastError?: string;
}

export interface LogEntry {
  id: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  timestamp: number;
  source?: string;
}

export interface AppState {
  // Risk Management
  riskConfig: RiskConfig;
  tradingHalted: boolean;
  dailyStats: { date: string; trades: number; loss: number };

  // Positions
  positions: Position[];
  trades: Trade[];
  totalPnl: number;

  // ML Models
  mlModels: MlModelInfo[];

  // Strategies
  strategies: StrategyConfig[];

  // Notifications
  alerts: Alert[];
  notificationRules: NotificationRule[];

  // System
  systemHealth: SystemHealth;
  logs: LogEntry[];
  isEmergencyStopped: boolean;
  haltReason: string | null;

  // Actions
  setRiskConfig: (config: Partial<RiskConfig>) => void;
  setTradingHalted: (halted: boolean) => void;
  syncTradingHalt: (halted: boolean, reason?: string | null) => void;
  setDailyStats: (stats: { date: string; trades: number; loss: number }) => void;
  setPositions: (positions: Position[]) => void;
  setTrades: (trades: Trade[]) => void;
  setTotalPnl: (pnl: number) => void;
  setMlModels: (models: MlModelInfo[]) => void;
  setStrategies: (strategies: StrategyConfig[]) => void;
  addAlert: (alert: Alert) => void;
  markAlertRead: (id: string) => void;
  clearAlerts: () => void;
  setNotificationRules: (rules: NotificationRule[]) => void;
  setSystemHealth: (health: Partial<SystemHealth>) => void;
  addLog: (log: LogEntry) => void;
  clearLogs: () => void;
  setEmergencyStopped: (stopped: boolean) => void;
}

// ============================================================
// Default Risk Config
// ============================================================

const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxPositionSizePercent: 0.01,
  stopLossPercent: 0.03,
  takeProfitPercent: 0.06,
  maxDailyLossPercent: 0.05,
  maxDrawdownPercent: 0.15,
  maxDailyDrawdownPercent: 0.05,
  maxWeeklyDrawdownPercent: 0.10,
  maxOpenPositions: 3,
  maxTradesPerDay: 10,
  minConfidenceThreshold: 0.65,
  slippageProtectionPercent: 0.005,
  mlShadowMode: false,
  mlRegimeGateEnabled: true,
  drawdownCooldownMinutes: 60,
  drawdownThrottleTiers: [
    { threshold: 0.5, scale: 0.5 },
    { threshold: 0.75, scale: 0.25 },
  ],
};

// ============================================================
// Store
// ============================================================

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial State
      riskConfig: DEFAULT_RISK_CONFIG,
      tradingHalted: false,
      dailyStats: { date: '', trades: 0, loss: 0 },
      positions: [],
      trades: [],
      totalPnl: 0,
      mlModels: [],
      strategies: [],
      alerts: [],
      notificationRules: [],
      systemHealth: {
        websocket: false,
        database: false,
        mlEngine: false,
        exchange: false,
        uptime: 0,
      },
      logs: [],
      isEmergencyStopped: false,
      haltReason: null,

      // Risk Management Actions
      setRiskConfig: (config) =>
        set((state) => ({
          riskConfig: { ...state.riskConfig, ...config },
        })),

      setTradingHalted: (halted) =>
        set({
          tradingHalted: halted,
          isEmergencyStopped: halted,
          haltReason: halted ? get().haltReason : null,
        }),

      syncTradingHalt: (halted, reason = null) =>
        set({
          tradingHalted: halted,
          isEmergencyStopped: halted,
          haltReason: halted ? reason || get().haltReason : null,
        }),

      setDailyStats: (stats) =>
        set({ dailyStats: stats }),

      // Position Actions
      setPositions: (positions) =>
        set({ positions }),

      setTrades: (trades) =>
        set({ trades }),

      setTotalPnl: (pnl) =>
        set({ totalPnl: pnl }),

      // ML Model Actions
      setMlModels: (models) =>
        set({ mlModels: models }),

      // Strategy Actions
      setStrategies: (strategies) =>
        set({ strategies }),

      // Alert Actions
      addAlert: (alert) =>
        set((state) => ({
          alerts: [alert, ...state.alerts].slice(0, 100), // Keep last 100 alerts
        })),

      markAlertRead: (id) =>
        set((state) => ({
          alerts: state.alerts.map((a) =>
            a.id === id ? { ...a, read: true } : a
          ),
        })),

      clearAlerts: () =>
        set({ alerts: [] }),

      setNotificationRules: (rules) =>
        set({ notificationRules: rules }),

      // System Actions
      setSystemHealth: (health) =>
        set((state) => ({
          systemHealth: { ...state.systemHealth, ...health },
        })),

      addLog: (log) =>
        set((state) => ({
          logs: [log, ...state.logs].slice(0, 500), // Keep last 500 logs
        })),

      clearLogs: () =>
        set({ logs: [] }),

      setEmergencyStopped: (stopped) =>
        set({
          isEmergencyStopped: stopped,
          tradingHalted: stopped,
          haltReason: stopped ? get().haltReason || 'EMERGENCY_STOP' : null,
        }),
    }),
    {
      name: 'caliana-app-storage',
      partialize: (state) => ({
        riskConfig: state.riskConfig,
        notificationRules: state.notificationRules,
        strategies: state.strategies,
      }),
    }
  )
);