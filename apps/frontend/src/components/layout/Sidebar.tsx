// apps/frontend/src/components/layout/Sidebar.tsx
// Sidebar navigasi dengan semua menu baru

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { binanceTickerWS } from '@/services/binance-ws';
import {
  Activity, BarChart3, LayoutDashboard, Wifi, WifiOff, Shield,
  Brain, Bell, Terminal, AlertTriangle, Send, Settings, FileText, ChevronDown
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
      { href: '/dashboard/risk', label: 'Risk Management', icon: Shield },
      { href: '/dashboard/orders', label: 'Manual Order', icon: Send },
      { href: '/dashboard/positions', label: 'Positions', icon: Activity },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { href: '/dashboard/performance', label: 'Performance', icon: BarChart3 },
      { href: '/dashboard/ml-models', label: 'ML Models', icon: Brain },
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
  const [isConnected, setIsConnected] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const unsub = binanceTickerWS.onStatusChange((connected) => {
      setIsConnected(connected);
    });
    binanceTickerWS.connect();
    return () => unsub();
  }, []);

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  };

  return (
    <aside className={`${expanded ? 'w-56' : 'w-16'} bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 transition-all duration-200`}>
      {/* Logo / Brand */}
      <div className="h-14 flex items-center justify-center lg:justify-start lg:px-4 border-b border-slate-800">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center shrink-0">
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
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
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

      {/* Connection Status */}
      <div className="p-2 lg:p-3 border-t border-slate-800">
        <div className="flex items-center justify-center lg:justify-start gap-2 text-xs text-slate-500">
          {isConnected ? (
            <>
              <Wifi className="w-3 h-3 text-emerald-400 shrink-0" />
              {expanded && <span className="text-emerald-400">Live</span>}
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3 text-red-400 shrink-0" />
              {expanded && <span className="text-red-400">Disconnected</span>}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}