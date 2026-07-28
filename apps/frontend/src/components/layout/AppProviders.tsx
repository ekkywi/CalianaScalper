'use client';

import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';

/** Client providers mounted from the root layout */
export default function AppProviders({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
