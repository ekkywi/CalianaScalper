// apps/frontend/src/components/notifications/AlertConfigurationCenter.tsx
// Panel untuk membuat aturan notifikasi

'use client';

import { useState } from 'react';
import { Bell, Plus, Trash2, Play, Pause } from 'lucide-react';

const TRIGGER_TYPES = [
  { value: 'price_above', label: 'Price Above' },
  { value: 'price_below', label: 'Price Below' },
  { value: 'pnl_threshold', label: 'P&L Threshold' },
  { value: 'drawdown', label: 'Drawdown Alert' },
  { value: 'signal', label: 'Signal Confirmation' },
  { value: 'error', label: 'System Error' },
];

const CHANNELS = [
  { value: 'in_app', label: 'In-App' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'discord', label: 'Discord' },
  { value: 'email', label: 'Email' },
];

interface Rule {
  id: string;
  triggerType: string;
  symbol: string;
  condition: string;
  channel: string;
  enabled: boolean;
}

export default function AlertConfigurationCenter() {
  const [rules, setRules] = useState<Rule[]>([]);

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      { id: `rule-${Date.now()}`, triggerType: 'price_above', symbol: '', condition: '', channel: 'in_app', enabled: true },
    ]);
  };

  const toggleRule = (id: string) => {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  const deleteRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 lg:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Bell className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Alert Rules</h2>
            <p className="text-[10px] text-slate-500">
              {rules.length} local draft rules · persistence / channels deferred (Phase 4)
            </p>
          </div>
        </div>
        <button
          onClick={addRule}
          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Rule
        </button>
      </div>

      <div className="space-y-2.5">
        {rules.map((rule) => (
          <div key={rule.id} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 flex-1">
                <select
                  value={rule.triggerType}
                  onChange={(e) => setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, triggerType: e.target.value } : r))}
                  className="bg-slate-800 border border-slate-700 text-white px-2 py-1 rounded text-[10px] focus:outline-none focus:border-blue-500"
                >
                  {TRIGGER_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Symbol"
                  value={rule.symbol}
                  onChange={(e) => setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, symbol: e.target.value.toUpperCase() } : r))}
                  className="bg-slate-800 border border-slate-700 text-white px-2 py-1 rounded text-[10px] w-20 font-mono focus:outline-none focus:border-blue-500"
                />
                <input
                  type="text"
                  placeholder="Condition"
                  value={rule.condition}
                  onChange={(e) => setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, condition: e.target.value } : r))}
                  className="bg-slate-800 border border-slate-700 text-white px-2 py-1 rounded text-[10px] w-20 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={rule.channel}
                  onChange={(e) => setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, channel: e.target.value } : r))}
                  className="bg-slate-800 border border-slate-700 text-white px-2 py-1 rounded text-[10px] focus:outline-none focus:border-blue-500"
                >
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => toggleRule(rule.id)}
                  className={`p-1 rounded ${rule.enabled ? 'text-emerald-400' : 'text-slate-500'}`}
                >
                  {rule.enabled ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => deleteRule(rule.id)}
                  className="p-1 rounded text-slate-500 hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}