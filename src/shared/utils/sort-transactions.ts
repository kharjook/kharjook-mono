import type { Transaction } from '@/shared/types/domain';
import { parseDateToNumber } from '@/shared/utils/parse-date';

/** Latest calendar date first; same day → newest `created_at`; then id. */
export function compareTransactionsNewestFirst(
  a: Transaction,
  b: Transaction
): number {
  const da = parseDateToNumber(a.date_string);
  const db = parseDateToNumber(b.date_string);
  if (da !== db) return db - da;
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (ta !== tb) return tb - ta;
  return b.id.localeCompare(a.id);
}

export function sortTransactionsNewestFirst(list: Transaction[]): Transaction[] {
  return list.slice().sort(compareTransactionsNewestFirst);
}
