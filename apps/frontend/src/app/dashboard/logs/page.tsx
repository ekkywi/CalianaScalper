'use client';

import SystemLogsViewer from '@/components/notifications/SystemLogsViewer';

export default function LogsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-white">System Logs</h1>
        <p className="text-xs text-slate-500 mt-0.5">Real-time event log stream with filtering</p>
      </div>
      <SystemLogsViewer />
    </div>
  );
}