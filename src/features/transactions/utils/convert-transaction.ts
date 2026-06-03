import { parseJalaali, formatJalaali, todayJalaali } from '@/shared/utils/jalali';
import { latinizeDigits } from '@/shared/utils/latinize-digits';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import type {
  Asset,
  CurrencyRate,
  Transaction,
  Wallet,
} from '@/shared/types/domain';

export const CONVERT_NOTE_PREFIX = '[CONVERT]';
export const CONVERT_UI_MODE = 'CONVERT' as const;
export type UiTransactionMode =
  | 'BUY'
  | 'SELL'
  | 'TRANSFER'
  | 'INCOME'
  | 'EXPENSE'
  | typeof CONVERT_UI_MODE;

export interface ConvertFormState {
  date: string;
  note: string;
  sourceAssetId: string | null;
  sourceAmount: string;
  sellPriceToman: string;
  sellUsdRate: string;
  sellTargetWalletId: string | null;
  targetAssetId: string | null;
  targetAmount: string;
  buyPriceToman: string;
  buyUsdRate: string;
  buySourceWalletId: string | null;
  matchBuyValue: boolean;
  operationId: string | null;
  sellTransactionId: string | null;
  buyTransactionId: string | null;
}

function todayCanonicalJalali(): string {
  return formatJalaali(todayJalaali());
}

