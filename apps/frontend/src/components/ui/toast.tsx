'use client';

import * as Toast from '@radix-ui/react-toast';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastVariant = 'success' | 'error' | 'info';

type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastItem = ToastInput & {
  id: string;
  variant: ToastVariant;
  open: boolean;
};

type ToastContextValue = {
  toast: (input: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const VARIANT_STYLES: Record<
  ToastVariant,
  { border: string; icon: typeof CheckCircle; iconClass: string }
> = {
  success: {
    border: 'border-emerald-500/30',
    icon: CheckCircle,
    iconClass: 'text-emerald-400',
  },
  error: {
    border: 'border-red-500/30',
    icon: AlertTriangle,
    iconClass: 'text-red-400',
  },
  info: {
    border: 'border-sky-500/30',
    icon: Info,
    iconClass: 'text-sky-400',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((t) => (t.id === id ? { ...t, open: false } : t)),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((input: ToastInput) => {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `toast-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setItems((prev) => [
      ...prev.slice(-4),
      {
        id,
        title: input.title,
        description: input.description,
        variant: input.variant ?? 'info',
        durationMs: input.durationMs,
        open: true,
      },
    ]);
  }, []);

  const api = useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (title, description) =>
        toast({ title, description, variant: 'success' }),
      error: (title, description) =>
        toast({ title, description, variant: 'error' }),
      info: (title, description) => toast({ title, description, variant: 'info' }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={api}>
      <Toast.Provider swipeDirection="right" duration={4200}>
        {children}
        {items.map((item) => {
          const style = VARIANT_STYLES[item.variant];
          const Icon = style.icon;
          return (
            <Toast.Root
              key={item.id}
              open={item.open}
              duration={item.durationMs ?? 4200}
              onOpenChange={(open) => {
                if (!open) {
                  dismiss(item.id);
                  window.setTimeout(() => remove(item.id), 200);
                }
              }}
              className={cn(
                'pointer-events-auto relative flex w-[360px] max-w-[calc(100vw-2rem)] gap-3 rounded-xl border bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-sm transition-all',
                'data-[state=open]:opacity-100 data-[state=closed]:opacity-0',
                'data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
                'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]',
                style.border,
              )}
            >
              <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.iconClass)} />
              <div className="min-w-0 flex-1 pr-5">
                <Toast.Title className="text-xs font-semibold text-white">
                  {item.title}
                </Toast.Title>
                {item.description ? (
                  <Toast.Description className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    {item.description}
                  </Toast.Description>
                ) : null}
              </div>
              <Toast.Close
                className="absolute right-2 top-2 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-white"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </Toast.Close>
            </Toast.Root>
          );
        })}
        <Toast.Viewport className="fixed bottom-4 right-4 z-[200] flex max-h-screen w-auto flex-col gap-2 outline-none" />
      </Toast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
