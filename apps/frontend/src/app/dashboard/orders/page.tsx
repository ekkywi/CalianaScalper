'use client';

import ManualOrderEntry from '@/components/emergency/ManualOrderEntry';

export default function OrdersPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">Manual Order Entry</h1>
        <p className="text-xs text-slate-500 mt-0.5">Place orders directly to the exchange</p>
      </div>
      <div className="max-w-md">
        <ManualOrderEntry />
      </div>
    </div>
  );
}