'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Coins,
  TrendingDown,
  TrendingUp,
  Wallet as WalletIcon,
} from 'lucide-react';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { formatCurrency } from '@/shared/utils/format-currency';
import {
  currentPeriod,
  encodePeriodParams,
  formatCurrentPeriodLabel,
  PERIOD_KINDS,
  type PeriodKind,
} from '@/shared/utils/period';
import { rollupCategories } from '@/features/reports/utils/category-rollup';
import { calculateAssetPeriodStats } from '@/features/reports/utils/asset-period-stats';

export function ReportsIndexView() {
  const router = useRouter();
  const { transactions, categories, wallets, currencyRates, assets } = useData();
  const { usdRate } = useUI();

  const cashflowByPeriod = useMemo(() => {
    return PERIOD_KINDS.map((kind) => {
      const period = currentPeriod(kind);
      const income = rollupCategories({
        transactions, categories, wallets, currencyRates,
        period, kind: 'income', walletId: null,
      }).total;
      const expense = rollupCategories({
        transactions, categories, wallets, currencyRates,
        period, kind: 'expense', walletId: null,
      }).total;
      return { kind, income, expense };
    });
  }, [transactions, categories, wallets, currencyRates]);

  // Index cards only surface REALIZED P/L (which depends on actual trade
  // prices, not end-of-period prices). Passing `null` for the period-end
  // price is correct: it just flags unrealized as unavailable, which we
  // ignore here. Avoiding the price lookup keeps this hot-path cheap when
  // the portfolio has many assets.
  const assetsByPeriod = useMemo(() => {
    return PERIOD_KINDS.map((kind) => {
      const period = currentPeriod(kind);
      let realizedToman = 0;
      let realizedUsd = 0;
      let buyCount = 0;
      let sellCount = 0;
      for (const a of assets) {
        const s = calculateAssetPeriodStats(
          a,
          transactions,
          period,
          usdRate,
          null
        );
        realizedToman += s.realizedToman;
        realizedUsd += s.realizedUsd;
        buyCount += s.bought.count;
        sellCount += s.sold.count;
      }
      return { kind, realizedToman, realizedUsd, buyCount, sellCount };
    });
  }, [assets, transactions, usdRate]);

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
        <div className="flex-1">
          <h1 className="text-base font-bold text-white flex items-center gap-2">
            <BarChart3 size={18} className="text-purple-400" />
            گزارش‌ها
          </h1>
          <p className="text-[11px] text-slate-500 mt-0.5">
            تحلیل جریان نقدی و سود/زیان دارایی‌ها بر اساس دوره‌های زمانی
          </p>
        </div>
      </header>

      <main className="p-4 space-y-8 pb-24">
        {/* Cashflow section */}
        <section className="space-y-3">
          <SectionHeader
            icon={<WalletIcon size={16} className="text-emerald-400" />}
            title="درآمد و هزینه"
            subtitle="مجموع بر اساس دسته‌بندی‌ها"
          />
          <div className="grid grid-cols-1 gap-2">
            {cashflowByPeriod.map(({ kind, income, expense }) => (
              <CashflowPeriodCard
                key={kind}
                kind={kind}
                income={income}
                expense={expense}
              />
            ))}
          </div>
        </section>

        {/* Assets section */}
        <section className="space-y-3">
          <SectionHeader
            icon={<Coins size={16} className="text-amber-400" />}
            title="سود/زیان دارایی‌ها"
            subtitle="محقق‌شده در دوره بر اساس تراکنش‌های خرید/فروش"
          />
          <div className="grid grid-cols-1 gap-2">
            {assetsByPeriod.map(({ kind, realizedToman, realizedUsd, buyCount, sellCount }) => (
              <AssetsPeriodCard
                key={kind}
                kind={kind}
                realizedToman={realizedToman}
                realizedUsd={realizedUsd}
                buyCount={buyCount}
                sellCount={sellCount}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">{icon}</div>
      <div>
        <h2 className="text-sm font-bold text-white">{title}</h2>
        <p className="text-[10px] text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function CashflowPeriodCard({
  kind,
  income,
  expense,
}: {
  kind: PeriodKind;
  income: number;
  expense: number;
}) {
  const { period, d } = encodePeriodParams(currentPeriod(kind));
  const href = `/reports/cashflow?period=${period}&d=${d}`;
  const net = income - expense;

  return (
    <Link
      href={href}
      className="flex items-stretch gap-3 bg-[#1A1B26] border border-white/5 hover:border-purple-500/30 rounded-2xl p-3 transition group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-300">
            {formatCurrentPeriodLabel(kind)}
          </span>
          <span className={`text-[10px] font-mono ${
            net > 0 ? 'text-emerald-400' : net < 0 ? 'text-rose-400' : 'text-slate-500'
          }`}>
            {net > 0 ? '+' : ''}
            {formatCurrency(net, 'TOMAN')}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <MiniStat
            icon={<ArrowDownCircle size={12} className="text-emerald-400" />}
            label="درآمد"
            value={formatCurrency(income, 'TOMAN')}
            tone="income"
            empty={income === 0}
          />
          <MiniStat
            icon={<ArrowUpCircle size={12} className="text-rose-400" />}
            label="هزینه"
            value={formatCurrency(expense, 'TOMAN')}
            tone="expense"
            empty={expense === 0}
          />
        </div>
      </div>
      <ChevronLeft size={18} className="text-slate-600 group-hover:text-purple-400 self-center transition" />
    </Link>
  );
}

function AssetsPeriodCard({
  kind,
  realizedToman,
  realizedUsd,
  buyCount,
  sellCount,
}: {
  kind: PeriodKind;
  realizedToman: number;
  realizedUsd: number;
  buyCount: number;
  sellCount: number;
}) {
  const { period, d } = encodePeriodParams(currentPeriod(kind));
  const href = `/reports/assets?period=${period}&d=${d}`;
  const positive = realizedToman >= 0;

  return (
    <Link
      href={href}
      className="flex items-stretch gap-3 bg-[#1A1B26] border border-white/5 hover:border-purple-500/30 rounded-2xl p-3 transition group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-slate-300">
            {formatCurrentPeriodLabel(kind)}
          </span>
          <span className="text-[10px] text-slate-500">
            {buyCount} خرید · {sellCount} فروش
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          {positive ? (
            <TrendingUp size={14} className="text-emerald-400" />
          ) : (
            <TrendingDown size={14} className="text-rose-400" />
          )}
          <span className={`text-sm font-mono font-bold ${
            positive ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {realizedToman > 0 ? '+' : ''}
            {formatCurrency(realizedToman, 'TOMAN')}
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            ({realizedUsd > 0 ? '+' : ''}
            {formatCurrency(realizedUsd, 'USD')})
          </span>
        </div>
        <p className="text-[10px] text-slate-500 mt-0.5">سود/زیان محقق‌شده</p>
      </div>
      <ChevronLeft size={18} className="text-slate-600 group-hover:text-purple-400 self-center transition" />
    </Link>
  );
}

function MiniStat({
  icon,
  label,
  value,
  tone,
  empty,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'income' | 'expense';
  empty: boolean;
}) {
  const color = empty
    ? 'text-slate-600'
    : tone === 'income'
      ? 'text-emerald-400'
      : 'text-rose-400';
  return (
    <div className="bg-white/2 border border-white/5 rounded-xl px-2.5 py-2">
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon}
        <span className="text-[10px] text-slate-500">{label}</span>
      </div>
      <div className={`text-xs font-mono font-bold ${color}`}>{value}</div>
    </div>
  );
}
