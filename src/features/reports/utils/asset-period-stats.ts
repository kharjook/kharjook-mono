/**
 * Per-asset P/L for a Jalali period.
 *
 * Model:
 *  - Replay every asset-touching tx (BUY/SELL and asset-side
 *    INCOME/EXPENSE) in chronological order so the running average
 *    cost-basis reflects all prior activity — we can't compute
 *    realized P/L on period sells without the cost basis they drain.
 *  - Asset-side INCOME is treated as a BUY: new units enter the book
 *    at the user-provided `price_toman` (market at receipt). That's
 *    the only honest cost basis we can establish without separate
 *    "received-for-free" semantics.
 *  - Asset-side EXPENSE is treated as a SELL: units leave the book at
 *    the user-provided `price_toman`, realizing P/L against the
 *    running average cost (units × (price − avgCost)). Same math in
 *    USD using each tx's own `usd_rate`.
 *  - A SELL charges against the running average cost; realized P/L
 *    = units sold × (sell price − avg cost). Same math in USD using each
 *    tx's own `usd_rate` (falling back to today's rate only if missing).
 *  - Avg buy/sell *for the period* is quantity-weighted over txs dated
 *    inside the period. INCOME rolls into `bought`; EXPENSE into `sold`.
 *  - Unrealized P/L is marked to the PRICE-AT-PERIOD-END, not the live
 *    price. The caller must resolve that via `effectivePriceAt` (see
 *    `price-history.ts`) and pass it in. When the caller has no price
 *    for that date we signal `unrealizedAvailable = false` rather than
 *    silently fabricating a number — accurate > convenient for a
 *    finance app. If the position is flat at period end (endHoldings
 *    = 0), unrealized is trivially 0 and `unrealizedAvailable = true`
 *    regardless of price.
 */

import type { Asset, Transaction } from '@/shared/types/domain';
import { parseDateToNumber } from '@/shared/utils/parse-date';
import { isInPeriod, jalaaliToNumber, type Period } from '@/shared/utils/period';
import type { EffectivePrice } from './price-history';

export interface SideAggregate {
  units: number;
  totalToman: number;
  totalUsd: number;
  avgPriceToman: number; // qty-weighted average within the period
  avgPriceUsd: number;
  count: number;
}

export interface AssetPeriodStats {
  assetId: string;
  bought: SideAggregate;
  sold: SideAggregate;
  realizedToman: number; // booked from period SELLs only
  realizedUsd: number;
  /** Holdings + cost basis at the end of the period. */
  endHoldings: number;
  endCostBasisToman: number;
  endCostBasisUsd: number;
  endAvgCostToman: number;
  endAvgCostUsd: number;
  /** Holdings + cost basis right now (= after replaying every tx). */
  currentHoldings: number;
  currentCostBasisToman: number;
  currentCostBasisUsd: number;
  currentAvgCostToman: number;
  currentAvgCostUsd: number;
  /**
   * Mark-to-market at period end: endHoldings × price-at-period-end
   * minus endCostBasis.
   *
   * `unrealizedAvailable` is false ONLY when the position at period end
   * was non-zero AND no snapshot price existed on or before that date.
   * When false, `unrealizedToman/Usd` are 0 (placeholders — callers must
   * gate on the availability flag before displaying).
   */
  unrealizedToman: number;
  unrealizedUsd: number;
  unrealizedAvailable: boolean;
  /** The price used for the mark (null if unavailable / no holdings). */
  periodEndPriceToman: number | null;
  periodEndPriceUsd: number | null;
  /** Date the snapshot was actually taken on; null when using live cache or no price. */
  periodEndPriceSourceDate: string | null;
  periodEndPriceIsLive: boolean;
  hadActivity: boolean;
}

function emptySide(): SideAggregate {
  return {
    units: 0,
    totalToman: 0,
    totalUsd: 0,
    avgPriceToman: 0,
    avgPriceUsd: 0,
    count: 0,
  };
}

export function emptyAssetPeriodStats(assetId: string): AssetPeriodStats {
  return {
    assetId,
    bought: emptySide(),
    sold: emptySide(),
    realizedToman: 0,
    realizedUsd: 0,
    endHoldings: 0,
    endCostBasisToman: 0,
    endCostBasisUsd: 0,
    endAvgCostToman: 0,
    endAvgCostUsd: 0,
    currentHoldings: 0,
    currentCostBasisToman: 0,
    currentCostBasisUsd: 0,
    currentAvgCostToman: 0,
    currentAvgCostUsd: 0,
    unrealizedToman: 0,
    unrealizedUsd: 0,
    unrealizedAvailable: true,
    periodEndPriceToman: null,
    periodEndPriceUsd: null,
    periodEndPriceSourceDate: null,
    periodEndPriceIsLive: false,
    hadActivity: false,
  };
}

