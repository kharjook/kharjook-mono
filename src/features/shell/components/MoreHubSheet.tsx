'use client';

import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Coins,
  LayoutGrid,
  Repeat,
  Target,
  TrendingUp,
  X,
} from 'lucide-react';
import { BottomSheet } from '@/shared/components/BottomSheet';

type MoreHubSheetProps = {
  open: boolean;
  onClose: () => void;
};

const LINKS = [
  {
    href: '/reports',
    title: 'گزارش‌ها',
    subtitle: 'جریان نقدی و سود/زیان دارایی',
    icon: BarChart3,
  },
  {
    href: '/prices',
    title: 'قیمت‌ها و نرخ‌ها',
    subtitle: 'قیمت روزانه و نرخ ارز',
    icon: TrendingUp,
  },
  {
    href: '/manage/assets',
    title: 'مدیریت دارایی‌ها',
    subtitle: 'افزودن، ویرایش و مرتب‌سازی',
    icon: Coins,
  },
  {
    href: '/manage/goals',
    title: 'اهداف تخصیص',
    subtitle: 'درصد یا مقدار هدف',
    icon: Target,
  },
  {
    href: '/manage/recurring',
    title: 'تراکنش‌های دوره‌ای',
    subtitle: 'حقوق، اجاره و … — ثبت خودکار',
    icon: Repeat,
  },
  {
    href: '/manage/categories',
    title: 'دسته‌بندی‌ها',
    subtitle: 'درآمد، هزینه و دارایی',
    icon: LayoutGrid,
  },
] as const;

export function MoreHubSheet({ open, onClose }: MoreHubSheetProps) {
  const router = useRouter();

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-5 pb-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">بیشتر</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white"
            aria-label="بستن"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-2">
          {LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => {
                  onClose();
                  router.push(item.href);
                }}
                className="w-full bg-surface-raised border border-white/5 p-4 rounded-2xl flex items-center gap-4 text-right hover:bg-surface-hover transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                  <Icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-200">{item.title}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{item.subtitle}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </BottomSheet>
  );
}
