'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  CircleDashed,
  PieChart,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { formatCurrency } from '@/shared/utils/format-currency';
import { clampPeriodToToday, currentPeriod } from '@/shared/utils/period';
import {
  formatJalaali,
  formatJalaaliHuman,
  JALALI_MONTHS,
  parseJalaali,
  todayJalaali,
} from '@/shared/utils/jalali';
import { calculateAssetPeriodStats } from '@/features/reports/utils/asset-period-stats';
import { effectivePriceAt } from '@/features/reports/utils/price-history';
import { buildGoalBuySuggestion } from '@/features/goals/utils/goal-action-suggestion';
import {
  computeGoalDelta,
  isGoalMet,
  type GoalValueKind,
} from '@/features/goals/utils/goal-progress-display';
import type { Loan, LoanInstallment } from '@/shared/types/domain';
import {
  AssetPriceTicker,
  type PriceTickerItem,
} from '@/features/dashboard/components/AssetPriceTicker';
import { MonthlyCashflowChart } from '@/features/dashboard/components/MonthlyCashflowChart';
import { TopAllocationCard } from '@/features/dashboard/components/TopAllocationCard';
import { DistributionChartCard } from '@/features/dashboard/components/DistributionChartCard';
import { buildYearCashflowByMonth } from '@/features/dashboard/utils/year-cashflow';

