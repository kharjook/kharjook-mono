/**
 * Category tree + rollup for income/expense reports.
 *
 * We build a forest keyed by `parent_id`, walk it in DFS order so parents
 * precede their children (UI relies on this for indentation), and compute two
 * values per category:
 *   - `own`    = sum of transactions directly tagged with this category in the
 *                period, in the wallet's toman-equivalent (we convert via
 *                `tomanPerUnit` to keep mixed-currency wallets comparable).
 *   - `rolled` = `own` + sum(rolled of children). Parent rows render this.
 *
 * Orphan categories whose parent lives in a different kind surface as roots
 * so nothing silently disappears.
 */

import type {
  Category,
  CategoryKind,
  CurrencyRate,
  Transaction,
  Wallet,
} from '@/shared/types/domain';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { isInPeriod, type Period } from '@/shared/utils/period';

export type CashflowKind = Extract<CategoryKind, 'income' | 'expense'>;

export interface RollupNode {
  id: string;
  name: string;
  color: string;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
  own: number;    // toman, own transactions only
  rolled: number; // toman, own + descendants
  txCount: number; // own only (direct tagged transactions in period)
}

export interface RollupResult {
  nodes: RollupNode[];
  total: number; // grand total in toman for this kind/period/filter
  /** Quick lookup: which rows have expandable subtrees. */
  childrenOf: Map<string, string[]>;
  uncategorized: {
    /** Toman total of period txs without a matching category (or wrong kind). */
    total: number;
    count: number;
  };
}

export interface RollupInput {
  transactions: Transaction[];
  categories: Category[];
  wallets: Wallet[];
  currencyRates: CurrencyRate[];
  period: Period;
  kind: CashflowKind;
  /** Filter to one wallet. `null` = app-wide. */
  walletId: string | null;
}

/**
 * Compute the toman-equivalent value of an INCOME/EXPENSE transaction on the
 * side that actually matters for that kind. INCOME deposits into the *target*
 * wallet; EXPENSE withdraws from the *source* wallet. We only handle wallet
 * endpoints here — asset-side INCOME/EXPENSE is uncommon and would need an
 * explicit conversion we don't have yet.
 */
function txTomanValue(
  tx: Transaction,
  kind: CashflowKind,
  wallets: Wallet[],
  rates: CurrencyRate[]
): { toman: number; walletId: string | null } {
  const walletId = kind === 'income' ? tx.target_wallet_id : tx.source_wallet_id;
  const amount = kind === 'income' ? Number(tx.target_amount) : Number(tx.source_amount);
  if (!walletId || !Number.isFinite(amount) || amount <= 0) {
    return { toman: 0, walletId: null };
  }
  const wallet = wallets.find((w) => w.id === walletId);
  if (!wallet) return { toman: 0, walletId };
  const rate = tomanPerUnit(wallet.currency, rates);
  if (rate <= 0) return { toman: 0, walletId };
  return { toman: amount * rate, walletId };
}

export function rollupCategories(input: RollupInput): RollupResult {
  const { transactions, categories, period, kind, walletId, wallets, currencyRates } = input;

  // 1) Bucket txs into own totals per category.
  const ownByCat = new Map<string, { toman: number; count: number }>();
  let uncategorizedToman = 0;
  let uncategorizedCount = 0;
  const targetType = kind === 'income' ? 'INCOME' : 'EXPENSE';

  for (const tx of transactions) {
    if (tx.type !== targetType) continue;
    if (!isInPeriod(tx.date_string, period)) continue;

    const { toman, walletId: txWalletId } = txTomanValue(tx, kind, wallets, currencyRates);
    if (toman <= 0) continue;
    if (walletId && txWalletId !== walletId) continue;

    const catId = tx.category_id;
    if (catId) {
      const cur = ownByCat.get(catId) ?? { toman: 0, count: 0 };
      cur.toman += toman;
      cur.count += 1;
      ownByCat.set(catId, cur);
    } else {
      uncategorizedToman += toman;
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
    const own = ownByCat.get(id)?.toman ?? 0;
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
    const own = ownByCat.get(id)?.toman ?? 0;
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
  let total = uncategorizedToman;
  for (const r of roots) total += rolledById.get(r.id) ?? 0;

  return {
    nodes,
    total,
    childrenOf,
    uncategorized: { total: uncategorizedToman, count: uncategorizedCount },
  };
}
