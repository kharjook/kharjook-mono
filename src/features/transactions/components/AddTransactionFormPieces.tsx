'use client';

import {
  ArrowRight,
  Calculator,
  Calendar,
  ChevronLeft,
  Coins,
  Folder,
  Trash2,
  UserRound,
  Wallet as WalletIcon,
} from 'lucide-react';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { EntityIcon } from '@/shared/components/EntityIcon';
import type { Asset, Category, Person, Wallet } from '@/shared/types/domain';
import type { EndpointKind } from '@/features/transactions/components/EndpointSheetPicker';
import { formatCurrency } from '@/shared/utils/format-currency';
import { formatCurrencyAmount } from '@/shared/utils/format-currency';
import { assetDecimals, formatAssetAmount } from '@/shared/utils/format-asset-amount';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';
import {
  TYPE_STYLES,
  type FormState,
  type TypeStyle,
} from '@/features/transactions/utils/transaction-form-types';
import {
  validateForm,
} from '@/features/transactions/utils/transaction-form-logic';

export function DirectionCard({
  label,
  kind,
  wallet,
  asset,
  person,
  balance,
  insufficient,
  optional = false,
  onTap,
}: {
  label: string;
  kind: EndpointKind | null;
  wallet?: Wallet;
  asset?: Asset;
  person?: { name: string };
  balance: number | null;
  insufficient: boolean;
  optional?: boolean;
  onTap: () => void;
}) {
  const filled = !!(wallet || asset);
  const name = wallet?.name ?? asset?.name ?? person?.name ?? 'انتخاب کنید';
  const unit = wallet ? `${CURRENCY_META[wallet.currency].symbol} ${wallet.currency}` : asset?.unit ?? '';

  const borderClass = insufficient
    ? 'border-rose-500/50'
    : filled
      ? 'border-white/10'
      : 'border-dashed border-white/15';

  return (
    <button
      type="button"
      onClick={onTap}
      className={`w-full bg-[#1A1B26] border ${borderClass} rounded-xl p-3 flex items-center gap-3 text-right hover:bg-[#222436] active:scale-[0.99] transition`}
    >
      <EntityIcon
        iconUrl={wallet?.icon_url ?? asset?.icon_url ?? null}
        fallback={
          kind === 'wallet'
            ? <WalletIcon size={18} />
            : kind === 'asset'
              ? <Coins size={18} />
              : <UserRound size={18} />
        }
        bgColor={
          kind === 'asset'
            ? 'rgba(251, 191, 36, 0.12)'
            : kind === 'person'
              ? 'rgba(56, 189, 248, 0.12)'
              : 'rgba(168, 85, 247, 0.12)'
        }
        color={kind === 'asset' ? '#fbbf24' : kind === 'person' ? '#7dd3fc' : '#c084fc'}
        className="w-10 h-10 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-slate-500 uppercase tracking-widest">
          {label}
          {optional ? ' · اختیاری' : ''}
        </p>
        <p className={`text-sm font-semibold truncate ${filled ? 'text-slate-100' : 'text-slate-500'}`}>
          {name}
        </p>
        {filled && (
          <p className={`text-[11px] mt-0.5  ${insufficient ? 'text-rose-400' : 'text-slate-500'}`} dir="ltr">
            {balance != null
              ? `${wallet ? formatCurrencyAmount(balance, wallet.currency) : asset ? formatAssetAmount(balance, assetDecimals(asset)) : balance.toLocaleString('en-US', { maximumFractionDigits: 6 })} ${unit.trim()}`
              : kind === 'person'
                ? 'حساب شخص'
                : unit}
          </p>
        )}
      </div>
      <ChevronLeft size={16} className="text-slate-500 shrink-0" />
    </button>
  );
}

