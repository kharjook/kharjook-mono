'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { useUI } from '@/features/portfolio/PortfolioProvider';
import { BottomNav } from '@/features/shell/components/BottomNav';
import { PwaInstallPrompt } from '@/shared/components/PwaInstallPrompt';
import { RouteTransitionBar } from '@/shared/components/RouteTransitionBar';

const TAB_ROUTES = new Set<string>(['/', '/assets', '/wallets', '/deadlines']);

export interface ShellProps {
  children: ReactNode;
  modal: ReactNode;
}

export function Shell({ children, modal }: ShellProps) {
  const { currencyMode, toggleCurrency } = useUI();
  const pathname = usePathname();
  const showNav =
    TAB_ROUTES.has(pathname) ||
    pathname === '/deadlines/loans' ||
    pathname === '/deadlines/persons';

  return (
    <div className="bg-[#0F1015] text-slate-200 min-h-dvh font-sans flex justify-center selection:bg-purple-500/30">
      <div className="w-full sm:max-w-md bg-[#161722] relative sm:shadow-2xl flex flex-col h-dvh overflow-hidden sm:border-x border-slate-800">
        <RouteTransitionBar />
        <header className="px-6 py-4 pt-safe flex justify-between items-center bg-[#1A1B26] border-b border-white/5 z-10">
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              aria-label="تنظیمات"
              className="w-10 h-10 rounded-2xl bg-[#1A1B26] border border-white/10 flex items-center justify-center text-slate-300 hover:text-white hover:border-purple-500/40 transition-colors"
            >
              <Settings size={18} />
            </Link>
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
          </div>

          <div className="flex flex-col">
            <h1 className="text-xl font-bold text-transparent bg-clip-text bg-linear-to-l from-purple-400 to-purple-600">
              خرجوک
            </h1>
            <span className="text-[10px] text-slate-500 uppercase tracking-widest">
              مدیریت دارایی
            </span>
          </div>
        </header>

        <PwaInstallPrompt />

        <main
          data-app-scroll="main"
          className="flex-1 overflow-y-auto overflow-x-hidden relative scrollbar-hide pb-24"
        >
          {children}
        </main>

        {modal}

        {showNav && <BottomNav />}
      </div>
    </div>
  );
}
