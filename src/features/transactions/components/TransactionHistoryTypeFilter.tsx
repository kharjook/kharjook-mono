'use client';

import type { TransactionType } from '@/shared/types/domain';

export type TxHistoryTypeFilter = TransactionType | 'ALL';

const ORDER: TransactionType[] = [
  'BUY',
  'SELL',
  'TRANSFER',
  'INCOME',
  'EXPENSE',
];

const LABELS: Record<TransactionType, string> = {
  BUY: 'خرید',
  SELL: 'فروش',
  TRANSFER: 'انتقال',
  INCOME: 'درآمد',
  EXPENSE: 'هزینه',
};

export function TransactionHistoryTypeFilter({
  value,
  onChange,
}: {
  value: TxHistoryTypeFilter;
  onChange: (next: TxHistoryTypeFilter) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="نوع تراکنش">
      <FilterChip
        label="همه"
        active={value === 'ALL'}
        onClick={() => onChange('ALL')}
      />
      {ORDER.map((t) => (
        <FilterChip
          key={t}
          label={LABELS[t]}
          active={value === t}
          onClick={() => onChange(t)}
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
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
        active
          ? 'bg-purple-600/25 border-purple-500/50 text-purple-200'
          : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  );
}