export function DateChip({
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
      className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition ${
        active
          ? 'bg-white/10 text-white'
          : 'bg-white/5 text-slate-400 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The primary amount input — the single number the user types. For BUY/SELL
 * this is the asset-side qty; for INCOME/EXPENSE/TRANSFER it's the only amount.
 */
export function PrimaryAmountField({
  form,
  primarySide,
  sourceWallet,
  targetWallet,
  sourceAsset,
  targetAsset,
  isInsufficient,
  onChange,
}: {
  form: FormState;
  primarySide: 'source' | 'target';
  sourceWallet?: Wallet;
  targetWallet?: Wallet;
  sourceAsset?: Asset;
  targetAsset?: Asset;
  isInsufficient: boolean;
  onChange: (v: string) => void;
}) {
  const isSource = primarySide === 'source';
  const wallet = isSource ? sourceWallet : targetWallet;
  const asset = isSource ? sourceAsset : targetAsset;
  const unit = wallet
    ? CURRENCY_META[wallet.currency].label
    : asset?.unit ?? '';
  const value = isSource ? form.sourceAmount : form.targetAmount;

  // Only the source-primary case can flag insufficient funds directly.
  const showError = isSource && isInsufficient;

  let label: string;
  if (form.type === 'BUY') label = `مقدار خرید${unit ? ` (${unit})` : ''}`;
  else if (form.type === 'SELL') label = `مقدار فروش${unit ? ` (${unit})` : ''}`;
  else if (form.type === 'INCOME') label = `مبلغ درآمد${unit ? ` (${unit})` : ''}`;
  else if (form.type === 'EXPENSE') label = `مبلغ هزینه${unit ? ` (${unit})` : ''}`;
  else label = `مقدار${unit ? ` (${unit})` : ''}`;

  return (
    <div>
      <label className={`block text-xs mb-1 ${showError ? 'text-rose-400' : 'text-slate-400'}`}>
        {label}
      </label>
      <FormattedNumberInput
        value={value}
        onValueChange={onChange}
        className={`w-full bg-[#1A1B26] border rounded-xl p-3 text-sm  focus:outline-none text-left ${
          showError
            ? 'border-rose-500/50 text-rose-200 focus:border-rose-500'
            : 'border-white/10 text-white focus:border-purple-500'
        }`}
        dir="ltr"
        required
      />
    </div>
  );
}

/**
 * Read-only line showing the auto-computed wallet-side amount on BUY/SELL.
 * The value pulses briefly whenever it changes (via `key` remount trick).
 */
export function DerivedAmountLine({
  form,
  sourceWallet,
  targetWallet,
}: {
  form: FormState;
  sourceWallet?: Wallet;
  targetWallet?: Wallet;
}) {
  // On BUY, source (wallet) is derived. On SELL, target (wallet) is derived.
  const isBuy = form.type === 'BUY';
  const wallet = isBuy ? sourceWallet : targetWallet;
  const unit = wallet ? CURRENCY_META[wallet.currency].label : '';
  const value = isBuy ? form.sourceAmount : form.targetAmount;
  const label = isBuy
    ? `مبلغ پرداختی${unit ? ` (${unit})` : ''}`
    : `مبلغ دریافتی${unit ? ` (${unit})` : ''}`;

  const display = value
    ? wallet
      ? formatCurrencyAmount(value, wallet.currency)
      : Number(value).toLocaleString('en-US', { maximumFractionDigits: 10 })
    : '—';

  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
        <Calculator size={12} />
        {label}
        <span className="text-[10px] text-slate-600">— محاسبه‌شده</span>
      </label>
      <div
        key={value || 'empty'}
        className="w-full bg-white/2 border border-dashed border-white/10 rounded-xl p-3 text-sm  text-left text-slate-300 animate-in fade-in zoom-in-95 duration-300"
        dir="ltr"
      >
        {display}
      </div>
    </div>
  );
}

/** Editable target-amount input for cross-currency TRANSFER. */
export function CrossCurrencyTargetField({
  value,
  targetWallet,
  targetAsset,
  targetPerson,
  onChange,
}: {
  value: string;
  targetWallet?: Wallet;
  targetAsset?: Asset;
  targetPerson?: Person;
  onChange: (v: string) => void;
}) {
  const unit = targetWallet
    ? CURRENCY_META[targetWallet.currency].label
    : targetAsset?.unit ?? (targetPerson ? 'مقدار' : '');
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">
        {`مقدار دریافتی${unit ? ` (${unit})` : ''}`}
      </label>
      <FormattedNumberInput
        value={value}
        onValueChange={onChange}
        className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-white text-sm  focus:border-purple-500 outline-none text-left"
        dir="ltr"
        required
      />
    </div>
  );
}

export function PriceFields({
  priceLabel,
  priceToman,
  usdRate,
  onPriceToman,
  onUsdRate,
  showTomanPrice = true,
  showUsdRate,
}: {
  priceLabel: string;
  priceToman: string;
  usdRate: string;
  onPriceToman: (v: string) => void;
  onUsdRate: (v: string) => void;
  showTomanPrice?: boolean;
  showUsdRate: boolean;
}) {
  return (
    <div className="space-y-3">
      {showTomanPrice && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">{priceLabel || 'قیمت واحد (تومان)'}</label>
          <FormattedNumberInput
            value={priceToman}
            onValueChange={onPriceToman}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-white text-sm  focus:border-purple-500 outline-none text-left"
            dir="ltr"
            required
          />
        </div>
      )}
      {showUsdRate && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">نرخ دلار در لحظه (تومان)</label>
          <FormattedNumberInput
            value={usdRate}
            onValueChange={onUsdRate}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-white text-sm  focus:border-purple-500 outline-none text-left"
            dir="ltr"
            required
          />
        </div>
      )}
    </div>
  );
}

