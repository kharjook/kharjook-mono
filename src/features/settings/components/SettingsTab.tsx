'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/features/portfolio/PortfolioProvider';
import { latinizeDigits } from '@/shared/utils/latinize-digits';
import { TelegramConnectionSection } from '@/features/settings/components/TelegramConnectionSection';
import { NotificationSettingsSection } from '@/features/settings/components/NotificationSettingsSection';

export function SettingsTab() {
  const router = useRouter();
  const { user, logout } = useAuth();

  if (!user) return null;

  const displayPhone = user.email ? user.email.split('@')[0] : user.phone ?? '';

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <div className="bg-[#0F1015] min-h-full pb-24 animate-in slide-in-from-right-8 duration-300">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
          aria-label="بازگشت"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">تنظیمات</h2>
      </div>

      <div className="p-6 space-y-6">
        <div className="bg-linear-to-r from-purple-500/20 to-transparent border border-purple-500/20 p-5 rounded-3xl flex items-center gap-4">
          <div className="w-14 h-14 bg-[#161722] rounded-full flex items-center justify-center border-2 border-purple-500/50 text-purple-400">
            <UserIcon size={24} />
          </div>
          <div>
            <p className="text-sm text-slate-400">اکانت</p>
            <p className="text-sm font-bold text-white mt-1" dir="ltr">
              {latinizeDigits(displayPhone)}
            </p>
          </div>
        </div>

        <TelegramConnectionSection />
        <NotificationSettingsSection />

        <button
          onClick={handleLogout}
          className="w-full bg-[#1A1B26] hover:bg-rose-500/10 border border-white/5 hover:border-rose-500/20 p-4 rounded-2xl flex items-center justify-between text-right transition-colors group"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-400 group-hover:bg-rose-500/20 transition-colors">
              <LogOut size={20} />
            </div>
            <span className="font-medium text-rose-400">خروج از حساب</span>
          </div>
        </button>
      </div>
    </div>
  );
}
