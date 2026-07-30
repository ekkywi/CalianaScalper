'use client';

import Link from 'next/link';
import MlDecisionLogPanel from '@/components/monitoring/MlDecisionLogPanel';

export default function MlDecisionsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">ML Decision Log</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Full history of orchestrator decisions per candle — why BUY executed or was
          blocked (confidence, regime, pair drift, holding, shadow).
        </p>
      </div>

      <MlDecisionLogPanel />

      <p className="text-[11px] text-slate-600">
        Latest signals:{' '}
        <Link
          href="/dashboard/ml-predictions"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          ML Predictions
        </Link>
        . Shadow-only view:{' '}
        <Link
          href="/dashboard/ml-shadow"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          ML Shadow Log
        </Link>
        .
      </p>
    </div>
  );
}
