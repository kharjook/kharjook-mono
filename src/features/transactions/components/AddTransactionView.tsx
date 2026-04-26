'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  Calculator,
  Calendar,
  ChevronLeft,
  Coins,
  Folder,
  Plus,
  Trash2,
  UserRound,
  Wallet as WalletIcon,
} from 'lucide-react';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { EntityIcon } from '@/shared/components/EntityIcon';
import { IOSDatePicker } from '@/shared/components/IOSDatePicker';
import { useToast } from '@/shared/components/Toast';
import { supabase } from '@/shared/lib/supabase/client';
import { formatCurrency } from '@/shared/utils/format-currency';
import {
  formatJalaaliHuman,
  parseJalaali,
  todayJalaali,
  formatJalaali,
  addDays,
} from '@/shared/utils/jalali';
import { latinizeDigits } from '@/shared/utils/latinize-digits';
import type {
  Asset,
  Category,
  Currency,
  CurrencyRate,
  DailyPrice,
  Person,
  Transaction,
  TransactionType,
  Wallet,
} from '@/shared/types/domain';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import {
  EndpointSheetPicker,
  type EndpointKind,
} from '@/features/transactions/components/EndpointSheetPicker';
import { CategorySheetPicker } from '@/shared/components/CategorySheetPicker';

// ─── Types ───────────────────────────────────────────────────────────────────

type FormState = {
  type: TransactionType;
  date: string; // canonical Jalali YYYY/MM/DD
  sourceKind: EndpointKind | null;
  sourceId: string | null;
  targetKind: EndpointKind | null;
  targetId: string | null;
  sourceAmount: string;
  targetAmount: string;
  priceToman: string;
  usdRate: string;
  categoryId: string | null;
  note: string;
};

/**
 * Which side the user inputs directly. For BUY/SELL, the asset side is the
 * primary (user enters quantity + price; wallet-side amount is auto-computed).
 * For INCOME/EXPENSE/TRANSFER there is only one amount in the common case.
 */
const PRIMARY_SIDE: Record<TransactionType, 'source' | 'target'> = {
  BUY: 'target',    // target = asset bought
  SELL: 'source',   // source = asset sold
  TRANSFER: 'source',
  INCOME: 'target',
  EXPENSE: 'source',
};

type TypeShape = {
  source: EndpointKind[] | null;
  target: EndpointKind[] | null;
  needsCategory: 'income' | 'expense' | null;
};

const TYPE_SHAPES: Record<TransactionType, TypeShape> = {
  BUY:      { source: ['wallet'],          target: ['asset'],           needsCategory: null },
  SELL:     { source: ['asset'],           target: ['wallet'],          needsCategory: null },
  TRANSFER: { source: ['wallet', 'asset', 'person'], target: ['wallet', 'asset', 'person'], needsCategory: null },
  INCOME:   { source: null,                target: ['wallet', 'asset', 'person'], needsCategory: 'income' },
  EXPENSE:  { source: ['wallet', 'asset', 'person'], target: null,                needsCategory: 'expense' },
};

/**
 * Pricing context per form state — decides whether we prompt for
 * `priceToman` / `usdRate` and what label to show.
 *
 * Rule:
 *  - BUY/SELL always need both `priceToman` and editable `usdRate`.
 *  - TRANSFER wallet↔asset: editable `usdRate` only (`showTomanPrice: false`);
 *    implied `price_toman` is derived at save from amounts + FX.
 *  - INCOME/EXPENSE need pricing WHENEVER the endpoint is not an IRT
 *    wallet. For IRT wallets, the amount is already in Toman and we
 *    use the current app USD rate as the default, but the user can edit it.
 *  - For asset endpoints, `priceToman` is "Toman per unit of asset".
 *  - For non-IRT wallet endpoints, `priceToman` is "Toman per unit of
 *    that wallet's currency" (e.g. Toman per USD). Equivalent to the
 *    current-rate entry but captured at the tx date.
 *
 * `autoCaptureUsdRate` is true for IRT wallets: we DO store
 * `amount_usd_at_time` but do not prompt the user; today's usd rate
 * is used at insert time. Auditable via daily price snapshots if
 * needed; for finance accuracy, non-IRT INCOME/EXPENSE MUST prompt.
 */
type PricingContext = {
  needsPrice: boolean;
  /** When false, only the USD rate row is shown (wallet↔asset transfer). */
  showTomanPrice?: boolean;
  needsUsdRate: boolean;
  priceLabel: string;
  endpointKind: EndpointKind | null;
  /** Sole wallet currency when the priced endpoint is a wallet. */
  walletCurrency: Currency | null;
};

function pricingContextOf(form: FormState, wallets: Wallet[]): PricingContext {
  if (form.type === 'TRANSFER') {
    const walletAssetTransfer =
      ((form.sourceKind === 'wallet' &&
        form.targetKind === 'asset' &&
        form.sourceId &&
        form.targetId) ||
        (form.sourceKind === 'asset' &&
          form.targetKind === 'wallet' &&
          form.sourceId &&
          form.targetId));
    if (walletAssetTransfer) {
      return {
        needsPrice: true,
        showTomanPrice: false,
        needsUsdRate: true,
        priceLabel: '',
        endpointKind: 'asset',
        walletCurrency: null,
      };
    }
    return {
      needsPrice: false,
      needsUsdRate: false,
      priceLabel: '',
      endpointKind: null,
      walletCurrency: null,
    };
  }
  if (form.type === 'BUY' || form.type === 'SELL') {
    // BUY/SELL always expose both asset price and USD rate. The wallet side
    // is optional, but the per-tx USD rate is still captured for auditability.
    const wallet = form.type === 'BUY'
      ? walletFromForm(form, 'source', wallets)
      : walletFromForm(form, 'target', wallets);
    return {
      needsPrice: true,
      needsUsdRate: true, // always stored; UI shows it only for USD wallets
      priceLabel: 'قیمت واحد (تومان)',
      endpointKind: 'asset',
      walletCurrency: wallet?.currency ?? null,
    };
  }

  // INCOME / EXPENSE
  const kind = form.type === 'INCOME' ? form.targetKind : form.sourceKind;
  const id   = form.type === 'INCOME' ? form.targetId   : form.sourceId;

  if (kind === 'asset') {
    return {
      needsPrice: true,
      needsUsdRate: true,
      priceLabel: 'قیمت هر واحد دارایی (تومان)',
      endpointKind: 'asset',
      walletCurrency: null,
    };
  }
  if (kind === 'person') {
    return {
      needsPrice: false,
      needsUsdRate: false,
      priceLabel: '',
      endpointKind: 'person',
      walletCurrency: null,
    };
  }
  if (kind === 'wallet' && id) {
    const w = wallets.find((x) => x.id === id);
    if (!w) return { needsPrice: false, needsUsdRate: false, priceLabel: '', endpointKind: 'wallet', walletCurrency: null };
    if (w.currency === 'IRT') {
      return {
        needsPrice: false,
        needsUsdRate: false,
        priceLabel: '',
        endpointKind: 'wallet',
        walletCurrency: 'IRT',
      };
    }
    return {
      needsPrice: true,
      needsUsdRate: true,
      priceLabel: `قیمت هر ${CURRENCY_META[w.currency].label} (تومان)`,
      endpointKind: 'wallet',
      walletCurrency: w.currency,
    };
  }
  // Endpoint not chosen yet → suppress the price fields until it is.
  return { needsPrice: false, needsUsdRate: false, priceLabel: '', endpointKind: null, walletCurrency: null };
}

