/**
 * Jalali period math. A Period is a closed inclusive range [start, end] tagged
 * with a granularity kind. All arithmetic and boundary calculations round-trip
 * through Gregorian via `addDays` to avoid manually tracking leap years.
 *
 * Week convention: Persian week starts Saturday (شنبه). JS Sunday=0, Saturday=6,
 * so "days since Saturday" = (getDay() + 1) % 7.
 */

import {
  addDays,
  formatJalaali,
  formatJalaaliHuman,
  JALALI_MONTHS,
  jalaaliMonthLength,
  parseJalaali,
  todayJalaali,
  type JalaaliDate,
} from '@/shared/utils/jalali';
import * as j from 'jalaali-js';

export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'all';

export interface Period {
  kind: PeriodKind;
  start: JalaaliDate; // inclusive
  end: JalaaliDate;   // inclusive
}

export const PERIOD_KINDS: readonly PeriodKind[] = ['day', 'week', 'month', 'year', 'all'];
const ALL_START: JalaaliDate = { jy: 1300, jm: 1, jd: 1 };

const PERSIAN_DIGITS = (s: string | number) =>
  String(s).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]!);

/** YYYYMMDD packed as a number — ordered comparison on Jalali dates. */
export function jalaaliToNumber(d: JalaaliDate): number {
  return d.jy * 10000 + d.jm * 100 + d.jd;
}

export function cmpJalaali(a: JalaaliDate, b: JalaaliDate): number {
  return jalaaliToNumber(a) - jalaaliToNumber(b);
}

/** Saturday-start of the week containing `d`. */
export function startOfWeek(d: JalaaliDate): JalaaliDate {
  const g = j.toGregorian(d.jy, d.jm, d.jd);
  const dt = new Date(g.gy, g.gm - 1, g.gd);
  const offset = (dt.getDay() + 1) % 7; // Sat=0 … Fri=6
  return addDays(d, -offset);
}

export function periodContaining(kind: PeriodKind, d: JalaaliDate): Period {
  switch (kind) {
    case 'day':
      return { kind, start: d, end: d };
    case 'week': {
      const start = startOfWeek(d);
      const end = addDays(start, 6);
      return { kind, start, end };
    }
    case 'month': {
      const start: JalaaliDate = { jy: d.jy, jm: d.jm, jd: 1 };
      const end: JalaaliDate = { jy: d.jy, jm: d.jm, jd: jalaaliMonthLength(d.jy, d.jm) };
      return { kind, start, end };
    }
    case 'year': {
      const start: JalaaliDate = { jy: d.jy, jm: 1, jd: 1 };
      const end: JalaaliDate = { jy: d.jy, jm: 12, jd: jalaaliMonthLength(d.jy, 12) };
      return { kind, start, end };
    }
    case 'all':
      return { kind, start: ALL_START, end: todayJalaali() };
  }
}

export function currentPeriod(kind: PeriodKind): Period {
  return periodContaining(kind, todayJalaali());
}

/**
 * Shift the period by `delta` buckets of its own kind. Positive moves forward.
 * Uses the start-of-current-period as the anchor to avoid drift when shifting
 * repeatedly (e.g. week → shift(+1) → week lands on the next Saturday exactly).
 */
export function shiftPeriod(p: Period, delta: number): Period {
  if (delta === 0) return p;
  switch (p.kind) {
    case 'day':
      return periodContaining('day', addDays(p.start, delta));
    case 'week':
      return periodContaining('week', addDays(p.start, delta * 7));
    case 'month': {
      const total = p.start.jm - 1 + delta;
      // Jalali months are 1..12; `total` can be any integer.
      const jy = p.start.jy + Math.floor(total / 12);
      const jm = ((total % 12) + 12) % 12 + 1;
      return periodContaining('month', { jy, jm, jd: 1 });
    }
    case 'year':
      return periodContaining('year', { jy: p.start.jy + delta, jm: 1, jd: 1 });
    case 'all':
      return p;
  }
}

export function isCurrentPeriod(p: Period): boolean {
  const today = todayJalaali();
  return cmpJalaali(today, p.start) >= 0 && cmpJalaali(today, p.end) <= 0;
}

/** Pure string check — safely handles Persian digits, `-` vs `/`, padding. */
export function isInPeriod(dateString: string, p: Period): boolean {
  const parsed = parseJalaali(dateString);
  if (!parsed) return false;
  const n = jalaaliToNumber(parsed);
  return n >= jalaaliToNumber(p.start) && n <= jalaaliToNumber(p.end);
}

// ─── Labels ──────────────────────────────────────────────────────────────────

export function formatPeriodLabel(p: Period): string {
  switch (p.kind) {
    case 'day':
      return formatJalaaliHuman(p.start);
    case 'week': {
      if (p.start.jy === p.end.jy && p.start.jm === p.end.jm) {
        return `${PERSIAN_DIGITS(p.start.jd)} تا ${PERSIAN_DIGITS(p.end.jd)} ${
          JALALI_MONTHS[p.start.jm - 1]
        } ${PERSIAN_DIGITS(p.start.jy)}`;
      }
      return `${formatJalaaliHuman(p.start)} تا ${formatJalaaliHuman(p.end)}`;
    }
    case 'month':
      return `${JALALI_MONTHS[p.start.jm - 1]} ${PERSIAN_DIGITS(p.start.jy)}`;
    case 'year':
      return `سال ${PERSIAN_DIGITS(p.start.jy)}`;
    case 'all':
      return 'از ابتدا';
  }
}

export function formatPeriodKindLabel(kind: PeriodKind): string {
  switch (kind) {
    case 'day':   return 'روز';
    case 'week':  return 'هفته';
    case 'month': return 'ماه';
    case 'year':  return 'سال';
    case 'all':   return 'از ابتدا';
  }
}

export function formatCurrentPeriodLabel(kind: PeriodKind): string {
  switch (kind) {
    case 'day':   return 'امروز';
    case 'week':  return 'این هفته';
    case 'month': return 'این ماه';
    case 'year':  return 'امسال';
    case 'all':   return 'از ابتدا';
  }
}

// ─── URL codec ───────────────────────────────────────────────────────────────

export function encodePeriodParams(p: Period): { period: PeriodKind; d: string } {
  return { period: p.kind, d: formatJalaali(p.start) };
}

export function decodePeriodParams(
  period: string | null | undefined,
  d: string | null | undefined
): Period {
  const kind: PeriodKind = PERIOD_KINDS.includes(period as PeriodKind)
    ? (period as PeriodKind)
    : 'month';
  const parsed = parseJalaali(d ?? '') ?? todayJalaali();
  return periodContaining(kind, parsed);
}
