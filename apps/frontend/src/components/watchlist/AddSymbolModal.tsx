'use client';
import { useState } from 'react';
import { addSymbol } from '@/services/api';

export default function AddSymbolModal({ onAdded }: { onAdded: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [symbolInput, setSymbolInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbolInput) return;
    setLoading(true);
    setError('');

    try {
      await addSymbol(symbolInput.toUpperCase());
      setSymbolInput('');
      setIsOpen(false);
      onAdded();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setIsOpen(true)}
        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition"
      >
        + Tambah Koin
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-4">Tambah Simbol Pantauan</h3>
            
            <form onSubmit={handleSubmit}>
              <input
                type="text"
                placeholder="Contoh: SOLUSDT, ADAUSDT"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 text-white px-4 py-2 rounded-lg focus:outline-none focus:border-blue-500 mb-3 uppercase"
              />
              {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
              
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition disabled:opacity-50"
                >
                  {loading ? 'Memproses Backfill...' : 'Simpan & Pantau'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}