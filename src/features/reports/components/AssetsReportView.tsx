'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Coins,
  Info,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import type { CurrencyMode } from '@/shared/types/domain';
import { EntityIcon } from '@/shared/components/EntityIcon';
import { formatCurrency } from '@/shared/utils/format-currency';
import {
  decodePeriodParams,
  encodePeriodParams,
  formatPeriodLabel,
  isCurrentPeriod,
  type Period,
} from '@/shared/utils/period';
import {
  formatJalaali,
  formatJalaaliHuman,
  parseJalaali,
  todayJalaali,
} from '@/shared/utils/jalali';
import { PeriodNavHeader } from '@/features/reports/components/PeriodNavHeader';
import {
  calculateAssetPeriodStats,
  type AssetPeriodStats,
} from '@/features/reports/utils/asset-period-stats';
import { effectivePriceAt } from '@/features/reports/utils/price-history';
import type { Asset } from '@/shared/types/domain';

export function AssetsReportView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { assets, transactions, dailyPrices } = useData();
  const { usdRate, currencyMode } = useUI();

  const period = useMemo(
    () => decodePeriodParams(searchParams.get('period'), searchParams.get('d')),
    [searchParams]
  );
  const assetFilter = searchParams.get('asset') || null;
  const todayStr = useMemo(() => formatJalaali(todayJalaali()), []);

  const pushParams = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/reports/assets?${sp.toString()}`, { scroll: false });
  };
  const setPeriod = (p: Period) => {
    const { period, d } = encodePeriodParams(p);
    pushParams({ period, d });
  };
  const setAsset = (id: string | null) => pushParams({ asset: id });

  // Compute per-asset stats once. Price lookup is O(n) in dailyPrices per
  // asset; with hundreds of snapshots × tens of assets still well under a
  // frame. Memoization keeps it off the render hot path.
  const allStats = useMemo(() => {
    const periodEndStr = formatJalaali(period.end);
    return assets
      .filter((a) => a.include_in_profit_loss !== false)
      .map((a) => {
      const endPrice = effectivePriceAt(a, periodEndStr, dailyPrices, todayStr);
      return {
        asset: a,
        stats: calculateAssetPeriodStats(
          a,
          transactions,
          period,
          usdRate,
          endPrice
        ),
      };
      });
  }, [assets, transactions, period, usdRate, dailyPrices, todayStr]);

  const visible = assetFilter
    ? allStats.filter((x) => x.asset.id === assetFilter)
    : allStats;

  // Sort: period activity first (by abs realized desc), then zero-activity
  // by period-end notional value desc (endHoldings × endAvgCost).
  const sorted = useMemo(() => {
    return [...visible].sort((a, b) => {
      const aAct = a.stats.hadActivity ? 1 : 0;
      const bAct = b.stats.hadActivity ? 1 : 0;
      if (aAct !== bAct) return bAct - aAct;
      if (a.stats.hadActivity) {
        return (
          Math.abs(b.stats.realizedToman) - Math.abs(a.stats.realizedToman)
        );
      }
      const aVal =
        a.stats.endHoldings *
        (a.stats.periodEndPriceToman ?? a.asset.price_toman ?? 0);
      const bVal =
        b.stats.endHoldings *
        (b.stats.periodEndPriceToman ?? b.asset.price_toman ?? 0);
      return bVal - aVal;
    });
  }, [visible]);

  // Totals across currently visible assets. Only aggregate unrealized for
  // assets where we actually know the period-end price — zeros from missing
  // data would LIE. We expose `unrealizedMissingCount` so the UI can flag
  // that the total is partial.
  const totals = useMemo(() => {
    let realizedToman = 0;
    let realizedUsd = 0;
    let unrealizedToman = 0;
    let unrealizedUsd = 0;
    let unrealizedMissingCount = 0;
    let buyCount = 0;
    let sellCount = 0;
    for (const { stats } of visible) {
      realizedToman += stats.realizedToman;
      realizedUsd += stats.realizedUsd;
      if (stats.unrealizedAvailable) {
        unrealizedToman += stats.unrealizedToman;
        unrealizedUsd += stats.unrealizedUsd;
      } else {
        unrealizedMissingCount += 1;
      }
      buyCount += stats.bought.count;
      sellCount += stats.sold.count;
    }
    return {
      realizedToman,
      realizedUsd,
      unrealizedToman,
      unrealizedUsd,
      unrealizedMissingCount,
      buyCount,
      sellCount,
    };
  }, [visible]);

  const periodIsCurrent = isCurrentPeriod(period);
  const periodEndLabel = periodIsCurrent
    ? 'تا اکنون'
    : `پایان ${formatPeriodLabel(period)}`;

  return (
    <div className="bg-[#161722] min-h-full">
      <header className="sticky top-0 z-10 bg-[#161722]/95 backdrop-blur-md border-b border-white/5 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="بازگشت"
          className="w-9 h-9 rounded-xl bg-[#1A1B26] border border-white/5 flex items-center justify-center text-slate-300 hover:bg-white/5"
        >
          <ChevronRight size={18} />
        </button>
        <h1 className="flex-1 text-base font-bold text-white">
          گزارش سود/زیان دارایی‌ها
        </h1>
      </header>

      <main className="p-4 space-y-4 pb-24">
        <PeriodNavHeader period={period} onChange={setPeriod} />

        <AssetFilterChips
          assets={assets}
          value={assetFilter}
          onChange={setAsset}
        />

        <SummaryCard
          totalToman={totals.realizedToman + totals.unrealizedToman}
          totalUsd={totals.realizedUsd + totals.unrealizedUsd}
          realizedToman={totals.realizedToman}
          realizedUsd={totals.realizedUsd}
          unrealizedToman={totals.unrealizedToman}
          unrealizedUsd={totals.unrealizedUsd}
          unrealizedMissingCount={totals.unrealizedMissingCount}
          buyCount={totals.buyCount}
          sellCount={totals.sellCount}
          periodEndLabel={periodEndLabel}
          currencyMode={currencyMode}
        />

        {sorted.length === 0 ? (
          <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-8 text-center">
            <Coins size={28} className="text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400">دارایی‌ای برای نمایش نیست.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map(({ asset, stats }) => (
              <AssetRow key={asset.id} asset={asset} stats={stats} currencyMode={currencyMode} />
            ))}
          </div>
        )}

        {totals.unrealizedMissingCount > 0 && (
          <p className="text-[10px] text-slate-500 leading-relaxed px-2">
            برای {totals.unrealizedMissingCount.toLocaleString('fa-IR')} دارایی
            قیمت پایان دوره در دسترس نیست؛ سود/زیان باز آن‌ها در جمع لحاظ
            نشده. با ثبت قیمت روزانه یا تراکنش در آن روز، تاریخچه ساخته می‌شود.
          </p>
        )}
      </main>
    </div>
  );
}

function AssetFilterChips({
  assets,
  value,
  onChange,
}: {
  assets: Asset[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (assets.length === 0) return null;
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
      <button
        type="button"
        onClick={() => onChange(null)}
        className={`shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition border ${
          value === null
            ? 'bg-purple-500/20 border-purple-500/40 text-white'
            : 'bg-[#1A1B26] border-white/5 text-slate-400 hover:text-white'
        }`}
      >
        همه دارایی‌ها
      </button>
      {assets.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onChange(a.id)}
          className={`shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition border ${
            value === a.id
              ? 'bg-purple-500/20 border-purple-500/40 text-white'
              : 'bg-[#1A1B26] border-white/5 text-slate-400 hover:text-white'
          }`}
        >
          {a.name}
        </button>
      ))}
    </div>
  );
}

function SummaryCard({
  totalToman,
  totalUsd,
  realizedToman,
  realizedUsd,
  unrealizedToman,
  unrealizedUsd,
  unrealizedMissingCount,
  buyCount,
  sellCount,
  periodEndLabel,
  currencyMode,
}: {
  totalToman: number;
  totalUsd: number;
  realizedToman: number;
  realizedUsd: number;
  unrealizedToman: number;
  unrealizedUsd: number;
  unrealizedMissingCount: number;
  buyCount: number;
  sellCount: number;
  periodEndLabel: string;
  currencyMode: CurrencyMode;
}) {
  return (
    <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">خلاصه دوره</span>
        <span className="text-[10px] text-slate-500">
          {buyCount} خرید · {sellCount} فروش
        </span>
      </div>
      <PnlLine
        label="سود/زیان کل (Total)"
        toman={totalToman}
        usd={totalUsd}
        tip={
          unrealizedMissingCount > 0
            ? `جمع کل با کسر ${unrealizedMissingCount.toLocaleString('fa-IR')} دارایی بدون قیمت پایان دوره`
            : 'مجموع محقق‌شده و باز در این دوره'
        }
        size="lg"
        warn={unrealizedMissingCount > 0}
        currencyMode={currencyMode}
      />
      <div className="border-t border-white/5" />
      <PnlLine
        label="محقق‌شده (Realized)"
        toman={realizedToman}
        usd={realizedUsd}
        tip="از تراکنش‌های فروش انجام‌شده در این دوره"
        size="md"
        currencyMode={currencyMode}
      />
      <div className="border-t border-white/5" />
      <PnlLine
        label={`باز (Unrealized) — ${periodEndLabel}`}
        toman={unrealizedToman}
        usd={unrealizedUsd}
        tip={
          unrealizedMissingCount > 0
            ? `${unrealizedMissingCount.toLocaleString('fa-IR')} دارایی بدون قیمت تاریخی لحاظ نشده`
            : 'بر اساس قیمت ثبت‌شده در پایان دوره'
        }
        size="md"
        warn={unrealizedMissingCount > 0}
        currencyMode={currencyMode}
      />
    </div>
  );
}

function PnlLine({
  label,
  toman,
  usd,
  tip,
  size,
  warn,
  currencyMode,
}: {
  label: string;
  toman: number;
  usd: number;
  tip: string;
  size: 'lg' | 'md';
  warn?: boolean;
  currencyMode: CurrencyMode;
}) {
  // Pivot primary/secondary based on the global currency toggle so the
  // dominant number always matches the user's chosen perspective.
  const primary = currencyMode === 'USD' ? usd : toman;
  const secondary = currencyMode === 'USD' ? toman : usd;
  const secondaryMode: CurrencyMode = currencyMode === 'USD' ? 'TOMAN' : 'USD';

  const positive = primary >= 0;
  const color =
    primary === 0
      ? 'text-slate-300'
      : positive
        ? 'text-emerald-400'
        : 'text-rose-400';
  const sizeCls = size === 'lg' ? 'text-xl' : 'text-base';
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        {primary >= 0 ? (
          <TrendingUp size={14} className="text-emerald-400" />
        ) : (
          <TrendingDown size={14} className="text-rose-400" />
        )}
        <span className="text-[11px] text-slate-400">{label}</span>
        {warn && <AlertCircle size={11} className="text-amber-400" />}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`${sizeCls}  font-bold ${color}`}>
          {primary > 0 ? '+' : ''}
          {formatCurrency(primary, currencyMode)}
        </span>
        <span className={`text-xs  ${color}`}>
          ({secondary > 0 ? '+' : ''}
          {formatCurrency(secondary, secondaryMode)})
        </span>
      </div>
      <p className="text-[10px] text-slate-500 mt-0.5">{tip}</p>
    </div>
  );
}

function AssetRow({
  asset,
  stats,
  currencyMode,
}: {
  asset: Asset;
  stats: AssetPeriodStats;
  currencyMode: CurrencyMode;
}) {
  const hasActivity = stats.hadActivity;
  const realizedPrimary = currencyMode === 'USD' ? stats.realizedUsd : stats.realizedToman;
  const realizedSecondary = currencyMode === 'USD' ? stats.realizedToman : stats.realizedUsd;
  const unrealizedPrimary = currencyMode === 'USD' ? stats.unrealizedUsd : stats.unrealizedToman;
  const unrealizedSecondary = currencyMode === 'USD' ? stats.unrealizedToman : stats.unrealizedUsd;
  const totalPrimary = stats.unrealizedAvailable
    ? realizedPrimary + unrealizedPrimary
    : null;
  const totalSecondary = stats.unrealizedAvailable
    ? realizedSecondary + unrealizedSecondary
    : null;
  const secondaryMode: CurrencyMode = currencyMode === 'USD' ? 'TOMAN' : 'USD';
  const realizedPositive = realizedPrimary >= 0;
  const realizedColor =
    realizedPrimary === 0
      ? 'text-slate-500'
      : realizedPositive
        ? 'text-emerald-400'
        : 'text-rose-400';

  // Show a stale-snapshot hint when the actual source date is meaningfully
  // earlier than the period end. Use 3+ days as the threshold for "stale".
  const staleHint = useMemo(() => {
    if (!stats.unrealizedAvailable) return null;
    if (!stats.periodEndPriceSourceDate) return null;
    // We don't have the period.end here; but `periodEndPriceSourceDate` is
    // only non-null when the price came from a snapshot, and the snapshot
    // is definitionally <= period.end. We parse both dates to days to
    // compute staleness below — this is a tiny helper that only runs when
    // the flag is set.
    const src = parseJalaali(stats.periodEndPriceSourceDate);
    if (!src) return null;
    return stats.periodEndPriceSourceDate;
  }, [stats.periodEndPriceSourceDate, stats.unrealizedAvailable]);

  return (
    <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-3 space-y-3">
      <div className="flex items-center gap-3">
        <EntityIcon
          iconUrl={asset.icon_url}
          fallback={<Coins size={16} />}
          className="w-9 h-9 shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-white truncate">
            {asset.name}
          </div>
          <div className="text-[10px] text-slate-500">
            موجودی در پایان دوره:{' '}
            <span className=" text-slate-400">
              {stats.endHoldings.toLocaleString('en-US', {
                maximumFractionDigits: 6,
              })}{' '}
              {asset.unit}
            </span>
          </div>
        </div>
        {hasActivity && (
          <div className="text-left shrink-0">
            <div className={`text-sm  font-bold ${realizedColor}`}>
              {realizedPrimary > 0 ? '+' : ''}
              {formatCurrency(realizedPrimary, currencyMode)}
            </div>
            <div className="text-[10px]  text-slate-500">
              {realizedSecondary > 0 ? '+' : ''}
              {formatCurrency(realizedSecondary, secondaryMode)}
            </div>
          </div>
        )}
      </div>

      {hasActivity ? (
        <div className="grid grid-cols-2 gap-2">
          <TradeBox
            icon={<ArrowDown size={12} className="text-emerald-400" />}
            label="خرید دوره"
            units={stats.bought.units}
            unit={asset.unit}
            avgToman={stats.bought.avgPriceToman}
            avgUsd={stats.bought.avgPriceUsd}
            count={stats.bought.count}
            empty={stats.bought.units === 0}
            currencyMode={currencyMode}
          />
          <TradeBox
            icon={<ArrowUp size={12} className="text-rose-400" />}
            label="فروش دوره"
            units={stats.sold.units}
            unit={asset.unit}
            avgToman={stats.sold.avgPriceToman}
            avgUsd={stats.sold.avgPriceUsd}
            count={stats.sold.count}
            empty={stats.sold.units === 0}
            currencyMode={currencyMode}
          />
        </div>
      ) : (
        <div className="text-[11px] text-slate-500 bg-white/2 border border-white/5 rounded-lg px-3 py-2">
          در این دوره تراکنشی ثبت نشده.
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/5">
        <MiniFact
          label="سود/زیان محقق‌شده"
          main={
            <span className={realizedColor}>
              {realizedPrimary > 0 ? '+' : ''}
              {formatCurrency(realizedPrimary, currencyMode)}
            </span>
          }
          sub={
            <span className={realizedColor}>
              {realizedSecondary > 0 ? '+' : ''}
              {formatCurrency(realizedSecondary, secondaryMode)}
            </span>
          }
        />
        {stats.unrealizedAvailable ? (
          <MiniFact
            label="سود/زیان باز"
            main={
              <span
                className={
                  unrealizedPrimary > 0
                    ? 'text-emerald-400'
                    : unrealizedPrimary < 0
                      ? 'text-rose-400'
                      : 'text-slate-400'
                }
              >
                {unrealizedPrimary > 0 ? '+' : ''}
                {formatCurrency(unrealizedPrimary, currencyMode)}
              </span>
            }
            sub={
              <span
                className={
                  unrealizedSecondary > 0
                    ? 'text-emerald-400'
                    : unrealizedSecondary < 0
                      ? 'text-rose-400'
                      : 'text-slate-400'
                }
              >
                {unrealizedSecondary > 0 ? '+' : ''}
                {formatCurrency(unrealizedSecondary, secondaryMode)}
              </span>
            }
            hint={
              staleHint && !stats.periodEndPriceIsLive
                ? `قیمت: ${formatJalaaliHuman(parseJalaali(staleHint)!)}`
                : undefined
            }
          />
        ) : (
          <MiniFact
            label="سود/زیان باز"
            main={
              <span className="text-slate-500 inline-flex items-center gap-1">
                —
                <Info size={11} className="text-slate-600" />
              </span>
            }
            sub={
              <span className="text-[10px] text-slate-600">
                قیمت پایان دوره ثبت نشده
              </span>
            }
          />
        )}
        {stats.unrealizedAvailable && totalPrimary !== null && totalSecondary !== null ? (
          <MiniFact
            label="سود/زیان کل"
            main={
              <span
                className={
                  totalPrimary > 0
                    ? 'text-emerald-400'
                    : totalPrimary < 0
                      ? 'text-rose-400'
                      : 'text-slate-400'
                }
              >
                {totalPrimary > 0 ? '+' : ''}
                {formatCurrency(totalPrimary, currencyMode)}
              </span>
            }
            sub={
              <span
                className={
                  totalSecondary > 0
                    ? 'text-emerald-400'
                    : totalSecondary < 0
                      ? 'text-rose-400'
                      : 'text-slate-400'
                }
              >
                {totalSecondary > 0 ? '+' : ''}
                {formatCurrency(totalSecondary, secondaryMode)}
              </span>
            }
          />
        ) : (
          <MiniFact
            label="سود/زیان کل"
            main={<span className="text-slate-500">—</span>}
            sub={<span className="text-[10px] text-slate-600">به قیمت تاریخی نیاز دارد</span>}
          />
        )}
      </div>

      {stats.endHoldings > 0 && (
        <div className="grid grid-cols-1 gap-2 pt-2 border-t border-white/5">
          <MiniFact
            label="میانگین قیمت خرید (پایان دوره)"
            main={formatCurrency(
              currencyMode === 'USD' ? stats.endAvgCostUsd : stats.endAvgCostToman,
              currencyMode
            )}
            sub={formatCurrency(
              currencyMode === 'USD' ? stats.endAvgCostToman : stats.endAvgCostUsd,
              secondaryMode
            )}
          />
        </div>
      )}
    </div>
  );
}

function TradeBox({
  icon,
  label,
  units,
  unit,
  avgToman,
  avgUsd,
  count,
  empty,
  currencyMode,
}: {
  icon: React.ReactNode;
  label: string;
  units: number;
  unit: string;
  avgToman: number;
  avgUsd: number;
  count: number;
  empty: boolean;
  currencyMode: CurrencyMode;
}) {
  const primary = currencyMode === 'USD' ? avgUsd : avgToman;
  const secondary = currencyMode === 'USD' ? avgToman : avgUsd;
  const secondaryMode: CurrencyMode = currencyMode === 'USD' ? 'TOMAN' : 'USD';
  return (
    <div
      className={`bg-white/2 border border-white/5 rounded-xl p-2.5 ${empty ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-slate-500">{label}</span>
        <span className="text-[10px] text-slate-600 mr-auto">({count})</span>
      </div>
      <div className="text-xs  text-white">
        {units.toLocaleString('en-US', { maximumFractionDigits: 6 })}{' '}
        <span className="text-[10px] text-slate-500">{unit}</span>
      </div>
      <div className="text-[10px] text-slate-500 mt-1">میانگین قیمت</div>
      <div className="text-[11px]  text-slate-300">
        {formatCurrency(primary, currencyMode)}
      </div>
      <div className="text-[10px]  text-slate-500">
        {formatCurrency(secondary, secondaryMode)}
      </div>
    </div>
  );
}

function MiniFact({
  label,
  main,
  sub,
  hint,
}: {
  label: string;
  main: React.ReactNode;
  sub: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className="text-xs  font-bold text-white">{main}</div>
      <div className="text-[10px]  text-slate-500">{sub}</div>
      {hint && (
        <div className="text-[9px] text-amber-400/70 mt-0.5">{hint}</div>
      )}
    </div>
  );
}
