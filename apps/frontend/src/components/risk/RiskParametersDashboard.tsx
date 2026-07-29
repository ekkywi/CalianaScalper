// apps/frontend/src/components/risk/RiskParametersDashboard.tsx
// Portfolio risk only — SL/TP live on Trading Profiles

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/store/app-store';
import {
  Shield,
  AlertTriangle,
  Save,
  Loader2,
  Check,
  RotateCcw,
  TrendingDown,
  Activity,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  fetchRiskConfig,
  updateRiskConfig,
  fetchDrawdownStatus,
  fetchDrawdownHistory,
  fetchPerSymbolDrawdown,
  resetPeakBalance,
} from '@/services/api-extended';
import Link from 'next/link';
import { useToast } from '@/components/ui/toast';

type DrawdownStatus = {
  equity: number;
  peakBalance: number;
  dailyPeak: number;
  weeklyPeak: number;
  drawdownPercent: number;
  dailyDrawdownPercent: number;
  weeklyDrawdownPercent: number;
  throttleScale: number;
  cooldownRemainingMs: number;
};

type DrawdownSnapshot = {
  timestamp: number;
  equity: number;
  drawdownPercent: number;
  dailyDrawdownPercent: number;
  weeklyDrawdownPercent: number;
  throttleScale: number;
  layer: string;
};

type PerSymbolDD = Record<
  string,
  { peak: number; current: number; drawdownPercent: number }
>;

function pct(v: number, decimals = 1) {
  return `${(v * 100).toFixed(decimals)}%`;
}

function ddColor(fraction: number) {
  if (fraction >= 0.75) return 'text-red-400';
  if (fraction >= 0.5) return 'text-amber-400';
  return 'text-emerald-400';
}

function ddBg(fraction: number) {
  if (fraction >= 0.75) return 'bg-red-500';
  if (fraction >= 0.5) return 'bg-amber-500';
  return 'bg-emerald-500';
}

