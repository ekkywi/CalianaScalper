'use client';

import PerformanceDashboard from '@/components/monitoring/PerformanceDashboard';
import TradeHistory from '@/components/monitoring/TradeHistory';

export default function PerformancePage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div className="mb-2">
        <h1 className="text-lg font-semibold text-white">Performance</h1>
        <p className="text-xs text-slate-500 mt-0.5">Trading performance metrics and trade history</p>
      </div>
      <PerformanceDashboard />
      <TradeHistory />
    </div>
  );
}