interface TypeStyle {
  label: string;
  icon: string; // plain text for tab, no emoji policy enforced
  accentBg: string;      // active tab background
  accentBorder: string;  // card border
  accentText: string;    // text accent
  accentBtnBg: string;   // submit button background
  accentBtnShadow: string;
  accentGradient: string;// preview card background gradient
}

const TYPE_STYLES: Record<TransactionType, TypeStyle> = {
  BUY: {
    label: 'خرید',
    icon: 'B',
    accentBg: 'bg-purple-600',
    accentBorder: 'border-purple-500/30',
    accentText: 'text-purple-400',
    accentBtnBg: 'bg-purple-600 hover:bg-purple-500',
    accentBtnShadow: 'shadow-[0_4px_20px_rgba(147,51,234,0.3)]',
    accentGradient: 'from-purple-500/15 to-transparent',
  },
  SELL: {
    label: 'فروش',
    icon: 'S',
    accentBg: 'bg-amber-600',
    accentBorder: 'border-amber-500/30',
    accentText: 'text-amber-400',
    accentBtnBg: 'bg-amber-600 hover:bg-amber-500',
    accentBtnShadow: 'shadow-[0_4px_20px_rgba(217,119,6,0.3)]',
    accentGradient: 'from-amber-500/15 to-transparent',
  },
  TRANSFER: {
    label: 'انتقال',
    icon: 'T',
    accentBg: 'bg-sky-600',
    accentBorder: 'border-sky-500/30',
    accentText: 'text-sky-400',
    accentBtnBg: 'bg-sky-600 hover:bg-sky-500',
    accentBtnShadow: 'shadow-[0_4px_20px_rgba(2,132,199,0.3)]',
    accentGradient: 'from-sky-500/15 to-transparent',
  },
  INCOME: {
    label: 'درآمد',
    icon: 'I',
    accentBg: 'bg-emerald-600',
    accentBorder: 'border-emerald-500/30',
    accentText: 'text-emerald-400',
    accentBtnBg: 'bg-emerald-600 hover:bg-emerald-500',
    accentBtnShadow: 'shadow-[0_4px_20px_rgba(5,150,105,0.3)]',
    accentGradient: 'from-emerald-500/15 to-transparent',
  },
  EXPENSE: {
    label: 'هزینه',
    icon: 'E',
    accentBg: 'bg-rose-600',
    accentBorder: 'border-rose-500/30',
    accentText: 'text-rose-400',
    accentBtnBg: 'bg-rose-600 hover:bg-rose-500',
    accentBtnShadow: 'shadow-[0_4px_20px_rgba(225,29,72,0.3)]',
    accentGradient: 'from-rose-500/15 to-transparent',
  },
};

const TYPE_TABS: TransactionType[] = ['BUY', 'SELL', 'TRANSFER', 'INCOME', 'EXPENSE'];

export interface AddTransactionViewProps {
  assetId?: string;
  walletId?: string;
  defaultType?: TransactionType;
  transactionId?: string;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

function endpointKindOfTx(tx: Transaction, side: 'source' | 'target'): EndpointKind | null {
  if (side === 'source') {
    if (tx.source_wallet_id) return 'wallet';
    if (tx.source_asset_id) return 'asset';
    if (tx.source_person_id) return 'person';
    return null;
  }
  if (tx.target_wallet_id) return 'wallet';
  if (tx.target_asset_id) return 'asset';
  if (tx.target_person_id) return 'person';
  return null;
}

function endpointIdOfTx(tx: Transaction, side: 'source' | 'target'): string | null {
  if (side === 'source') {
    return tx.source_wallet_id ?? tx.source_asset_id ?? tx.source_person_id ?? null;
  }
  return tx.target_wallet_id ?? tx.target_asset_id ?? tx.target_person_id ?? null;
}

function todayCanonicalJalali(): string {
  return formatJalaali(todayJalaali());
}

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  // Strip float noise and trailing zeros; keep up to 10 significant decimals.
  const rounded = n.toFixed(10);
  const trimmed = rounded.replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
}

function walletFromForm(
  form: FormState,
  side: 'source' | 'target',
  wallets: Wallet[]
): Wallet | null {
  const kind = side === 'source' ? form.sourceKind : form.targetKind;
  const id = side === 'source' ? form.sourceId : form.targetId;
  if (kind !== 'wallet' || !id) return null;
  return wallets.find((w) => w.id === id) ?? null;
}

function buildInitialForm(
  tx: Transaction | undefined,
  defaults: { assetId?: string; walletId?: string; defaultType?: TransactionType },
  usdRate: number
): FormState {
  if (tx) {
    return {
      type: tx.type,
      date: latinizeDigits(tx.date_string),
      sourceKind: endpointKindOfTx(tx, 'source'),
      sourceId: endpointIdOfTx(tx, 'source'),
      targetKind: endpointKindOfTx(tx, 'target'),
      targetId: endpointIdOfTx(tx, 'target'),
      sourceAmount: tx.source_amount != null ? String(tx.source_amount) : '',
      targetAmount: tx.target_amount != null ? String(tx.target_amount) : '',
      priceToman: tx.price_toman != null ? String(tx.price_toman) : '',
      usdRate: tx.usd_rate != null ? String(tx.usd_rate) : String(usdRate),
      categoryId: tx.category_id,
      note: tx.note ?? '',
    };
  }

  const type: TransactionType = defaults.defaultType ?? 'BUY';
  const f: FormState = {
    type,
    date: todayCanonicalJalali(),
    sourceKind: null,
    sourceId: null,
    targetKind: null,
    targetId: null,
    sourceAmount: '',
    targetAmount: '',
    priceToman: '',
    usdRate: String(usdRate),
    categoryId: null,
    note: '',
  };

  if (defaults.assetId) {
    if (type === 'BUY') {
      f.targetKind = 'asset';
      f.targetId = defaults.assetId;
    } else if (type === 'SELL' || type === 'EXPENSE' || type === 'TRANSFER') {
      f.sourceKind = 'asset';
      f.sourceId = defaults.assetId;
    } else if (type === 'INCOME') {
      f.targetKind = 'asset';
      f.targetId = defaults.assetId;
    }
  }
  if (defaults.walletId) {
    if (type === 'SELL' || type === 'INCOME') {
      f.targetKind = 'wallet';
      f.targetId = defaults.walletId;
    } else {
      f.sourceKind = 'wallet';
      f.sourceId = defaults.walletId;
    }
  }
  return f;
}

function applyTypeSwitch(prev: FormState, type: TransactionType): FormState {
  if (type === prev.type) return prev;
  const next = TYPE_SHAPES[type];
  return {
    ...prev,
    type,
    sourceKind: prev.sourceKind && next.source?.includes(prev.sourceKind) ? prev.sourceKind : null,
    sourceId:   prev.sourceKind && next.source?.includes(prev.sourceKind) ? prev.sourceId   : null,
    targetKind: prev.targetKind && next.target?.includes(prev.targetKind) ? prev.targetKind : null,
    targetId:   prev.targetKind && next.target?.includes(prev.targetKind) ? prev.targetId   : null,
    categoryId: null,
  };
}

/**
 * Derive the wallet-side amount on BUY/SELL from (asset-amount × price),
 * converted through the wallet currency rate. The asset side is always the
 * primary input the user edits; the wallet side is always computed.
 *
 * Returns `next` unchanged if required inputs are missing — never blows up.
 */
