// apps/frontend/src/components/layout/Sidebar.tsx
// Sidebar navigasi dengan semua menu baru

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ConnectionStatus from '@/components/layout/ConnectionStatus';
import {
  Activity, BarChart3, LayoutDashboard,
  Brain, Bell, Terminal, Send, Shield, SlidersHorizontal, GraduationCap,
  TrendingUp, Eye,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    label: 'Main',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Trading',
    items: [
      { href: '/dashboard/trading-profiles', label: 'Trading Profiles', icon: SlidersHorizontal },
      { href: '/dashboard/risk', label: 'Risk Management', icon: Shield },
      { href: '/dashboard/orders', label: 'Orders', icon: Send },
      { href: '/dashboard/positions', label: 'Positions', icon: Activity },
    ],
  },
  {
    label: 'ML',
    items: [
      { href: '/dashboard/ml-training', label: 'ML Training', icon: GraduationCap },
      { href: '/dashboard/ml-models', label: 'ML Models', icon: Brain },
      { href: '/dashboard/ml-predictions', label: 'ML Predictions', icon: TrendingUp },
      { href: '/dashboard/ml-shadow', label: 'ML Shadow Log', icon: Eye },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { href: '/dashboard/performance', label: 'Performance', icon: BarChart3 },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
      { href: '/dashboard/logs', label: 'System Logs', icon: Terminal },
      { href: '/dashboard/health', label: 'System Health', icon: Activity },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  return (
    <aside className={`${expanded ? 'w-56' : 'w-16'} h-full bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 transition-all duration-200`}>
      {/* Logo / Brand */}
      <div className="h-14 flex items-center justify-center lg:justify-start lg:px-4 border-b border-slate-800">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shrink-0">
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          {expanded && (
            <span className="text-sm font-semibold text-white tracking-tight">Caliana</span>
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 overflow-y-auto custom-scrollbar">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-3">
            {expanded && (
              <p className="px-4 text-[10px] text-slate-600 uppercase tracking-wider font-medium mb-1.5">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5 px-2">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        active
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                      title={expanded ? '' : item.label}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {expanded && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Connection Status — dots only */}
      <div className="p-3 border-t border-slate-800 flex justify-center">
        <ConnectionStatus />
      </div>
    </aside>
  );
}