function canonicalNumber(n: number): string {
  if (!Number.isFinite(n)) return '';
  const rounded = n.toFixed(10);
  const trimmed = rounded.replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
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

function computeLegSnapshots(amount: number, priceToman: number, usdRate: number) {
  if (!Number.isFinite(amount) || amount <= 0) return { toman: null, usd: null };
  if (!Number.isFinite(priceToman) || priceToman <= 0) return { toman: null, usd: null };
  const toman = amount * priceToman;
  const usd =
    Number.isFinite(usdRate) && usdRate > 0 ? toman / usdRate : null;
  return { toman, usd };
}

function convertNote(note: string): string | null {
  const trimmed = note.trim();
  if (!trimmed) return CONVERT_NOTE_PREFIX;
  return `${CONVERT_NOTE_PREFIX} ${trimmed}`;
}

function deriveWalletAmount(
  assetQty: number,
  priceToman: number,
  wallet: Wallet | undefined,
  currencyRates: CurrencyRate[],
  fallbackUsdRate: number,
  usdRateStr: string
): string {
  if (!wallet || !(assetQty > 0) || !(priceToman > 0)) return '';
  const rate = walletRateForTransfer(
    wallet,
    currencyRates,
    fallbackUsdRate,
    usdRateStr
  );
  if (!(rate > 0)) return '';
  return canonicalNumber((assetQty * priceToman) / rate);
}

/** Holdings including TRANSFER-acquired/disposed quantities. */
export function assetHolding(assetId: string, transactions: Transaction[]): number {
  const isAcquire = (tx: Transaction) => {
    if (tx.type === 'BUY' || tx.type === 'INCOME') {
      return tx.asset_id === assetId || tx.target_asset_id === assetId;
    }
    if (tx.type === 'TRANSFER') {
      return tx.target_asset_id === assetId;
    }
    return false;
  };
  const isDispose = (tx: Transaction) => {
    if (tx.type === 'SELL' || tx.type === 'EXPENSE') {
      return tx.asset_id === assetId || tx.source_asset_id === assetId;
    }
    if (tx.type === 'TRANSFER') {
      return tx.source_asset_id === assetId;
    }
    return false;
  };
  const txAmountForAsset = (tx: Transaction): number => {
    if (tx.type === 'BUY' || tx.type === 'INCOME') {
      return Number(tx.target_amount ?? tx.amount);
    }
    if (tx.type === 'SELL' || tx.type === 'EXPENSE') {
      return Number(tx.source_amount ?? tx.amount);
    }
    if (isAcquire(tx)) return Number(tx.target_amount ?? tx.amount);
    return Number(tx.source_amount ?? tx.amount);
  };

  let total = 0;
  for (const tx of transactions) {
    const acquiring = isAcquire(tx);
    const disposing = isDispose(tx);
    if (!acquiring && !disposing) continue;

    const amount = txAmountForAsset(tx);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    total += acquiring ? amount : -amount;
  }
  return total;
}

export function buildInitialConvertForm(
  defaults: {
    assetId?: string;
    targetAssetId?: string;
    sourceAmount?: string;
    targetAmount?: string;
  },
  assets: Asset[],
  usdRate: number,
  pair?: { sell: Transaction; buy: Transaction }
): ConvertFormState {
  if (pair) {
    const note = (pair.sell.note ?? '').replace(/^\[CONVERT\]\s*/, '').trim();
    return {
      date: latinizeDigits(pair.sell.date_string),
      note,
      sourceAssetId: pair.sell.source_asset_id,
      sourceAmount:
        pair.sell.source_amount != null ? String(pair.sell.source_amount) : '',
      sellPriceToman:
        pair.sell.price_toman != null ? String(pair.sell.price_toman) : '',
      sellUsdRate:
        pair.sell.usd_rate != null ? String(pair.sell.usd_rate) : String(usdRate),
      sellTargetWalletId: pair.sell.target_wallet_id,
      targetAssetId: pair.buy.target_asset_id,
      targetAmount:
        pair.buy.target_amount != null ? String(pair.buy.target_amount) : '',
      buyPriceToman:
        pair.buy.price_toman != null ? String(pair.buy.price_toman) : '',
      buyUsdRate:
        pair.buy.usd_rate != null ? String(pair.buy.usd_rate) : String(usdRate),
      buySourceWalletId: pair.buy.source_wallet_id,
      matchBuyValue: false,
      operationId: pair.sell.operation_id ?? pair.buy.operation_id ?? null,
      sellTransactionId: pair.sell.id,
      buyTransactionId: pair.buy.id,
    };
  }

  const sourceAsset = defaults.assetId
    ? assets.find((a) => a.id === defaults.assetId)
    : null;
  const targetAsset = defaults.targetAssetId
    ? assets.find((a) => a.id === defaults.targetAssetId)
    : null;

  return {
    date: todayCanonicalJalali(),
    note: '',
    sourceAssetId: defaults.assetId ?? null,
    sourceAmount: defaults.sourceAmount ?? '',
    sellPriceToman: sourceAsset ? String(sourceAsset.price_toman) : '',
    sellUsdRate: String(usdRate),
    sellTargetWalletId: null,
    targetAssetId: defaults.targetAssetId ?? null,
    targetAmount: defaults.targetAmount ?? '',
    buyPriceToman: targetAsset ? String(targetAsset.price_toman) : '',
    buyUsdRate: String(usdRate),
    buySourceWalletId: null,
    matchBuyValue: true,
    operationId: null,
    sellTransactionId: null,
    buyTransactionId: null,
  };
}

export function applyMatchBuyValue(form: ConvertFormState): ConvertFormState {
  if (!form.matchBuyValue) return form;
  const sellQty = Number(form.sourceAmount);
  const buyQty = Number(form.targetAmount);
  const sellPrice = Number(form.sellPriceToman);
  if (!(sellQty > 0) || !(buyQty > 0) || !(sellPrice > 0)) return form;
  const buyPrice = (sellQty * sellPrice) / buyQty;
  return {
    ...form,
    buyPriceToman: canonicalNumber(buyPrice),
    buyUsdRate: form.sellUsdRate || form.buyUsdRate,
  };
}

export function validateConvertForm(
  form: ConvertFormState,
  transactions: Transaction[],
  wallets: Wallet[]
): string | null {
  if (!form.date) return 'تاریخ الزامی است.';
  if (!parseJalaali(form.date)) return 'تاریخ نامعتبر است.';
  if (!form.sourceAssetId) return 'دارایی مبدأ را انتخاب کن.';
  if (!form.targetAssetId) return 'دارایی مقصد را انتخاب کن.';
  if (form.sourceAssetId === form.targetAssetId) {
    return 'مبدأ و مقصد نباید یک دارایی باشند.';
  }

  const sellQty = Number(form.sourceAmount);
  if (!Number.isFinite(sellQty) || sellQty <= 0) return 'مقدار فروش نامعتبر است.';
  const buyQty = Number(form.targetAmount);
  if (!Number.isFinite(buyQty) || buyQty <= 0) return 'مقدار خرید نامعتبر است.';

  const sellPrice = Number(form.sellPriceToman);
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) {
    return 'قیمت فروش هر واحد (تومان) نامعتبر است.';
  }
  const buyPrice = Number(form.buyPriceToman);
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
    return 'قیمت خرید هر واحد (تومان) نامعتبر است.';
  }

  const sellUsd = Number(form.sellUsdRate);
  if (!Number.isFinite(sellUsd) || sellUsd <= 0) return 'نرخ دلار فروش نامعتبر است.';
  const buyUsd = Number(form.buyUsdRate);
  if (!Number.isFinite(buyUsd) || buyUsd <= 0) return 'نرخ دلار خرید نامعتبر است.';

  const holding = assetHolding(form.sourceAssetId, transactions);
  const editingSellQty =
    form.sellTransactionId != null
      ? Number(
          transactions.find((tx) => tx.id === form.sellTransactionId)?.source_amount ??
            0
        )
      : 0;
  const effectiveHolding = holding + (Number.isFinite(editingSellQty) ? editingSellQty : 0);
  if (sellQty > effectiveHolding + 1e-9) {
    return 'موجودی دارایی مبدأ کافی نیست.';
  }

  if (form.sellTargetWalletId && !wallets.some((w) => w.id === form.sellTargetWalletId)) {
    return 'کیف پول مقصد فروش نامعتبر است.';
  }
  if (form.buySourceWalletId && !wallets.some((w) => w.id === form.buySourceWalletId)) {
    return 'کیف پول مبدأ خرید نامعتبر است.';
  }

  return null;
}

