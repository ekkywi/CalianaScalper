// apps/frontend/src/components/ui/PriceFlash.tsx
// Komponen wrapper untuk animasi flash green/red saat harga berubah

'use client';

import { useEffect, useRef, useState } from 'react';

interface PriceFlashProps {
  value: number;
  children: React.ReactNode;
  className?: string;
}

type FlashDirection = 'up' | 'down' | null;

export default function PriceFlash({ value, children, className }: PriceFlashProps) {
  const prevValue = useRef(value);
  const [flash, setFlash] = useState<FlashDirection>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevValue.current !== value) {
      const direction = value > prevValue.current ? 'up' : 'down';
      setFlash(direction);
      prevValue.current = value;

      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setFlash(null);
      }, 600);
    }
  }, [value]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const flashClass =
    flash === 'up'
      ? 'animate-flash-green'
      : flash === 'down'
        ? 'animate-flash-red'
        : '';

  return <span className={`${flashClass} ${className || ''}`}>{children}</span>;
}