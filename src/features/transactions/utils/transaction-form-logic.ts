import type {
  Asset,
  CurrencyRate,
  DailyPrice,
  Transaction,
  TransactionType,
  Wallet,
} from '@/shared/types/domain';
import {
  applyExpensePayloadFields,
  computeExpenseAmountSnapshots,
} from '@/features/transactions/utils/expense-transaction';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import { assetHolding } from '@/features/transactions/utils/convert-transaction';
import { parseJalaali, todayJalaali, formatJalaali } from '@/shared/utils/jalali';
import { latinizeDigits } from '@/shared/utils/latinize-digits';
import type { EndpointKind } from '@/features/transactions/components/EndpointSheetPicker';
import {
  type FormState,
  pricingContextOf,
} from '@/features/transactions/utils/transaction-form-types';

export function endpointKindOfTx(tx: Transaction, side: 'source' | 'target'): EndpointKind | null {
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

export function endpointIdOfTx(tx: Transaction, side: 'source' | 'target'): string | null {
  if (side === 'source') {
    return tx.source_wallet_id ?? tx.source_asset_id ?? tx.source_person_id ?? null;
  }
  return tx.target_wallet_id ?? tx.target_asset_id ?? tx.target_person_id ?? null;
}

export function todayCanonicalJalali(): string {
  return formatJalaali(todayJalaali());
}

export function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  // Strip float noise and trailing zeros; keep up to 10 significant decimals.
  const rounded = n.toFixed(10);
  const trimmed = rounded.replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
}

export function walletFromForm(
  form: FormState,
  side: 'source' | 'target',
  wallets: Wallet[]
): Wallet | null {
  const kind = side === 'source' ? form.sourceKind : form.targetKind;
  const id = side === 'source' ? form.sourceId : form.targetId;
  if (kind !== 'wallet' || !id) return null;
  return wallets.find((w) => w.id === id) ?? null;
}

export function buildInitialForm(
  tx: Transaction | undefined,
  defaults: {
    assetId?: string;
    walletId?: string;
    defaultType?: TransactionType;
    personId?: string;
    personSide?: 'source' | 'target';
    settleAmount?: string;
  },
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
  if (
    defaults.personId &&
    defaults.walletId &&
    defaults.settleAmount &&
    defaults.personSide &&
    type === 'TRANSFER'
  ) {
    if (defaults.personSide === 'source') {
      f.sourceKind = 'person';
      f.sourceId = defaults.personId;
      f.targetKind = 'wallet';
      f.targetId = defaults.walletId;
    } else {
      f.sourceKind = 'wallet';
      f.sourceId = defaults.walletId;
      f.targetKind = 'person';
      f.targetId = defaults.personId;
    }
    f.sourceAmount = defaults.settleAmount;
    f.targetAmount = defaults.settleAmount;
    return f;
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

/**
 * Derive the wallet-side amount on BUY/SELL from (asset-amount × price),
 * converted through the wallet currency rate. The asset side is always the
 * primary input the user edits; the wallet side is always computed.
 *
 * Returns `next` unchanged if required inputs are missing — never blows up.
 */
export function recomputeMoneySide(
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

export function walletRateForTransfer(
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

export function recomputeTransferTarget(
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
    const overridePrice = Number(next.priceToman);
    const assetPrice =
      Number.isFinite(overridePrice) && overridePrice > 0
        ? overridePrice
        : Number(sourceAsset.price_toman);
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

export function sourceBalance(
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

export function validateForm(form: FormState, wallets: Wallet[]): string | null {
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

export function computeAmountSnapshots(
  form: FormState,
  wallets: Wallet[],
  currencyRates: CurrencyRate[],
  fallbackUsdRate: number
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
        const explicit = Number(form.priceToman);
        const price =
          Number.isFinite(explicit) && explicit > 0
            ? explicit
            : walletRateForTransfer(w, currencyRates, fallbackUsdRate, form.usdRate);
        if (!(price > 0)) return { toman: null, usd: null };
        return computeFromAmountPrice(amount, price);
      }
      if (form.targetKind === 'person') {
        return computeFromAmountPrice(amount, 1);
      }
      return { toman: null, usd: null };
    }

    case 'EXPENSE':
      return computeExpenseAmountSnapshots(form, wallets, currencyRates, fallbackUsdRate);

    case 'TRANSFER':
      return { toman: null, usd: null };
  }
}

export function buildPayload(
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
        const explicitPrice = Number(form.priceToman);
        const tomanFromPrice =
          Number.isFinite(explicitPrice) && explicitPrice > 0 && qty > 0
            ? qty * explicitPrice
            : 0;
        const tomanFromMoney = Number.isFinite(money) && Number.isFinite(walletRate) ? money * walletRate : 0;
        const toman = tomanFromPrice > 0 ? tomanFromPrice : tomanFromMoney;
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
      applyExpensePayloadFields(base, form);
      break;
  }

  const snap = computeAmountSnapshots(form, wallets, currencyRates, fallbackUsdRate);
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
export function buildTradeSnapshots(
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
