// apps/frontend/src/service/api.ts

const API_BASE = 'http://localhost:3001/api';

export async function fetchSymbols() {
    const res = await fetch(`${API_BASE}/symbols`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Gagal mengambil data simbol');
    return res.json();
}

export async function addSymbol(symbol: string) {
    const res = await fetch(`${API_BASE}/symbols`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol }),
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Gagal menambahkan simbol');
    }
    return res.json();
}

export async function deleteSymbol(id: string) {
    const res = await fetch(`${API_BASE}/symbols/${id}`, {
        method: 'DELETE',
    });
    if (!res.ok) throw new Error('Gagal menghapus simbol');
    return res.json();
}