'use client';

import Link from 'next/link';
import MlShadowLogPanel from '@/components/monitoring/MlShadowLogPanel';

export default function MlShadowPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">ML Shadow Log</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Would-be BUY decisions when shadow mode or gates block execution — for debugging
          strategy pairing and risk gates without placing orders.
        </p>
      </div>

      <MlShadowLogPanel />

      <p className="text-[11px] text-slate-600">
        Enable shadow mode on{' '}
        <Link href="/dashboard/risk" className="text-sky-400 hover:text-sky-300 underline">
          Risk Management
        </Link>
        . Live signals are on{' '}
        <Link
          href="/dashboard/ml-predictions"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          ML Predictions
        </Link>
        . All blocked reasons:{' '}
        <Link
          href="/dashboard/ml-decisions"
          className="text-sky-400 hover:text-sky-300 underline"
        >
          ML Decision Log
        </Link>
        .
      </p>
    </div>
  );
}
