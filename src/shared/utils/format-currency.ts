import type { CurrencyMode } from '@/shared/types/domain';

export function formatCurrency(
  value: unknown,
  currency: CurrencyMode | string
): string {
  if (value === undefined || value === null) return currency === 'USD' ? '$0' : '0 ت';
  const val = Number(value);
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(Math.abs(val));

  const sign = val < 0 ? '-' : '';
  return currency === 'USD'
    ? `${sign}$${formatted}`
    : `${sign}${formatted} ت`;
}
