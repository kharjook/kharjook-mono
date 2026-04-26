import type {
  Asset,
  Currency,
  CurrencyRate,
  DailyPrice,
  Transaction,
  Wallet,
} from '@/shared/types/domain';
import {
  calculateWalletStats,
  walletBalanceThroughDate,
} from '@/shared/utils/calculate-wallet-balance';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { parseDateToNumber } from '@/shared/utils/parse-date';
import { effectivePriceAt } from '@/features/reports/utils/price-history';
import { calculateAssetPeriodStats } from '@/features/reports/utils/asset-period-stats';
import {
  addDays,
  formatJalaali,
  JALALI_MONTHS,
  jalaaliMonthLength,
  type JalaaliDate,
} from '@/shared/utils/jalali';
import type { Period } from '@/shared/utils/period';

/** Net on-hand quantity for `assetId` after all BUY/SELL/INCOME/EXPENSE through date (inclusive). */
export function assetNetAmountThroughDate(
  assetId: string,
  transactions: Transaction[],
  throughDateStr: string
): number {
  const limit = parseDateToNumber(throughDateStr);
  const assetTxs = transactions.filter((tx) => tx.asset_id === assetId);
  const isAcquireType = (t: Transaction['type']) => t === 'BUY' || t === 'INCOME';
  const isDisposeType = (t: Transaction['type']) => t === 'SELL' || t === 'EXPENSE';

  const sortedTxs = [...assetTxs].sort((a, b) => {
    const dateA = parseDateToNumber(a.date_string);
    const dateB = parseDateToNumber(b.date_string);
    if (dateA !== dateB) return dateA - dateB;
    const ra = isAcquireType(a.type) ? 0 : 1;
    const rb = isAcquireType(b.type) ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  let totalAmount = 0;
  for (const tx of sortedTxs) {
    if (parseDateToNumber(tx.date_string) > limit) continue;
    if (!isAcquireType(tx.type) && !isDisposeType(tx.type)) continue;
    const amount = Number(tx.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (isAcquireType(tx.type)) {
      totalAmount += amount;
    } else {
      totalAmount -= amount;
      if (totalAmount <= 0.000001) totalAmount = 0;
    }
  }
  return totalAmount;
}

export interface PortfolioAssetsValueResult {
  valueToman: number;
  valueUsd: number;
  missingPriceCount: number;
}

export function portfolioAssetsValueAtDate(
  assets: Asset[],
  transactions: Transaction[],
  dailyPrices: DailyPrice[],
  todayStr: string,
  asOfDateStr: string
): PortfolioAssetsValueResult {
  let valueToman = 0;
  let valueUsd = 0;
  let missingPriceCount = 0;

  for (const asset of assets) {
    if (asset.include_in_balance === false) continue;
    const qty = assetNetAmountThroughDate(asset.id, transactions, asOfDateStr);
    if (qty <= 0) continue;
    const p = effectivePriceAt(asset, asOfDateStr, dailyPrices, todayStr);
    if (!p) {
      missingPriceCount += 1;
      continue;
    }
    valueToman += qty * p.priceToman;
    valueUsd += qty * p.priceUsd;
  }

  return { valueToman, valueUsd, missingPriceCount };
}

export function portfolioCashTomanAtDate(
  wallets: Wallet[],
  transactions: Transaction[],
  currencyRates: CurrencyRate[],
  asOfDateStr: string
): number {
  let cash = 0;
  for (const w of wallets) {
    const balance = walletBalanceThroughDate(w, transactions, asOfDateStr);
    if (balance <= 0) continue;
    cash += balance * tomanPerUnit(w.currency, currencyRates);
  }
  return cash;
}

export function portfolioTotalTomanAtDate(
  assets: Asset[],
  transactions: Transaction[],
  wallets: Wallet[],
  dailyPrices: DailyPrice[],
  currencyRates: CurrencyRate[],
  todayStr: string,
  asOfDateStr: string
): { totalToman: number; totalUsd: number; missingPriceCount: number } {
  const a = portfolioAssetsValueAtDate(
    assets,
    transactions,
    dailyPrices,
    todayStr,
    asOfDateStr
  );
  const cash = portfolioCashTomanAtDate(
    wallets,
    transactions,
    currencyRates,
    asOfDateStr
  );
  const totalToman = a.valueToman + cash;
  const usdRow = currencyRates.find((r) => r.currency === 'USD');
  const usd = Number(usdRow?.toman_per_unit) || 0;
  const totalUsd = usd > 0 ? totalToman / usd : 0;
  return {
    totalToman,
    totalUsd,
    missingPriceCount: a.missingPriceCount,
  };
}

export type SparklineRange = '7d' | '30d' | '90d' | 'ytd';

export function buildSparklineDateStrings(
  range: SparklineRange,
  today: JalaaliDate,
  todayStr: string,
  maxPoints: number
): string[] {
  if (range === '7d') {
    return Array.from({ length: 7 }, (_, i) =>
      formatJalaali(addDays(today, -6 + i))
    );
  }
  if (range === '30d') {
    return sampleUniformDates(today, 30, maxPoints);
  }
  if (range === '90d') {
    return sampleUniformDates(today, 90, maxPoints);
  }
  // ytd: Farvardin 1 .. today
  const yearStart: JalaaliDate = { jy: today.jy, jm: 1, jd: 1 };
  const endNum = parseDateToNumber(todayStr);
  const all: string[] = [];
  let d = yearStart;
  while (parseDateToNumber(formatJalaali(d)) <= endNum) {
    all.push(formatJalaali(d));
    d = addDays(d, 1);
  }
  if (all.length <= maxPoints) return all;
  const step = Math.ceil(all.length / maxPoints);
  const out: string[] = [];
  for (let i = 0; i < all.length; i += step) out.push(all[i]!);
  if (out[out.length - 1] !== all[all.length - 1]) out.push(all[all.length - 1]!);
  return out;
}

function sampleUniformDates(today: JalaaliDate, spanDays: number, maxPoints: number): string[] {
  const dates: string[] = [];
  const step = Math.max(1, Math.ceil(spanDays / maxPoints));
  for (let i = spanDays - 1; i >= 0; i -= step) {
    dates.push(formatJalaali(addDays(today, -i)));
  }
  const last = formatJalaali(today);
  if (dates[dates.length - 1] !== last) dates.push(last);
  return dates;
}

/** Last calendar day of the Jalali month before `today` (not "one month ago from today"). */
export function endOfPreviousJalaliMonth(today: JalaaliDate): JalaaliDate {
  if (today.jm <= 1) {
    const jy = today.jy - 1;
    return { jy, jm: 12, jd: jalaaliMonthLength(jy, 12) };
  }
  const jm = today.jm - 1;
  return {
    jy: today.jy,
    jm,
    jd: jalaaliMonthLength(today.jy, jm),
  };
}

/** Running P/L from 1 Farvardin through each month-end ( Jalali YTD ), reporting currency. */
export function ytdCumulativeProfitMonthlySeries(
  assets: Asset[],
  transactions: Transaction[],
  dailyPrices: DailyPrice[],
  usdRate: number,
  today: JalaaliDate,
  todayStr: string
): { key: string; label: string; profitToman: number; profitUsd: number }[] {
  const yearStart: JalaaliDate = { jy: today.jy, jm: 1, jd: 1 };
  const points: {
    key: string;
    label: string;
    profitToman: number;
    profitUsd: number;
  }[] = [];

  for (let m = 1; m <= today.jm; m += 1) {
    const end: JalaaliDate =
      m < today.jm
        ? {
            jy: today.jy,
            jm: m,
            jd: jalaaliMonthLength(today.jy, m),
          }
        : today;
    const period: Period = { kind: 'month', start: yearStart, end };
    const endStr = formatJalaali(end);
    let profitToman = 0;
    let profitUsd = 0;

    for (const asset of assets) {
      if (asset.include_in_profit_loss === false) continue;
      const endPrice = effectivePriceAt(asset, endStr, dailyPrices, todayStr);
      const s = calculateAssetPeriodStats(
        asset,
        transactions,
        period,
        usdRate,
        endPrice
      );
      profitToman += s.realizedToman;
      profitUsd += s.realizedUsd;
      if (s.unrealizedAvailable) {
        profitToman += s.unrealizedToman;
        profitUsd += s.unrealizedUsd;
      }
    }

    points.push({
      key: `m${m}`,
      label: JALALI_MONTHS[m - 1]!,
      profitToman,
      profitUsd,
    });
  }

  return points;
}

/** Positive wallet balances only, aggregated in toman at current FX rows. */
export function walletCashTomanByCurrency(
  wallets: Wallet[],
  transactions: Transaction[],
  currencyRates: CurrencyRate[]
): { currency: Currency; toman: number }[] {
  const map = new Map<Currency, number>();
  for (const w of wallets) {
    const b = calculateWalletStats(w, transactions).balance;
    if (b <= 0) continue;
    const t = b * tomanPerUnit(w.currency, currencyRates);
    map.set(w.currency, (map.get(w.currency) ?? 0) + t);
  }
  return Array.from(map.entries())
    .map(([currency, toman]) => ({ currency, toman }))
    .sort((a, b) => b.toman - a.toman);
}
