// Thin wrapper over `jalaali-js`. We declare the shape inline because the
// upstream package ships no `.d.ts`. Keep this module the ONLY place in the
// codebase that talks to jalaali-js — every other caller imports from here.

import * as j from 'jalaali-js';
import { latinizeDigits } from '@/shared/utils/latinize-digits';

export interface JalaaliDate {
  jy: number;
  jm: number; // 1–12
  jd: number; // 1–31
}

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
] as const;

export function todayJalaali(): JalaaliDate {
  const now = new Date();
  const { jy, jm, jd } = j.toJalaali(
    now.getFullYear(),
    now.getMonth() + 1,
    now.getDate()
  );
  return { jy, jm, jd };
}

/** Format as canonical `YYYY/MM/DD` in ASCII digits — matches the shape stored in `transactions.date_string`. */
export function formatJalaali(d: JalaaliDate): string {
  return `${d.jy}/${String(d.jm).padStart(2, '0')}/${String(d.jd).padStart(2, '0')}`;
}

/** Parse whatever the user or DB hands us; tolerates Persian digits, `-`, `/`, and whitespace. */
export function parseJalaali(input: unknown): JalaaliDate | null {
  if (input == null) return null;
  const s = latinizeDigits(String(input)).trim();
  const parts = s.split(/[-/]/);
  if (parts.length !== 3) return null;
  const jy = Number(parts[0]);
  const jm = Number(parts[1]);
  const jd = Number(parts[2]);
  if (!Number.isFinite(jy) || !Number.isFinite(jm) || !Number.isFinite(jd)) return null;
  if (!j.isValidJalaaliDate(jy, jm, jd)) return null;
  return { jy, jm, jd };
}

export function isValidJalaali(jy: number, jm: number, jd: number): boolean {
  return j.isValidJalaaliDate(jy, jm, jd);
}

export function jalaaliMonthLength(jy: number, jm: number): number {
  return j.jalaaliMonthLength(jy, jm);
}

/** Shift a Jalali date by N days, Gregorian-accurate. */
export function addDays(d: JalaaliDate, days: number): JalaaliDate {
  const g = j.toGregorian(d.jy, d.jm, d.jd);
  const gregDate = new Date(g.gy, g.gm - 1, g.gd);
  gregDate.setDate(gregDate.getDate() + days);
  const back = j.toJalaali(
    gregDate.getFullYear(),
    gregDate.getMonth() + 1,
    gregDate.getDate()
  );
  return { jy: back.jy, jm: back.jm, jd: back.jd };
}

/** Human label like «فروردین ۱۴۰۳». Persian digits for display. */
export function formatJalaaliHuman(d: JalaaliDate): string {
  const persian = (n: number) =>
    String(n).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]!);
  return `${persian(d.jd)} ${JALALI_MONTHS[d.jm - 1]} ${persian(d.jy)}`;
}

export function equalsJalaali(a: JalaaliDate, b: JalaaliDate): boolean {
  return a.jy === b.jy && a.jm === b.jm && a.jd === b.jd;
}