function recomputeMoneySide(
  next: FormState,
  wallets: Wallet[],
  currencyRates: CurrencyRate[],
  usdRate: number
): FormState {
  if (next.type !== 'BUY' && next.type !== 'SELL') return next;

  const wallet = next.type === 'BUY'
    ? walletFromForm(next, 'source', wallets)
    : walletFromForm(next, 'target', wallets);
  if (!wallet) {
    return next.type === 'BUY'
      ? { ...next, sourceAmount: '' }
      : { ...next, targetAmount: '' };
  }

  const price = Number(next.priceToman);
  if (!Number.isFinite(price) || price <= 0) return next;

  // USD wallets: per-tx `usdRate` overrides the table rate so a trade's
  // exact conversion is captured. Other currencies always read from rates.
  let rate: number;
  if (wallet.currency === 'USD') {
    const override = Number(next.usdRate);
    rate = Number.isFinite(override) && override > 0 ? override : usdRate;
  } else if (wallet.currency === 'IRT') {
    rate = 1;
  } else {
    rate = tomanPerUnit(wallet.currency, currencyRates);
  }
  if (!rate) return next;

  if (next.type === 'BUY') {
    // User enters `target` (asset qty). Derive `source` (wallet spend).
    const tgt = Number(next.targetAmount);
    if (!Number.isFinite(tgt) || tgt <= 0) return next;
    return { ...next, sourceAmount: canonicalNumber((tgt * price) / rate) };
  }

  // SELL: user enters `source` (asset qty). Derive `target` (wallet proceeds).
  const src = Number(next.sourceAmount);
  if (!Number.isFinite(src) || src <= 0) return next;
  return { ...next, targetAmount: canonicalNumber((src * price) / rate) };
}

function walletRateForTransfer(
  wallet: Wallet,
  currencyRates: CurrencyRate[],
  globalUsdRate: number,
  formUsdRate?: string
): number {
  if (wallet.currency === 'IRT') return 1;
  if (wallet.currency === 'USD') {
    const o = formUsdRate != null ? Number(formUsdRate) : NaN;
    const u = Number.isFinite(o) && o > 0 ? o : globalUsdRate;
    return u > 0 ? u : tomanPerUnit('USD', currencyRates);
  }
  return tomanPerUnit(wallet.currency, currencyRates);
}

function recomputeTransferTarget(
  next: FormState,
  wallets: Wallet[],
  assets: Asset[],
  currencyRates: CurrencyRate[],
  usdRate: number
): FormState {
  if (next.type !== 'TRANSFER') return next;
  const srcAmount = Number(next.sourceAmount);
  if (!Number.isFinite(srcAmount) || srcAmount <= 0) return next;
  if (!next.sourceKind || !next.sourceId || !next.targetKind || !next.targetId) return next;

  const sourceWallet = next.sourceKind === 'wallet'
    ? wallets.find((w) => w.id === next.sourceId)
    : null;
  const targetWallet = next.targetKind === 'wallet'
    ? wallets.find((w) => w.id === next.targetId)
    : null;
  const sourceAsset = next.sourceKind === 'asset'
    ? assets.find((a) => a.id === next.sourceId)
    : null;
  const targetAsset = next.targetKind === 'asset'
    ? assets.find((a) => a.id === next.targetId)
    : null;

  if (sourceWallet && targetWallet) {
    if (sourceWallet.currency === targetWallet.currency) {
      return { ...next, targetAmount: next.sourceAmount };
    }
    return next; // cross-currency wallet transfer stays user-editable
  }

  if (sourceAsset && targetWallet) {
    const walletRate = walletRateForTransfer(
      targetWallet,
      currencyRates,
      usdRate,
      next.usdRate
    );
    const assetPrice = Number(sourceAsset.price_toman);
    if (!(walletRate > 0) || !(assetPrice > 0)) return next;
    return { ...next, targetAmount: canonicalNumber((srcAmount * assetPrice) / walletRate) };
  }

  if (sourceWallet && targetAsset) {
    const walletRate = walletRateForTransfer(
      sourceWallet,
      currencyRates,
      usdRate,
      next.usdRate
    );
    const assetPrice = Number(targetAsset.price_toman);
    if (!(walletRate > 0) || !(assetPrice > 0)) return next;
    return { ...next, targetAmount: canonicalNumber((srcAmount * walletRate) / assetPrice) };
  }

  return next;
}

/** Holdings of an asset across existing transactions. */
function assetHolding(assetId: string, transactions: Transaction[]): number {
  let total = 0;
  for (const tx of transactions) {
    const isAcquire = tx.type === 'BUY' || tx.type === 'INCOME';
    const isDispose = tx.type === 'SELL' || tx.type === 'EXPENSE';
    if (!isAcquire && !isDispose) continue;

    const txAssetId = isAcquire
      ? tx.target_asset_id ?? tx.asset_id
      : tx.source_asset_id ?? tx.asset_id;
    if (txAssetId !== assetId) continue;

    const rawAmount = tx.amount ?? (isAcquire ? tx.target_amount : tx.source_amount);
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += isAcquire ? amount : -amount;
  }
  return total;
}

function sourceBalance(
  form: FormState,
  wallets: Wallet[],
  transactions: Transaction[],
  persons: { id: string }[]
): number | null {
  if (form.sourceKind === 'wallet' && form.sourceId) {
    const w = wallets.find((x) => x.id === form.sourceId);
    if (!w) return null;
    return calculateWalletStats(w, transactions).balance;
  }
  if (form.sourceKind === 'asset' && form.sourceId) {
    return assetHolding(form.sourceId, transactions);
  }
  if (form.sourceKind === 'person' && form.sourceId) {
    const personExists = persons.some((p) => p.id === form.sourceId);
    if (!personExists) return null;
    let balance = 0;
    for (const tx of transactions) {
      if (tx.target_person_id === form.sourceId) {
        balance += Number(tx.target_amount) || 0;
      }
      if (tx.source_person_id === form.sourceId) {
        balance -= Number(tx.source_amount) || 0;
      }
    }
    return balance;
  }
  return null;
}

function validateForm(form: FormState, wallets: Wallet[]): string | null {
  if (!form.date) return 'تاریخ الزامی است.';
  if (!parseJalaali(form.date)) return 'تاریخ نامعتبر است.';

  switch (form.type) {
    case 'BUY':
      if (form.targetKind !== 'asset'  || !form.targetId) return 'دارایی مقصد را انتخاب کن.';
      if (form.sourceKind && form.sourceKind !== 'wallet') return 'مبدأ خرید فقط می‌تواند کیف پول باشد.';
      break;
    case 'SELL':
      if (form.sourceKind !== 'asset'  || !form.sourceId) return 'دارایی مبدأ را انتخاب کن.';
      if (form.targetKind && form.targetKind !== 'wallet') return 'مقصد فروش فقط می‌تواند کیف پول باشد.';
      break;
    case 'TRANSFER':
      if (!form.sourceKind || !form.sourceId) return 'مبدأ را انتخاب کن.';
      if (!form.targetKind || !form.targetId) return 'مقصد را انتخاب کن.';
      if (form.sourceKind === 'asset' && form.targetKind === 'person') {
        return 'انتقال دارایی به شخص مجاز نیست.';
      }
      if (form.sourceKind === 'person' && form.targetKind === 'asset') {
        return 'انتقال از شخص به دارایی مجاز نیست.';
      }
      if (form.sourceId === form.targetId) return 'مبدأ و مقصد نباید یکی باشند.';
      break;
    case 'INCOME':
      if (!form.targetKind || !form.targetId) return 'مقصد را انتخاب کن.';
      if (!form.categoryId) return 'دسته درآمد الزامی است.';
      break;
    case 'EXPENSE':
      if (!form.sourceKind || !form.sourceId) return 'مبدأ را انتخاب کن.';
      if (!form.categoryId) return 'دسته هزینه الزامی است.';
      break;
  }

  const needsSrc =
    form.type === 'SELL' ||
    form.type === 'EXPENSE' ||
    form.type === 'TRANSFER' ||
    (form.type === 'BUY' && form.sourceKind === 'wallet' && !!form.sourceId);
  const needsTgt =
    form.type === 'BUY' ||
    form.type === 'INCOME' ||
    form.type === 'TRANSFER' ||
    (form.type === 'SELL' && form.targetKind === 'wallet' && !!form.targetId);
  if (needsSrc) {
    const v = Number(form.sourceAmount);
    if (!Number.isFinite(v) || v <= 0) return 'مقدار مبدأ نامعتبر است.';
  }
  if (needsTgt) {
    const v = Number(form.targetAmount);
    if (!Number.isFinite(v) || v <= 0) return 'مقدار مقصد نامعتبر است.';
  }

  const ctx = pricingContextOf(form, wallets);
  if (ctx.needsPrice && ctx.showTomanPrice !== false) {
    const p = Number(form.priceToman);
    if (!Number.isFinite(p) || p <= 0) return 'قیمت واحد (تومان) نامعتبر است.';
  }
  if (ctx.needsUsdRate) {
    const u = Number(form.usdRate);
    if (!Number.isFinite(u) || u <= 0) return 'نرخ دلار نامعتبر است.';
  }

  return null;
}