export default function RiskParametersDashboard() {
  const { success, error: toastError } = useToast();
  const { riskConfig, setRiskConfig } = useAppStore();
  const [localConfig, setLocalConfig] = useState({ ...riskConfig });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [ddStatus, setDdStatus] = useState<DrawdownStatus | null>(null);
  const [ddHistory, setDdHistory] = useState<DrawdownSnapshot[]>([]);
  const [perSymbol, setPerSymbol] = useState<PerSymbolDD>({});
  const [showHistory, setShowHistory] = useState(false);
  const [resettingPeak, setResettingPeak] = useState(false);

  const loadDrawdownData = useCallback(async () => {
    try {
      const [status, history, symbols] = await Promise.all([
        fetchDrawdownStatus(),
        fetchDrawdownHistory(),
        fetchPerSymbolDrawdown(),
      ]);
      setDdStatus(status);
      setDdHistory(history);
      setPerSymbol(symbols);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        setLoading(true);
        const config = await fetchRiskConfig();
        const merged = {
          ...localConfig,
          ...config,
          drawdownThrottleTiers: config.drawdownThrottleTiers || [
            { threshold: 0.5, scale: 0.5 },
            { threshold: 0.75, scale: 0.25 },
          ],
        };
        setLocalConfig(merged);
        setRiskConfig(merged);
      } catch (err: any) {
        setError(err.message || 'Failed to load risk config');
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
    loadDrawdownData();
    const iv = setInterval(loadDrawdownData, 15000);
    return () => clearInterval(iv);
  }, [setRiskConfig, loadDrawdownData]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateRiskConfig(localConfig);
      setRiskConfig(localConfig);
      setSaved(true);
      success('Risk configuration saved');
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      const msg = err.message || 'Failed to save risk config';
      setError(msg);
      toastError('Save failed', msg);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPeak = async () => {
    setResettingPeak(true);
    try {
      await resetPeakBalance();
      success('Peak balance reset');
      await loadDrawdownData();
    } catch (err: any) {
      toastError('Reset failed', err.message);
    } finally {
      setResettingPeak(false);
    }
  };

  const SliderInput = ({
    label,
    value,
    onChange,
    min = 0,
    max = 100,
    step = 0.5,
    suffix = '%',
    unitHint,
  }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    unitHint?: string;
  }) => (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs gap-2">
        <span className="text-slate-400">
          {label}
          {unitHint && <span className="text-slate-600 ml-1">({unitHint})</span>}
        </span>
        <span className="text-white font-mono shrink-0">
          {suffix === '%' ? (value * 100).toFixed(1) : value.toFixed(suffix === 'x' ? 0 : 2)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={suffix === '%' ? value * 100 : value}
        onChange={(e) =>
          onChange(suffix === '%' ? parseFloat(e.target.value) / 100 : parseFloat(e.target.value))
        }
        className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-sky-500"
      />
    </div>
  );

  if (loading) {
    return (
      <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          <span className="ml-2 text-xs text-slate-400">Loading risk configuration...</span>
        </div>
      </div>
    );
  }

  const ddFractionMax =
    ddStatus && localConfig.maxDrawdownPercent > 0
      ? ddStatus.drawdownPercent / localConfig.maxDrawdownPercent
      : 0;
  const ddFractionDaily =
    ddStatus && localConfig.maxDailyDrawdownPercent > 0
      ? ddStatus.dailyDrawdownPercent / localConfig.maxDailyDrawdownPercent
      : 0;
  const ddFractionWeekly =
    ddStatus && localConfig.maxWeeklyDrawdownPercent > 0
      ? ddStatus.weeklyDrawdownPercent / localConfig.maxWeeklyDrawdownPercent
      : 0;

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Shield className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Risk Parameters</h2>
            <p className="text-[10px] text-slate-500">
              Account / portfolio limits only — no SL/TP here
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${
            saved ? 'bg-emerald-600' : 'bg-sky-600 hover:bg-sky-700'
          }`}
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : saved ? (
            <Check className="w-3.5 h-3.5" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Configuration'}
        </button>
      </div>

      {saved && (
        <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center gap-2">
          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <p className="text-xs text-emerald-400">Configuration saved successfully.</p>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}

      {/* ── Drawdown Live Status ── */}
      {ddStatus && (
        <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-semibold text-white">Drawdown Monitor</span>
            </div>
            <div className="flex items-center gap-2">
              {ddStatus.throttleScale < 1 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">
                  Throttle {(ddStatus.throttleScale * 100).toFixed(0)}%
                </span>
              )}
              {ddStatus.cooldownRemainingMs > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Cooldown {Math.ceil(ddStatus.cooldownRemainingMs / 60000)}m
                </span>
              )}
              <button
                onClick={handleResetPeak}
                disabled={resettingPeak}
                className="text-[10px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 flex items-center gap-1"
              >
                {resettingPeak ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RotateCcw className="w-3 h-3" />
                )}
                Reset Peak
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* Daily DD */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-500">Daily</span>
                <span className={ddColor(ddFractionDaily)}>{pct(ddStatus.dailyDrawdownPercent)}</span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${ddBg(ddFractionDaily)}`}
                  style={{ width: `${Math.min(ddFractionDaily * 100, 100)}%` }}
                />
              </div>
              <p className="text-[9px] text-slate-600">
                limit {pct(localConfig.maxDailyDrawdownPercent)} | peak {ddStatus.dailyPeak.toFixed(2)}
              </p>
            </div>

            {/* Weekly DD */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-500">Weekly</span>
                <span className={ddColor(ddFractionWeekly)}>{pct(ddStatus.weeklyDrawdownPercent)}</span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${ddBg(ddFractionWeekly)}`}
                  style={{ width: `${Math.min(ddFractionWeekly * 100, 100)}%` }}
                />
              </div>
              <p className="text-[9px] text-slate-600">
                limit {pct(localConfig.maxWeeklyDrawdownPercent)} | peak {ddStatus.weeklyPeak.toFixed(2)}
              </p>
            </div>

            {/* Max DD */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-500">Max</span>
                <span className={ddColor(ddFractionMax)}>{pct(ddStatus.drawdownPercent)}</span>
              </div>
              <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${ddBg(ddFractionMax)}`}
                  style={{ width: `${Math.min(ddFractionMax * 100, 100)}%` }}
                />
              </div>
              <p className="text-[9px] text-slate-600">
                limit {pct(localConfig.maxDrawdownPercent)} | peak {ddStatus.peakBalance.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Per-symbol */}
          {Object.keys(perSymbol).length > 0 && (
            <div className="pt-2 border-t border-slate-700/50">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Per-Symbol</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(perSymbol).map(([sym, data]) => (
                  <div key={sym} className="flex items-center justify-between text-[10px] bg-slate-800/50 rounded px-2 py-1">
                    <span className="text-slate-300 font-mono">{sym}</span>
                    <span className={data.drawdownPercent > 0.05 ? 'text-red-400' : 'text-slate-400'}>
                      {pct(data.drawdownPercent)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* History toggle */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-300"
          >
            <Activity className="w-3 h-3" />
            History ({ddHistory.length} snapshots)
            {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {showHistory && ddHistory.length > 0 && (
            <div className="max-h-32 overflow-y-auto text-[10px] font-mono space-y-0.5">
              {ddHistory.slice(-20).reverse().map((s, i) => (
                <div key={i} className="flex justify-between text-slate-400 px-1">
                  <span>{new Date(s.timestamp).toLocaleTimeString()}</span>
                  <span>eq {s.equity.toFixed(2)}</span>
                  <span className={s.layer !== 'ok' ? 'text-red-400' : ''}>
                    dd {pct(s.drawdownPercent)} {s.layer !== 'ok' ? `[${s.layer}]` : ''}
                  </span>
                  {s.throttleScale < 1 && (
                    <span className="text-amber-400">T{(s.throttleScale * 100).toFixed(0)}%</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Risk Sliders ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <SliderInput
          label="Max Position Size"
          unitHint="% of account"
          value={localConfig.maxPositionSizePercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxPositionSizePercent: v }))}
          max={20}
          suffix="%"
        />
        <SliderInput
          label="Max Daily Loss"
          unitHint="% of account"
          value={localConfig.maxDailyLossPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxDailyLossPercent: v }))}
          max={20}
          suffix="%"
        />
        <SliderInput
          label="Max Drawdown (trailing)"
          unitHint="% from peak"
          value={localConfig.maxDrawdownPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxDrawdownPercent: v }))}
          max={50}
          suffix="%"
        />
        <SliderInput
          label="Daily Drawdown"
          unitHint="% resets midnight"
          value={localConfig.maxDailyDrawdownPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxDailyDrawdownPercent: v }))}
          max={20}
          suffix="%"
        />
        <SliderInput
          label="Weekly Drawdown"
          unitHint="% resets Monday"
          value={localConfig.maxWeeklyDrawdownPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxWeeklyDrawdownPercent: v }))}
          max={30}
          suffix="%"
        />
        <SliderInput
          label="Cooldown After Halt"
          unitHint="minutes"
          value={localConfig.drawdownCooldownMinutes}
          onChange={(v) => setLocalConfig((p) => ({ ...p, drawdownCooldownMinutes: v }))}
          min={0}
          max={480}
          step={15}
          suffix=" min"
        />
        <SliderInput
          label="Max Open Positions"
          unitHint="count"
          value={localConfig.maxOpenPositions}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxOpenPositions: v }))}
          min={1}
          max={20}
          step={1}
          suffix="x"
        />
        <SliderInput
          label="Max Trades Per Day"
          unitHint="count"
          value={localConfig.maxTradesPerDay}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxTradesPerDay: v }))}
          min={1}
          max={50}
          step={1}
          suffix="x"
        />
        <SliderInput
          label="Min ML Confidence"
          unitHint="%"
          value={localConfig.minConfidenceThreshold}
          onChange={(v) => setLocalConfig((p) => ({ ...p, minConfidenceThreshold: v }))}
          max={100}
          suffix="%"
        />
        <SliderInput
          label="Max Slippage"
          unitHint="%"
          value={localConfig.slippageProtectionPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, slippageProtectionPercent: v }))}
          max={5}
          suffix="%"
        />
      </div>

      {/* ── Throttle Tiers ── */}
      <div className="pt-3 border-t border-slate-800">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">
          Gradual Position Sizing (Drawdown Throttle)
        </p>
        <div className="space-y-2">
          {(localConfig.drawdownThrottleTiers || []).map((tier, idx) => (
            <div key={idx} className="flex items-center gap-3 text-xs">
              <span className="text-slate-400 w-24 shrink-0">
                At {(tier.threshold * 100).toFixed(0)}% of limit
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={tier.threshold * 100}
                onChange={(e) => {
                  const tiers = [...(localConfig.drawdownThrottleTiers || [])];
                  tiers[idx] = { ...tiers[idx], threshold: Number(e.target.value) / 100 };
                  setLocalConfig((p) => ({ ...p, drawdownThrottleTiers: tiers }));
                }}
                className="w-20 accent-amber-500"
              />
              <span className="text-slate-400">→ size</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={tier.scale * 100}
                onChange={(e) => {
                  const tiers = [...(localConfig.drawdownThrottleTiers || [])];
                  tiers[idx] = { ...tiers[idx], scale: Number(e.target.value) / 100 };
                  setLocalConfig((p) => ({ ...p, drawdownThrottleTiers: tiers }));
                }}
                className="w-20 accent-sky-500"
              />
              <span className="text-white font-mono w-10">{(tier.scale * 100).toFixed(0)}%</span>
              <button
                onClick={() => {
                  const tiers = (localConfig.drawdownThrottleTiers || []).filter((_, i) => i !== idx);
                  setLocalConfig((p) => ({ ...p, drawdownThrottleTiers: tiers }));
                }}
                className="text-red-400 hover:text-red-300 text-xs"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              const tiers = [...(localConfig.drawdownThrottleTiers || []), { threshold: 0.9, scale: 0.1 }];
              setLocalConfig((p) => ({ ...p, drawdownThrottleTiers: tiers }));
            }}
            className="text-[10px] text-sky-400 hover:text-sky-300"
          >
            + Add tier
          </button>
        </div>
      </div>

      {/* ── ML Strategy Gates ── */}
      <div className="pt-3 border-t border-slate-800 space-y-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
          ML strategy gates
        </p>
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={Boolean(localConfig.mlRegimeGateEnabled)}
            onChange={(e) =>
              setLocalConfig((p) => ({ ...p, mlRegimeGateEnabled: e.target.checked }))
            }
            className="mt-0.5 rounded border-slate-600 bg-slate-800 text-sky-500"
          />
          <span className="text-xs text-slate-300 leading-relaxed">
            Regime gate — block or tighten BUY in high volatility / downtrend
          </span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={Boolean(localConfig.mlShadowMode)}
            onChange={(e) =>
              setLocalConfig((p) => ({ ...p, mlShadowMode: e.target.checked }))
            }
            className="mt-0.5 rounded border-slate-600 bg-slate-800 text-amber-500"
          />
          <span className="text-xs text-slate-300 leading-relaxed">
            Shadow mode — log would-be BUY orders without executing (see{' '}
            <Link href="/dashboard/ml-shadow" className="text-sky-400 underline">
              ML Shadow Log
            </Link>
            )
          </span>
        </label>
      </div>

      <div className="flex items-start gap-2 p-3 bg-sky-500/5 border border-sky-500/20 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-sky-300/80">
          Stop loss & take profit are configured per symbol on{' '}
          <Link href="/dashboard/trading-profiles" className="text-sky-400 underline">
            Trading Profiles
          </Link>
          . Models are trained under ML Training and activated under ML Models.
        </p>
      </div>
    </div>
  );
}
