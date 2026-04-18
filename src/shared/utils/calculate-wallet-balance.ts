import type { Transaction, Wallet } from '@/shared/types/domain';

export interface WalletStats {
  /** Closing balance in the wallet's native currency. */
  balance: number;
  /** Sum of money flowing into the wallet from INCOME txs only. */
  incomeTotal: number;
  /** Sum of money flowing out via EXPENSE txs only. */
  expenseTotal: number;
  /** Net inflow (BUY proceeds + SELL proceeds + TRANSFER + INCOME) minus outflows. */
  netFlow: number;
  /** Transactions touching this wallet on either side, ordered oldest → newest. */
  transactions: Transaction[];
}

/**
 * Pure derivation — never mutates inputs. The wallet's balance follows directly
 * from `initial_balance` plus the signed sum of every transaction touching it,
 * regardless of which side. We do not depend on the legacy `asset_id/amount`
 * columns here because wallets only ever live on the polymorphic side.
 */
export function calculateWalletStats(
  wallet: Wallet,
  transactions: Transaction[]
): WalletStats {
  let balance = Number(wallet.initial_balance) || 0;
  let incomeTotal = 0;
  let expenseTotal = 0;
  let netFlow = 0;

  const touching: Transaction[] = [];

  for (const tx of transactions) {
    const isSource = tx.source_wallet_id === wallet.id;
    const isTarget = tx.target_wallet_id === wallet.id;
    if (!isSource && !isTarget) continue;

    touching.push(tx);

    if (isTarget) {
      const v = Number(tx.target_amount) || 0;
      balance += v;
      netFlow += v;
      if (tx.type === 'INCOME') incomeTotal += v;
    }
    if (isSource) {
      const v = Number(tx.source_amount) || 0;
      balance -= v;
      netFlow -= v;
      if (tx.type === 'EXPENSE') expenseTotal += v;
    }
  }

  // Oldest first so the UI can render a chronological history.
  touching.sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return { balance, incomeTotal, expenseTotal, netFlow, transactions: touching };
}