// ─── Amount-at-time snapshots ───────────────────────────────────────────────
//
// Computes cashflow snapshots in BOTH Toman and USD for every transaction
// type that contributes to cashflow / P&L. TRANSFER returns nulls.
//
// For IRT-wallet INCOME/EXPENSE: amount already IS Toman; USD derived
// from `form.usdRate` (which is pre-filled with today's rate on new
// forms). For non-IRT wallet / asset INCOME/EXPENSE: both `priceToman`
// and `usdRate` are user-provided, captured at transaction date.

function computeAmountSnapshots(
  form: FormState,
  wallets: Wallet[]
): { toman: number | null; usd: number | null } {
  const usdRate = Number(form.usdRate);
  const validUsdRate = Number.isFinite(usdRate) && usdRate > 0 ? usdRate : null;

  const computeFromAmountPrice = (amount: number, priceToman: number) => {
    const toman = amount * priceToman;
    const usd = validUsdRate ? toman / validUsdRate : null;
    return { toman, usd };
  };

  switch (form.type) {
    case 'BUY':
    case 'SELL': {
      const amount = form.type === 'BUY'
        ? Number(form.targetAmount)
        : Number(form.sourceAmount);
      const price = Number(form.priceToman);
      if (!Number.isFinite(amount) || amount <= 0) return { toman: null, usd: null };
      if (!Number.isFinite(price) || price <= 0) return { toman: null, usd: null };
      return computeFromAmountPrice(amount, price);
    }

    case 'INCOME': {
      const amount = Number(form.targetAmount);
      if (!Number.isFinite(amount) || amount <= 0) return { toman: null, usd: null };

      if (form.targetKind === 'asset') {
        const price = Number(form.priceToman);
        if (!Number.isFinite(price) || price <= 0) return { toman: null, usd: null };
        return computeFromAmountPrice(amount, price);
      }
      if (form.targetKind === 'wallet' && form.targetId) {
        const w = wallets.find((x) => x.id === form.targetId);
        if (!w) return { toman: null, usd: null };
        if (w.currency === 'IRT') {
          return computeFromAmountPrice(amount, 1);
        }
        const price = Number(form.priceToman);
        if (!Number.isFinite(price) || price <= 0) return { toman: null, usd: null };
        return computeFromAmountPrice(amount, price);
      }
      if (form.targetKind === 'person') {
        return computeFromAmountPrice(amount, 1);
      }
      return { toman: null, usd: null };
    }

    case 'EXPENSE': {
      const amount = Number(form.sourceAmount);
      if (!Number.isFinite(amount) || amount <= 0) return { toman: null, usd: null };

      if (form.sourceKind === 'asset') {
        const price = Number(form.priceToman);
        if (!Number.isFinite(price) || price <= 0) return { toman: null, usd: null };
        return computeFromAmountPrice(amount, price);
      }
      if (form.sourceKind === 'wallet' && form.sourceId) {
        const w = wallets.find((x) => x.id === form.sourceId);
        if (!w) return { toman: null, usd: null };
        if (w.currency === 'IRT') {
          return computeFromAmountPrice(amount, 1);
        }
        const price = Number(form.priceToman);
        if (!Number.isFinite(price) || price <= 0) return { toman: null, usd: null };
        return computeFromAmountPrice(amount, price);
      }
      if (form.sourceKind === 'person') {
        return computeFromAmountPrice(amount, 1);
      }
      return { toman: null, usd: null };
    }

    case 'TRANSFER':
      return { toman: null, usd: null };
  }
}