export function convertValueWarning(form: ConvertFormState): string | null {
  const sellQty = Number(form.sourceAmount);
  const buyQty = Number(form.targetAmount);
  const sellPrice = Number(form.sellPriceToman);
  const buyPrice = Number(form.buyPriceToman);
  if (!(sellQty > 0) || !(buyQty > 0) || !(sellPrice > 0) || !(buyPrice > 0)) {
    return null;
  }
  const sellTotal = sellQty * sellPrice;
  const buyTotal = buyQty * buyPrice;
  const diff = Math.abs(sellTotal - buyTotal);
  const tolerance = Math.max(sellTotal, buyTotal) * 0.02;
  if (diff <= tolerance) return null;
  return 'ارزش فروش و خرید اختلاف قابل توجهی دارد.';
}

export function buildConvertPayloads(
  form: ConvertFormState,
  userId: string,
  wallets: Wallet[],
  currencyRates: CurrencyRate[],
  fallbackUsdRate: number,
  operationId: string
): [Record<string, unknown>, Record<string, unknown>] {
  const note = convertNote(form.note);
  const sellQty = Number(form.sourceAmount);
  const buyQty = Number(form.targetAmount);
  const sellPrice = Number(form.sellPriceToman);
  const sellUsd = Number(form.sellUsdRate);
  const buyPrice = Number(form.buyPriceToman);
  const buyUsd = Number(form.buyUsdRate);

  const sellWallet = form.sellTargetWalletId
    ? wallets.find((w) => w.id === form.sellTargetWalletId)
    : undefined;
  const buyWallet = form.buySourceWalletId
    ? wallets.find((w) => w.id === form.buySourceWalletId)
    : undefined;

  const sellWalletAmount = deriveWalletAmount(
    sellQty,
    sellPrice,
    sellWallet,
    currencyRates,
    fallbackUsdRate,
    form.sellUsdRate
  );
  const buyWalletAmount = deriveWalletAmount(
    buyQty,
    buyPrice,
    buyWallet,
    currencyRates,
    fallbackUsdRate,
    form.buyUsdRate
  );

  const sellSnap = computeLegSnapshots(sellQty, sellPrice, sellUsd);
  const buySnap = computeLegSnapshots(buyQty, buyPrice, buyUsd);

  const sellPayload: Record<string, unknown> = {
    user_id: userId,
    type: 'SELL',
    date_string: form.date,
    note,
    operation_id: operationId,
    source_wallet_id: null,
    source_asset_id: form.sourceAssetId,
    source_person_id: null,
    target_wallet_id: form.sellTargetWalletId,
    target_asset_id: null,
    target_person_id: null,
    source_amount: sellQty,
    target_amount: sellWallet ? Number(sellWalletAmount) || null : null,
    category_id: null,
    asset_id: form.sourceAssetId,
    amount: sellQty,
    price_toman: sellPrice,
    usd_rate: sellUsd,
    amount_toman_at_time: sellSnap.toman,
    amount_usd_at_time: sellSnap.usd,
  };

  const buyPayload: Record<string, unknown> = {
    user_id: userId,
    type: 'BUY',
    date_string: form.date,
    note,
    operation_id: operationId,
    source_wallet_id: form.buySourceWalletId,
    source_asset_id: null,
    source_person_id: null,
    target_wallet_id: null,
    target_asset_id: form.targetAssetId,
    target_person_id: null,
    source_amount: buyWallet ? Number(buyWalletAmount) || null : null,
    target_amount: buyQty,
    category_id: null,
    asset_id: form.targetAssetId,
    amount: buyQty,
    price_toman: buyPrice,
    usd_rate: buyUsd,
    amount_toman_at_time: buySnap.toman,
    amount_usd_at_time: buySnap.usd,
  };

  return [sellPayload, buyPayload];
}

