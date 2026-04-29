'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  CalendarClock,
  DollarSign,
  Plus,
} from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { formatCurrency } from '@/shared/utils/format-currency';
import { currentPeriod } from '@/shared/utils/period';
import { formatJalaali, formatJalaaliHuman, parseJalaali, todayJalaali } from '@/shared/utils/jalali';
import { calculateAssetPeriodStats } from '@/features/reports/utils/asset-period-stats';
import { effectivePriceAt } from '@/features/reports/utils/price-history';
import type { LoanInstallment } from '@/shared/types/domain';

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
  const [upcomingDeadline, setUpcomingDeadline] = useState<LoanInstallment | null>(null);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    void supabase
      .from('loan_installments')
      .select('*')
      .eq('is_paid', false)
      .order('due_date_string', { ascending: true })
      .limit(1)
      .then(({ data }) => {
        if (!mounted) return;
        setUpcomingDeadline(((data ?? [])[0] as LoanInstallment | undefined) ?? null);
      });
    return () => {
      mounted = false;
    };
  }, [user]);

  const today = todayJalaali();
  const todayStr = formatJalaali(today);
  const monthPeriod = currentPeriod('month');
  const yearPeriod = currentPeriod('year');

  const stats = useMemo(() => {
    let assetsValueToman = 0;
    let yearProfitToman = 0;
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
      if (periodStats.unrealizedAvailable) {
        yearProfitToman += periodStats.unrealizedToman;
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
      ? (usdRate > 0 ? stats.yearProfitToman / usdRate : 0)
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

  return (
    <div className="p-6 space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">داشبورد</h2>
        <span className="text-xs text-slate-500">
          {isLoadingData ? 'در حال به‌روزرسانی...' : 'به‌روز'}
        </span>
      </div>

      <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4">
        <p className="text-xs text-slate-400 mb-1">ارزش کل پورتفو</p>
        <p className="text-3xl font-bold text-white" dir="ltr">
          {formatCurrency(displayPortfolio, currencyMode)}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">قیمت دلار</p>
          <p className="text-lg font-semibold text-white" dir="ltr">
            {usdRateRow ? `${Number(usdRateRow.toman_per_unit).toLocaleString('fa-IR')} تومان` : '—'}
          </p>
          <p className="text-[11px] text-slate-500 mt-2">
            آخرین به‌روزرسانی:{' '}
            {usdRateRow?.updated_at
              ? new Date(usdRateRow.updated_at).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })
              : '—'}
          </p>
        </div>
        <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4">
          <p className="text-xs text-slate-400 mb-1">سود سال جاری</p>
          <p className={`text-lg font-semibold ${displayYearProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`} dir="ltr">
            {displayYearProfit >= 0 ? '+' : ''}
            {formatCurrency(displayYearProfit, currencyMode)}
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
          <p className="text-xs text-slate-500 mt-2">
            {upcomingDeadline
              ? `نزدیک‌ترین: ${formatJalaaliHuman(parseJalaali(upcomingDeadline.due_date_string) ?? today)}`
              : 'سررسید پرداخت‌نشده‌ای وجود ندارد'}
          </p>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DistributionCard
          title="توزیع دارایی اصلی"
          rows={stats.mainDistribution.slice(0, 6).map((r) => ({
            name: r.name,
            value: formatCurrency(convertDistribution(r.valueToman), currencyMode),
          }))}
        />
        <DistributionCard
          title="توزیع دارایی فرعی"
          rows={stats.subDistribution.slice(0, 6).map((r) => ({
            name: r.name,
            value: formatCurrency(convertDistribution(r.valueToman), currencyMode),
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

function DistributionCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ name: string; value: string }>;
}) {
  return (
    <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4">
      <p className="text-xs text-slate-400 mb-2">{title}</p>
      {rows.length === 0 ? (
        <div className="text-xs text-slate-500 inline-flex items-center gap-1">
          <AlertCircle size={12} />
          بدون داده
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.name} className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-300 truncate">{row.name}</span>
              <span className="text-xs text-slate-400 shrink-0" dir="ltr">
                {row.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
