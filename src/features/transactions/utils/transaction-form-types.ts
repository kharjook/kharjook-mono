import type { Currency, TransactionType, Wallet } from '@/shared/types/domain';
import type { EndpointKind } from '@/features/transactions/components/EndpointSheetPicker';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';
import {
  CONVERT_UI_MODE,
  type UiTransactionMode,
} from '@/features/transactions/utils/convert-transaction';

export type FormState = {
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
export const PRIMARY_SIDE: Record<TransactionType, 'source' | 'target'> = {
  BUY: 'target',    // target = asset bought
  SELL: 'source',   // source = asset sold
  TRANSFER: 'source',
  INCOME: 'target',
  EXPENSE: 'source',
};

export type TypeShape = {
  source: EndpointKind[] | null;
  target: EndpointKind[] | null;
  needsCategory: 'income' | 'expense' | null;
};

export const TYPE_SHAPES: Record<TransactionType, TypeShape> = {
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
export type PricingContext = {
  needsPrice: boolean;
  /** When false, only the USD rate row is shown (wallet↔asset transfer). */
  showTomanPrice?: boolean;
  needsUsdRate: boolean;
  priceLabel: string;
  endpointKind: EndpointKind | null;
  /** Sole wallet currency when the priced endpoint is a wallet. */
  walletCurrency: Currency | null;
};

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

export function pricingContextOf(form: FormState, wallets: Wallet[]): PricingContext {
  if (form.type === 'TRANSFER') {
    const walletToAsset =
      form.sourceKind === 'wallet' &&
      form.targetKind === 'asset' &&
      !!form.sourceId &&
      !!form.targetId;
    const assetToWallet =
      form.sourceKind === 'asset' &&
      form.targetKind === 'wallet' &&
      !!form.sourceId &&
      !!form.targetId;
    if (walletToAsset) {
      return {
        needsPrice: true,
        showTomanPrice: false,
        needsUsdRate: true,
        priceLabel: '',
        endpointKind: 'asset',
        walletCurrency: null,
      };
    }
    if (assetToWallet) {
      return {
        needsPrice: true,
        showTomanPrice: true,
        needsUsdRate: true,
        priceLabel: 'قیمت فروش هر واحد (تومان)',
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

export interface TypeStyle {
  label: string;
  icon: string; // plain text for tab, no emoji policy enforced
  accentBg: string;      // active tab background
  accentBorder: string;  // card border
  accentText: string;    // text accent
  accentBtnBg: string;   // submit button background
  accentBtnShadow: string;
  accentGradient: string;// preview card background gradient
}

export const TYPE_STYLES: Record<TransactionType, TypeStyle> = {
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

export const UI_TABS: UiTransactionMode[] = [
  'BUY',
  'SELL',
  CONVERT_UI_MODE,
  'TRANSFER',
  'INCOME',
  'EXPENSE',
];

export const CONVERT_TAB_STYLE: TypeStyle = {
  label: 'تبدیل',
  icon: 'C',
  accentBg: 'bg-violet-600',
  accentBorder: 'border-violet-500/30',
  accentText: 'text-violet-400',
  accentBtnBg: 'bg-violet-600 hover:bg-violet-500',
  accentBtnShadow: 'shadow-[0_4px_20px_rgba(124,58,237,0.3)]',
  accentGradient: 'from-violet-500/15 to-transparent',
};

export function styleForUiMode(mode: UiTransactionMode): TypeStyle {
  if (mode === CONVERT_UI_MODE) return CONVERT_TAB_STYLE;
  return TYPE_STYLES[mode];
}

export interface AddTransactionViewProps {
  assetId?: string;
  walletId?: string;
  targetAssetId?: string;
  sourceAmount?: string;
  targetAmount?: string;
  personId?: string;
  personSide?: 'source' | 'target';
  settleAmount?: string;
  defaultType?: TransactionType;
  defaultUiMode?: UiTransactionMode;
  transactionId?: string;
}
