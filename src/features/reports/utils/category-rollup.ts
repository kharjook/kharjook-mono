/**
 * Category tree + rollup for income/expense reports.
 *
 * We SUM the per-row snapshots written at transaction time:
 *   - `amount_toman_at_time`
 *   - `amount_usd_at_time`
 * The `currencyMode` param picks which column is summed.
 *
 * This is the only way to produce historically-accurate reports in an
 * inflationary economy: converting a past transaction through today's
 * currency_rates would silently rewrite history as rates move.
 *
 * Rows with a NULL snapshot (only legacy INCOME/EXPENSE that couldn't be
 * backfilled, e.g. the user had no USD rate at migration time) are
 * EXCLUDED from totals and counted in `unpricedCount` so the UI can
 * surface the gap. We deliberately do NOT fall back to today's rate —
 * silently fabricating numbers is exactly what we're trying to kill.
 *
 * Wallet filter:
 *   - `walletId = null` → app-wide.
 *   - `walletId = <id>` → only rows whose wallet endpoint matches.
 *     Asset-endpoint rows are EXCLUDED from wallet-scoped views (they
 *     don't live in a wallet). Filter to asset via UI in future if needed.
 *
 * Orphan categories (parent in a different kind) surface as roots so
 * nothing silently disappears.
 */

import type {
  Category,
  CategoryKind,
  CurrencyMode,
  Transaction,
  Wallet,
} from '@/shared/types/domain';
import { isInPeriod, type Period } from '@/shared/utils/period';

export type CashflowKind = Extract<CategoryKind, 'income' | 'expense'>;

export interface RollupNode {
  id: string;
  name: string;
  color: string;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  /** Own transactions only, in the requested currency. */
  own: number;
  /** Own + descendants, in the requested currency. */
  rolled: number;
  /** Count of direct-tagged transactions in period (own only). */
  txCount: number;
}

export interface RollupResult {
  nodes: RollupNode[];
  /** Grand total in the requested currency for this kind/period/filter. */
  total: number;
  childrenOf: Map<string, string[]>;
  uncategorized: {
    total: number;
    count: number;
  };
  /**
   * Rows matching the filter but whose snapshot is NULL (un-backfillable
   * legacy). Not included in `total` / `own` / `rolled`. UI should surface
   * this so the user can retro-edit those rows.
   */
  unpricedCount: number;
}

export interface RollupInput {
  transactions: Transaction[];
  categories: Category[];
  wallets: Wallet[];
  period: Period;
  kind: CashflowKind;
  /** `null` = app-wide. Wallet-scoped views exclude asset-endpoint rows. */
  walletId: string | null;
  currencyMode: CurrencyMode;
}

/**
 * Resolve the snapshot for the right side of an INCOME/EXPENSE tx and
 * return the wallet id (if wallet endpoint) so the wallet-filter can
 * apply. Asset endpoints return walletId=null and can only contribute
 * when the filter is app-wide.
 */
function txCashflow(
  tx: Transaction,
  kind: CashflowKind,
  mode: CurrencyMode
): {
  value: number | null;
  walletId: string | null;
  isAsset: boolean;
} {
  const snapshot = mode === 'TOMAN' ? tx.amount_toman_at_time : tx.amount_usd_at_time;
  const value = snapshot == null ? null : Number(snapshot);

  const walletId = kind === 'income' ? tx.target_wallet_id : tx.source_wallet_id;
  const assetId = kind === 'income' ? tx.target_asset_id : tx.source_asset_id;
  const isAsset = !walletId && !!assetId;

  return { value, walletId, isAsset };
}