export function findConvertPartner(
  tx: Transaction,
  transactions: Transaction[]
): Transaction | null {
  if (!tx.operation_id) return null;
  return (
    transactions.find(
      (row) =>
        row.id !== tx.id &&
        row.operation_id === tx.operation_id &&
        row.type !== tx.type &&
        (row.type === 'BUY' || row.type === 'SELL')
    ) ?? null
  );
}

export function isConvertTransaction(
  tx: Transaction,
  transactions: Transaction[]
): boolean {
  if (tx.operation_id && findConvertPartner(tx, transactions)) return true;
  return (tx.note ?? '').startsWith(CONVERT_NOTE_PREFIX);
}

export function resolveConvertPair(
  tx: Transaction,
  transactions: Transaction[]
): { sell: Transaction; buy: Transaction } | null {
  const partner = findConvertPartner(tx, transactions);
  if (partner) {
    const sell = tx.type === 'SELL' ? tx : partner;
    const buy = tx.type === 'BUY' ? tx : partner;
    if (sell.type === 'SELL' && buy.type === 'BUY') return { sell, buy };
  }

  if (!(tx.note ?? '').startsWith(CONVERT_NOTE_PREFIX)) return null;
  const sameDay = transactions.filter(
    (row) =>
      row.id !== tx.id &&
      row.date_string === tx.date_string &&
      (row.note ?? '').startsWith(CONVERT_NOTE_PREFIX) &&
      row.type !== tx.type
  );
  const partnerFallback = sameDay[0];
  if (!partnerFallback) return null;
  const sell = tx.type === 'SELL' ? tx : partnerFallback;
  const buy = tx.type === 'BUY' ? tx : partnerFallback;
  if (sell.type === 'SELL' && buy.type === 'BUY') return { sell, buy };
  return null;
}

export interface ConvertTransactionGroup {
  operationId: string;
  sell: Transaction;
  buy: Transaction;
}

export function groupConvertTransactions(
  transactions: Transaction[]
): ConvertTransactionGroup[] {
  const groups = new Map<string, ConvertTransactionGroup>();
  for (const tx of transactions) {
    if (tx.type !== 'SELL' && tx.type !== 'BUY') continue;
    const pair = resolveConvertPair(tx, transactions);
    if (!pair) continue;
    const key =
      pair.sell.operation_id ??
      pair.buy.operation_id ??
      `${pair.sell.id}|${pair.buy.id}`;
    if (!groups.has(key)) {
      groups.set(key, {
        operationId: key,
        sell: pair.sell,
        buy: pair.buy,
      });
    }
  }
  return [...groups.values()];
}

export function transactionIdsInConvertGroups(
  transactions: Transaction[]
): Set<string> {
  const ids = new Set<string>();
  for (const group of groupConvertTransactions(transactions)) {
    ids.add(group.sell.id);
    ids.add(group.buy.id);
  }
  return ids;
}

export function countConvertOperations(transactions: Transaction[]): number {
  return groupConvertTransactions(transactions).length;
}
