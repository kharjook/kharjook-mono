export type DisplayDigitStyle = 'persian' | 'latin';

export interface FormatDisplayNumberOptions {
  /** Persian (۰-۹) or Latin (0-9) digits in output. Default: persian. */
  digits?: DisplayDigitStyle;
  /** Group thousands with locale separators. Default: true. */
  grouping?: boolean;
  /** Fixed decimal places; omit to preserve input precision. */
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
}

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;

function toPersianDigits(value: string): string {
  return value.replace(/\d/g, (d) => PERSIAN_DIGITS[Number(d)] ?? d);
}

/**
 * Single display policy for numeric UI strings.
 * Use latin digits only inside inputs (`FormattedNumberInput`) and API payloads.
 */
export function formatDisplayNumber(
  value: number,
  options: FormatDisplayNumberOptions = {}
): string {
  const {
    digits = 'persian',
    grouping = true,
    maximumFractionDigits,
    minimumFractionDigits,
  } = options;

  if (!Number.isFinite(value)) return digits === 'persian' ? '۰' : '0';

  const formatted = grouping
    ? value.toLocaleString('en-US', {
        maximumFractionDigits,
        minimumFractionDigits,
      })
    : String(value);

  return digits === 'persian' ? toPersianDigits(formatted) : formatted;
}
