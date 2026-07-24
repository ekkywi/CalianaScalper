'use client';

import PositionManagementPanel from '@/components/emergency/PositionManagementPanel';
import RealTimePnL from '@/components/monitoring/RealTimePnL';

export default function PositionsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">Positions</h1>
        <p className="text-xs text-slate-500 mt-0.5">Manage open positions, set SL/TP, and monitor P&L</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PositionManagementPanel />
        <RealTimePnL />
      </div>
    </div>
  );
}