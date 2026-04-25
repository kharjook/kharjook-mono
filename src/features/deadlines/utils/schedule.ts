import type { LoanIntervalPeriod } from '@/shared/types/domain';
import {
  addDays,
  formatJalaali,
  jalaaliMonthLength,
  parseJalaali,
} from '@/shared/utils/jalali';
import type { JalaaliDate } from '@/shared/utils/jalali';

function addMonthsClamped(date: JalaaliDate, months: number): JalaaliDate {
  const absoluteMonth = (date.jm - 1) + months;
  const nextYear = date.jy + Math.floor(absoluteMonth / 12);
  const nextMonth = ((absoluteMonth % 12) + 12) % 12 + 1;
  const monthLength = jalaaliMonthLength(nextYear, nextMonth);
  return {
    jy: nextYear,
    jm: nextMonth,
    jd: Math.min(date.jd, monthLength),
  };
}

function addYearsClamped(date: JalaaliDate, years: number): JalaaliDate {
  const nextYear = date.jy + years;
  const monthLength = jalaaliMonthLength(nextYear, date.jm);
  return {
    jy: nextYear,
    jm: date.jm,
    jd: Math.min(date.jd, monthLength),
  };
}

export function addIntervalDate(
  date: JalaaliDate,
  intervalNumber: number,
  intervalPeriod: LoanIntervalPeriod
): JalaaliDate {
  if (intervalPeriod === 'day') return addDays(date, intervalNumber);
  if (intervalPeriod === 'week') return addDays(date, intervalNumber * 7);
  if (intervalPeriod === 'month') return addMonthsClamped(date, intervalNumber);
  return addYearsClamped(date, intervalNumber);
}

export function buildInstallmentSchedule(params: {
  firstDueDate: string;
  repeatCount: number;
  intervalNumber: number;
  intervalPeriod: LoanIntervalPeriod;
}): string[] {
  const first = parseJalaali(params.firstDueDate);
  if (!first) return [];
  const out: string[] = [];
  let cursor = first;
  for (let i = 0; i < params.repeatCount; i += 1) {
    out.push(formatJalaali(cursor));
    cursor = addIntervalDate(cursor, params.intervalNumber, params.intervalPeriod);
  }
  return out;
}
