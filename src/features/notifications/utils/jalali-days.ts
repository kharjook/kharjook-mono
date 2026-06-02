import * as j from 'jalaali-js';
import { parseJalaali, todayJalaali, type JalaaliDate } from '@/shared/utils/jalali';
import { jalaaliToNumber } from '@/shared/utils/period';

/** Inclusive calendar days from `from` to `to` (Jalali date strings). */
export function daysBetweenJalaali(from: string, to: string): number | null {
  const a = parseJalaali(from);
  const b = parseJalaali(to);
  if (!a || !b) return null;
  const ga = j.toGregorian(a.jy, a.jm, a.jd);
  const gb = j.toGregorian(b.jy, b.jm, b.jd);
  const da = Date.UTC(ga.gy, ga.gm - 1, ga.gd);
  const db = Date.UTC(gb.gy, gb.gm - 1, gb.gd);
  return Math.round((db - da) / 86_400_000);
}

export function isDueForReminder(
  dueDateString: string,
  today: JalaaliDate = todayJalaali()
): number | null {
  const todayStr = `${today.jy}/${String(today.jm).padStart(2, '0')}/${String(today.jd).padStart(2, '0')}`;
  const diff = daysBetweenJalaali(todayStr, dueDateString);
  if (diff == null || diff < 0) return null;
  return diff;
}

export function compareJalaaliStrings(a: string, b: string): number {
  const pa = parseJalaali(a);
  const pb = parseJalaali(b);
  if (!pa || !pb) return 0;
  return jalaaliToNumber(pa) - jalaaliToNumber(pb);
}
