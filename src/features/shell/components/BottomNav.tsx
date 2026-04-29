'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, CalendarDays, Home, Plus, Wallet } from 'lucide-react';
import { useData } from '@/features/portfolio/PortfolioProvider';
import { NavItem } from '@/features/shell/components/NavItem';
import { haptic } from '@/shared/utils/haptics';

type Tab = 'home' | 'assets' | 'wallets' | 'deadlines' | null;

function useTabState(pathname: string): Tab {
  if (pathname === '/') return 'home';
  if (pathname === '/assets' || pathname.startsWith('/assets/')) return 'assets';
  if (pathname === '/wallets' || pathname.startsWith('/wallets/')) return 'wallets';
  if (pathname === '/deadlines' || pathname.startsWith('/deadlines/')) return 'deadlines';
  return null;
}

export function BottomNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoadingData } = useData();

  const active = useTabState(pathname);
  const navTo = (href: string) => {
    haptic('selection');
    router.push(href);
  };

  return (
    <nav className="absolute bottom-0 w-full bg-[#1A1B26]/90 backdrop-blur-md border-t border-white/5 px-4 py-2 flex justify-between items-end pb-safe z-40">
      <div className="flex justify-around flex-1 items-center pb-2">
        <NavItem
          icon={<Home size={22} />}
          label="داشبورد"
          isActive={active === 'home'}
          onClick={() => navTo('/')}
        />
        <NavItem
          icon={<Activity size={22} />}
          label="دارایی‌ها"
          isActive={active === 'assets'}
          onClick={() => navTo('/assets')}
        />
      </div>

      <div className="flex flex-col items-center justify-center -mt-6 z-10 px-2 pb-1">
        <Link
          href="/transactions/new"
          onClick={() => haptic('selection')}
          aria-disabled={isLoadingData}
          tabIndex={isLoadingData ? -1 : undefined}
          className={`w-14 h-14 bg-purple-600 hover:bg-purple-500 rounded-full flex justify-center items-center text-white shadow-[0_4px_15px_rgba(147,51,234,0.5)] border-[5px] border-[#161722] transition-transform active:scale-95 ${
            isLoadingData ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          <Plus size={26} />
        </Link>
      </div>

      <div className="flex justify-around flex-1 items-center pb-2">
        <NavItem
          icon={<Wallet size={22} />}
          label="کیف پول‌ها"
          isActive={active === 'wallets'}
          onClick={() => navTo('/wallets')}
          disabled={isLoadingData}
        />
        <NavItem
          icon={<CalendarDays size={22} />}
          label="سررسید"
          isActive={active === 'deadlines'}
          onClick={() => navTo('/deadlines')}
        />
      </div>
    </nav>
  );
}
