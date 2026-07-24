'use client';

import NotificationCenter from '@/components/notifications/NotificationCenter';
import AlertConfigurationCenter from '@/components/notifications/AlertConfigurationCenter';

export default function NotificationsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-slate-100 p-4 lg:p-6 space-y-6">
      <div className="mb-2">
        <h1 className="text-lg font-semibold text-white">Notifications & Alerts</h1>
        <p className="text-xs text-slate-500 mt-0.5">Manage alert rules and view notification history</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NotificationCenter />
        <AlertConfigurationCenter />
      </div>
    </div>
  );
}