export function CategoryField({
  kind,
  categories,
  value,
  onOpen,
}: {
  kind: 'income' | 'expense';
  categories: Category[];
  value: string | null;
  onOpen: () => void;
}) {
  const selected = value ? categories.find((c) => c.id === value) ?? null : null;

  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">
        {kind === 'income' ? 'دسته درآمد' : 'دسته هزینه'}
      </label>
      <button
        type="button"
        onClick={onOpen}
        className={`w-full flex items-center gap-3 bg-[#1A1B26] border rounded-xl p-3 text-right transition hover:bg-[#222436] ${
          selected ? 'border-white/10' : 'border-white/10'
        }`}
      >
        {selected ? (
          <>
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: selected.color }}
            />
            <span className="flex-1 min-w-0 text-sm text-white truncate">
              {selected.name}
            </span>
          </>
        ) : (
          <>
            <Folder size={14} className="text-slate-500" />
            <span className="flex-1 min-w-0 text-sm text-slate-500">— انتخاب کنید —</span>
          </>
        )}
        <ChevronLeft size={16} className="text-slate-500 shrink-0" />
      </button>
    </div>
  );
}

// ─── Collapsed row summary ───────────────────────────────────────────────────

export function CollapsedRow({
  form,
  rowIndex,
  style,
  canRemove,
  onToggle,
  onRemove,
  wallets,
  assets,
  persons,
  categories,
}: {
  form: FormState;
  rowIndex: number;
  style: TypeStyle;
  canRemove: boolean;
  onToggle: () => void;
  onRemove: () => void;
  wallets: Wallet[];
  assets: Asset[];
  persons: Person[];
  categories: Category[];
}) {
  const summary = summarizeForm(form, wallets, assets, categories, persons);
  return (
    <div
      className={`rounded-2xl border ${style.accentBorder} bg-linear-to-b ${style.accentGradient} p-3 flex items-center gap-3`}
    >
      <span className={`text-[11px] font-bold shrink-0 ${style.accentText}`}>#{rowIndex + 1}</span>
      <button
        type="button"
        onClick={onToggle}
        className="flex-1 min-w-0 text-right text-sm text-slate-200 truncate"
      >
        {summary}
      </button>
      {canRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 p-1.5 bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 rounded-lg text-slate-400 transition-colors"
          aria-label="حذف"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

export function summarizeForm(
  form: FormState,
  wallets: Wallet[],
  assets: Asset[],
  categories: Category[],
  persons: { id: string; name: string }[]
): string {
  const sourceName =
    form.sourceKind === 'wallet'
      ? wallets.find((w) => w.id === form.sourceId)?.name
      : form.sourceKind === 'asset'
        ? assets.find((a) => a.id === form.sourceId)?.name
        : form.sourceKind === 'person'
          ? persons.find((p) => p.id === form.sourceId)?.name
        : null;
  const targetName =
    form.targetKind === 'wallet'
      ? wallets.find((w) => w.id === form.targetId)?.name
      : form.targetKind === 'asset'
        ? assets.find((a) => a.id === form.targetId)?.name
        : form.targetKind === 'person'
          ? persons.find((p) => p.id === form.targetId)?.name
        : null;

  const srcAmt = Number(form.sourceAmount);
  const tgtAmt = Number(form.targetAmount);
  const category = categories.find((c) => c.id === form.categoryId);
  const sourceAsset = form.sourceKind === 'asset'
    ? assets.find((a) => a.id === form.sourceId)
    : null;
  const targetAsset = form.targetKind === 'asset'
    ? assets.find((a) => a.id === form.targetId)
    : null;

  const fmt = (n: number, side: 'source' | 'target') => {
    if (!Number.isFinite(n) || n <= 0) return '—';
    if (side === 'source' && sourceAsset) return formatAssetAmount(n, assetDecimals(sourceAsset));
    if (side === 'target' && targetAsset) return formatAssetAmount(n, assetDecimals(targetAsset));
    return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
  };

  const label = TYPE_STYLES[form.type].label;

  switch (form.type) {
    case 'BUY':
      return `${label} · ${fmt(tgtAmt, 'target')} ${targetName ?? '...'} از ${sourceName ?? '...'}`;
    case 'SELL':
      return `${label} · ${fmt(srcAmt, 'source')} ${sourceName ?? '...'} → ${targetName ?? '...'}`;
    case 'TRANSFER':
      return `${label} · ${fmt(srcAmt, 'source')} از ${sourceName ?? '...'} به ${targetName ?? '...'}`;
    case 'INCOME':
      return `${label} · ${fmt(tgtAmt, 'target')} → ${targetName ?? '...'}${category ? ` · ${category.name}` : ''}`;
    case 'EXPENSE':
      return `${label} · ${fmt(srcAmt, 'source')} از ${sourceName ?? '...'}${category ? ` · ${category.name}` : ''}`;
  }
}

// ─── Preview ─────────────────────────────────────────────────────────────────

export function PreviewPanel({
  rows,
  wallets,
  assets,
  persons,
  categories,
  style,
}: {
  rows: FormState[];
  wallets: Wallet[];
  assets: Asset[];
  persons: Person[];
  categories: Category[];
  style: TypeStyle;
}) {
  const valid = rows.map((r) => validateForm(r, wallets) === null);
  const validCount = valid.filter(Boolean).length;

  if (validCount === 0) {
    return (
      <div className="rounded-2xl border border-white/5 bg-white/2 p-4 text-center">
        <p className="text-xs text-slate-500">
          پیش‌نمایش پس از تکمیل فرم در اینجا ظاهر می‌شود.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border ${style.accentBorder} bg-linear-to-b ${style.accentGradient} p-4 space-y-2`}>
      <div className="flex items-center justify-between">
        <p className={`text-[11px] font-bold uppercase tracking-widest ${style.accentText}`}>
          پیش‌نمایش
        </p>
        {rows.length > 1 && (
          <p className="text-[11px] text-slate-500">
            {validCount} از {rows.length} آماده
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        {rows.map((r, i) =>
          valid[i] ? (
            <p key={i} className="text-sm text-slate-100 leading-relaxed">
              {rows.length > 1 && <span className="text-slate-500">#{i + 1} · </span>}
              {summarizeForm(r, wallets, assets, categories, persons)}
            </p>
          ) : null
        )}
      </div>
      {rows.length > 1 && (
        <BulkTotalsStrip rows={rows} valid={valid} wallets={wallets} />
      )}
    </div>
  );
}

function BulkTotalsStrip({
  rows,
  valid,
  wallets,
}: {
  rows: FormState[];
  valid: boolean[];
  wallets: Wallet[];
}) {
  // Group inflow/outflow amounts by currency so the user sees a net impact
  // per wallet currency. Only tallies rows touching wallets (asset units
  // aren't comparable across assets).
  const byCur = new Map<string, { inflow: number; outflow: number }>();

  rows.forEach((r, i) => {
    if (!valid[i]) return;
    if (r.sourceKind === 'wallet' && r.sourceId) {
      const w = wallets.find((x) => x.id === r.sourceId);
      if (w) {
        const bucket = byCur.get(w.currency) ?? { inflow: 0, outflow: 0 };
        bucket.outflow += Number(r.sourceAmount) || 0;
        byCur.set(w.currency, bucket);
      }
    }
    if (r.targetKind === 'wallet' && r.targetId) {
      const w = wallets.find((x) => x.id === r.targetId);
      if (w) {
        const bucket = byCur.get(w.currency) ?? { inflow: 0, outflow: 0 };
        bucket.inflow += Number(r.targetAmount) || 0;
        byCur.set(w.currency, bucket);
      }
    }
  });

  if (byCur.size === 0) return null;

  return (
    <div className="mt-2 pt-2 border-t border-white/5 space-y-1">
      {Array.from(byCur.entries()).map(([cur, { inflow, outflow }]) => {
        const net = inflow - outflow;
        const sym = CURRENCY_META[cur as keyof typeof CURRENCY_META]?.symbol ?? '';
        return (
          <div key={cur} className="flex justify-between text-[11px] text-slate-400 " dir="ltr">
            <span>{cur}</span>
            <span>
              {inflow > 0 && <span className="text-emerald-400">+{formatCurrencyAmount(inflow, cur)} </span>}
              {outflow > 0 && <span className="text-rose-400">-{formatCurrencyAmount(outflow, cur)} </span>}
              <span className={net >= 0 ? 'text-slate-300' : 'text-slate-300'}>
                = {net >= 0 ? '+' : ''}{formatCurrencyAmount(net, cur)} {sym}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Keep `formatCurrency` import "used" for possible future formatting of
// preview IRT totals — it's re-exported implicitly via the file and I'd
// rather not re-import it later.
void formatCurrency;

// ─── Other ───────────────────────────────────────────────────────────────────

export function NotFound({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="bg-[#0F1015] min-h-full">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5">
        <button
          type="button"
          onClick={onBack}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">تراکنش</h2>
      </div>
      <div className="p-6 text-center text-slate-500 text-sm">{message}</div>
    </div>
  );
}
