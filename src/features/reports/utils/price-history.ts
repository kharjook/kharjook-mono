import type { Asset, DailyPrice } from '@/shared/types/domain';

/**
 * Resolved price for an asset on a specific Jalali date.
 *
 *  - `isLive`    = true when the value came from the live `assets.price_*`
 *                  cache (i.e. target date is today or in the future).
 *  - `sourceDate` = the canonical Jalali "YYYY/MM/DD" the value was
 *                  recorded on. For live reads this equals `todayDate`.
 */
export interface EffectivePrice {
  priceToman: number;
  priceUsd: number;
  sourceDate: string;
  isLive: boolean;
}

/**
 * Resolve the effective price of `asset` as of `targetDate`, choosing
 * between the live cache (`assets.price_*`) and the historical snapshots
 * in `daily_prices` using the following strict rules:
 *
 *   targetDate >= todayDate:
 *     Return the live cache. This is the only source that can speak for
 *     today / the future and it's what every other screen in the app
 *     already uses.
 *
 *   targetDate <  todayDate:
 *     Look up the MAX `date_string` row for this asset with
 *     `date_string <= targetDate`. If none exists, return `null` — we
 *     refuse to invent a price. Callers MUST render an explicit
 *     "no data" state; silently falling back to the live cache would
 *     corrupt historical unrealized-P/L calculations (which was the
 *     entire reason this module exists).
 *
 * Canonical Jalali "YYYY/MM/DD" strings sort chronologically under
 * lexicographic comparison — relied on throughout.
 *
 * Zero / negative cache values are treated as "unset" and return null.
 *
 * This function is O(n) in `dailyPrices` length. For the typical user
 * with a few hundred snapshot rows this is fine; if it ever becomes
 * hot, pre-group by asset at call site.
 */
export function effectivePriceAt(
  asset: Asset,
  targetDate: string,
  dailyPrices: DailyPrice[],
  todayDate: string
): EffectivePrice | null {
  if (targetDate >= todayDate) {
    const toman = Number(asset.price_toman);
    const usd = Number(asset.price_usd);
    if (!Number.isFinite(toman) || toman <= 0) return null;
    if (!Number.isFinite(usd) || usd < 0) return null;
    return {
      priceToman: toman,
      priceUsd: usd,
      sourceDate: todayDate,
      isLive: true,
    };
  }

  let best: DailyPrice | null = null;
  for (const p of dailyPrices) {
    if (p.asset_id !== asset.id) continue;
    if (p.date_string > targetDate) continue;
    if (!best || p.date_string > best.date_string) best = p;
  }
  if (!best) return null;

  const toman = Number(best.price_toman);
  const usd = Number(best.price_usd);
  if (!Number.isFinite(toman) || toman < 0) return null;
  if (!Number.isFinite(usd) || usd < 0) return null;

  return {
    priceToman: toman,
    priceUsd: usd,
    sourceDate: best.date_string,
    isLive: false,
  };
}