export function rollupCategories(input: RollupInput): RollupResult {
  const { transactions, categories, period, kind, walletId, currencyMode } = input;

  // 1) Bucket txs into own totals per category.
  const ownByCat = new Map<string, { amount: number; count: number }>();
  let uncategorizedTotal = 0;
  let uncategorizedCount = 0;
  let unpricedCount = 0;
  const targetType = kind === 'income' ? 'INCOME' : 'EXPENSE';

  for (const tx of transactions) {
    if (tx.type !== targetType) continue;
    if (!isInPeriod(tx.date_string, period)) continue;

    const { value, walletId: txWalletId, isAsset } = txCashflow(tx, kind, currencyMode);

    // Wallet-scoped view excludes asset-endpoint transactions outright.
    // (They can't meaningfully be assigned to a "wallet filter".)
    if (walletId) {
      if (isAsset) continue;
      if (txWalletId !== walletId) continue;
    }

    if (value == null || !Number.isFinite(value) || value <= 0) {
      // Row matched period + filter but has no snapshot → unpriced.
      // Skip value but track so UI can flag it.
      if (value == null) unpricedCount += 1;
      continue;
    }

    const catId = tx.category_id;
    if (catId) {
      const cur = ownByCat.get(catId) ?? { amount: 0, count: 0 };
      cur.amount += value;
      cur.count += 1;
      ownByCat.set(catId, cur);
    } else {
      uncategorizedTotal += value;
      uncategorizedCount += 1;
    }
  }

  // 2) Build forest scoped to the kind.
  const scoped = categories.filter((c) => c.kind === kind);
  const scopedIds = new Set(scoped.map((c) => c.id));
  const childrenOf = new Map<string, string[]>();
  const roots: Category[] = [];

  for (const c of scoped) {
    if (c.parent_id && scopedIds.has(c.parent_id)) {
      const arr = childrenOf.get(c.parent_id) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parent_id, arr);
    } else {
      roots.push(c);
    }
  }

  // 3) Post-order rollup so parents see final child totals.
  const rolledById = new Map<string, number>();
  const visitRollup = (id: string): number => {
    const own = ownByCat.get(id)?.amount ?? 0;
    const children = childrenOf.get(id) ?? [];
    let sum = own;
    for (const cid of children) sum += visitRollup(cid);
    rolledById.set(id, sum);
    return sum;
  };
  for (const r of roots) visitRollup(r.id);

  // 4) Pre-order flatten for UI, sorted at each level by rolled desc then name.
  const byId = new Map(scoped.map((c) => [c.id, c]));
  const nodes: RollupNode[] = [];
  const visitFlat = (id: string, depth: number) => {
    const c = byId.get(id);
    if (!c) return;
    const own = ownByCat.get(id)?.amount ?? 0;
    const count = ownByCat.get(id)?.count ?? 0;
    const rolled = rolledById.get(id) ?? 0;
    const children = childrenOf.get(id) ?? [];
    nodes.push({
      id,
      name: c.name,
      color: c.color,
      depth,
      parentId: c.parent_id && scopedIds.has(c.parent_id) ? c.parent_id : null,
      hasChildren: children.length > 0,
      own,
      rolled,
      txCount: count,
    });

    const sortedChildren = [...children].sort((a, b) => {
      const ra = rolledById.get(a) ?? 0;
      const rb = rolledById.get(b) ?? 0;
      if (rb !== ra) return rb - ra;
      return (byId.get(a)?.name ?? '').localeCompare(byId.get(b)?.name ?? '');
    });
    for (const cid of sortedChildren) visitFlat(cid, depth + 1);
  };

  const sortedRoots = [...roots].sort((a, b) => {
    const ra = rolledById.get(a.id) ?? 0;
    const rb = rolledById.get(b.id) ?? 0;
    if (rb !== ra) return rb - ra;
    return a.name.localeCompare(b.name);
  });
  for (const r of sortedRoots) visitFlat(r.id, 0);

  // 5) Total = sum of roots + uncategorized. (Descendants already counted.)
  let total = uncategorizedTotal;
  for (const r of roots) total += rolledById.get(r.id) ?? 0;

  return {
    nodes,
    total,
    childrenOf,
    uncategorized: { total: uncategorizedTotal, count: uncategorizedCount },
    unpricedCount,
  };
}
