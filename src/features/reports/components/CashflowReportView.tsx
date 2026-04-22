'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  WalletIcon,
} from 'lucide-react';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import type { CurrencyMode } from '@/shared/types/domain';
import { formatCurrency } from '@/shared/utils/format-currency';
import {
  decodePeriodParams,
  encodePeriodParams,
  type Period,
} from '@/shared/utils/period';
import { PeriodNavHeader } from '@/features/reports/components/PeriodNavHeader';
import {
  rollupCategories,
  type CashflowKind,
  type RollupNode,
  type RollupResult,
} from '@/features/reports/utils/category-rollup';

type Tab = CashflowKind;

export function CashflowReportView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { transactions, categories, wallets } = useData();
  const { currencyMode } = useUI();

  const period = useMemo(
    () => decodePeriodParams(searchParams.get('period'), searchParams.get('d')),
    [searchParams]
  );
  const tab: Tab = (searchParams.get('tab') === 'income' ? 'income' : 'expense');
  const walletId = searchParams.get('wallet') || null;

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const pushParams = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`/reports/cashflow?${sp.toString()}`, { scroll: false });
    setExpanded(new Set()); // reset drill state on filter change
  };

  const setPeriod = (p: Period) => {
    const { period, d } = encodePeriodParams(p);
    pushParams({ period, d });
  };
  const setTab = (t: Tab) => pushParams({ tab: t });
  const setWallet = (w: string | null) => pushParams({ wallet: w });

  const incomeRollup = useMemo(
    () =>
      rollupCategories({
        transactions, categories, wallets,
        period, kind: 'income', walletId, currencyMode,
      }),
    [transactions, categories, wallets, period, walletId, currencyMode]
  );
  const expenseRollup = useMemo(
    () =>
      rollupCategories({
        transactions, categories, wallets,
        period, kind: 'expense', walletId, currencyMode,
      }),
    [transactions, categories, wallets, period, walletId, currencyMode]
  );

  const active = tab === 'income' ? incomeRollup : expenseRollup;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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
        <h1 className="flex-1 text-base font-bold text-white">گزارش درآمد و هزینه</h1>
      </header>

      <main className="p-4 space-y-4 pb-24">
        <PeriodNavHeader period={period} onChange={setPeriod} />

        <WalletFilterChips
          wallets={wallets}
          value={walletId}
          onChange={setWallet}
        />

        <TabSwitcher
          tab={tab}
          onChange={setTab}
          incomeTotal={incomeRollup.total}
          expenseTotal={expenseRollup.total}
          currencyMode={currencyMode}
        />

        <CategoryList
          result={active}
          tab={tab}
          expanded={expanded}
          onToggle={toggle}
          currencyMode={currencyMode}
        />

        {active.unpricedCount > 0 && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-200 leading-relaxed">
              {active.unpricedCount.toLocaleString('fa-IR')} تراکنش بدون
              قیمت لحظه‌ای ثبت شده و در جمع لحاظ نشده. ویرایش و ثبت
              قیمت تا سود/زیان دقیق محاسبه شود.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function WalletFilterChips({
  wallets,
  value,
  onChange,
}: {
  wallets: ReturnType<typeof useData>['wallets'];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (wallets.length === 0) return null;
  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
      <FilterChip
        label="همه کیف‌ها"
        active={value === null}
        onClick={() => onChange(null)}
      />
      {wallets.map((w) => (
        <FilterChip
          key={w.id}
          label={w.name}
          active={value === w.id}
          onClick={() => onChange(w.id)}
        />
      ))}
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition border ${
        active
          ? 'bg-purple-500/20 border-purple-500/40 text-white'
          : 'bg-[#1A1B26] border-white/5 text-slate-400 hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

function TabSwitcher({
  tab,
  onChange,
  incomeTotal,
  expenseTotal,
  currencyMode,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  incomeTotal: number;
  expenseTotal: number;
  currencyMode: CurrencyMode;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <TabCard
        active={tab === 'income'}
        onClick={() => onChange('income')}
        icon={<ArrowDownCircle size={16} className="text-emerald-400" />}
        label="درآمد"
        value={incomeTotal}
        tone="income"
        currencyMode={currencyMode}
      />
      <TabCard
        active={tab === 'expense'}
        onClick={() => onChange('expense')}
        icon={<ArrowUpCircle size={16} className="text-rose-400" />}
        label="هزینه"
        value={expenseTotal}
        tone="expense"
        currencyMode={currencyMode}
      />
    </div>
  );
}

function TabCard({
  active,
  onClick,
  icon,
  label,
  value,
  tone,
  currencyMode,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: 'income' | 'expense';
  currencyMode: CurrencyMode;
}) {
  const activeRing = tone === 'income'
    ? 'border-emerald-500/40 bg-emerald-500/5'
    : 'border-rose-500/40 bg-rose-500/5';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 border rounded-2xl p-3 text-right transition ${
        active ? activeRing : 'bg-[#1A1B26] border-white/5 hover:bg-white/5'
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className={`text-xs font-bold ${active ? 'text-white' : 'text-slate-400'}`}>
          {label}
        </span>
      </div>
      <span className={`text-lg font-mono font-bold ${
        active
          ? tone === 'income' ? 'text-emerald-400' : 'text-rose-400'
          : 'text-slate-300'
      }`}>
        {formatCurrency(value, currencyMode)}
      </span>
    </button>
  );
}

function CategoryList({
  result,
  tab,
  expanded,
  onToggle,
  currencyMode,
}: {
  result: RollupResult;
  tab: Tab;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  currencyMode: CurrencyMode;
}) {
  const { nodes, total, uncategorized } = result;

  // Hide rows whose ancestor is collapsed.
  const visibleNodes = useMemoVisible(nodes, expanded);

  const accent = tab === 'income' ? 'emerald' : 'rose';

  if (nodes.length === 0 && uncategorized.total === 0) {
    return (
      <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-8 text-center">
        <FolderOpen size={28} className="text-slate-600 mx-auto mb-2" />
        <p className="text-sm text-slate-400">
          در این بازه، {tab === 'income' ? 'درآمدی' : 'هزینه‌ای'} ثبت نشده.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {visibleNodes.map((n) => (
        <CategoryRow
          key={n.id}
          node={n}
          total={total}
          accent={accent}
          isExpanded={expanded.has(n.id)}
          onToggle={() => onToggle(n.id)}
          currencyMode={currencyMode}
        />
      ))}
      {uncategorized.total > 0 && (
        <UncategorizedRow total={uncategorized.total} count={uncategorized.count} parentTotal={total} accent={accent} currencyMode={currencyMode} />
      )}
    </div>
  );
}

function useMemoVisible(nodes: RollupNode[], expanded: Set<string>) {
  return useMemo(() => {
    const out: RollupNode[] = [];
    // Walk and skip subtrees whose parent is collapsed.
    const skipDepth: { depth: number } = { depth: -1 };
    for (const n of nodes) {
      if (skipDepth.depth !== -1 && n.depth > skipDepth.depth) continue;
      skipDepth.depth = -1;
      out.push(n);
      if (n.hasChildren && !expanded.has(n.id)) {
        skipDepth.depth = n.depth;
      }
    }
    return out;
  }, [nodes, expanded]);
}

function CategoryRow({
  node,
  total,
  accent,
  isExpanded,
  onToggle,
  currencyMode,
}: {
  node: RollupNode;
  total: number;
  accent: 'emerald' | 'rose';
  isExpanded: boolean;
  onToggle: () => void;
  currencyMode: CurrencyMode;
}) {
  const displayValue = node.depth === 0 ? node.rolled : node.own;
  const pct = total > 0 ? (displayValue / total) * 100 : 0;
  const empty = displayValue === 0;
  const barColor = accent === 'emerald' ? 'bg-emerald-500/60' : 'bg-rose-500/60';
  const textColor = accent === 'emerald' ? 'text-emerald-400' : 'text-rose-400';

  const handleClick = () => {
    if (node.hasChildren) onToggle();
  };
  const Component = (node.hasChildren ? 'button' : 'div') as 'button' | 'div';

  return (
    <Component
      {...(node.hasChildren ? { type: 'button' as const, onClick: handleClick } : {})}
      className={`w-full flex items-center gap-2 bg-[#1A1B26] border border-white/5 rounded-xl px-3 py-2.5 text-right transition ${
        node.hasChildren ? 'hover:bg-white/5 cursor-pointer' : ''
      } ${empty ? 'opacity-50' : ''}`}
      style={{ paddingInlineStart: `${12 + node.depth * 16}px` }}
    >
      {node.hasChildren ? (
        <ChevronDown
          size={14}
          className={`shrink-0 text-slate-500 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
        />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ backgroundColor: node.color }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-white truncate">
            {node.name}
            {node.depth === 0 && node.hasChildren && !isExpanded && (
              <span className="text-[10px] text-slate-500 mr-1">(جمع زیرشاخه‌ها)</span>
            )}
          </span>
          <span className={`text-xs font-mono font-bold ${empty ? 'text-slate-500' : textColor}`}>
            {formatCurrency(displayValue, currencyMode)}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full ${barColor} rounded-full transition-all`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-slate-500 shrink-0 w-10 text-left">
            {pct.toFixed(1)}٪
          </span>
        </div>
      </div>
    </Component>
  );
}

function UncategorizedRow({
  total,
  count,
  parentTotal,
  accent,
  currencyMode,
}: {
  total: number;
  count: number;
  parentTotal: number;
  accent: 'emerald' | 'rose';
  currencyMode: CurrencyMode;
}) {
  const pct = parentTotal > 0 ? (total / parentTotal) * 100 : 0;
  const textColor = accent === 'emerald' ? 'text-emerald-400' : 'text-rose-400';
  return (
    <div className="flex items-center gap-2 bg-[#1A1B26] border border-dashed border-white/10 rounded-xl px-3 py-2.5">
      <WalletIcon size={14} className="text-slate-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-slate-300 truncate">
            بدون دسته‌بندی
            <span className="text-[10px] text-slate-500 mr-1">({count} تراکنش)</span>
          </span>
          <span className={`text-xs font-mono font-bold ${textColor}`}>
            {formatCurrency(total, currencyMode)}
          </span>
        </div>
        <div className="text-[10px] font-mono text-slate-500 mt-0.5">{pct.toFixed(1)}٪</div>
      </div>
    </div>
  );
}
