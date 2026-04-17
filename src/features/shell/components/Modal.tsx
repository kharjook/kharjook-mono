'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export interface ModalProps {
  children: ReactNode;
}

export function Modal({ children }: ModalProps) {
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  return (
    <div className="absolute inset-0 z-50 bg-[#0F1015] overflow-y-auto overflow-x-hidden scrollbar-hide">
      {children}
    </div>
  );
}