function finalizeSide(s: SideAggregate): void {
  s.avgPriceToman = s.units > 0 ? s.totalToman / s.units : 0;
  s.avgPriceUsd = s.units > 0 ? s.totalUsd / s.units : 0;
}

/**
 * Normalize the cost-basis / proceeds side of any asset-touching tx into
 * unified `(amount, priceToman, priceUsd)`. Handles:
 *   - BUY / SELL (legacy + polymorphic columns)
 *   - Asset-side INCOME (target_asset_id populated)
 *   - Asset-side EXPENSE (source_asset_id populated)
 *
 * For new asset-side INCOME/EXPENSE, `buildPayload` also fills the
 * legacy `amount`, `price_toman`, `usd_rate` columns so this function
 * doesn't need type-specific branching. If either value is missing or
 * non-positive, we return null and the caller skips the row — a silent
 * drop is preferable to fabricating numbers.
 */
function readTrade(
  tx: Transaction,
  usdRateFallback: number
): { amount: number; priceToman: number; priceUsd: number } | null {
  const polyAmount =
    tx.type === 'BUY' || tx.type === 'INCOME'
      ? tx.target_amount
      : tx.source_amount;
  const amount = Number(tx.amount ?? polyAmount);

  let priceToman = Number(tx.price_toman);
  if (!Number.isFinite(priceToman) || priceToman <= 0) {
    // Only BUY/SELL can derive priceToman from the counterparty wallet
    // amount — INCOME/EXPENSE have no wallet counterparty on the asset
    // side, so they MUST carry `price_toman`.
    if (tx.type === 'BUY' || tx.type === 'SELL') {
      const money = Number(tx.type === 'BUY' ? tx.source_amount : tx.target_amount);
      if (Number.isFinite(money) && money > 0 && Number.isFinite(amount) && amount > 0) {
        priceToman = money / amount;
      }
    }
  }
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(priceToman) || priceToman <= 0) return null;
  const rate = Number(tx.usd_rate) > 0 ? Number(tx.usd_rate) : usdRateFallback;
  if (!(rate > 0)) return null;
  return { amount, priceToman, priceUsd: priceToman / rate };
}

/**
 * True when a tx adds units to the asset's book (BUY or asset-side
 * INCOME with the asset as target). Asset-side INCOME from `buildPayload`
 * also writes `asset_id` = target.
 */
function isAcquireForAsset(tx: Transaction, assetId: string): boolean {
  if (tx.type === 'BUY') {
    return tx.asset_id === assetId || tx.target_asset_id === assetId;
  }
  if (tx.type === 'INCOME') {
    return tx.target_asset_id === assetId || tx.asset_id === assetId;
  }
  return false;
}

function isDisposeForAsset(tx: Transaction, assetId: string): boolean {
  if (tx.type === 'SELL') {
    return tx.asset_id === assetId || tx.source_asset_id === assetId;
  }
  if (tx.type === 'EXPENSE') {
    return tx.source_asset_id === assetId || tx.asset_id === assetId;
  }
  return false;
}

