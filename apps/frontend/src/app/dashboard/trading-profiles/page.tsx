'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2,
  Plus,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { fetchSymbols } from '@/services/api';
import {
  activateTradingProfile,
  createTradingProfile,
  deleteTradingProfile,
  fetchCompatibleModels,
  fetchStrategyPairs,
  fetchTradingProfiles,
  type StrategyModelRow,
  type StrategyPairStatus,
  type TradingProfileRow,
} from '@/services/api-strategy';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/toast';

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

export default function TradingProfilesPage() {
  const { success, error: toastError, info } = useToast();
  const [profiles, setProfiles] = useState<TradingProfileRow[]>([]);
  const [pairs, setPairs] = useState<StrategyPairStatus[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TradingProfileRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expandedModels, setExpandedModels] = useState<Record<string, StrategyModelRow[] | 'loading' | null>>({});
  const [form, setForm] = useState({
    symbol: '',
    name: '',
    stopLossPercent: 0.03,
    takeProfitPercent: 0.06,
    maxHorizonCandles: 96,
    fromModelId: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wl, prof, pairData] = await Promise.all([
        fetchSymbols(),
        fetchTradingProfiles(),
        fetchStrategyPairs(),
      ]);
      const list = (Array.isArray(wl) ? wl : [])
        .map((s: any) => String(s.symbol || s).toUpperCase())
        .filter(Boolean);
      setSymbols(list);
      setProfiles(prof.profiles || []);
      setPairs(pairData.pairs || []);
      if (!form.symbol && list[0]) setForm((f) => ({ ...f, symbol: list[0] }));
    } catch (err: any) {
      const msg = err.message || 'Failed to load profiles';
      setError(msg);
      toastError('Failed to load profiles', msg);
    } finally {
      setLoading(false);
    }
  }, [form.symbol, toastError]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pairFor = (symbol: string) =>
    pairs.find((p) => p.symbol === symbol.toUpperCase());

  const handleCreate = async () => {
    if (!form.symbol || !form.name.trim()) {
      toastError('Missing fields', 'Symbol and name are required');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createTradingProfile({
        symbol: form.symbol,
        name: form.name.trim(),
        stopLossPercent: form.stopLossPercent,
        takeProfitPercent: form.takeProfitPercent,
        maxHorizonCandles: form.maxHorizonCandles,
        fromModelId: form.fromModelId || undefined,
      });
      setForm((f) => ({ ...f, name: '', fromModelId: '' }));
      success('Profile created', `${form.name.trim()} for ${form.symbol}`);
      await load();
    } catch (err: any) {
      const msg = err.message || 'Create failed';
      setError(msg);
      toastError('Create failed', msg);
    } finally {
      setCreating(false);
    }
  };

  const toggleCompatibleModels = async (profile: TradingProfileRow) => {
    const current = expandedModels[profile.id];
    if (current && current !== 'loading') {
      setExpandedModels((prev) => ({ ...prev, [profile.id]: null }));
      return;
    }
    setExpandedModels((prev) => ({ ...prev, [profile.id]: 'loading' }));
    try {
      const res = await fetchCompatibleModels(profile.id);
      const models = (res.models || []) as StrategyModelRow[];
      if (!models.length) {
        setExpandedModels((prev) => ({ ...prev, [profile.id]: null }));
        info('No compatible models', 'Train a model from this profile or adjust labels.');
        return;
      }
      setExpandedModels((prev) => ({ ...prev, [profile.id]: models }));
    } catch (err: any) {
      setExpandedModels((prev) => ({ ...prev, [profile.id]: null }));
      toastError('Could not load models', err.message);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteTradingProfile(deleteTarget.id);
      success('Profile deleted', deleteTarget.name);
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      toastError('Delete failed', err.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Trading Profiles</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Execution SL / TP / horizon per symbol — independent from ML training params
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 space-y-3">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">
          Create profile
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <select
            value={form.symbol}
            onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs font-mono"
          >
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Profile name"
            className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs"
          />
          <button
            type="button"
            disabled={creating || symbols.length === 0}
            onClick={handleCreate}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-xs font-medium disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create manual
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[10px]">
          <label className="space-y-1">
            <span className="text-slate-500">Stop Loss {pct(form.stopLossPercent)}</span>
            <input
              type="range"
              min={0.5}
              max={15}
              step={0.5}
              value={form.stopLossPercent * 100}
              onChange={(e) =>
                setForm((f) => ({ ...f, stopLossPercent: Number(e.target.value) / 100 }))
              }
              className="w-full accent-sky-500"
            />
          </label>
          <label className="space-y-1">
            <span className="text-slate-500">Take Profit {pct(form.takeProfitPercent)}</span>
            <input
              type="range"
              min={0.5}
              max={30}
              step={0.5}
              value={form.takeProfitPercent * 100}
              onChange={(e) =>
                setForm((f) => ({ ...f, takeProfitPercent: Number(e.target.value) / 100 }))
              }
              className="w-full accent-sky-500"
            />
          </label>
          <label className="space-y-1">
            <span className="text-slate-500">Horizon {form.maxHorizonCandles}c</span>
            <input
              type="range"
              min={48}
              max={384}
              step={16}
              value={form.maxHorizonCandles}
              onChange={(e) =>
                setForm((f) => ({ ...f, maxHorizonCandles: Number(e.target.value) }))
              }
              className="w-full accent-sky-500"
            />
          </label>
        </div>
        <p className="text-[10px] text-slate-600">
          Tip: to create from an existing model, open ML Models → activate model → use
          “Create profile from model”.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-slate-500 text-xs py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : profiles.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-xs text-slate-500">
          No trading profiles yet. Create one above for a watchlist symbol.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profiles.map((p) => {
            const pair = pairFor(p.symbol);
            const modelsPanel = expandedModels[p.id];
            return (
              <div
                key={p.id}
                className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{p.name}</p>
                    <p className="text-[10px] font-mono text-slate-500">{p.symbol}</p>
                  </div>
                  {p.isActive ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                      ACTIVE
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-500">
                      idle
                    </span>
                  )}
                </div>
                <p className="text-[10px] font-mono text-slate-300">
                  SL {pct(p.stopLossPercent)} · TP {pct(p.takeProfitPercent)} · horizon{' '}
                  {p.maxHorizonCandles}c
                </p>
                {!p.hasCompatibleModel ? (
                  <p className="text-[10px] text-amber-400/90 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    No compatible ML model yet — train one from this profile or activate a
                    matching model.
                  </p>
                ) : (
                  <p className="text-[10px] text-emerald-400/80 flex items-center gap-1.5">
                    <CheckCircle className="w-3 h-3" />
                    {p.compatibleModelCount} compatible model(s)
                  </p>
                )}
                {p.isActive && pair && (
                  <p
                    className={`text-[10px] ${
                      pair.blockBuy ? 'text-red-400' : 'text-slate-500'
                    }`}
                  >
                    Pair: {pair.message}
                  </p>
                )}
                {modelsPanel === 'loading' && (
                  <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading models…
                  </div>
                )}
                {Array.isArray(modelsPanel) && (
                  <ul className="rounded-lg border border-slate-800 bg-slate-950/50 p-2 space-y-1.5">
                    {modelsPanel.map((m) => (
                      <li key={m.id} className="text-[10px] text-slate-300 font-mono">
                        {m.name}
                        <span className="text-slate-600 ml-1.5">
                          SL {pct(m.labelConfig.stop_loss_percent)} / TP{' '}
                          {pct(m.labelConfig.take_profit_percent)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  {!p.isActive && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await activateTradingProfile(p.id);
                          success('Profile activated', p.name);
                          await load();
                        } catch (err: any) {
                          toastError('Activate failed', err.message);
                        }
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-[10px] font-medium"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleCompatibleModels(p)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
                  >
                    {Array.isArray(modelsPanel) ? (
                      <>
                        Hide models <ChevronUp className="w-3 h-3" />
                      </>
                    ) : (
                      <>
                        Show models <ChevronDown className="w-3 h-3" />
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(p)}
                    className="p-1.5 rounded text-slate-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete trading profile?"
        description={
          deleteTarget
            ? `Remove “${deleteTarget.name}” (${deleteTarget.symbol}). Active bindings using this profile will be cleared.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
