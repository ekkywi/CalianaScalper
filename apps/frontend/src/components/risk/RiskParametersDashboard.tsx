// apps/frontend/src/components/risk/RiskParametersDashboard.tsx
// Panel untuk mengatur parameter risiko global — TERHUBUNG ke backend API

'use client';

import { useState, useEffect } from 'react';
import { useAppStore } from '@/store/app-store';
import { Shield, AlertTriangle, Save, Loader2 } from 'lucide-react';
import { fetchRiskConfig, updateRiskConfig } from '@/services/api-extended';

export default function RiskParametersDashboard() {
  const { riskConfig, setRiskConfig } = useAppStore();
  const [localConfig, setLocalConfig] = useState({ ...riskConfig });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Load risk config from backend on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        setLoading(true);
        const config = await fetchRiskConfig();
        setLocalConfig(config);
        setRiskConfig(config);
      } catch (err: any) {
        setError(err.message || 'Failed to load risk config');
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, [setRiskConfig]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Kirim ke backend API
      await updateRiskConfig(localConfig);
      // Update local store setelah sukses
      setRiskConfig(localConfig);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to save risk config');
    } finally {
      setSaving(false);
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
  }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
  }) => (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-white font-mono">
          {suffix === '%' ? (value * 100).toFixed(1) : value.toFixed(2)}
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
        className="w-full h-1.5 bg-slate-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
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

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Shield className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Risk Parameters</h2>
            <p className="text-[10px] text-slate-500">Global risk management settings</p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
        </button>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p className="text-xs text-red-400 font-mono">{error}</p>
        </div>
      )}

      {/* Risk Parameters Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <SliderInput
          label="Max Position Size (% of Account)"
          value={localConfig.maxPositionSizePercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxPositionSizePercent: v }))}
          max={20}
          suffix="%"
        />
        <SliderInput
          label="Stop Loss (%)"
          value={localConfig.stopLossPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, stopLossPercent: v }))}
          max={15}
          suffix="%"
        />
        <SliderInput
          label="Take Profit (%)"
          value={localConfig.takeProfitPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, takeProfitPercent: v }))}
          max={30}
          suffix="%"
        />
        <SliderInput
          label="Max Daily Loss (% of Account)"
          value={localConfig.maxDailyLossPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxDailyLossPercent: v }))}
          max={20}
          suffix="%"
        />
        <SliderInput
          label="Max Drawdown (%)"
          value={localConfig.maxDrawdownPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxDrawdownPercent: v }))}
          max={50}
          suffix="%"
        />
        <SliderInput
          label="Max Open Positions"
          value={localConfig.maxOpenPositions}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxOpenPositions: v }))}
          min={1}
          max={20}
          step={1}
          suffix="x"
        />
        <SliderInput
          label="Max Trades Per Day"
          value={localConfig.maxTradesPerDay}
          onChange={(v) => setLocalConfig((p) => ({ ...p, maxTradesPerDay: v }))}
          min={1}
          max={50}
          step={1}
          suffix="x"
        />
        <SliderInput
          label="Min ML Confidence"
          value={localConfig.minConfidenceThreshold}
          onChange={(v) => setLocalConfig((p) => ({ ...p, minConfidenceThreshold: v }))}
          max={100}
          suffix="%"
        />
        <SliderInput
          label="Max Slippage"
          value={localConfig.slippageProtectionPercent}
          onChange={(v) => setLocalConfig((p) => ({ ...p, slippageProtectionPercent: v }))}
          max={5}
          suffix="%"
        />
      </div>

      {/* Warning */}
      <div className="mt-4 flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-400/80">
          Changes to risk parameters are applied immediately. High risk values can lead to significant losses.
        </p>
      </div>
    </div>
  );
}