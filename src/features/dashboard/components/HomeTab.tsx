'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  ChevronLeft,
  Info,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { BottomSheet } from '@/shared/components/BottomSheet';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import {
  buildSparklineDateStrings,
  endOfPreviousJalaliMonth,
  portfolioTotalTomanAtDate,
  type SparklineRange,
  walletCashTomanByCurrency,
  ytdCumulativeProfitMonthlySeries,
} from '@/features/dashboard/utils/portfolio-history';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { formatCurrency } from '@/shared/utils/format-currency';
import { currentPeriod } from '@/shared/utils/period';
import {
  addDays,
  formatJalaali,
  todayJalaali,
} from '@/shared/utils/jalali';
import { calculateAssetPeriodStats } from '@/features/reports/utils/asset-period-stats';
import { effectivePriceAt } from '@/features/reports/utils/price-history';

const CASH_SLICE_COLOR = '#94a3b8';
const CASH_SLICE_NAME = 'نقد';
const SPARKLINE_MAX_POINTS = 42;

function formatCompactToman(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fa-IR', { maximumFractionDigits: 0 })} تومان`;
}

function formatPercentDelta(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const s = pct.toLocaleString('fa-IR', { maximumFractionDigits: 1 });
  return `${pct >= 0 ? '+' : ''}${s}٪`;
}

function SparklineChart({
  points,
  height = 56,
}: {
  points: { totalToman: number }[];
  height?: number;
}) {
  const gradId = useId().replace(/:/g, '');
  const width = 280;
  if (points.length < 2) return null;
  const values = points.map((p) => p.totalToman);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padY = 6;
  const span = max - min || 1;
  const toY = (v: number) =>
    height -
    padY -
    ((v - min) / span) * (height - 2 * padY);
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(2)} ${toY(p.totalToman).toFixed(2)}`)
    .join(' ');
  const areaD = `${d} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(168, 85, 247)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="rgb(168, 85, 247)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path
        d={d}
        fill="none"
        stroke="rgb(192, 132, 252)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function CashGaugeRing({
  cashRatio,
  size = 88,
}: {
  cashRatio: number;
  size?: number;
}) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = Math.min(0.92, Math.max(0, cashRatio)) * c;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgb(51, 65, 85)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgb(148, 163, 184)"
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