function buildPayload(
  form: FormState,
  userId: string,
  wallets: Wallet[],
  currencyRates: CurrencyRate[],
  fallbackUsdRate: number
): Record<string, unknown> {
  // Polymorphic columns default to NULL — the per-type switch below fills
  // only the fields that apply. Legacy `asset_id` / `amount` / `price_toman`
  // / `usd_rate` are populated on every row that references an asset so
  // the period-stats replay stays oblivious to INCOME/EXPENSE vs BUY/SELL
  // semantics.
  const base: Record<string, unknown> = {
    user_id: userId,
    type: form.type,
    date_string: form.date,
    note: form.note || null,
    source_wallet_id: null,
    source_asset_id: null,
    source_person_id: null,
    target_wallet_id: null,
    target_asset_id: null,
    target_person_id: null,
    source_amount: null,
    target_amount: null,
    category_id: null,
    asset_id: null,
    amount: null,
    price_toman: null,
    usd_rate: null,
    amount_toman_at_time: null,
    amount_usd_at_time: null,
  };

  const setSource = () => {
    if (form.sourceKind === 'wallet') base.source_wallet_id = form.sourceId;
    else if (form.sourceKind === 'asset') base.source_asset_id = form.sourceId;
    else if (form.sourceKind === 'person') base.source_person_id = form.sourceId;
    const amount = Number(form.sourceAmount);
    if (Number.isFinite(amount) && amount > 0) base.source_amount = amount;
  };
  const setTarget = () => {
    if (form.targetKind === 'wallet') base.target_wallet_id = form.targetId;
    else if (form.targetKind === 'asset') base.target_asset_id = form.targetId;
    else if (form.targetKind === 'person') base.target_person_id = form.targetId;
    const amount = Number(form.targetAmount);
    if (Number.isFinite(amount) && amount > 0) base.target_amount = amount;
  };

  switch (form.type) {
    case 'BUY':
      setSource();
      setTarget();
      base.price_toman = Number(form.priceToman);
      base.usd_rate = Number(form.usdRate);
      base.asset_id = form.targetId;
      base.amount = Number(form.targetAmount);
      break;
    case 'SELL':
      setSource();
      setTarget();
      base.price_toman = Number(form.priceToman);
      base.usd_rate = Number(form.usdRate);
      base.asset_id = form.sourceId;
      base.amount = Number(form.sourceAmount);
      break;
    case 'TRANSFER':
      setSource();
      setTarget();
      // Asset<->wallet transfer should update asset holdings/cost replay exactly
      // like a sell/buy at the implied unit price.
      if (form.sourceKind === 'asset' && form.targetKind === 'wallet') {
        const qty = Number(form.sourceAmount);
        const money = Number(form.targetAmount);
        const targetWallet = wallets.find((w) => w.id === form.targetId);
        const walletRate = targetWallet
          ? walletRateForTransfer(
              targetWallet,
              currencyRates,
              fallbackUsdRate,
              form.usdRate
            )
          : 0;
        const toman = Number.isFinite(money) && Number.isFinite(walletRate) ? money * walletRate : 0;
        if (qty > 0 && toman > 0) {
          base.asset_id = form.sourceId;
          base.amount = qty;
          base.price_toman = toman / qty;
          const u = Number(form.usdRate);
          if (u > 0) base.usd_rate = u;
        }
      } else if (form.sourceKind === 'wallet' && form.targetKind === 'asset') {
        const qty = Number(form.targetAmount);
        const money = Number(form.sourceAmount);
        const sourceWallet = wallets.find((w) => w.id === form.sourceId);
        const walletRate = sourceWallet
          ? walletRateForTransfer(
              sourceWallet,
              currencyRates,
              fallbackUsdRate,
              form.usdRate
            )
          : 0;
        const toman = Number.isFinite(money) && Number.isFinite(walletRate) ? money * walletRate : 0;
        if (qty > 0 && toman > 0) {
          base.asset_id = form.targetId;
          base.amount = qty;
          base.price_toman = toman / qty;
          const u = Number(form.usdRate);
          if (u > 0) base.usd_rate = u;
        }
      }
      break;
    case 'INCOME':
      setTarget();
      base.category_id = form.categoryId;
      // Asset-side INCOME: populate the legacy trio so asset stats replay
      // treats these new units as acquired at `price_toman` (cost basis
      // = market at receipt, symmetric with a BUY).
      if (form.targetKind === 'asset') {
        base.asset_id = form.targetId;
        base.amount = Number(form.targetAmount);
        base.price_toman = Number(form.priceToman);
        base.usd_rate = Number(form.usdRate);
      }
      break;
    case 'EXPENSE':
      setSource();
      base.category_id = form.categoryId;
      // Asset-side EXPENSE: populate the legacy trio so asset stats
      // realize P/L against running cost basis (symmetric with a SELL).
      if (form.sourceKind === 'asset') {
        base.asset_id = form.sourceId;
        base.amount = Number(form.sourceAmount);
        base.price_toman = Number(form.priceToman);
        base.usd_rate = Number(form.usdRate);
      }
      break;
  }

  const snap = computeAmountSnapshots(form, wallets);
  base.amount_toman_at_time = snap.toman;
  base.amount_usd_at_time = snap.usd;

  return base;
}

/**
 * Build daily_prices rows from freshly-saved BUY/SELL (+asset-side TRANSFER)
 * transactions.
 *
 * Writes with `ignoreDuplicates: true` so ANY existing snapshot on that
 * (user, asset, date_string) key survives untouched — critical for the
 * source-priority contract: manual > trade > auto. If two trades happen
 * the same day, first-writer-wins is good enough; manual save will
 * overwrite regardless.
 *
 * Only rows with a positive `price_toman` AND positive `usd_rate` are
 * snapshotted. Without a rate we cannot materialize a true usd price, and
 * a zero would contaminate P/L lookups.
 */
function buildTradeSnapshots(
  txs: Transaction[],
  userId: string
): Omit<DailyPrice, 'created_at' | 'updated_at'>[] {
  const out: Omit<DailyPrice, 'created_at' | 'updated_at'>[] = [];
  for (const tx of txs) {
    if (tx.type !== 'BUY' && tx.type !== 'SELL' && tx.type !== 'TRANSFER') continue;
    const assetId =
      tx.asset_id ??
      (tx.type === 'BUY'
        ? tx.target_asset_id
        : tx.type === 'SELL'
          ? tx.source_asset_id
          : tx.source_asset_id ?? tx.target_asset_id);
    if (!assetId) continue;
    if (!tx.date_string) continue;
    if (!/^[0-9]{4}\/[0-9]{2}\/[0-9]{2}$/.test(tx.date_string)) continue;

    const priceToman = Number(tx.price_toman);
    const rate = Number(tx.usd_rate);
    if (!Number.isFinite(priceToman) || priceToman <= 0) continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;

    out.push({
      user_id: userId,
      asset_id: assetId,
      date_string: tx.date_string,
      price_toman: priceToman,
      price_usd: priceToman / rate,
      source: 'trade',
    });
  }
  return out;
}

// ─── Main component ──────────────────────────────────────────────────────────

