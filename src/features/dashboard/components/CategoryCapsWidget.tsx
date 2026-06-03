'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Target } from 'lucide-react';
import { useData } from '@/features/portfolio/PortfolioProvider';
import { formatCurrency } from '@/shared/utils/format-currency';
import { clampPeriodToToday, currentPeriod } from '@/shared/utils/period';
import type { CategorySpendingCap } from '@/shared/types/domain';
import { buildCapStatuses } from '@/features/categories/utils/category-spending-caps';

const toFaDigits = (value: number | string) =>
  String(value).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]!);

function barTone(level: 'ok' | 'warn' | 'over'): string {
  if (level === 'over') return 'bg-rose-500';
  if (level === 'warn') return 'bg-amber-500';
  return 'bg-emerald-500';
}

export function CategoryCapsWidget({ caps }: { caps: CategorySpendingCap[] }) {
  const router = useRouter();
  const { categories, transactions } = useData();

  const rows = useMemo(() => {
    if (caps.length === 0) return [];
    const period = clampPeriodToToday(currentPeriod('month'));
    return buildCapStatuses({ caps, categories, transactions, period }).slice(0, 5);
  }, [caps, categories, transactions]);

  if (rows.length === 0) return null;

  return (
    <section className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400">
            <Target size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">سقف هزینه ماه</h3>
            <p className="text-[11px] text-slate-500">پیشرفت دسته‌های محدودشده</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/manage/categories')}
          className="text-[11px] text-purple-400 hover:text-purple-300 inline-flex items-center gap-0.5"
        >
          مدیریت
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="space-y-3">
        {rows.map((row) => {
          const width = Math.min(Math.max(row.percent, 0), 100);
          return (
            <div key={row.categoryId} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: row.categoryColor }}
                  />
                  <span className="text-slate-200 truncate">{row.categoryName}</span>
                </div>
                <span className="text-slate-400 shrink-0">{toFaDigits(Math.round(row.percent))}٪</span>
              </div>
              <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`absolute inset-y-0 right-0 rounded-full transition-[width] duration-300 ${barTone(row.level)}`}
                  style={{ width: `${width > 0 ? Math.max(width, 4) : 0}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500" dir="ltr">
                {formatCurrency(row.spentToman, 'TOMAN')} / {formatCurrency(row.limitToman, 'TOMAN')}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
