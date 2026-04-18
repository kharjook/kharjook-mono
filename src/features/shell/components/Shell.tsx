'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useUI } from '@/features/portfolio/PortfolioProvider';
import { BottomNav } from '@/features/shell/components/BottomNav';

const TAB_ROUTES = new Set<string>(['/', '/assets', '/wallets', '/settings']);

export interface ShellProps {
  children: ReactNode;
  modal: ReactNode;
}

export function Shell({ children, modal }: ShellProps) {
  const { currencyMode, toggleCurrency } = useUI();
  const pathname = usePathname();
  const showNav = TAB_ROUTES.has(pathname);

  return (
    <div className="bg-[#0F1015] text-slate-200 min-h-screen font-sans flex justify-center selection:bg-purple-500/30">
      <div className="w-full max-w-md bg-[#161722] relative shadow-2xl flex flex-col h-screen overflow-hidden sm:border-x border-slate-800">
        <header className="px-6 py-4 flex justify-between items-center bg-[#1A1B26] border-b border-white/5 z-10">
          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-l from-purple-400 to-purple-600">
              سبدینو
            </h1>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">
              مدیریت دارایی
            </span>
          </div>

          <button
            onClick={toggleCurrency}
            className="flex items-center gap-2 bg-[#222436] p-1 rounded-full border border-purple-500/20 transition-all hover:border-purple-500/50"
          >
            <div
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${currencyMode === 'TOMAN' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20' : 'text-slate-400'}`}
            >
              تومان
            </div>
            <div
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${currencyMode === 'USD' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20' : 'text-slate-400'}`}
            >
              دلار
            </div>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-hide pb-24">
          {children}
        </main>

        {modal}

        {showNav && <BottomNav />}
      </div>
    </div>
  );
}
