'use client';

import MlModelManagement from '@/components/strategy/MlModelManagement';
import MlPredictionDisplay from '@/components/monitoring/MlPredictionDisplay';
import MlShadowLogPanel from '@/components/monitoring/MlShadowLogPanel';

export default function MlModelsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div className="mb-2">
        <h1 className="text-lg font-semibold text-white">ML Models</h1>
        <p className="text-xs text-slate-500 mt-0.5">Manage machine learning models and view predictions</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MlModelManagement />
        <div className="space-y-6">
          <MlPredictionDisplay />
          <MlShadowLogPanel />
        </div>
      </div>
    </div>
  );
}