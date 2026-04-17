import { latinizeDigits } from '@/shared/utils/latinize-digits';

/** Parse date strings (slashes/dashes; tolerates Persian digits in stored values). */
export function parseDateToNumber(dateStr: unknown): number {
  if (!dateStr) return 0;
  const normalized = latinizeDigits(dateStr);

  const parts = normalized.split(/[-/_\s]/);
  if (parts.length >= 3) {
    const y = parts[0]!;
    const m = parts[1]!.padStart(2, '0');
    const d = parts[2]!.padStart(2, '0');
    return parseInt(y + m + d, 10);
  }

  return parseInt(normalized.replace(/\D/g, ''), 10) || 0;
}
