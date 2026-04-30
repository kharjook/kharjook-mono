'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CalendarClock,
  DollarSign,
  Sparkles,
  Plus,
} from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { formatCurrency } from '@/shared/utils/format-currency';
import { clampPeriodToToday, currentPeriod } from '@/shared/utils/period';
import { formatJalaali, formatJalaaliHuman, parseJalaali, todayJalaali } from '@/shared/utils/jalali';
import { calculateAssetPeriodStats } from '@/features/reports/utils/asset-period-stats';
import { effectivePriceAt } from '@/features/reports/utils/price-history';
import type { Loan, LoanInstallment } from '@/shared/types/domain';

export function HomeTab() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    assets,
    categories,
    transactions,
    wallets,
    currencyRates,
    dailyPrices,
    isLoadingData,
  } = useData();
  const { currencyMode, usdRate } = useUI();
  const [upcomingDeadlines, setUpcomingDeadlines] = useState<Array<LoanInstallment & { loanTitle?: string }>>([]);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    void (async () => {
      const { data } = await supabase
        .from('loan_installments')
        .select('*')
        .eq('is_paid', false)
        .order('due_date_string', { ascending: true })
        .limit(4);
      if (!mounted) return;
      const installments = ((data ?? []) as LoanInstallment[]);
      if (installments.length === 0) {
        setUpcomingDeadlines([]);
        return;
      }
      const loanIds = Array.from(new Set(installments.map((item) => item.loan_id)));
      const { data: loansData } = await supabase
        .from('loans')
        .select('id,title')
        .in('id', loanIds);
      if (!mounted) return;
      const loanMap = new Map(((loansData ?? []) as Pick<Loan, 'id' | 'title'>[]).map((loan) => [loan.id, loan.title]));
      setUpcomingDeadlines(
        installments.map((item) => ({
          ...item,
          loanTitle: loanMap.get(item.loan_id),
        }))
      );
    })();
    return () => {
      mounted = false;
    };
  }, [user]);

  const today = todayJalaali();
  const todayStr = formatJalaali(today);
  const monthPeriod = clampPeriodToToday(currentPeriod('month'));
  const yearPeriod = clampPeriodToToday(currentPeriod('year'));

  const stats = useMemo(() => {
    let assetsValueToman = 0;
    let yearProfitToman = 0;
    let yearProfitUsd = 0;
    let yearUnrealizedMissingCount = 0;
    let monthIncomeToman = 0;
    let monthExpenseToman = 0;
    const monthExpenseByCategory = new Map<string, number>();
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const walletsById = new Map(wallets.map((w) => [w.id, w]));
    const mainDistributionMap = new Map<string, number>();
    const subDistribution: { id: string; name: string; valueToman: number }[] = [];

    const txToToman = (txAmount: number | null | undefined, walletId: string | null | undefined) => {
      const amount = Number(txAmount ?? 0);
      if (!Number.isFinite(amount)) return 0;
      const wallet = walletId ? walletsById.get(walletId) : null;
      const rate = wallet ? tomanPerUnit(wallet.currency, currencyRates) : 0;
      return Math.abs(amount) * (rate > 0 ? rate : 0);
    };

    for (const tx of transactions) {
      const inMonth =
        tx.date_string >= formatJalaali(monthPeriod.start) &&
        tx.date_string <= formatJalaali(monthPeriod.end);
      if (!inMonth) continue;
      if (tx.type === 'INCOME') {
        const toman = tx.amount_toman_at_time ?? txToToman(tx.target_amount, tx.target_wallet_id);
        monthIncomeToman += Number(toman) || 0;
      }
      if (tx.type === 'EXPENSE') {
        const toman = tx.amount_toman_at_time ?? txToToman(tx.source_amount, tx.source_wallet_id);
        const value = Number(toman) || 0;
        monthExpenseToman += value;
        const cat = tx.category_id ?? '__uncat__';
        monthExpenseByCategory.set(cat, (monthExpenseByCategory.get(cat) ?? 0) + value);
      }
    }

    assets.forEach((asset) => {
      const stats = calculateAssetStats(
        asset,
        transactions,
        currencyMode,
        usdRate
      );
      if (asset.include_in_balance !== false) {
        assetsValueToman += stats.currentValueToman;
      }
      if (stats.currentValueToman > 0 && asset.include_in_balance !== false) {
        subDistribution.push({
          id: asset.id,
          name: asset.name,
          valueToman: stats.currentValueToman,
        });
        const catId = asset.category_id ?? '__uncat__';
        mainDistributionMap.set(
          catId,
          (mainDistributionMap.get(catId) ?? 0) + stats.currentValueToman
        );
      }
    });

    let cashToman = 0;
    wallets.forEach((w) => {
      const balance = calculateWalletStats(w, transactions).balance;
      cashToman += balance * tomanPerUnit(w.currency, currencyRates);
    });

    const totalPortfolioToman = assetsValueToman + cashToman;
    const yearEnd = formatJalaali(yearPeriod.end);

    for (const asset of assets) {
      if (asset.include_in_profit_loss === false) continue;
      const periodEndPrice = effectivePriceAt(
        asset,
        yearEnd,
        dailyPrices,
        todayStr
      );
      const periodStats = calculateAssetPeriodStats(
        asset,
        transactions,
        yearPeriod,
        usdRate,
        periodEndPrice
      );
      yearProfitToman += periodStats.realizedToman;
      yearProfitUsd += periodStats.realizedUsd;
      if (periodStats.unrealizedAvailable) {
        yearProfitToman += periodStats.unrealizedToman;
        yearProfitUsd += periodStats.unrealizedUsd;
      } else {
        yearUnrealizedMissingCount += 1;
      }
    }

    const mainDistribution = Array.from(mainDistributionMap.entries())
      .map(([catId, valueToman]) => ({
        id: catId,
        name:
          catId === '__uncat__'
            ? 'بدون دسته'
            : (categoryById.get(catId)?.name ?? 'بدون دسته'),
        valueToman,
      }))
      .sort((a, b) => b.valueToman - a.valueToman);

    subDistribution.sort((a, b) => b.valueToman - a.valueToman);

    const maxExpenseEntry = Array.from(monthExpenseByCategory.entries()).sort(
      (a, b) => b[1] - a[1]
    )[0];
    const maxExpense = maxExpenseEntry
      ? {
          name:
            maxExpenseEntry[0] === '__uncat__'
              ? 'بدون دسته'
              : (categoryById.get(maxExpenseEntry[0])?.name ?? 'بدون دسته'),
          valueToman: maxExpenseEntry[1],
        }
      : null;

    return {
      totalPortfolioToman,
      cashToman,
      yearProfitToman,
      yearProfitUsd,
      yearUnrealizedMissingCount,
      monthIncomeToman,
      monthExpenseToman,
      monthBalanceToman: monthIncomeToman - monthExpenseToman,
      maxExpense,
      mainDistribution,
      subDistribution,
    };
  }, [
    assets,
    categories,
    transactions,
    wallets,
    currencyRates,
    dailyPrices,
    usdRate,
    todayStr,
    monthPeriod.end,
    monthPeriod.start,
    yearPeriod.end,
    yearPeriod.start,
  ]);

  const usdRateRow = useMemo(
    () => currencyRates.find((r) => r.currency === 'USD'),
    [currencyRates]
  );

  const displayPortfolio =
    currencyMode === 'USD'
      ? (usdRate > 0 ? stats.totalPortfolioToman / usdRate : 0)
      : stats.totalPortfolioToman;
  const displayCash =
    currencyMode === 'USD'
      ? (usdRate > 0 ? stats.cashToman / usdRate : 0)
      : stats.cashToman;
  const displayYearProfit =
    currencyMode === 'USD'
      ? stats.yearProfitUsd
      : stats.yearProfitToman;
  const displayMonthIncome =
    currencyMode === 'USD' && usdRate > 0
      ? stats.monthIncomeToman / usdRate
      : stats.monthIncomeToman;
  const displayMonthExpense =
    currencyMode === 'USD' && usdRate > 0
      ? stats.monthExpenseToman / usdRate
      : stats.monthExpenseToman;
  const displayMonthBalance =
    currencyMode === 'USD' && usdRate > 0
      ? stats.monthBalanceToman / usdRate
      : stats.monthBalanceToman;
  const displayMaxExpense =
    stats.maxExpense && currencyMode === 'USD' && usdRate > 0
      ? stats.maxExpense.valueToman / usdRate
      : (stats.maxExpense?.valueToman ?? 0);

  const convertDistribution = (valueToman: number) =>
    currencyMode === 'USD' && usdRate > 0
      ? valueToman / usdRate
      : valueToman;

  const deadlineRows = upcomingDeadlines.map((item) => {
    const amount =
      currencyMode === 'USD' && usdRate > 0
        ? item.amount / usdRate
        : item.amount;
    return {
      id: item.id,
      title: item.loanTitle ?? 'بدهی',
      dueLabel: formatJalaaliHuman(parseJalaali(item.due_date_string) ?? today),
      amountLabel: formatCurrency(amount, currencyMode),
    };
  });

  return (
    <div className="p-6 space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">داشبورد</h2>
        <span className="text-xs text-slate-500">
          {isLoadingData ? 'در حال به‌روزرسانی...' : 'به‌روز'}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-linear-to-br from-emerald-500/15 via-teal-500/10 to-cyan-500/10 border border-emerald-400/20 rounded-3xl p-5 relative overflow-hidden">
          <div className="absolute -top-8 -left-8 w-24 h-24 rounded-full bg-emerald-400/10 blur-2xl" />
          <div className="flex items-center gap-2 text-emerald-300 mb-2">
            <DollarSign size={16} />
            <span className="text-sm font-medium">قیمت دلار</span>
          </div>
          <p className="text-2xl font-bold text-white" dir="ltr">
            {usdRateRow ? `${Number(usdRateRow.toman_per_unit).toLocaleString('fa-IR')} تومان` : '—'}
          </p>
          <p className="text-[11px] text-slate-500 mt-2">
            آخرین به‌روزرسانی:{' '}
            {usdRateRow?.updated_at
              ? new Date(usdRateRow.updated_at).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })
              : '—'}
          </p>
        </div>
        <div className="bg-linear-to-br from-purple-500/15 via-fuchsia-500/10 to-transparent border border-white/5 rounded-3xl p-5">
          <div className="flex items-center gap-2 text-purple-300 mb-2">
            <Sparkles size={16} />
            <span className="text-sm font-medium">ارزش کل پورتفو</span>
          </div>
          <p className="text-3xl font-bold text-white" dir="ltr">
            {formatCurrency(displayPortfolio, currencyMode)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard title="درآمد ماه" value={formatCurrency(displayMonthIncome, currencyMode)} tone="neutral" />
        <MetricCard title="هزینه‌های ماه" value={formatCurrency(displayMonthExpense, currencyMode)} tone="danger" />
        <MetricCard
          title="بالانس ماه"
          value={`${displayMonthBalance >= 0 ? '+' : ''}${formatCurrency(displayMonthBalance, currencyMode)}`}
          tone={displayMonthBalance >= 0 ? 'success' : 'danger'}
        />
        <MetricCard
          title="بیشترین هزینه ماه"
          value={stats.maxExpense ? formatCurrency(displayMaxExpense, currencyMode) : '—'}
          subtitle={stats.maxExpense?.name ?? 'بدون داده'}
          tone="danger"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link
          href="/transactions/new"
          className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4 hover:bg-[#222436] transition-colors"
        >
          <div className="flex items-center gap-2 text-slate-300">
            <Plus size={16} />
            <span className="text-sm font-medium">شورت‌کات هزینه</span>
          </div>
          <p className="text-xs text-slate-500 mt-2">ثبت سریع تراکنش جدید</p>
        </Link>
        <button
          type="button"
          onClick={() => router.push('/deadlines')}
          className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4 text-right hover:bg-[#222436] transition-colors"
        >
          <div className="flex items-center gap-2 text-slate-300">
            <CalendarClock size={16} />
            <span className="text-sm font-medium">سررسید</span>
          </div>
          {deadlineRows.length === 0 ? (
            <p className="text-xs text-slate-500 mt-2">سررسید پرداخت‌نشده‌ای وجود ندارد</p>
          ) : (
            <div className="mt-3 space-y-2">
              {deadlineRows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-200 truncate">{row.title}</p>
                    <p className="text-[10px] text-slate-500">{row.dueLabel}</p>
                  </div>
                  <span className="text-[11px] text-amber-300 shrink-0" dir="ltr">
                    {row.amountLabel}
                  </span>
                </div>
              ))}
            </div>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DistributionChartCard
          title="توزیع دارایی اصلی"
          rows={stats.mainDistribution.slice(0, 6).map((r) => ({
            name: r.name,
            value: convertDistribution(r.valueToman),
            label: formatCurrency(convertDistribution(r.valueToman), currencyMode),
          }))}
        />
        <DistributionChartCard
          title="توزیع دارایی فرعی"
          rows={stats.subDistribution.slice(0, 6).map((r) => ({
            name: r.name,
            value: convertDistribution(r.valueToman),
            label: formatCurrency(convertDistribution(r.valueToman), currencyMode),
          }))}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">نقدی</p>
          <p className="text-xl font-semibold text-white" dir="ltr">
            {formatCurrency(displayCash, currencyMode)}
          </p>
        </div>
        <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">سود سال جاری</p>
          <p className={`text-xl font-semibold ${displayYearProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
            {displayYearProfit >= 0 ? '+' : ''}
            {formatCurrency(displayYearProfit, currencyMode)}
          </p>
          {stats.yearUnrealizedMissingCount > 0 && (
            <p className="text-[10px] text-amber-400/80 mt-1">
              {stats.yearUnrealizedMissingCount.toLocaleString('fa-IR')} دارایی بدون قیمت تاریخی؛ عدد کل ناقص است.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  tone,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone: 'neutral' | 'success' | 'danger';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-400'
      : tone === 'danger'
        ? 'text-rose-400'
        : 'text-slate-200';
  return (
    <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4">
      <p className="text-xs text-slate-400 mb-1">{title}</p>
      <p className={`text-sm font-semibold ${toneClass}`} dir="ltr">
        {value}
      </p>
      {subtitle && <p className="text-[11px] text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function DistributionChartCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; value: number; label: string }>;
}) {
  const palette = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#ec4899'];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4 overflow-hidden">
      <p className="text-xs text-slate-400 mb-2">{title}</p>
      {rows.length === 0 ? (
        <div className="text-xs text-slate-500 inline-flex items-center gap-1">
          <AlertCircle size={12} />
          بدون داده
        </div>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/5 mb-4">
            {rows.map((row, index) => (
              <div
                key={row.name}
                className="h-full transition-all duration-500"
                style={{
                  width: `${total > 0 ? (row.value / total) * 100 : 0}%`,
                  backgroundColor: palette[index % palette.length],
                }}
              />
            ))}
          </div>
          <div className="space-y-3">
            {rows.map((row, index) => {
              const percent = total > 0 ? (row.value / total) * 100 : 0;
              return (
                <div key={row.name} className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: palette[index % palette.length] }}
                      />
                      <span className="text-sm text-slate-300 truncate">{row.name}</span>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="text-xs text-slate-300" dir="ltr">{row.label}</div>
                      <div className="text-[10px] text-slate-500" dir="ltr">{percent.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${percent}%`,
                        background: `linear-gradient(90deg, ${palette[index % palette.length]}, rgba(255,255,255,0.85))`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
