import type { CurrencyRate, Wallet } from '@/shared/types/domain';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import type { EndpointKind } from '@/features/transactions/components/EndpointSheetPicker';

export type ExpenseFormFields = {
  sourceKind: EndpointKind | null;
  sourceId: string | null;
  sourceAmount: string;
  categoryId: string | null;
  priceToman: string;
  usdRate: string;
};

function walletRateForExpense(
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

export function computeExpenseAmountSnapshots(
  form: ExpenseFormFields,
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
    const explicit = Number(form.priceToman);
    const price =
      Number.isFinite(explicit) && explicit > 0
        ? explicit
        : walletRateForExpense(w, currencyRates, fallbackUsdRate, form.usdRate);
    if (!(price > 0)) return { toman: null, usd: null };
    return computeFromAmountPrice(amount, price);
  }

  if (form.sourceKind === 'person') {
    return computeFromAmountPrice(amount, 1);
  }

  return { toman: null, usd: null };
}

export function applyExpensePayloadFields(
  base: Record<string, unknown>,
  form: ExpenseFormFields
): void {
  if (form.sourceKind === 'wallet') base.source_wallet_id = form.sourceId;
  else if (form.sourceKind === 'asset') base.source_asset_id = form.sourceId;
  else if (form.sourceKind === 'person') base.source_person_id = form.sourceId;

  const amount = Number(form.sourceAmount);
  if (Number.isFinite(amount) && amount > 0) base.source_amount = amount;

  base.category_id = form.categoryId;

  if (form.sourceKind === 'asset') {
    base.asset_id = form.sourceId;
    base.amount = Number(form.sourceAmount);
    base.price_toman = Number(form.priceToman);
    base.usd_rate = Number(form.usdRate);
  }
}
