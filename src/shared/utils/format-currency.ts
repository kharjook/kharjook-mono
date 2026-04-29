import type { CurrencyMode } from '@/shared/types/domain';

export function getCurrencyFractionDigits(currency: CurrencyMode | string): number {
  if (currency === 'USD') return 2;
  if (currency === 'IRT' || currency === 'TOMAN') return 0;
  return 2;
}

export function formatCurrencyAmount(
  value: unknown,
  currency: CurrencyMode | string
): string {
  const val = Number(value ?? 0);
  const fractionDigits = getCurrencyFractionDigits(currency);
  return new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(val);
}

export function formatCurrency(
  value: unknown,
  currency: CurrencyMode | string
): string {
  if (value === undefined || value === null) {
    const zero = formatCurrencyAmount(0, currency);
    return currency === 'USD' ? `$${zero}` : `${zero} ت`;
  }
  const val = Number(value);
  const formatted = formatCurrencyAmount(Math.abs(val), currency);

  const sign = val < 0 ? '-' : '';
  return currency === 'USD'
    ? `${sign}$${formatted}`
    : `${sign}${formatted} ت`;
}