export function calculateAssetPeriodStats(
  asset: Asset,
  transactions: Transaction[],
  period: Period,
  usdRateFallback: number,
  /**
   * Price of the asset AT THE END OF `period`, resolved by the caller
   * via `effectivePriceAt`. Pass `null` when no snapshot exists — we
   * will flag `unrealizedAvailable = false` unless the period-end
   * position is flat (in which case unrealized is trivially 0).
   */
  periodEndPrice: EffectivePrice | null
): AssetPeriodStats {
  // Filter to every asset-touching tx: BUY/SELL plus asset-side
  // INCOME/EXPENSE (which `buildPayload` writes with `asset_id`, `amount`,
  // `price_toman`, `usd_rate` populated so the replay math is uniform).
  const assetTxs = transactions.filter((tx) => {
    if (isAcquireForAsset(tx, asset.id)) return true;
    if (isDisposeForAsset(tx, asset.id)) return true;
    return false;
  });

  const acquireRank = (tx: Transaction) =>
    isAcquireForAsset(tx, asset.id) ? 0 : 1;

  const sorted = [...assetTxs].sort((a, b) => {
    const da = parseDateToNumber(a.date_string);
    const db = parseDateToNumber(b.date_string);
    if (da !== db) return da - db;
    // Same-day convention: acquisitions (BUY / asset-INCOME) before
    // disposals (SELL / asset-EXPENSE) so a same-day buy-then-sell
    // cost-bases correctly.
    const ra = acquireRank(a);
    const rb = acquireRank(b);
    if (ra !== rb) return ra - rb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const stats = emptyAssetPeriodStats(asset.id);
  const endNum = jalaaliToNumber(period.end);

  let units = 0;
  let costToman = 0;
  let costUsd = 0;

  let endUnits = 0;
  let endCostToman = 0;
  let endCostUsd = 0;
  let snapshotted = false;

  for (const tx of sorted) {
    const trade = readTrade(tx, usdRateFallback);
    if (!trade) continue;
    const { amount, priceToman, priceUsd } = trade;

    // Snapshot end-of-period state the moment we step past the period.
    const txNum = parseDateToNumber(tx.date_string);
    if (!snapshotted && txNum > endNum) {
      endUnits = units;
      endCostToman = costToman;
      endCostUsd = costUsd;
      snapshotted = true;
    }

    const inPeriod = isInPeriod(tx.date_string, period);
    const isAcquire = isAcquireForAsset(tx, asset.id);

    if (isAcquire) {
      units += amount;
      costToman += amount * priceToman;
      costUsd += amount * priceUsd;

      if (inPeriod) {
        stats.bought.units += amount;
        stats.bought.totalToman += amount * priceToman;
        stats.bought.totalUsd += amount * priceUsd;
        stats.bought.count += 1;
        stats.hadActivity = true;
      }
    } else {
      const avgT = units > 0 ? costToman / units : 0;
      const avgU = units > 0 ? costUsd / units : 0;
      const drain = Math.min(amount, units);

      if (inPeriod) {
        stats.realizedToman += drain * (priceToman - avgT);
        stats.realizedUsd += drain * (priceUsd - avgU);
        stats.sold.units += amount;
        stats.sold.totalToman += amount * priceToman;
        stats.sold.totalUsd += amount * priceUsd;
        stats.sold.count += 1;
        stats.hadActivity = true;
      }

      units -= drain;
      costToman -= drain * avgT;
      costUsd -= drain * avgU;

      // Kill FP noise when the position goes flat (mirrors
      // calculate-asset-stats).
      if (units <= 1e-6) {
        units = 0;
        costToman = 0;
        costUsd = 0;
      }
    }
  }

  // If every tx was in-or-before the period, the snapshot equals the
  // final state after replay.
  if (!snapshotted) {
    endUnits = units;
    endCostToman = costToman;
    endCostUsd = costUsd;
  }

  stats.endHoldings = endUnits;
  stats.endCostBasisToman = endCostToman;
  stats.endCostBasisUsd = endCostUsd;
  stats.endAvgCostToman = endUnits > 0 ? endCostToman / endUnits : 0;
  stats.endAvgCostUsd = endUnits > 0 ? endCostUsd / endUnits : 0;

  stats.currentHoldings = units;
  stats.currentCostBasisToman = costToman;
  stats.currentCostBasisUsd = costUsd;
  stats.currentAvgCostToman = units > 0 ? costToman / units : 0;
  stats.currentAvgCostUsd = units > 0 ? costUsd / units : 0;

  // ----- Unrealized at period end -----
  //
  // Three cases, in priority order:
  //  (a) Flat at period end → unrealized is trivially 0, available.
  //  (b) Non-zero holdings + price available → compute mark-to-market.
  //  (c) Non-zero holdings + no price → flag unavailable; values stay 0.
  if (endUnits <= 0) {
    stats.unrealizedAvailable = true;
    stats.unrealizedToman = 0;
    stats.unrealizedUsd = 0;
  } else if (periodEndPrice) {
    stats.unrealizedAvailable = true;
    stats.unrealizedToman = endUnits * periodEndPrice.priceToman - endCostToman;
    stats.unrealizedUsd = endUnits * periodEndPrice.priceUsd - endCostUsd;
    stats.periodEndPriceToman = periodEndPrice.priceToman;
    stats.periodEndPriceUsd = periodEndPrice.priceUsd;
    stats.periodEndPriceSourceDate = periodEndPrice.isLive
      ? null
      : periodEndPrice.sourceDate;
    stats.periodEndPriceIsLive = periodEndPrice.isLive;
  } else {
    stats.unrealizedAvailable = false;
  }

  finalizeSide(stats.bought);
  finalizeSide(stats.sold);

  return stats;
}
