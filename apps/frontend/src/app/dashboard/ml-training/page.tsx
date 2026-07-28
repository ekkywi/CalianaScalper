'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { fetchSymbols } from '@/services/api';
import {
  fetchTradingProfiles,
  strategyLabelPreview,
  strategyTrain,
  type TradingProfileRow,
} from '@/services/api-strategy';
import { useToast } from '@/components/ui/toast';

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

export default function MlTrainingPage() {
  const { success, error: toastError } = useToast();
  const [symbols, setSymbols] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<TradingProfileRow[]>([]);
  const [source, setSource] = useState<'manual' | 'from_profile'>('manual');
  const [symbol, setSymbol] = useState('');
  const [profileId, setProfileId] = useState('');
  const [name, setName] = useState('');
  const [sl, setSl] = useState(0.03);
  const [tp, setTp] = useState(0.06);
  const [horizon, setHorizon] = useState(96);
  const [setActive, setSetActive] = useState(true);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [wl, prof] = await Promise.all([fetchSymbols(), fetchTradingProfiles()]);
    const list = (Array.isArray(wl) ? wl : [])
      .map((s: any) => String(s.symbol || s).toUpperCase())
      .filter(Boolean);
    setSymbols(list);
    setProfiles(prof.profiles || []);
    if (!symbol && list[0]) setSymbol(list[0]);
  }, [symbol]);

  useEffect(() => {
    load().catch((e) => {
      setError(e.message);
      toastError('Failed to load training form', e.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const symbolProfiles = profiles.filter((p) => p.symbol === symbol);

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const result =
        source === 'from_profile'
          ? await strategyLabelPreview({ symbol, profileId })
          : await strategyLabelPreview({
              symbol,
              stopLossPercent: sl,
              takeProfitPercent: tp,
              maxHorizonCandles: horizon,
            });
      setPreview(result);
      success('Label preview ready');
    } catch (err: any) {
      setError(err.message);
      toastError('Label preview failed', err.message);
    } finally {
      setBusy(false);
    }
  };

  const runTrain = async () => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        symbol,
        name: name || undefined,
        setActive,
        source,
      };
      if (source === 'from_profile') {
        body.profileId = profileId;
      } else {
        body.stopLossPercent = sl;
        body.takeProfitPercent = tp;
        body.maxHorizonCandles = horizon;
      }
      const res = await strategyTrain(body);
      const detail = res.labelConfig
        ? `SL ${(res.labelConfig.stop_loss_percent * 100).toFixed(1)}% / TP ${(res.labelConfig.take_profit_percent * 100).toFixed(1)}% — check ML Models when done.`
        : 'Check ML Models when training finishes.';
      setMsg(`Training started. ${detail}`);
      success('Training started', detail);
    } catch (err: any) {
      setError(err.message);
      toastError('Training failed to start', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">ML Training</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Set label params manually or copy from a trading profile — creates a new model
            version (does not overwrite others)
          </p>
        </div>
        <button
          type="button"
          onClick={() => load()}
          className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
          {error}
        </div>
      )}
      {msg && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
          {msg}
        </div>
      )}

      <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 space-y-4 max-w-2xl">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSource('manual')}
            className={`px-3 py-1.5 rounded-lg text-xs ${
              source === 'manual' ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400'
            }`}
          >
            Manual params
          </button>
          <button
            type="button"
            onClick={() => setSource('from_profile')}
            className={`px-3 py-1.5 rounded-lg text-xs ${
              source === 'from_profile'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            From trading profile
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1 text-[10px] text-slate-500">
            Symbol
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs font-mono text-slate-200"
            >
              {symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[10px] text-slate-500">
            Model name (optional)
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${symbol || 'SYM'}-v1`}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-200"
            />
          </label>
        </div>

        {source === 'from_profile' ? (
          <label className="block space-y-1 text-[10px] text-slate-500">
            Trading profile
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-2 text-xs text-slate-200"
            >
              <option value="">Select profile…</option>
              {symbolProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — SL {pct(p.stopLossPercent)} / TP {pct(p.takeProfitPercent)} /{' '}
                  {p.maxHorizonCandles}c
                </option>
              ))}
            </select>
            {symbolProfiles.length === 0 && (
              <span className="text-amber-400/90">
                No profiles for {symbol}. Create one under Trading Profiles first.
              </span>
            )}
          </label>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[10px]">
            <label className="space-y-1 text-slate-500">
              SL {pct(sl)}
              <input
                type="range"
                min={0.5}
                max={15}
                step={0.5}
                value={sl * 100}
                onChange={(e) => setSl(Number(e.target.value) / 100)}
                className="w-full accent-sky-500"
              />
            </label>
            <label className="space-y-1 text-slate-500">
              TP {pct(tp)}
              <input
                type="range"
                min={0.5}
                max={30}
                step={0.5}
                value={tp * 100}
                onChange={(e) => setTp(Number(e.target.value) / 100)}
                className="w-full accent-sky-500"
              />
            </label>
            <label className="space-y-1 text-slate-500">
              Horizon {horizon}c
              <input
                type="range"
                min={48}
                max={384}
                step={16}
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                className="w-full accent-sky-500"
              />
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={setActive}
            onChange={(e) => setSetActive(e.target.checked)}
            className="rounded border-slate-600"
          />
          Set as active model after train (BUY still blocked until profile matches)
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || (source === 'from_profile' && !profileId)}
            onClick={runPreview}
            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs disabled:opacity-50"
          >
            {busy ? '…' : 'Preview labels'}
          </button>
          <button
            type="button"
            disabled={busy || (source === 'from_profile' && !profileId) || !symbol}
            onClick={runTrain}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-xs font-medium disabled:opacity-50"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Start training
          </button>
        </div>

        {preview && (
          <p className="text-[10px] text-slate-400 font-mono">
            Preview: {preview.n_positive ?? 0} pos / {preview.train_rows ?? 0} train ·{' '}
            {preview.resolved_rows ?? 0} resolved
            {preview.trainable ? ' · trainable' : ` · ${preview.hint || 'not trainable'}`}
          </p>
        )}
      </div>
    </div>
  );
}