export type HomeGoalRow = {
  id: string;
  name: string;
  kindLabel: string;
  valueKind: GoalValueKind;
  currentValue: number;
  targetValue: number;
  unit?: string;
  buySuggestion: string | null;
};

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
    goals,
    isLoadingData,
    refreshAll,
  } = useData();
  const { currencyMode, usdRate } = useUI();
  const [upcomingDeadlines, setUpcomingDeadlines] = useState<
    Array<LoanInstallment & { loanTitle?: string; loanCurrency?: Loan['currency'] }>
  >([]);

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    void (async () => {
      const { data } = await supabase
        .from('loan_installments')
        .select('*')
        .eq('is_paid', false)
        .order('due_date_string', { ascending: true })
        .limit(120);
      if (!mounted) return;
      const installments = ((data ?? []) as LoanInstallment[]);
      if (installments.length === 0) {
        setUpcomingDeadlines([]);
        return;
      }
      const loanIds = Array.from(new Set(installments.map((item) => item.loan_id)));
      const { data: loansData } = await supabase
        .from('loans')
        .select('id,title,currency')
        .in('id', loanIds);
      if (!mounted) return;
      const loanMap = new Map(
        ((loansData ?? []) as Pick<Loan, 'id' | 'title' | 'currency'>[]).map((loan) => [
          loan.id,
          loan,
        ])
      );
      setUpcomingDeadlines(
        installments.map((item) => ({
          ...item,
          loanTitle: loanMap.get(item.loan_id)?.title,
          loanCurrency: loanMap.get(item.loan_id)?.currency,
        }))
      );
    })();
    return () => {
      mounted = false;
    };
  }, [user]);

  const today = useMemo(() => todayJalaali(), []);
  const todayStr = useMemo(() => formatJalaali(today), [today]);
  const monthPeriod = useMemo(() => clampPeriodToToday(currentPeriod('month')), []);
  const yearPeriod = useMemo(() => clampPeriodToToday(currentPeriod('year')), []);

  const stats = useMemo(() => {
    let assetsValueToman = 0;
    let yearProfitToman = 0;
    let yearProfitUsd = 0;
    let yearUnrealizedMissingCount = 0;
    let monthIncomeToman = 0;
    let monthIncomeUsd = 0;
    let monthExpenseToman = 0;
    let monthExpenseUsd = 0;
    const monthExpenseByCategory = new Map<string, number>();
    const monthExpenseByCategoryUsd = new Map<string, number>();
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const walletsById = new Map(wallets.map((w) => [w.id, w]));
    const mainDistributionMap = new Map<string, number>();
    const subDistribution: { id: string; name: string; valueToman: number }[] = [];
    const assetValueById = new Map<string, number>();

    const txToToman = (
      txAmount: number | null | undefined,
      walletId: string | null | undefined
    ) => {
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
        const toman =
          tx.amount_toman_at_time ?? txToToman(tx.target_amount, tx.target_wallet_id);
        const usd =
          tx.amount_usd_at_time ??
          (() => {
            const t = Number(tx.amount_toman_at_time);
            const r = Number(tx.usd_rate);
            if (Number.isFinite(t) && t > 0 && Number.isFinite(r) && r > 0) return t / r;
            return 0;
          })();
        monthIncomeToman += Number(toman) || 0;
        monthIncomeUsd += Number(usd) || 0;
      }
      if (tx.type === 'EXPENSE') {
        const toman =
          tx.amount_toman_at_time ?? txToToman(tx.source_amount, tx.source_wallet_id);
        const usd =
          tx.amount_usd_at_time ??
          (() => {
            const t = Number(tx.amount_toman_at_time);
            const r = Number(tx.usd_rate);
            if (Number.isFinite(t) && t > 0 && Number.isFinite(r) && r > 0) return t / r;
            return 0;
          })();
        const valueToman = Number(toman) || 0;
        const valueUsd = Number(usd) || 0;
        monthExpenseToman += valueToman;
        monthExpenseUsd += valueUsd;
        const cat = tx.category_id ?? '__uncat__';
        monthExpenseByCategory.set(
          cat,
          (monthExpenseByCategory.get(cat) ?? 0) + valueToman
        );
        monthExpenseByCategoryUsd.set(
          cat,
          (monthExpenseByCategoryUsd.get(cat) ?? 0) + valueUsd
        );
      }
    }

    assets.forEach((asset) => {
      const s = calculateAssetStats(asset, transactions, currencyMode, usdRate);
      if (asset.include_in_balance !== false) {
        assetsValueToman += s.currentValueToman;
      }
      if (s.currentValueToman > 0 && asset.include_in_balance !== false) {
        subDistribution.push({
          id: asset.id,
          name: asset.name,
          valueToman: s.currentValueToman,
        });
        assetValueById.set(asset.id, s.currentValueToman);
        const catId = asset.category_id ?? '__uncat__';
        mainDistributionMap.set(
          catId,
          (mainDistributionMap.get(catId) ?? 0) + s.currentValueToman
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
      const periodEndPrice = effectivePriceAt(asset, yearEnd, dailyPrices, todayStr);
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

    const goalComparison: HomeGoalRow[] = goals
      .map((goal) => {
        if (goal.target_kind === 'quantity') {
          if (goal.scope !== 'asset') return null;
          const asset = goal.asset_id ? assets.find((a) => a.id === goal.asset_id) : null;
          if (!asset) return null;
          const targetValue = Number(goal.target_quantity ?? 0);
          if (!Number.isFinite(targetValue) || targetValue <= 0) return null;
          const assetStats = calculateAssetStats(
            asset,
            transactions,
            currencyMode,
            usdRate
          );
          const currentValue = assetStats.totalAmount;
          return {
            id: goal.id,
            name: asset.name,
            kindLabel: 'دارایی',
            valueKind: 'quantity' as const,
            currentValue,
            targetValue,
            unit: asset.unit,
            buySuggestion: buildGoalBuySuggestion({
              name: asset.name,
              kind: 'quantity',
              current: currentValue,
              target: targetValue,
              unit: asset.unit,
              decimalPlaces: asset.decimal_places,
            }),
          };
        }

        const targetValue = Number(goal.target_percent ?? 0);
        if (!Number.isFinite(targetValue) || targetValue <= 0) return null;
        if (goal.scope === 'asset') {
          const asset = goal.asset_id ? assets.find((a) => a.id === goal.asset_id) : null;
          if (!asset) return null;
          const currentValueToman = assetValueById.get(asset.id) ?? 0;
          const currentPercent =
            assetsValueToman > 0 ? (currentValueToman / assetsValueToman) * 100 : 0;
          return {
            id: goal.id,
            name: asset.name,
            kindLabel: 'دارایی',
            valueKind: 'percent' as const,
            currentValue: currentPercent,
            targetValue,
            unit: asset.unit,
            buySuggestion: buildGoalBuySuggestion({
              name: asset.name,
              kind: 'percent',
              current: currentPercent,
              target: targetValue,
              currentValueToman,
              portfolioValueToman: assetsValueToman,
              priceToman: asset.price_toman,
              unit: asset.unit,
              decimalPlaces: asset.decimal_places,
              currencyMode,
              usdRate,
            }),
          };
        }
        const category = goal.category_id ? categoryById.get(goal.category_id) : null;
        if (!category) return null;
        const groupValueToman = mainDistributionMap.get(category.id) ?? 0;
        const currentPercent =
          assetsValueToman > 0 ? (groupValueToman / assetsValueToman) * 100 : 0;
        return {
          id: goal.id,
          name: category.name,
          kindLabel: 'گروه',
          valueKind: 'percent' as const,
          currentValue: currentPercent,
          targetValue,
          buySuggestion: buildGoalBuySuggestion({
            name: category.name,
            kind: 'percent',
            current: currentPercent,
            target: targetValue,
            currentValueToman: groupValueToman,
            portfolioValueToman: assetsValueToman,
            currencyMode,
            usdRate,
          }),
        };
      })
      .filter((row): row is HomeGoalRow => row !== null)
      .sort((a, b) => b.targetValue - a.targetValue);

    const buildMaxExpense = (byCategory: Map<string, number>) => {
      const maxEntry = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])[0];
      if (!maxEntry) return null;
      return {
        name:
          maxEntry[0] === '__uncat__'
            ? 'بدون دسته'
            : (categoryById.get(maxEntry[0])?.name ?? 'بدون دسته'),
        value: maxEntry[1],
      };
    };

    return {
      totalPortfolioToman,
      cashToman,
      yearProfitToman,
      yearProfitUsd,
      yearUnrealizedMissingCount,
      monthIncomeToman,
      monthIncomeUsd,
      monthExpenseToman,
      monthExpenseUsd,
      monthBalanceToman: monthIncomeToman - monthExpenseToman,
      monthBalanceUsd: monthIncomeUsd - monthExpenseUsd,
      maxExpenseToman: buildMaxExpense(monthExpenseByCategory),
      maxExpenseUsd: buildMaxExpense(monthExpenseByCategoryUsd),
      mainDistribution,
      subDistribution,
      goalComparison,
    };
  }, [
    assets,
    categories,
    transactions,
    wallets,
    currencyRates,
    dailyPrices,
    goals,
    currencyMode,
    usdRate,
    todayStr,
    monthPeriod,
    yearPeriod,
  ]);

  const priceTickerItems = useMemo((): PriceTickerItem[] => {
    const items: PriceTickerItem[] = [];

    if (usdRate > 0) {
      items.push({
        id: 'usd',
        label: 'دلار',
        price: formatCurrency(usdRate, 'TOMAN'),
        href: '/prices',
      });
    }

    for (const asset of assets) {
      const stats = calculateAssetStats(asset, transactions, currencyMode, usdRate);
      if (stats.totalAmount <= 0) continue;

      const unitPrice =
        currencyMode === 'USD'
          ? Number(asset.price_usd)
          : Number(asset.price_toman);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) continue;

      items.push({
        id: asset.id,
        label: asset.unit ? `${asset.name} / ${asset.unit}` : asset.name,
        price: formatCurrency(unitPrice, currencyMode),
        href: `/assets/${asset.id}`,
      });
    }

    return items;
  }, [assets, transactions, currencyMode, usdRate]);

  const yearCashflowMonths = useMemo(
    () =>
      buildYearCashflowByMonth(
        transactions,
        wallets,
        currencyRates,
        currencyMode,
        usdRate
      ),
    [transactions, wallets, currencyRates, currencyMode, usdRate]
  );

  const yearLabel = useMemo(
    () => `سال ${String(today.jy).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]!)}`,
    [today.jy]
  );

  const sortedGoalRows = useMemo(() => {
    return [...stats.goalComparison].sort((a, b) => {
      const metA = isGoalMet(a.currentValue, a.targetValue, a.valueKind);
      const metB = isGoalMet(b.currentValue, b.targetValue, b.valueKind);
      if (metA !== metB) return metA ? 1 : -1;
      return (
        Math.abs(b.currentValue - b.targetValue) -
        Math.abs(a.currentValue - a.targetValue)
      );
    });
  }, [stats.goalComparison]);

  const displayPortfolio =
    currencyMode === 'USD'
      ? (usdRate > 0 ? stats.totalPortfolioToman / usdRate : 0)
      : stats.totalPortfolioToman;
  const displayCash =
    currencyMode === 'USD' ? (usdRate > 0 ? stats.cashToman / usdRate : 0) : stats.cashToman;
  const assetsToman = Math.max(0, stats.totalPortfolioToman - stats.cashToman);
  const displayAssets =
    currencyMode === 'USD' && usdRate > 0 ? assetsToman / usdRate : assetsToman;
  const assetShare =
    stats.totalPortfolioToman > 0
      ? (assetsToman / stats.totalPortfolioToman) * 100
      : 0;
  const cashShare =
    stats.totalPortfolioToman > 0
      ? (stats.cashToman / stats.totalPortfolioToman) * 100
      : 0;
  const displayYearProfit =
    currencyMode === 'USD' ? stats.yearProfitUsd : stats.yearProfitToman;
  const displayMonthBalance =
    currencyMode === 'USD' ? stats.monthBalanceUsd : stats.monthBalanceToman;
  const activeMaxExpense =
    currencyMode === 'USD' ? stats.maxExpenseUsd : stats.maxExpenseToman;
  const displayMaxExpense = activeMaxExpense?.value ?? 0;

  const convertDistribution = (valueToman: number) =>
    currencyMode === 'USD' && usdRate > 0 ? valueToman / usdRate : valueToman;

  const topAllocationRows = useMemo(() => {
    const total = stats.mainDistribution.reduce((sum, row) => sum + row.valueToman, 0);
    return stats.mainDistribution.slice(0, 3).map((row) => ({
      name: row.name,
      value: convertDistribution(row.valueToman),
      percent: total > 0 ? (row.valueToman / total) * 100 : 0,
    }));
  }, [stats.mainDistribution, currencyMode, usdRate]);

  const subAssetChartRows = useMemo(() => {
    return stats.subDistribution.slice(0, 6).map((row) => ({
      name: row.name,
      value: convertDistribution(row.valueToman),
      label: formatCurrency(convertDistribution(row.valueToman), currencyMode),
    }));
  }, [stats.subDistribution, currencyMode, usdRate]);

  const mainGroupChartRows = useMemo(() => {
    return stats.mainDistribution.slice(0, 6).map((row) => ({
      name: row.name,
      value: convertDistribution(row.valueToman),
      label: formatCurrency(convertDistribution(row.valueToman), currencyMode),
    }));
  }, [stats.mainDistribution, currencyMode, usdRate]);

  const currentMonthDeadlineSummary = useMemo(() => {
    const currentMonthKey = `${today.jy}/${String(today.jm).padStart(2, '0')}/`;
    const currentMonthLabel = `${JALALI_MONTHS[today.jm - 1]} ${String(today.jy).replace(
      /\d/g,
      (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]!
    )}`;
    const toDisplayAmount = (
      item: LoanInstallment & { loanCurrency?: Loan['currency'] }
    ) => {
      const rate = tomanPerUnit(item.loanCurrency ?? 'IRT', currencyRates);
      const toman = item.amount * (rate > 0 ? rate : 0);
      if (currencyMode === 'USD' && usdRate > 0) return toman / usdRate;
      return toman;
    };
    const monthRows = upcomingDeadlines
      .filter((item) => item.due_date_string.startsWith(currentMonthKey))
      .map((item) => {
        const parsed = parseJalaali(item.due_date_string);
        const displayAmount = toDisplayAmount(item);
        return {
          id: item.id,
          title: item.loanTitle ?? 'بدهی',
          dueLabel: formatJalaaliHuman(parsed ?? today),
          amount: displayAmount,
          amountLabel: formatCurrency(displayAmount, currencyMode),
        };
      });
    return {
      label: currentMonthLabel,
      total: monthRows.reduce((sum, row) => sum + row.amount, 0),
      rows: monthRows,
    };
  }, [currencyMode, currencyRates, today, upcomingDeadlines, usdRate]);

  return (
    <div className="p-6 space-y-5 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">داشبورد</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {isLoadingData ? 'در حال به‌روزرسانی...' : 'به‌روز'}
          </span>
          <button
            type="button"
            onClick={() => void refreshAll()}
            disabled={isLoadingData}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 inline-flex items-center justify-center disabled:opacity-50"
            aria-label="refresh-prices-and-data"
            title="بروزرسانی قیمت‌ها"
          >
            <RefreshCw size={14} className={isLoadingData ? 'animate-spin' : undefined} />
          </button>
        </div>
      </div>

      <PortfolioHeroCard
        totalLabel={formatCurrency(displayPortfolio, currencyMode)}
        assetsLabel={formatCurrency(displayAssets, currencyMode)}
        cashLabel={formatCurrency(displayCash, currencyMode)}
        assetShare={assetShare}
        cashShare={cashShare}
      />

      <AssetPriceTicker items={priceTickerItems} />

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => router.push('/reports')}
          className="bg-[#1A1B26] border border-white/5 hover:border-purple-500/20 p-4 rounded-2xl flex items-center justify-between text-right transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400 group-hover:bg-purple-500/20 transition-colors">
              <BarChart3 size={18} />
            </div>
            <span className="text-sm font-medium text-slate-200">گزارش‌ها</span>
          </div>
          <ChevronLeft size={18} className="text-slate-600" />
        </button>
        <button
          type="button"
          onClick={() => router.push('/prices')}
          className="bg-[#1A1B26] border border-white/5 hover:border-cyan-500/20 p-4 rounded-2xl flex items-center justify-between text-right transition-colors group"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400 group-hover:bg-cyan-500/20 transition-colors">
              <TrendingUp size={18} />
            </div>
            <span className="text-sm font-medium text-slate-200">قیمت‌ها و نرخ‌ها</span>
          </div>
          <ChevronLeft size={18} className="text-slate-600" />
        </button>
      </div>

      <MonthlyCashflowChart
        months={yearCashflowMonths}
        currencyMode={currencyMode}
        yearLabel={yearLabel}
        onOpenReports={() => router.push('/reports/cashflow')}
      />

      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          title="بالانس ماه"
          value={`${displayMonthBalance >= 0 ? '+' : ''}${formatCurrency(
            displayMonthBalance,
            currencyMode
          )}`}
          tone={displayMonthBalance >= 0 ? 'success' : 'danger'}
          icon={<Sparkles size={14} />}
        />
        <MetricCard
          title="بیشترین هزینه ماه"
          value={activeMaxExpense ? formatCurrency(displayMaxExpense, currencyMode) : '—'}
          subtitle={activeMaxExpense?.name ?? 'بدون داده'}
          tone="danger"
          icon={<PieChart size={14} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-3">
        <button
          type="button"
          onClick={() => router.push('/deadlines')}
          className="group relative overflow-hidden rounded-[1.75rem] border border-amber-300/10 bg-[#1A1B26] p-4 text-right transition hover:border-amber-300/20 hover:bg-[#222436]"
        >
          <div className="absolute -left-12 -top-12 h-28 w-28 rounded-full bg-amber-400/10 blur-2xl transition group-hover:bg-amber-400/15" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-slate-300">
              <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
                <CalendarClock size={16} />
              </span>
              <div>
                <span className="text-sm font-semibold">سررسید</span>
                <p className="text-[11px] text-slate-500">پرداخت‌های نزدیک همین ماه</p>
              </div>
            </div>
            {currentMonthDeadlineSummary.rows.length > 0 && (
              <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] text-amber-200">
                {currentMonthDeadlineSummary.rows.length.toLocaleString('fa-IR')} مورد
              </span>
            )}
          </div>
          {currentMonthDeadlineSummary.rows.length === 0 ? (
            <p className="relative mt-3 text-xs text-slate-500">
              سررسید پرداخت‌نشده‌ای وجود ندارد
            </p>
          ) : (
            <div className="relative mt-3 space-y-2">
              <div className="rounded-2xl border border-white/5 bg-white/4 px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-200 font-semibold">
                    {currentMonthDeadlineSummary.label}
                  </p>
                  <span className="text-[11px] text-amber-300 shrink-0" dir="ltr">
                    {formatCurrency(currentMonthDeadlineSummary.total, currencyMode)}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {currentMonthDeadlineSummary.rows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="text-[11px] text-slate-200 truncate">{row.title}</p>
                        <p className="text-[10px] text-slate-500">{row.dueLabel}</p>
                      </div>
                      <span className="text-[11px] text-slate-300 shrink-0" dir="ltr">
                        {row.amountLabel}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </button>
      </div>

      <HomeGoalsSection
        rows={sortedGoalRows.slice(0, 6)}
        onManage={() => router.push('/manage/goals')}
      />

      <TopAllocationCard rows={topAllocationRows} currencyMode={currencyMode} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DistributionChartCard
          title="توزیع گروه‌ها"
          subtitle="گروه‌های بزرگ‌تر در سبد"
          rows={mainGroupChartRows}
        />
        <DistributionChartCard
          title="توزیع دارایی‌ها"
          subtitle="دارایی‌های غالب"
          rows={subAssetChartRows}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SummaryInsightCard
          title="نقدی"
          value={formatCurrency(displayCash, currencyMode)}
          subtitle={`${cashShare.toFixed(1)}% از پورتفو`}
          tone="cyan"
          icon={<Wallet size={16} />}
        />
        <div className="relative overflow-hidden rounded-[1.75rem] border border-white/5 bg-[#1A1B26] p-4">
          <div
            className={`absolute -left-12 -top-12 h-28 w-28 rounded-full blur-2xl ${
              displayYearProfit >= 0 ? 'bg-emerald-400/10' : 'bg-rose-400/10'
            }`}
          />
          <div className="relative flex items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                displayYearProfit >= 0
                  ? 'bg-emerald-400/10 text-emerald-300'
                  : 'bg-rose-400/10 text-rose-300'
              }`}
            >
              <TrendingUp size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-400 mb-1">سود سال جاری</p>
              <p
                className={`truncate text-xl font-black ${
                  displayYearProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
                dir="ltr"
              >
                {displayYearProfit >= 0 ? '+' : ''}
                {formatCurrency(displayYearProfit, currencyMode)}
              </p>
            </div>
          </div>
          {stats.yearUnrealizedMissingCount > 0 && (
            <p className="relative text-[10px] text-amber-400/80 mt-3">
              {stats.yearUnrealizedMissingCount.toLocaleString('fa-IR')} دارایی بدون قیمت تاریخی؛
              عدد کل ناقص است.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PortfolioHeroCard({
  totalLabel,
  assetsLabel,
  cashLabel,
  assetShare,
  cashShare,
}: {
  totalLabel: string;
  assetsLabel: string;
  cashLabel: string;
  assetShare: number;
  cashShare: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-4xl border border-purple-400/20 bg-[#1A1B26] p-5 shadow-2xl shadow-purple-950/20">
      <div className="absolute -top-20 -left-16 h-48 w-48 rounded-full bg-purple-500/20 blur-3xl" />
      <div className="absolute -bottom-24 right-8 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-purple-200">
              <Sparkles size={13} />
              نمای کلی سبد
            </div>
            <p className="text-sm text-slate-400">ارزش کل پورتفو</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-white sm:text-4xl" dir="ltr">
              {totalLabel}
            </p>
          </div>
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-[#0F1015]/80 ring-1 ring-white/10">
            <div
              className="absolute inset-2 rounded-full"
              style={{
                background: `conic-gradient(#8b5cf6 0 ${assetShare}%, #06b6d4 ${assetShare}% ${Math.min(100, assetShare + cashShare)}%, rgba(255,255,255,0.08) 0)`,
              }}
            />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[#151622] text-center">
              <span className="text-lg font-bold text-white" dir="ltr">
                {assetShare.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <PortfolioSplitPill
            label="دارایی‌ها"
            value={assetsLabel}
            percent={assetShare}
            color="#8b5cf6"
          />
          <PortfolioSplitPill label="نقدی" value={cashLabel} percent={cashShare} color="#06b6d4" />
        </div>
      </div>
    </div>
  );
}

function PortfolioSplitPill({
  label,
  value,
  percent,
  color,
}: {
  label: string;
  value: string;
  percent: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/4 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-[11px] text-slate-500" dir="ltr">
          {percent.toFixed(1)}%
        </span>
      </div>
      <p className="truncate text-sm font-semibold text-white" dir="ltr">
        {value}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, percent)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  subtitle,
  tone,
  icon,
}: {
  title: string;
  value: string;
  subtitle?: string;
  tone: 'neutral' | 'success' | 'danger';
  icon?: ReactNode;
}) {
  const toneClass = {
    neutral: 'text-slate-200',
    success: 'text-emerald-300',
    danger: 'text-rose-300',
  }[tone];
  const iconClass = {
    neutral: 'bg-slate-400/10 text-slate-300',
    success: 'bg-emerald-400/10 text-emerald-300',
    danger: 'bg-rose-400/10 text-rose-300',
  }[tone];
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-[#1A1B26] p-4 transition hover:border-white/10 hover:bg-[#202234]">
      <div className="absolute -left-8 -top-8 h-16 w-16 rounded-full bg-white/5 blur-xl opacity-0 transition group-hover:opacity-100" />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-slate-400">{title}</p>
          <p className={`truncate text-sm font-bold ${toneClass}`} dir="ltr">
            {value}
          </p>
        </div>
        {icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${iconClass}`}>
            {icon}
          </span>
        )}
      </div>
      {subtitle && <p className="text-[11px] text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function SummaryInsightCard({
  title,
  value,
  subtitle,
  tone,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  tone: 'cyan' | 'purple';
  icon: ReactNode;
}) {
  const toneClass =
    tone === 'cyan'
      ? 'bg-cyan-400/10 text-cyan-300'
      : 'bg-purple-400/10 text-purple-300';
  const glowClass = tone === 'cyan' ? 'bg-cyan-400/10' : 'bg-purple-400/10';
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-white/5 bg-[#1A1B26] p-4">
      <div className={`absolute -left-12 -top-12 h-28 w-28 rounded-full blur-2xl ${glowClass}`} />
      <div className="relative flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${toneClass}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="mb-1 text-xs text-slate-400">{title}</p>
          <p className="truncate text-xl font-black text-white" dir="ltr">
            {value}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

function HomeGoalsSection({
  rows,
  onManage,
}: {
  rows: HomeGoalRow[];
  onManage: () => void;
}) {
  const metCount = rows.filter((row) =>
    isGoalMet(row.currentValue, row.targetValue, row.valueKind)
  ).length;
  const pendingCount = rows.length - metCount;
  const buySuggestions = rows.filter((row) => row.buySuggestion);
  const maxValue = Math.max(
    1,
    ...rows.flatMap((row) => [row.currentValue, row.targetValue])
  );

  const formatGoalAxisValue = (row: HomeGoalRow, value: number) =>
    row.valueKind === 'percent'
      ? `${value.toFixed(1)}%`
      : `${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}${row.unit ? ` ${row.unit}` : ''}`;

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-purple-400/15 bg-[#1A1B26] p-4">
      <div className="absolute -left-16 top-0 h-40 w-40 rounded-full bg-emerald-500/5 blur-3xl" />
      <div className="absolute -right-16 bottom-0 h-40 w-40 rounded-full bg-rose-500/5 blur-3xl" />
      <div className="relative mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-purple-300">
            <Target size={16} />
            <p className="text-sm font-bold text-white">هدف‌های سبد</p>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {rows.length > 0
              ? `${metCount.toLocaleString('fa-IR')} از ${rows.length.toLocaleString('fa-IR')} رسیده`
              : 'هدفی تعریف نشده'}
          </p>
        </div>
        <button
          type="button"
          onClick={onManage}
          className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 shrink-0"
        >
          مدیریت
          <ChevronLeft size={14} />
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/3 py-10 text-xs text-slate-500">
          <AlertCircle size={12} />
          <span className="mt-2">از بخش مدیریت، هدف برای دارایی یا گروه تعریف کن.</span>
        </div>
      ) : (
        <>
          <div className="relative mb-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-emerald-300">
                <CheckCircle2 size={13} />
                <span className="text-[10px]">رسیده به هدف</span>
              </div>
              <p className="text-sm font-bold text-white">
                {metCount.toLocaleString('fa-IR')}
              </p>
            </div>
            <div className="rounded-xl border border-rose-500/15 bg-rose-500/5 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-rose-300">
                <CircleDashed size={13} />
                <span className="text-[10px]">در انتظار</span>
              </div>
              <p className="text-sm font-bold text-white">
                {pendingCount.toLocaleString('fa-IR')}
              </p>
            </div>
          </div>

          <div className="relative flex h-36 items-end gap-1.5 sm:gap-2" dir="ltr">
            {rows.map((row) => {
              const currentH = (row.currentValue / maxValue) * 100;
              const targetH = (row.targetValue / maxValue) * 100;
              const progress = {
                current: row.currentValue,
                target: row.targetValue,
                percentComplete:
                  row.targetValue > 0
                    ? (row.currentValue / row.targetValue) * 100
                    : 0,
                remaining: Math.max(0, row.targetValue - row.currentValue),
              };
              const valueUnit = row.valueKind === 'percent' ? '%' : row.unit ?? '';
              const status = computeGoalDelta(progress, row.valueKind, valueUnit).status;
              const currentBarClass =
                status === 'under' ? 'bg-rose-500/85' : 'bg-emerald-500/85';

              return (
                <div
                  key={row.id}
                  className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                >
                  <div className="flex h-28 w-full items-end justify-center gap-0.5">
                    <div
                      className={`w-[42%] max-w-5 rounded-t-md transition-all ${currentBarClass}`}
                      style={{
                        height: `${Math.max(row.currentValue > 0 ? 4 : 0, currentH)}%`,
                      }}
                      title={`${row.name} · فعلی: ${formatGoalAxisValue(row, row.currentValue)} (${row.kindLabel})`}
                    />
                    <div
                      className="w-[42%] max-w-5 rounded-t-md bg-white/20 transition-all"
                      style={{
                        height: `${Math.max(row.targetValue > 0 ? 4 : 0, targetH)}%`,
                      }}
                      title={`${row.name} · هدف: ${formatGoalAxisValue(row, row.targetValue)} (${row.kindLabel})`}
                    />
                  </div>
                  <span
                    className="w-full truncate text-center text-[9px] text-slate-500 sm:text-[10px]"
                    title={row.name}
                  >
                    {row.name}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-emerald-500/85" />
              رسیده
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-rose-500/85" />
              کمتر از هدف
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-white/20" />
              هدف
            </span>
          </div>

          {buySuggestions.length > 0 && (
            <div className="relative mt-4 space-y-2 rounded-xl border border-purple-400/10 bg-purple-500/5 px-3 py-2.5">
              <p className="text-[10px] font-semibold text-purple-300">پیشنهاد خرید</p>
              <ul className="space-y-1.5">
                {buySuggestions.map((row) => (
                  <li key={row.id} className="text-[10px] leading-relaxed text-slate-300">
                    {row.buySuggestion}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
