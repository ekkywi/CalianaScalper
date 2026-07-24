'use client';

import SystemHealthMonitor from '@/components/monitoring/SystemHealthMonitor';

export default function HealthPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">System Health</h1>
        <p className="text-xs text-slate-500 mt-0.5">Monitor service status and system uptime</p>
      </div>
      <div className="max-w-md">
        <SystemHealthMonitor />
      </div>
    </div>
  );
}