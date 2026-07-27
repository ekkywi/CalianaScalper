'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { addSymbol } from '@/services/api';

export default function AddSymbolModal({ onAdded }: { onAdded: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [symbolInput, setSymbolInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) {
        setIsOpen(false);
        setError('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, loading]);

  const close = () => {
    if (loading) return;
    setIsOpen(false);
    setError('');
    setSymbolInput('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbolInput.trim()) return;
    setLoading(true);
    setError('');

    try {
      await addSymbol(symbolInput.trim().toUpperCase());
      setSymbolInput('');
      setIsOpen(false);
      onAdded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const modal =
    isOpen && mounted
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
            onClick={close}
            role="presentation"
          >
            <div
              className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-sm shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-symbol-title"
            >
              <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-800/80">
                <h3 id="add-symbol-title" className="text-sm font-semibold text-white">
                  Tambah Simbol Pantauan
                </h3>
                <button
                  type="button"
                  onClick={close}
                  disabled={loading}
                  className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                  aria-label="Tutup"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-4 space-y-3">
                <div>
                  <label htmlFor="add-symbol-input" className="text-xs text-slate-400 mb-1.5 block">
                    Symbol
                  </label>
                  <input
                    id="add-symbol-input"
                    type="text"
                    placeholder="Contoh: SOLUSDT, ADAUSDT"
                    value={symbolInput}
                    onChange={(e) => setSymbolInput(e.target.value)}
                    autoFocus
                    className="w-full bg-slate-800 border border-slate-700 text-white px-3 py-2 rounded-lg text-sm font-mono focus:outline-none focus:border-sky-500 uppercase"
                  />
                </div>

                {error && <p className="text-xs text-red-400">{error}</p>}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={close}
                    disabled={loading}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition disabled:opacity-50"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={loading || !symbolInput.trim()}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium rounded-lg transition disabled:opacity-50"
                  >
                    {loading ? 'Memproses...' : 'Simpan & Pantau'}
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-sky-600 hover:bg-sky-700 text-white transition-colors"
      >
        <Plus className="w-3 h-3" />
        Tambah Koin
      </button>
      {modal}
    </>
  );
}
