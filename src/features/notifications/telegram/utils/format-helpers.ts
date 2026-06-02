const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => PERSIAN[Number(d)]!);
}

export function formatTelegramMoney(
  value: number,
  currency: 'TOMAN' | 'USD'
): string {
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: currency === 'USD' ? 2 : 0,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(abs);
  const persian = toPersianDigits(formatted);
  if (currency === 'USD') {
    return value < 0 ? `−$${persian}` : `$${persian}`;
  }
  return value < 0 ? `−${persian} تومان` : `${persian} تومان`;
}

export const TELEGRAM_SEPARATOR = '━━━━━━━━━━━━━━━━';

export const JALALI_WEEKDAY_NAMES = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنجشنبه',
  'جمعه',
] as const;
