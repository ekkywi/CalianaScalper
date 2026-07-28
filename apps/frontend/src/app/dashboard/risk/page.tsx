'use client';

import RiskParametersDashboard from '@/components/risk/RiskParametersDashboard';
import PositionSizingCalculator from '@/components/risk/PositionSizingCalculator';
import EmergencyCircuitBreaker from '@/components/emergency/EmergencyCircuitBreaker';

export default function RiskPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">Risk Management</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Portfolio limits and emergency controls — SL/TP live on Trading Profiles
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RiskParametersDashboard />
        <PositionSizingCalculator />
      </div>
      <EmergencyCircuitBreaker />
    </div>
  );
}