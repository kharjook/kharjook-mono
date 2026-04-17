import { latinizeDigits } from '@/shared/utils/latinize-digits';

/** Strip thousand separators before parsing. */
function stripGrouping(s: string): string {
  return s.replace(/[,\s\u202f]/g, '');
}

/**
 * Normalizes a user-visible numeric field to a canonical string: ASCII digits
 * and at most one `.` (no thousand separators).
 */
export function parseFormattedNumberToCanonical(input: string): string {
  const normalized = latinizeDigits(stripGrouping(input));
  let out = '';
  let dotSeen = false;
  for (const ch of normalized) {
    if (ch === '.') {
      if (!dotSeen) {
        out += ch;
        dotSeen = true;
      }
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      out += ch;
    }
  }
  return out;
}

/**
 * Formats canonical numeric input for display (en-US grouping, Latin digits).
 * Client-only; persisted values stay plain numbers.
 */
export function formatCanonicalNumberDisplay(canonical: string): string {
  if (canonical === '') return '';

  const endsWithBareDot =
    canonical.endsWith('.') && canonical.split('.').length <= 2;
  const core = endsWithBareDot ? canonical.slice(0, -1) : canonical;

  const dotIdx = core.indexOf('.');
  const intRaw = dotIdx === -1 ? core : core.slice(0, dotIdx);
  const fracRaw = dotIdx === -1 ? '' : core.slice(dotIdx + 1);

  let intFormatted: string;
  if (intRaw === '') {
    intFormatted = '0';
  } else {
    const normalized = intRaw.replace(/^0+(?=\d)/, '') || '0';
    intFormatted = BigInt(normalized).toLocaleString('en-US');
  }

  if (fracRaw === '' && !endsWithBareDot) {
    return intFormatted;
  }
  if (fracRaw === '' && endsWithBareDot) {
    return `${intFormatted}.`;
  }
  return `${intFormatted}.${fracRaw}`;
}