function PnlMiniBars({
  points,
  currencyMode,
  usdRate,
}: {
  points: { label: string; profitToman: number; profitUsd: number }[];
  currencyMode: 'TOMAN' | 'USD';
  usdRate: number;
}) {
  if (points.length === 0) return null;
  const vals = points.map((p) =>
    currencyMode === 'USD' && usdRate > 0 ? p.profitUsd : p.profitToman
  );
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const h = 52;
  const gap = 4;
  const barW = Math.max(8, (240 - (points.length - 1) * gap) / points.length);

  return (
    <div className="flex items-end justify-center gap-1 pt-2" dir="ltr">
      {points.map((p, i) => {
        const v = vals[i]!;
        const nh = (Math.abs(v) / maxAbs) * h;
        const pos = v >= 0;
        return (
          <div key={p.label} className="flex flex-col items-center gap-1">
            <div
              className="flex flex-col justify-end items-center"
              style={{ height: h }}
            >
              <div
                className={`w-full rounded-t-md ${pos ? 'bg-emerald-500/70' : 'bg-rose-500/70'}`}
                style={{
                  height: Math.max(2, nh),
                  width: barW,
                }}
              />
            </div>
            <span className="text-[9px] text-slate-500 max-w-[3.2rem] truncate text-center">
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function StaggerSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div
        className="h-24 rounded-2xl bg-white/5"
        style={{ animationDelay: '0ms' }}
      />
      <div
        className="h-32 rounded-2xl bg-white/5"
        style={{ animationDelay: '120ms' }}
      />
      <div
        className="h-20 rounded-2xl bg-white/5"
        style={{ animationDelay: '220ms' }}
      />
    </div>
  );
}

export function HomeTab() {
  const router = useRouter();
  const {
    assets,
    categories,
    transactions,
    wallets,
    currencyRates,
    dailyPrices,
    isLoadingData,
    refreshAll,
  } = useData();
  const { currencyMode, usdRate } = useUI();

  const [sparkRange, setSparkRange] = useState<SparklineRange>('30d');
  const [selectedSliceKey, setSelectedSliceKey] = useState<string | null>(null);
  const [heroDetailOpen, setHeroDetailOpen] = useState(false);
  const [comparePrevMonth, setComparePrevMonth] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullArm = useRef(false);
  const pullDistanceRef = useRef(0);

  const todayStr = formatJalaali(todayJalaali());

  const portfolioStats = useMemo(() => {
    let assetsValueToman = 0;
    let assetsValueUsd = 0;
    let totalCostToman = 0;

    const categoryMap = new Map<
      string,
      { sliceKey: string; name: string; value: number; color: string; percent?: number }
    >();

    assets.forEach((asset) => {
      const stats = calculateAssetStats(
        asset,
        transactions,
        currencyMode,
        usdRate
      );
      const inBalance = asset.include_in_balance !== false;
      if (inBalance) {
        assetsValueToman += stats.currentValueToman;
        assetsValueUsd += stats.currentValueUsd;
        totalCostToman += stats.totalCostToman;

        if (stats.currentValueToman > 0 && asset.category_id) {
          const cat = categories.find((c) => c.id === asset.category_id);
          const catName = cat ? cat.name : 'بدون دسته';
          const catColor = cat ? cat.color : '#64748b';
          const sliceKey = asset.category_id;

          const existing = categoryMap.get(sliceKey);
          if (existing) {
            existing.value += stats.currentValueToman;
          } else {
            categoryMap.set(sliceKey, {
              sliceKey,
              name: catName,
              value: stats.currentValueToman,
              color: catColor,
            });
          }
        }
      }
    });

    let cashValueToman = 0;
    wallets.forEach((w) => {
      const balance = calculateWalletStats(w, transactions).balance;
      if (balance <= 0) return;
      cashValueToman += balance * tomanPerUnit(w.currency, currencyRates);
    });

    if (cashValueToman > 0) {
      categoryMap.set('__cash__', {
        sliceKey: '__cash__',
        name: CASH_SLICE_NAME,
        value: cashValueToman,
        color: CASH_SLICE_COLOR,
      });
    }

    const totalValueToman = assetsValueToman + cashValueToman;
    const totalValueUsd =
      usdRate > 0 ? totalValueToman / usdRate : assetsValueUsd;

    const currentYear = currentPeriod('year');
    const currentYearEnd = formatJalaali(currentYear.end);
    let yearTotalProfitToman = 0;
    let yearTotalProfitUsd = 0;
    let yearProfitMissingCount = 0;

    for (const asset of assets) {
      if (asset.include_in_profit_loss === false) continue;
      const periodEndPrice = effectivePriceAt(
        asset,
        currentYearEnd,
        dailyPrices,
        todayStr
      );
      const periodStats = calculateAssetPeriodStats(
        asset,
        transactions,
        currentYear,
        usdRate,
        periodEndPrice
      );
      yearTotalProfitToman += periodStats.realizedToman;
      yearTotalProfitUsd += periodStats.realizedUsd;
      if (periodStats.unrealizedAvailable) {
        yearTotalProfitToman += periodStats.unrealizedToman;
        yearTotalProfitUsd += periodStats.unrealizedUsd;
      } else {
        yearProfitMissingCount += 1;
      }
    }
    const isProfit = yearTotalProfitToman >= 0;

    const distributions = Array.from(categoryMap.values());
    distributions.forEach((d) => {
      d.percent =
        totalValueToman > 0 ? (d.value / totalValueToman) * 100 : 0;
    });
    distributions.sort((a, b) => b.value - a.value);

    const excludedFromBalanceNames = assets
      .filter((a) => a.include_in_balance === false)
      .map((a) => a.name);

    return {
      totalValueToman,
      totalValueUsd,
      assetsValueToman,
      assetsValueUsd,
      cashValueToman,
      totalCostToman,
      yearTotalProfitToman,
      yearTotalProfitUsd,
      yearProfitMissingCount,
      isProfit,
      distributions,
      excludedFromBalanceNames,
    };
  }, [
    assets,
    categories,
    transactions,
    wallets,
    currencyRates,
    dailyPrices,
    currencyMode,
    usdRate,
    todayStr,
  ]);

  const sparklinePoints = useMemo(() => {
    void todayStr;
    const t = todayJalaali();
    const ts = formatJalaali(t);
    const dates = buildSparklineDateStrings(
      sparkRange,
      t,
      ts,
      SPARKLINE_MAX_POINTS
    );
    return dates.map((dateStr) => ({
      dateStr,
      ...portfolioTotalTomanAtDate(
        assets,
        transactions,
        wallets,
        dailyPrices,
        currencyRates,
        ts,
        dateStr
      ),
    }));
  }, [
    sparkRange,
    todayStr,
    assets,
    transactions,
    wallets,
    dailyPrices,
    currencyRates,
  ]);

  const deltas = useMemo(() => {
    void todayStr;
    const t = todayJalaali();
    const ts = formatJalaali(t);
    const yStr = formatJalaali(addDays(t, -1));
    const wStr = formatJalaali(addDays(t, -7));
    const tToday = portfolioStats.totalValueToman;
    const yTot = portfolioTotalTomanAtDate(
      assets,
      transactions,
      wallets,
      dailyPrices,
      currencyRates,
      ts,
      yStr
    ).totalToman;
    const wTot = portfolioTotalTomanAtDate(
      assets,
      transactions,
      wallets,
      dailyPrices,
      currencyRates,
      ts,
      wStr
    ).totalToman;
    const d1 = tToday - yTot;
    const d7 = tToday - wTot;
    const p1 = yTot > 0 ? (d1 / yTot) * 100 : null;
    const p7 = wTot > 0 ? (d7 / wTot) * 100 : null;
    return { d1, d7, p1, p7, yTot, wTot };
  }, [
    todayStr,
    portfolioStats.totalValueToman,
    assets,
    transactions,
    wallets,
    dailyPrices,
    currencyRates,
  ]);

  const prevMonthTotal = useMemo(() => {
    void todayStr;
    const t = todayJalaali();
    const ts = formatJalaali(t);
    const prevEnd = formatJalaali(endOfPreviousJalaliMonth(t));
    return portfolioTotalTomanAtDate(
      assets,
      transactions,
      wallets,
      dailyPrices,
      currencyRates,
      ts,
      prevEnd
    ).totalToman;
  }, [assets, transactions, wallets, dailyPrices, currencyRates, todayStr]);

  const ytdPnLMonthly = useMemo(() => {
    void todayStr;
    const t = todayJalaali();
    return ytdCumulativeProfitMonthlySeries(
      assets,
      transactions,
      dailyPrices,
      usdRate,
      t,
      formatJalaali(t)
    );
  }, [assets, transactions, dailyPrices, usdRate, todayStr]);

  const currencyBreakdown = useMemo(
    () => walletCashTomanByCurrency(wallets, transactions, currencyRates),
    [wallets, transactions, currencyRates]
  );

  const usdRateRow = useMemo(
    () => currencyRates.find((r) => r.currency === 'USD'),
    [currencyRates]
  );

  const cashRatio =
    portfolioStats.totalValueToman > 0
      ? portfolioStats.cashValueToman / portfolioStats.totalValueToman
      : 0;

  const displayValue =
    currencyMode === 'USD'
      ? portfolioStats.totalValueUsd
      : portfolioStats.totalValueToman;
  const displayProfit =
    currencyMode === 'USD'
      ? portfolioStats.yearTotalProfitUsd
      : portfolioStats.yearTotalProfitToman;
  const displayCash =
    currencyMode === 'USD' && usdRate > 0
      ? portfolioStats.cashValueToman / usdRate
      : portfolioStats.cashValueToman;
  const displayAssets =
    currencyMode === 'USD' && usdRate > 0
      ? portfolioStats.assetsValueToman / usdRate
      : portfolioStats.assetsValueToman;

  const onPullRefresh = useCallback(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const main = document.querySelector<HTMLElement>('[data-app-scroll="main"]');
    if (!main) return;

    let startY = 0;

    const onTouchStart = (e: TouchEvent) => {
      if (main.scrollTop > 2) {
        pullArm.current = false;
        return;
      }
      pullArm.current = true;
      startY = e.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!pullArm.current || main.scrollTop > 2) return;
      const y = e.touches[0]?.clientY ?? 0;
      const dy = y - startY;
      if (dy > 0) {
        const px = Math.min(72, dy * 0.35);
        pullDistanceRef.current = px;
        setPullDistance(px);
        if (dy > 12) e.preventDefault();
      }
    };

    const onTouchEnd = () => {
      if (pullArm.current && pullDistanceRef.current > 44) {
        onPullRefresh();
      }
      pullArm.current = false;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    main.addEventListener('touchstart', onTouchStart, { passive: true });
    main.addEventListener('touchmove', onTouchMove, { passive: false });
    main.addEventListener('touchend', onTouchEnd);
    return () => {
      main.removeEventListener('touchstart', onTouchStart);
      main.removeEventListener('touchmove', onTouchMove);
      main.removeEventListener('touchend', onTouchEnd);
    };
  }, [onPullRefresh]);

  const sparkTabs: { id: SparklineRange; label: string }[] = [
    { id: '7d', label: '۷ روز' },
    { id: '30d', label: '۳۰ روز' },
    { id: '90d', label: '۹۰ روز' },
    { id: 'ytd', label: 'امسال' },
  ];

  const showSkeleton = isLoadingData && assets.length === 0 && wallets.length === 0;

  const compareDeltaToman = portfolioStats.totalValueToman - prevMonthTotal;
  const comparePct =
    prevMonthTotal > 0 ? (compareDeltaToman / prevMonthTotal) * 100 : null;

  return (
    <div className="p-6 space-y-8 animate-in fade-in duration-300 relative">
      {pullDistance > 8 && (
        <div
          className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 flex flex-col items-center text-purple-300/90 text-xs"
          style={{ transform: `translate(-50%, ${Math.min(40, pullDistance)}px)` }}
        >
          <RefreshCw size={18} className={pullDistance > 44 ? 'animate-spin' : ''} />
          <span className="mt-1">رها کنید برای به‌روزرسانی</span>
        </div>
      )}

      <div className="flex justify-between items-center gap-3">
        <h2 className="text-xl font-bold text-white">داشبورد</h2>
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={isLoadingData}
          className="text-slate-400 hover:text-white p-2 rounded-xl border border-white/5 bg-white/5"
          aria-label="به‌روزرسانی"
        >
          <RefreshCw size={18} className={isLoadingData ? 'animate-spin' : ''} />
        </button>
      </div>

      {showSkeleton ? (
        <StaggerSkeleton />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push('/assets')}
              className="flex-1 min-w-[140px] rounded-2xl border border-white/10 bg-[#1A1B26] px-3 py-3 text-right hover:bg-[#222436] transition-colors"
            >
              <p className="text-[11px] text-slate-500">دارایی‌ها</p>
              <p className="text-sm font-semibold text-white mt-0.5" dir="ltr">
                {formatCurrency(displayAssets, currencyMode)}
              </p>
            </button>
            <button
              type="button"
              onClick={() => router.push('/wallets')}
              className="flex-1 min-w-[140px] rounded-2xl border border-white/10 bg-[#1A1B26] px-3 py-3 text-right hover:bg-[#222436] transition-colors"
            >
              <p className="text-[11px] text-slate-500">نقد</p>
              <p className="text-sm font-semibold text-white mt-0.5" dir="ltr">
                {formatCurrency(displayCash, currencyMode)}
              </p>
            </button>
          </div>

          <div className="bg-linear-to-br from-[#23253A] to-[#1A1B26] rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.4)] border border-white/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10" />
            <div className="flex items-start justify-between gap-2 relative z-10">
              <div>
                <p className="text-slate-400 text-sm mb-1">
                  ارزش کل سبد (دارایی + نقد)
                </p>
                <h2 className="text-4xl font-bold text-white tracking-tight" dir="ltr">
                  {formatCurrency(displayValue, currencyMode)}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setHeroDetailOpen(true)}
                className="shrink-0 p-2 rounded-xl bg-white/5 text-slate-400 hover:text-white border border-white/10"
                aria-label="جزئیات"
              >
                <Info size={18} />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-[11px] relative z-10">
              <span
                className={`rounded-full px-2.5 py-1 border ${
                  deltas.d1 >= 0
                    ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10'
                    : 'border-rose-500/30 text-rose-300 bg-rose-500/10'
                }`}
                dir="ltr"
              >
                دیروز: {formatPercentDelta(deltas.p1)} (
                {formatCurrency(
                  currencyMode === 'USD' && usdRate > 0 ? deltas.d1 / usdRate : deltas.d1,
                  currencyMode
                )}
                )
              </span>
              <span
                className={`rounded-full px-2.5 py-1 border ${
                  deltas.d7 >= 0
                    ? 'border-emerald-500/30 text-emerald-300/90 bg-emerald-500/5'
                    : 'border-rose-500/30 text-rose-300/90 bg-rose-500/5'
                }`}
                dir="ltr"
              >
                هفته: {formatPercentDelta(deltas.p7)} (
                {formatCurrency(
                  currencyMode === 'USD' && usdRate > 0 ? deltas.d7 / usdRate : deltas.d7,
                  currencyMode
                )}
                )
              </span>
            </div>

            <label className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 relative z-10 cursor-pointer">
              <span className="text-xs text-slate-400">مقایسه با پایان ماه قبل</span>
              <input
                type="checkbox"
                checked={comparePrevMonth}
                onChange={(e) => setComparePrevMonth(e.target.checked)}
                className="accent-purple-600 w-4 h-4"
              />
            </label>
            {comparePrevMonth && (
              <div className="mt-2 text-[11px] text-slate-400 space-y-1 relative z-10" dir="ltr">
                <p>
                  پایان ماه قبل:{' '}
                  <span className="text-slate-200">
                    {formatCurrency(
                      currencyMode === 'USD' && usdRate > 0
                        ? prevMonthTotal / usdRate
                        : prevMonthTotal,
                      currencyMode
                    )}
                  </span>
                </p>
                <p>
                  تغییر:{' '}
                  <span
                    className={
                      compareDeltaToman >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }
                  >
                    {formatCurrency(
                      currencyMode === 'USD' && usdRate > 0
                        ? compareDeltaToman / usdRate
                        : compareDeltaToman,
                      currencyMode
                    )}{' '}
                    ({formatPercentDelta(comparePct)})
                  </span>
                </p>
              </div>
            )}

            <div className="flex items-center gap-3 mt-4 relative z-10">
              <div
                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium ${portfolioStats.isProfit ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}
                dir="ltr"
              >
                {portfolioStats.isProfit ? (
                  <TrendingUp size={16} />
                ) : (
                  <TrendingDown size={16} />
                )}
                <span>{formatCurrency(Math.abs(displayProfit), currencyMode)}</span>
              </div>
              <span className="text-slate-500 text-xs">سود/زیان دارایی‌ها (امسال)</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2 relative z-10">
              سود/زیان کل امسال
              {portfolioStats.yearProfitMissingCount > 0
                ? ` · ${portfolioStats.yearProfitMissingCount.toLocaleString('fa-IR')} دارایی بدون قیمت تاریخی`
                : ''}
            </p>

            <div className="mt-5 pt-4 border-t border-white/10 relative z-10">
              <p className="text-xs text-slate-500 mb-2">
                سود/زیان انباشته امسال (ماهانه)
              </p>
              <PnlMiniBars
                points={ytdPnLMonthly}
                currencyMode={currencyMode}
                usdRate={usdRate}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="bg-[#1A1B26] p-4 rounded-3xl border border-white/5">
              <p className="text-xs text-slate-400 mb-3">سهم نقد از کل سبد</p>
              <div className="flex items-center gap-4">
                <CashGaugeRing cashRatio={cashRatio} />
                <div>
                  <p className="text-2xl font-bold text-white" dir="ltr">
                    {(cashRatio * 100).toLocaleString('fa-IR', { maximumFractionDigits: 1 })}
                    ٪
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">بقیه: دارایی‌ها</p>
                </div>
              </div>
            </div>

            <div className="bg-[#1A1B26] p-4 rounded-3xl border border-white/5">
              <p className="text-xs text-slate-400 mb-2">نرخ دلار (پایگاه داده)</p>
              <p className="text-xl font-bold text-white" dir="ltr">
                {usdRateRow && Number(usdRateRow.toman_per_unit) > 0
                  ? `${Number(usdRateRow.toman_per_unit).toLocaleString('fa-IR')} تومان`
                  : '—'}
              </p>
              {usdRateRow?.updated_at && (
                <p className="text-[10px] text-slate-500 mt-2">
                  آخرین به‌روزرسانی:{' '}
                  {new Date(usdRateRow.updated_at).toLocaleString('fa-IR', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="bg-[#1A1B26] p-4 rounded-3xl border border-white/5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <p className="text-sm font-medium text-slate-200">روند ارزش کل سبد</p>
              <BarChart3 size={16} className="text-slate-500 shrink-0" />
            </div>
            <p className="text-[10px] text-slate-500 mb-3">
              دارایی‌ها و نقد به‌صورت تاریخی بازسازی شده‌اند؛ نرخ ارزهای غیر تومانی
              همان نرخ فعلی شماست.
            </p>
            <div className="flex gap-1 flex-wrap mb-3">
              {sparkTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSparkRange(t.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    sparkRange === t.id
                      ? 'bg-purple-600 text-white'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {sparklinePoints.length >= 2 ? (
              <div className="w-full h-14">
                <SparklineChart points={sparklinePoints} height={56} />
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-4 text-center">
                دادهٔ کافی برای نمودار نیست.
              </p>
            )}
          </div>

          {currencyBreakdown.length > 0 && (
            <div className="bg-[#1A1B26] p-4 rounded-3xl border border-white/5">
              <p className="text-sm font-medium text-slate-200 mb-3">نقد به تفکیک ارز</p>
              <div className="space-y-2">
                {currencyBreakdown.map((row) => {
                  const max = currencyBreakdown[0]!.toman || 1;
                  const w = (row.toman / max) * 100;
                  return (
                    <div key={row.currency}>
                      <div className="flex justify-between text-xs text-slate-400 mb-1">
                        <span>{row.currency}</span>
                        <span dir="ltr">{formatCompactToman(row.toman)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-slate-400/80"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="rounded-3xl border border-white/10 bg-[#161722] p-4">
            <p className="text-xs text-slate-500 mb-3">اقدامات سریع</p>
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/transactions/new"
                className="flex items-center gap-2 rounded-2xl bg-purple-600/20 border border-purple-500/30 px-3 py-3 text-sm text-purple-100 hover:bg-purple-600/30 transition-colors"
              >
                <Plus size={18} className="shrink-0" />
                تراکنش
              </Link>
              <Link
                href="/prices"
                className="flex items-center gap-2 rounded-2xl bg-white/5 border border-white/10 px-3 py-3 text-sm text-slate-200 hover:bg-white/10 transition-colors"
              >
                <BarChart3 size={18} className="shrink-0 text-slate-400" />
                قیمت‌ها
              </Link>
              <Link
                href="/deadlines"
                className="flex items-center gap-2 rounded-2xl bg-white/5 border border-white/10 px-3 py-3 text-sm text-slate-200 hover:bg-white/10 transition-colors col-span-2"
              >
                <ChevronLeft size={18} className="shrink-0 text-slate-400 rotate-180" />
                سررسید و اقساط
              </Link>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-slate-200 mb-4">
              پراکندگی سبد
            </h3>
            <div className="bg-[#1A1B26] p-5 rounded-3xl border border-white/5">
              {isLoadingData && portfolioStats.distributions.length === 0 ? (
                <div className="space-y-3 animate-pulse">
                  <div className="h-3 rounded-full bg-white/10" />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="h-10 rounded-xl bg-white/5" />
                    <div className="h-10 rounded-xl bg-white/5" />
                  </div>
                </div>
              ) : portfolioStats.distributions.length > 0 ? (
                <>
                  <div className="w-full h-3 flex rounded-full overflow-hidden mb-6 bg-slate-800">
                    {portfolioStats.distributions.map((dist) => {
                      const active = selectedSliceKey === dist.sliceKey;
                      return (
                        <button
                          key={dist.sliceKey}
                          type="button"
                          title={dist.name}
                          onClick={() =>
                            setSelectedSliceKey((k) =>
                              k === dist.sliceKey ? null : dist.sliceKey
                            )
                          }
                          style={{
                            width: `${dist.percent ?? 0}%`,
                            backgroundColor: dist.color,
                            opacity: selectedSliceKey && !active ? 0.35 : 1,
                          }}
                          className="h-full min-w-[4px] transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                        />
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {portfolioStats.distributions.map((dist) => {
                      const active = selectedSliceKey === dist.sliceKey;
                      return (
                        <button
                          key={dist.sliceKey}
                          type="button"
                          onClick={() =>
                            setSelectedSliceKey((k) =>
                              k === dist.sliceKey ? null : dist.sliceKey
                            )
                          }
                          className={`flex items-center gap-3 text-right rounded-xl p-2 -m-2 transition-colors ${
                            active ? 'bg-white/10 ring-1 ring-purple-500/40' : ''
                          }`}
                        >
                          <div
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: dist.color }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-300 truncate">{dist.name}</p>
                            <p className="text-xs text-slate-500">
                              {(dist.percent ?? 0).toLocaleString('fa-IR', {
                                maximumFractionDigits: 1,
                              })}
                              ٪
                            </p>
                            {(!selectedSliceKey || active) && (
                              <p className="text-[11px] text-slate-400 mt-0.5" dir="ltr">
                                {formatCurrency(
                                  currencyMode === 'USD' && usdRate > 0
                                    ? dist.value / usdRate
                                    : dist.value,
                                  currencyMode
                                )}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center text-slate-500 text-sm py-4">
                  دیتایی برای نمایش نیست.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <BottomSheet
        open={heroDetailOpen}
        onClose={() => setHeroDetailOpen(false)}
        title="جزئیات ارزش سبد"
      >
        <div className="space-y-4 text-sm text-slate-300">
          <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
            <span className="text-slate-500">دارایی‌ها (در سبد)</span>
            <span dir="ltr" className="font-medium text-white">
              {formatCurrency(displayAssets, currencyMode)}
            </span>
          </div>
          <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
            <span className="text-slate-500">نقد</span>
            <span dir="ltr" className="font-medium text-white">
              {formatCurrency(displayCash, currencyMode)}
            </span>
          </div>
          <div className="flex justify-between gap-4 border-b border-white/10 pb-3">
            <span className="text-slate-500">جمع</span>
            <span dir="ltr" className="font-bold text-purple-200">
              {formatCurrency(displayValue, currencyMode)}
            </span>
          </div>
          {portfolioStats.excludedFromBalanceNames.length > 0 && (
            <div>
              <p className="text-xs text-slate-500 mb-2">
                خارج از «ارزش کل سبد» (فقط نام)
              </p>
              <ul className="list-disc pr-5 text-xs text-amber-200/90 space-y-1">
                {portfolioStats.excludedFromBalanceNames.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-[11px] text-slate-500 leading-relaxed">
            نرخ تبدیل ارزهای کیف پول از جدول نرخ شماست. برای دلار، مقدار
            ردیف USD در نرخ‌ها معتبر است.
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
