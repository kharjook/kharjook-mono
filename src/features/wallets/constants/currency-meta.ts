import type { Currency, RateCurrency } from '@/shared/types/domain';

export interface CurrencyMeta {
  code: Currency;
  label: string;
  symbol: string;
  /** Max decimal places shown/persisted for amounts in this currency. */
  decimals: number;
}

export const CURRENCY_META: Record<Currency, CurrencyMeta> = {
  IRT: { code: 'IRT', label: 'تومان', symbol: 'ت', decimals: 0 },
  USD: { code: 'USD', label: 'دلار آمریکا', symbol: '$', decimals: 2 },
  TRY: { code: 'TRY', label: 'لیر ترکیه', symbol: '₺', decimals: 2 },
  EUR: { code: 'EUR', label: 'یورو', symbol: '€', decimals: 2 },
};

/** Display order across the app — IRT first since it's the home currency. */
export const CURRENCY_ORDER: Currency[] = ['IRT', 'USD', 'TRY', 'EUR'];

/** Display order for currencies that have a toman_per_unit rate (excludes IRT). */
export const RATE_ORDER: RateCurrency[] = ['USD', 'TRY', 'EUR'];
