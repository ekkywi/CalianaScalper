'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  activateStrategyModel,
  createProfileFromModel,
  deleteStrategyModel,
  fetchStrategyModels,
  fetchStrategyPairs,
  syncStrategyModels,
  type StrategyModelRow,
  type StrategyPairStatus,
} from '@/services/api-strategy';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import PromptDialog from '@/components/ui/PromptDialog';
import { useToast } from '@/components/ui/toast';

function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function timeAgo(ms: number) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function MlModelsPage() {
  const { success, error: toastError } = useToast();
  const [models, setModels] = useState<StrategyModelRow[]>([]);
  const [pairs, setPairs] = useState<StrategyPairStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StrategyModelRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [profileFromModel, setProfileFromModel] = useState<StrategyModelRow | null>(null);
  const [creatingProfile, setCreatingProfile] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await syncStrategyModels().catch(() => undefined);
      const [m, p] = await Promise.all([fetchStrategyModels(), fetchStrategyPairs()]);
      setModels(m.models || []);
      setPairs(p.pairs || []);
    } catch (err: any) {
      const msg = err.message || 'Failed to load models';
      setError(msg);
      toastError('Failed to load models', msg);
    } finally {
      setLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const pairFor = (symbol: string) => pairs.find((x) => x.symbol === symbol);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteStrategyModel(deleteTarget.id);
      success('Model deleted', deleteTarget.name);
      setDeleteTarget(null);
      await load();
    } catch (err: any) {
      toastError('Delete failed', err.message);
    } finally {
      setDeleting(false);
    }
  };

  const confirmCreateProfile = async (name: string) => {
    if (!profileFromModel) return;
    setCreatingProfile(true);
    try {
      await createProfileFromModel({
        symbol: profileFromModel.symbol,
        name,
        fromModelId: profileFromModel.id,
      });
      success('Profile created', `${name} from ${profileFromModel.name}`);
      setProfileFromModel(null);
      await load();
    } catch (err: any) {
      toastError('Create profile failed', err.message);
    } finally {
      setCreatingProfile(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">ML Models</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Trained model library — activate without losing other versions. BUY requires an
            aligned trading profile. Live signals and shadow logs have their own menus.
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

      {loading && models.length === 0 ? (
        <div className="flex justify-center py-12 text-slate-500 text-xs gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading models…
        </div>
      ) : models.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-xs text-slate-500">
          No ML models yet. Train one under <span className="text-slate-300">ML Training</span>.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {models.map((m) => {
            const pair = pairFor(m.symbol);
            const lc = m.labelConfig;
            return (
              <div
                key={m.id}
                className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">{m.name}</p>
                    <p className="text-[10px] font-mono text-slate-500">
                      {m.symbol} · {m.algorithm} · {timeAgo(Number(m.trainedAt))}
                    </p>
                  </div>
                  {m.isActive ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                      ACTIVE
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-500">
                      stored
                    </span>
                  )}
                </div>
                <p className="text-[10px] font-mono text-slate-300">
                  Trained SL {pct(lc.stop_loss_percent)} · TP {pct(lc.take_profit_percent)} ·
                  horizon {lc.max_horizon_candles}c
                </p>
                {!m.hasCompatibleProfile ? (
                  <p className="text-[10px] text-amber-400/90 flex items-start gap-1.5">
                    <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                    No compatible trading profile — create one from this model or adjust a
                    profile.
                  </p>
                ) : (
                  <p className="text-[10px] text-emerald-400/80 flex items-center gap-1.5">
                    <CheckCircle className="w-3 h-3" />
                    {m.compatibleProfileCount} compatible profile(s)
                  </p>
                )}
                {m.isActive && pair?.blockBuy && (
                  <p className="text-[10px] text-red-400">{pair.message}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {!m.isActive && (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await activateStrategyModel(m.id);
                          success('Model activated', m.name);
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
                    onClick={() => setProfileFromModel(m)}
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300"
                  >
                    Create profile from model
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(m)}
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
        title="Delete ML model?"
        description={
          deleteTarget
            ? `Permanently remove “${deleteTarget.name}” (${deleteTarget.symbol}). This cannot be undone.`
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

      <PromptDialog
        open={Boolean(profileFromModel)}
        title="Create trading profile"
        description={
          profileFromModel
            ? `Copy SL/TP/horizon from “${profileFromModel.name}” into a new profile for ${profileFromModel.symbol}.`
            : undefined
        }
        label="Profile name"
        defaultValue={
          profileFromModel
            ? `${profileFromModel.symbol} from ${profileFromModel.name}`
            : ''
        }
        confirmLabel="Create profile"
        loading={creatingProfile}
        onConfirm={confirmCreateProfile}
        onCancel={() => {
          if (!creatingProfile) setProfileFromModel(null);
        }}
      />
    </div>
  );
}
