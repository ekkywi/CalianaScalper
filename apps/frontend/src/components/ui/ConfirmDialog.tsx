'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'default';
  loading?: boolean;
  /** When set, user must type this exact string before Confirm enables */
  requireTypedConfirm?: string;
  /** Optional extra content (e.g. checkbox) between description and actions */
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  requireTypedConfirm,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!open) {
      setTyped('');
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  const typedOk =
    !requireTypedConfirm || typed.trim() === requireTypedConfirm;
  const confirmClass =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700'
      : 'bg-sky-600 hover:bg-sky-700';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={() => {
        if (!loading) onCancel();
      }}
      role="presentation"
    >
      <div
        className="bg-slate-900 border border-slate-800 p-5 rounded-xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
      >
        <h3 id="confirm-dialog-title" className="text-sm font-semibold text-white mb-2">
          {title}
        </h3>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">{description}</p>
        {children && <div className="mb-4">{children}</div>}
        {requireTypedConfirm && (
          <div className="mb-5">
            <label className="text-[10px] text-slate-500 block mb-1.5">
              Type <span className="font-mono text-red-400">{requireTypedConfirm}</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={loading}
              autoFocus
              className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-red-500"
              placeholder={requireTypedConfirm}
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-3.5 py-2 text-xs text-slate-400 hover:text-white transition disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || !typedOk}
            className={`px-3.5 py-2 text-xs font-medium text-white rounded-lg transition disabled:opacity-50 flex items-center gap-1.5 ${confirmClass}`}
          >
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
