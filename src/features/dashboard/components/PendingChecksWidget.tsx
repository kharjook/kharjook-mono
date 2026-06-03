'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ReceiptText } from 'lucide-react';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import type { Check } from '@/shared/types/domain';
import { formatCurrency } from '@/shared/utils/format-currency';
import { formatJalaali, formatJalaaliHuman, parseJalaali, todayJalaali } from '@/shared/utils/jalali';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { daysBetweenJalaali } from '@/features/notifications/utils/jalali-days';

const toFaDigits = (value: number | string) =>
  String(value).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]!);

function dueHint(daysUntil: number | null): string {
  if (daysUntil == null) return '';
  if (daysUntil < 0) return `${toFaDigits(Math.abs(daysUntil))} روز گذشته`;
  if (daysUntil === 0) return 'امروز';
  if (daysUntil === 1) return 'فردا';
  return `${toFaDigits(daysUntil)} روز دیگر`;
}

function dueTone(daysUntil: number | null): string {
  if (daysUntil == null) return 'text-slate-400';
  if (daysUntil < 0) return 'text-rose-400';
  if (daysUntil === 0) return 'text-amber-300';
  if (daysUntil <= 7) return 'text-amber-200/90';
  return 'text-slate-400';
}

export function PendingChecksWidget({ checks }: { checks: Check[] }) {
  const router = useRouter();
  const { currencyRates } = useData();
  const { currencyMode, usdRate } = useUI();
  const todayStr = useMemo(() => formatJalaali(todayJalaali()), []);

  const rows = useMemo(() => {
    return checks
      .filter((check) => check.status === 'pending')
      .sort((a, b) => a.due_date_string.localeCompare(b.due_date_string))
      .slice(0, 5)
      .map((check) => {
        const rate = tomanPerUnit(check.currency, currencyRates);
        const toman = check.amount * (rate > 0 ? rate : 0);
        const displayAmount =
          currencyMode === 'USD' && usdRate > 0 ? toman / usdRate : toman;
        const daysUntil = daysBetweenJalaali(todayStr, check.due_date_string);
        const due = parseJalaali(check.due_date_string);
        return {
          id: check.id,
          title: check.title,
          bankName: check.bank_name,
          dueLabel: due ? formatJalaaliHuman(due) : check.due_date_string,
          dueHint: dueHint(daysUntil),
          dueTone: dueTone(daysUntil),
          amountLabel: formatCurrency(displayAmount, currencyMode),
          daysUntil,
        };
      });
  }, [checks, currencyMode, currencyRates, todayStr, usdRate]);

  const pendingCount = useMemo(
    () => checks.filter((check) => check.status === 'pending').length,
    [checks]
  );

  if (pendingCount === 0) return null;

  const overdueCount = rows.filter((row) => row.daysUntil != null && row.daysUntil < 0).length;

  return (
    <section className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center text-violet-300">
            <ReceiptText size={16} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">چک‌های در انتظار</h3>
            <p className="text-[11px] text-slate-500">
              {toFaDigits(pendingCount)} مورد
              {overdueCount > 0 ? ` · ${toFaDigits(overdueCount)} معوق` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/deadlines/checks')}
          className="text-[11px] text-purple-400 hover:text-purple-300 inline-flex items-center gap-0.5"
        >
          همه
          <ChevronLeft size={14} />
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => router.push('/deadlines/checks')}
            className="w-full flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5 text-right hover:bg-white/[0.06] transition"
          >
            <div className="min-w-0">
              <p className="text-xs text-slate-200 font-medium truncate">{row.title}</p>
              <p className="text-[10px] text-slate-500 truncate">
                {row.dueLabel}
                {row.bankName ? ` · ${row.bankName}` : ''}
              </p>
              {row.dueHint && (
                <p className={`text-[10px] mt-0.5 ${row.dueTone}`}>{row.dueHint}</p>
              )}
            </div>
            <span className="text-xs font-bold text-slate-300 shrink-0" dir="ltr">
              {row.amountLabel}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
