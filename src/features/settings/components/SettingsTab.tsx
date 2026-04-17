'use client';

import { useRouter } from 'next/navigation';
import {
  Activity,
  ChevronLeft,
  LogOut,
  Tag,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '@/features/portfolio/PortfolioProvider';
import { latinizeDigits } from '@/shared/utils/latinize-digits';

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
    <div className="p-6 animate-in fade-in duration-300 space-y-6">
      <h2 className="text-xl font-bold text-white mb-6">تنظیمات و مدیریت</h2>

      <div className="bg-gradient-to-r from-purple-500/20 to-transparent border border-purple-500/20 p-5 rounded-3xl flex items-center gap-4">
        <div className="w-14 h-14 bg-[#161722] rounded-full flex items-center justify-center border-2 border-purple-500/50 text-purple-400">
          <UserIcon size={24} />
        </div>
        <div>
          <p className="text-sm text-slate-400">اکانت سوپابیس</p>
          <p
            className="text-sm font-bold text-white mt-1 font-mono"
            dir="ltr"
          >
            {latinizeDigits(displayPhone)}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => router.push('/manage/categories')}
          className="w-full bg-[#1A1B26] hover:bg-[#222436] border border-white/5 p-4 rounded-2xl flex items-center justify-between text-right transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400">
              <Tag size={20} />
            </div>
            <span className="font-medium text-slate-200">
              مدیریت دسته‌بندی‌ها
            </span>
          </div>
          <ChevronLeft size={20} className="text-slate-600" />
        </button>

        <button
          onClick={() => router.push('/manage/assets')}
          className="w-full bg-[#1A1B26] hover:bg-[#222436] border border-white/5 p-4 rounded-2xl flex items-center justify-between text-right transition-colors"
        >
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400">
              <Activity size={20} />
            </div>
            <span className="font-medium text-slate-200">مدیریت دارایی‌ها</span>
          </div>
          <ChevronLeft size={20} className="text-slate-600" />
        </button>

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
