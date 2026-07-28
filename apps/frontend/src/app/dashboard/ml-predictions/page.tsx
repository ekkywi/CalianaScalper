'use client';

import Link from 'next/link';
import MlPredictionDisplay from '@/components/monitoring/MlPredictionDisplay';

export default function MlPredictionsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">ML Predictions</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Latest orchestrator signals from the active model per symbol — not the model
          library.
        </p>
      </div>

      <MlPredictionDisplay />

      <p className="text-[11px] text-slate-600">
        Models are managed under{' '}
        <Link href="/dashboard/ml-models" className="text-sky-400 hover:text-sky-300 underline">
          ML Models
        </Link>
        . Would-be trades (shadow) live under{' '}
        <Link href="/dashboard/ml-shadow" className="text-sky-400 hover:text-sky-300 underline">
          ML Shadow Log
        </Link>
        .
      </p>
    </div>
  );
}