export function AddTransactionView({
  assetId,
  walletId,
  defaultType,
  transactionId,
}: AddTransactionViewProps) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const {
    assets,
    wallets,
    persons,
    categories,
    transactions,
    currencyRates,
    dailyPrices,
    setTransactions,
    setDailyPrices,
  } = useData();
  const { usdRate } = useUI();

  const txToEdit = useMemo(
    () => (transactionId ? transactions.find((t) => t.id === transactionId) : undefined),
    [transactionId, transactions]
  );

  const [rows, setRows] = useState<FormState[]>(() => [
    buildInitialForm(txToEdit, { assetId, walletId, defaultType }, usdRate),
  ]);
  // Collapsed state lives out-of-band: it's pure UI and we don't want to bloat
  // FormState (which is serialized into the DB payload).
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (txToEdit) {
      setRows([buildInitialForm(txToEdit, {}, usdRate)]);
      setCollapsed({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txToEdit?.id]);

  if (!user) return null;
  if (transactionId && !txToEdit) {
    return <NotFound message="تراکنش پیدا نشد." onBack={() => router.back()} />;
  }

  const isEdit = !!txToEdit;
  const sharedType = rows[0].type;
  const sharedStyle = TYPE_STYLES[sharedType];

  const switchType = (type: TransactionType) => {
    if (isEdit) return;
    if (type === sharedType) return;
    setRows((prev) => prev.map((r) => applyTypeSwitch(r, type)));
  };

  const updateRow = (idx: number, updater: (prev: FormState) => FormState) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? updater(r) : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      buildInitialForm(undefined, { defaultType: sharedType }, usdRate),
    ]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
    setCollapsed((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const toggleCollapsed = (idx: number) => {
    setCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  /**
   * Best-effort snapshot of BUY/SELL trades into `daily_prices`.
   *
   * Source-priority contract:
   *   manual > trade > auto   (higher NEVER gets overwritten by lower)
   *
   * We implement it client-side with a check-then-upsert:
   *   1. Build candidate rows from the txs we just saved.
   *   2. Drop any whose (asset_id, date_string) already has a MANUAL row.
   *   3. Within this batch, dedupe to one row per (asset_id, date_string),
   *      keeping the LAST occurrence (matches the user's typing order, and
   *      for a single-tx edit there's nothing to dedupe).
   *   4. Regular upsert — overwriting any prior trade/auto row for the
   *      same key is the correct behavior for edits.
   *
   * Race with a concurrent manual save between step 2 and step 4 is
   * tolerated: this is a single-user mobile app, interactions are serial.
   *
   * Failures are logged but NEVER abort the primary save. The live
   * `assets.price_*` cache is not involved here.
   */
  const persistTradeSnapshots = async (txs: Transaction[]) => {
    const candidates = buildTradeSnapshots(txs, user.id);
    if (candidates.length === 0) return;

    const manualKeys = new Set(
      dailyPrices
        .filter((p) => p.source === 'manual')
        .map((p) => `${p.asset_id}|${p.date_string}`)
    );

    const byKey = new Map<
      string,
      Omit<DailyPrice, 'created_at' | 'updated_at'>
    >();
    for (const row of candidates) {
      const key = `${row.asset_id}|${row.date_string}`;
      if (manualKeys.has(key)) continue;
      byKey.set(key, row); // last wins
    }
    const rows = [...byKey.values()];
    if (rows.length === 0) return;

    const { data, error } = await supabase
      .from('daily_prices')
      .upsert(rows, { onConflict: 'user_id,asset_id,date_string' })
      .select();
    if (error) {
      console.error('daily_prices trade snapshot failed', error);
      return;
    }
    const fresh = (data as DailyPrice[]) || [];
    if (fresh.length === 0) return;
    setDailyPrices((prev) => {
      const key = (p: DailyPrice) =>
        `${p.user_id}|${p.asset_id}|${p.date_string}`;
      const map = new Map(prev.map((p) => [key(p), p]));
      for (const p of fresh) map.set(key(p), p);
      return Array.from(map.values());
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    for (let i = 0; i < rows.length; i++) {
      const err = validateForm(rows[i], wallets);
      if (err) {
        const msg = rows.length > 1 ? `تراکنش #${i + 1}: ${err}` : err;
        toast.error(msg);
        // Expand the offender and bring it on-screen.
        setCollapsed((prev) => ({ ...prev, [i]: false }));
        window.requestAnimationFrame(() => {
          rowRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (isEdit && txToEdit) {
        const payload = buildPayload(
          rows[0],
          user.id,
          wallets,
          currencyRates,
          usdRate
        );
        const { data, error } = await supabase
          .from('transactions')
          .update(payload)
          .eq('id', txToEdit.id)
          .select()
          .single();
        if (error) throw error;
        const updated = data as Transaction;
        setTransactions((prev) =>
          prev.map((t) => (t.id === txToEdit.id ? updated : t))
        );
        // Snapshot (trade) this edit too — never overwrites manual on conflict.
        await persistTradeSnapshots([updated]);
        toast.success('تراکنش به‌روزرسانی شد.');
        router.back();
      } else {
        const payloads = rows.map((r) =>
          buildPayload(r, user.id, wallets, currencyRates, usdRate)
        );
        const { data, error } = await supabase
          .from('transactions')
          .insert(payloads)
          .select();
        if (error) throw error;
        const inserted = (data ?? []) as Transaction[];
        setTransactions((prev) => [...inserted.slice().reverse(), ...prev]);
        // Best-effort: snapshot trades in parallel with the success toast.
        await persistTradeSnapshots(inserted);
        const ids = inserted.map((t) => t.id);
        // Undo = hard delete + local rollback. 6s window (toast default for info).
        toast.success(
          inserted.length > 1
            ? `${inserted.length} تراکنش ثبت شد.`
            : 'تراکنش ثبت شد.',
          {
            action: {
              label: 'برگرداندن',
              onClick: async () => {
                try {
                  const { error: delErr } = await supabase
                    .from('transactions')
                    .delete()
                    .in('id', ids);
                  if (delErr) throw delErr;
                  setTransactions((prev) => prev.filter((t) => !ids.includes(t.id)));
                  toast.info('تراکنش‌ها لغو شدند.');
                } catch (undoErr) {
                  console.error(undoErr);
                  toast.error('خطا در لغو تراکنش‌ها.');
                }
              },
            },
          }
        );
        router.back();
      }
    } catch (err2) {
      console.error(err2);
      toast.error('خطا در ثبت تراکنش.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#0F1015] min-h-full pb-10 animate-in slide-in-from-bottom-8 duration-300 relative z-50">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-10">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">
          {isEdit
            ? 'ویرایش تراکنش'
            : rows.length > 1
              ? `ثبت ${rows.length} تراکنش`
              : 'ثبت تراکنش جدید'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {/* Type tabs */}
        <div className="grid grid-cols-5 gap-1 bg-[#1A1B26] p-1 rounded-xl">
          {TYPE_TABS.map((t) => {
            const s = TYPE_STYLES[t];
            const active = sharedType === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => switchType(t)}
                disabled={isEdit && t !== sharedType}
                className={`py-2 text-xs font-bold rounded-lg transition-all ${
                  active
                    ? `${s.accentBg} text-white shadow-md`
                    : 'text-slate-400 hover:text-slate-200 disabled:opacity-30'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {isEdit && (
          <p className="text-[11px] text-slate-500 -mt-2">
            نوع تراکنش پس از ثبت قابل تغییر نیست.
          </p>
        )}

        {/* Rows */}
        <div className="space-y-4">
          {rows.map((form, idx) => (
            <div
              key={idx}
              ref={(el) => {
                rowRefs.current[idx] = el;
              }}
            >
              <TransactionFormRow
                form={form}
                rowIndex={idx}
                totalRows={rows.length}
                isCollapsed={!!collapsed[idx]}
                canRemove={!isEdit && rows.length > 1}
                onChange={(updater) => updateRow(idx, updater)}
                onRemove={() => removeRow(idx)}
                onToggleCollapsed={() => toggleCollapsed(idx)}
                wallets={wallets}
                assets={assets}
                persons={persons}
                categories={categories}
                transactions={transactions}
                currencyRates={currencyRates}
                usdRate={usdRate}
              />
            </div>
          ))}
        </div>

        {!isEdit && (
          <button
            type="button"
            onClick={addRow}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-dashed border-white/10 text-slate-300 p-3 rounded-xl text-sm font-bold transition-all"
          >
            <Plus size={16} />
            افزودن تراکنش دیگر
          </button>
        )}

        {/* Live preview */}
        <PreviewPanel
          rows={rows}
          wallets={wallets}
          assets={assets}
          persons={persons}
          categories={categories}
          style={sharedStyle}
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full ${sharedStyle.accentBtnBg} text-white p-4 rounded-xl font-bold ${sharedStyle.accentBtnShadow} transition-all disabled:opacity-50`}
        >
          {isSubmitting
            ? 'در حال ارسال...'
            : isEdit
              ? 'ثبت تغییرات'
              : rows.length > 1
                ? `ثبت ${rows.length} تراکنش`
                : 'ثبت تراکنش'}
        </button>
      </form>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function TransactionFormRow({
  form,
  rowIndex,
  totalRows,
  isCollapsed,
  canRemove,
  onChange,
  onRemove,
  onToggleCollapsed,
  wallets,
  assets,
  persons,
  categories,
  transactions,
  currencyRates,
  usdRate,
}: {
  form: FormState;
  rowIndex: number;
  totalRows: number;
  isCollapsed: boolean;
  canRemove: boolean;
  onChange: (updater: (prev: FormState) => FormState) => void;
  onRemove: () => void;
  onToggleCollapsed: () => void;
  wallets: Wallet[];
  assets: Asset[];
  persons: Person[];
  categories: Category[];
  transactions: Transaction[];
  currencyRates: CurrencyRate[];
  usdRate: number;
}) {
  const shape = TYPE_SHAPES[form.type];
  const style = TYPE_STYLES[form.type];
  const pricing = pricingContextOf(form, wallets);
  const isBulk = totalRows > 1;

  const [pickerOpen, setPickerOpen] = useState<null | 'source' | 'target'>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);

  const sourceWallet = form.sourceKind === 'wallet' ? wallets.find((w) => w.id === form.sourceId) : undefined;
  const sourceAsset  = form.sourceKind === 'asset'  ? assets.find((a)  => a.id === form.sourceId) : undefined;
  const targetWallet = form.targetKind === 'wallet' ? wallets.find((w) => w.id === form.targetId) : undefined;
  const targetAsset  = form.targetKind === 'asset'  ? assets.find((a)  => a.id === form.targetId) : undefined;
  const targetPerson = form.targetKind === 'person' ? persons.find((p) => p.id === form.targetId) : undefined;

  const srcBalance = sourceBalance(form, wallets, transactions, persons);
  const srcAmountNum = Number(form.sourceAmount);
  const isInsufficient =
    form.type !== 'INCOME' &&
    form.sourceKind !== 'person' &&
    srcBalance != null &&
    Number.isFinite(srcAmountNum) &&
    srcAmountNum > srcBalance;

  // Mutators --------------------------------------------------------------

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    onChange((prev) => {
      const next = { ...prev, [key]: value };
      if (
        (next.type === 'BUY' || next.type === 'SELL') &&
        (key === 'targetAmount' ||
         key === 'sourceAmount' ||
         key === 'priceToman' ||
         key === 'usdRate' ||
         key === 'sourceId' ||
         key === 'targetId' ||
         key === 'sourceKind' ||
         key === 'targetKind')
      ) {
        return recomputeMoneySide(next, wallets, currencyRates, usdRate);
      }
      if (
        next.type === 'TRANSFER' &&
        (key === 'sourceAmount' ||
          key === 'sourceId' ||
          key === 'targetId' ||
          key === 'sourceKind' ||
          key === 'targetKind' ||
          key === 'usdRate')
      ) {
        return recomputeTransferTarget(next, wallets, assets, currencyRates, usdRate);
      }
      return next;
    });
  };

  const selectEndpoint = (side: 'source' | 'target') =>
    (kind: EndpointKind, id: string) => {
      onChange((prev) => {
        const next: FormState = side === 'source'
          ? { ...prev, sourceKind: kind, sourceId: id }
          : { ...prev, targetKind: kind, targetId: id };
        if (next.type === 'BUY' || next.type === 'SELL') {
          return recomputeMoneySide(next, wallets, currencyRates, usdRate);
        }
        if (next.type === 'TRANSFER') {
          return recomputeTransferTarget(next, wallets, assets, currencyRates, usdRate);
        }
        return next;
      });
    };

  // Primary-side amount setter. For TRANSFER same-currency, we mirror target.
  const setPrimaryAmount = (v: string) => {
    const primary = PRIMARY_SIDE[form.type];
    onChange((prev) => {
      const next: FormState = primary === 'source'
        ? { ...prev, sourceAmount: v }
        : { ...prev, targetAmount: v };

      if (next.type === 'BUY' || next.type === 'SELL') {
        return recomputeMoneySide(next, wallets, currencyRates, usdRate);
      }
      if (next.type === 'TRANSFER') {
        return recomputeTransferTarget(next, wallets, assets, currencyRates, usdRate);
      }
      return next;
    });
  };

  // Secondary editable input — only used for cross-currency TRANSFER.
  const setTargetAmountRaw = (v: string) => {
    onChange((prev) => ({ ...prev, targetAmount: v }));
  };

  const applySourcePercent = (pct: number) => {
    if (srcBalance == null || srcBalance <= 0) return;
    const amt = (srcBalance * pct) / 100;
    // Chips always target the source; only useful when source IS primary.
    if (PRIMARY_SIDE[form.type] !== 'source') return;
    setPrimaryAmount(canonicalNumber(amt));
  };

  // View helpers ----------------------------------------------------------

  const jalaali = parseJalaali(form.date);
  const dateLabel = jalaali ? formatJalaaliHuman(jalaali) : form.date || 'انتخاب تاریخ';
  const today = todayJalaali();
  const yesterday = addDays(today, -1);
  const isToday = jalaali && jalaali.jy === today.jy && jalaali.jm === today.jm && jalaali.jd === today.jd;
  const isYesterday =
    jalaali && jalaali.jy === yesterday.jy && jalaali.jm === yesterday.jm && jalaali.jd === yesterday.jd;

  const primarySide = PRIMARY_SIDE[form.type];
  const optionalSource = form.type === 'BUY';
  const optionalTarget = form.type === 'SELL';
  const canShowQuickChips =
    primarySide === 'source' &&
    form.sourceKind !== null &&
    form.sourceId !== null &&
    srcBalance != null &&
    srcBalance > 0;

  // Collapsed summary -----------------------------------------------------

  if (isBulk && isCollapsed) {
    return (
      <CollapsedRow
        form={form}
        rowIndex={rowIndex}
        style={style}
        canRemove={canRemove}
        onToggle={onToggleCollapsed}
        onRemove={onRemove}
        wallets={wallets}
        assets={assets}
        persons={persons}
        categories={categories}
      />
    );
  }

  // Expanded view ---------------------------------------------------------

  const clearOptionalSource = () => {
    onChange((prev) => ({ ...prev, sourceKind: null, sourceId: null, sourceAmount: '' }));
  };

  const clearOptionalTarget = () => {
    onChange((prev) => ({ ...prev, targetKind: null, targetId: null, targetAmount: '' }));
  };

  return (
    <>
      <div
        className={`rounded-2xl border ${style.accentBorder} bg-linear-to-b ${style.accentGradient} p-4 space-y-5`}
      >
        {isBulk && (
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold ${style.accentText}`}>
              تراکنش #{rowIndex + 1}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleCollapsed}
                className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400 transition-colors"
                aria-label="جمع‌کردن"
              >
                <ChevronLeft size={14} />
              </button>
              {canRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="p-1.5 bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 rounded-lg text-slate-400 transition-colors"
                  aria-label="حذف"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Direction cards */}
        <div className="space-y-2">
          {shape.source && (
            <DirectionCard
              label="مبدأ"
              kind={form.sourceKind}
              wallet={sourceWallet}
              asset={sourceAsset}
              person={
                form.sourceKind === 'person'
                  ? persons.find((p) => p.id === form.sourceId)
                  : undefined
              }
              balance={srcBalance}
              insufficient={isInsufficient}
              optional={optionalSource}
              onTap={() => setPickerOpen('source')}
            />
          )}

          {optionalSource && (form.sourceKind || form.sourceId) && (
            <div className="-mt-1 flex justify-end">
              <button
                type="button"
                onClick={clearOptionalSource}
                className="text-[11px] text-slate-500 hover:text-white transition"
              >
                بدون ثبت مبدأ
              </button>
            </div>
          )}

          {shape.source && shape.target && (
            <div className="flex justify-center py-0.5">
              <div className={`p-1.5 rounded-full bg-white/5 ${style.accentText}`}>
                <ArrowDown size={14} />
              </div>
            </div>
          )}

          {shape.target && (
            <DirectionCard
              label="مقصد"
              kind={form.targetKind}
              wallet={targetWallet}
              asset={targetAsset}
              person={
                form.targetKind === 'person'
                  ? persons.find((p) => p.id === form.targetId)
                  : undefined
              }
              balance={
                form.targetKind === 'wallet' && targetWallet
                  ? calculateWalletStats(targetWallet, transactions).balance
                  : form.targetKind === 'person' && form.targetId
                    ? sourceBalance(
                        {
                          ...form,
                          sourceKind: 'person',
                          sourceId: form.targetId,
                        },
                        wallets,
                        transactions,
                        persons
                      )
                  : null
              }
              insufficient={false}
              optional={optionalTarget}
              onTap={() => setPickerOpen('target')}
            />
          )}

          {optionalTarget && (form.targetKind || form.targetId) && (
            <div className="-mt-1 flex justify-end">
              <button
                type="button"
                onClick={clearOptionalTarget}
                className="text-[11px] text-slate-500 hover:text-white transition"
              >
                بدون ثبت مقصد
              </button>
            </div>
          )}
        </div>

        {/* Date */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">تاریخ</label>
          <button
            type="button"
            onClick={() => setDateOpen(true)}
            className="w-full flex items-center gap-3 bg-[#1A1B26] border border-white/10 hover:border-white/20 rounded-xl p-3 text-right transition"
          >
            <Calendar size={16} className={style.accentText} />
            <span className="text-sm text-slate-100 flex-1">{dateLabel}</span>
          </button>
          <div className="mt-2 flex gap-2">
            <DateChip
              label="امروز"
              active={!!isToday}
              onClick={() => updateField('date', formatJalaali(today))}
            />
            <DateChip
              label="دیروز"
              active={!!isYesterday}
              onClick={() => updateField('date', formatJalaali(yesterday))}
            />
          </div>
        </div>

        {/* Primary amount input */}
        <PrimaryAmountField
          form={form}
          primarySide={primarySide}
          sourceWallet={sourceWallet}
          targetWallet={targetWallet}
          sourceAsset={sourceAsset}
          targetAsset={targetAsset}
          isInsufficient={isInsufficient}
          onChange={setPrimaryAmount}
        />

        {/* Source balance info + quick chips */}
        {canShowQuickChips && (
          <div className="flex flex-wrap items-center gap-2 -mt-2">
            <span className="text-[11px] text-slate-500">درصدی از موجودی:</span>
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applySourcePercent(p)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white/5 hover:bg-white/10 ${style.accentText} transition`}
              >
                {p === 100 ? 'همه' : `${p}٪`}
              </button>
            ))}
          </div>
        )}

        {/* Price fields (BUY/SELL; INCOME/EXPENSE when priced; TRANSFER
            wallet↔asset: USD rate only — see pricingContextOf). */}
        {pricing.needsPrice && (
          <PriceFields
            priceLabel={pricing.priceLabel}
            priceToman={form.priceToman}
            usdRate={form.usdRate}
            onPriceToman={(v) => updateField('priceToman', v)}
            onUsdRate={(v) => updateField('usdRate', v)}
            showTomanPrice={pricing.showTomanPrice !== false}
            showUsdRate={pricing.needsUsdRate}
          />
        )}

        {/* Derived (auto-computed) amount — read-only */}
        {((form.type === 'BUY' && sourceWallet) || (form.type === 'SELL' && targetWallet)) && (
          <DerivedAmountLine
            form={form}
            sourceWallet={sourceWallet}
            targetWallet={targetWallet}
          />
        )}

        {/* Secondary editable amount — only for cross-currency TRANSFER */}
        {form.type === 'TRANSFER' &&
          !(
            sourceWallet &&
            targetWallet &&
            sourceWallet.currency === targetWallet.currency
          ) && (
            <CrossCurrencyTargetField
              value={form.targetAmount}
              targetWallet={targetWallet}
              targetAsset={targetAsset}
              targetPerson={targetPerson}
              onChange={setTargetAmountRaw}
            />
          )}

        {/* Category */}
        {shape.needsCategory && (
          <CategoryField
            kind={shape.needsCategory}
            categories={categories}
            value={form.categoryId}
            onOpen={() => setCategoryOpen(true)}
          />
        )}

        {/* Note */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            توضیحات (اختیاری)
          </label>
          <textarea
            value={form.note}
            onChange={(e) => updateField('note', e.target.value)}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none min-h-[60px]"
            maxLength={500}
          />
        </div>

        {/* Transfer cross-currency warning */}
        {form.type === 'TRANSFER' &&
          sourceWallet &&
          targetWallet &&
          sourceWallet.currency !== targetWallet.currency && (
            <div className="flex items-center gap-2 text-[11px] text-amber-400/80 -mt-2">
              <ArrowLeftRight size={12} />
              انتقال بین دو ارز متفاوت — هر دو مقدار را به‌صورت دستی وارد کن.
            </div>
          )}
      </div>

      {/* Endpoint picker sheet */}
      <EndpointSheetPicker
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        title={pickerOpen === 'source' ? 'انتخاب مبدأ' : 'انتخاب مقصد'}
        allow={
          pickerOpen === 'source'
            ? (shape.source ?? [])
            : (shape.target ?? [])
        }
        excludeIds={
          pickerOpen === 'source'
            ? (form.sourceKind === form.targetKind ? [form.targetId ?? ''] : [])
            : (form.sourceKind === form.targetKind ? [form.sourceId ?? ''] : [])
        }
        wallets={wallets}
        assets={assets}
        persons={persons}
        transactions={transactions}
        onSelect={(kind, id) => {
          if (pickerOpen) selectEndpoint(pickerOpen)(kind, id);
        }}
      />

      {/* iOS date picker */}
      <IOSDatePicker
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        value={form.date}
        onChange={(v) => updateField('date', v)}
      />

      {/* Category picker sheet */}
      {shape.needsCategory && (
        <CategorySheetPicker
          open={categoryOpen}
          onClose={() => setCategoryOpen(false)}
          title={shape.needsCategory === 'income' ? 'انتخاب دسته درآمد' : 'انتخاب دسته هزینه'}
          kind={shape.needsCategory}
          categories={categories}
          value={form.categoryId}
          onSelect={(id) => updateField('categoryId', id)}
        />
      )}
    </>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function DirectionCard({
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
              ? `${balance.toLocaleString('en-US', { maximumFractionDigits: wallet ? CURRENCY_META[wallet.currency].decimals : 6 })} ${unit.trim()}`
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

function DateChip({
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
function PrimaryAmountField({
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
function DerivedAmountLine({
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
    ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 10 })
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
function CrossCurrencyTargetField({
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

function PriceFields({
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

function CategoryField({
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

function CollapsedRow({
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

function summarizeForm(
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

  const fmt = (n: number) =>
    Number.isFinite(n) && n > 0
      ? n.toLocaleString('en-US', { maximumFractionDigits: 6 })
      : '—';

  const label = TYPE_STYLES[form.type].label;

  switch (form.type) {
    case 'BUY':
      return `${label} · ${fmt(tgtAmt)} ${targetName ?? '...'} از ${sourceName ?? '...'}`;
    case 'SELL':
      return `${label} · ${fmt(srcAmt)} ${sourceName ?? '...'} → ${targetName ?? '...'}`;
    case 'TRANSFER':
      return `${label} · ${fmt(srcAmt)} از ${sourceName ?? '...'} به ${targetName ?? '...'}`;
    case 'INCOME':
      return `${label} · ${fmt(tgtAmt)} → ${targetName ?? '...'}${category ? ` · ${category.name}` : ''}`;
    case 'EXPENSE':
      return `${label} · ${fmt(srcAmt)} از ${sourceName ?? '...'}${category ? ` · ${category.name}` : ''}`;
  }
}

// ─── Preview ─────────────────────────────────────────────────────────────────

function PreviewPanel({
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
              {inflow > 0 && <span className="text-emerald-400">+{inflow.toLocaleString('en-US', { maximumFractionDigits: 4 })} </span>}
              {outflow > 0 && <span className="text-rose-400">-{outflow.toLocaleString('en-US', { maximumFractionDigits: 4 })} </span>}
              <span className={net >= 0 ? 'text-slate-300' : 'text-slate-300'}>
                = {net >= 0 ? '+' : ''}{net.toLocaleString('en-US', { maximumFractionDigits: 4 })} {sym}
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

function NotFound({ message, onBack }: { message: string; onBack: () => void }) {
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
