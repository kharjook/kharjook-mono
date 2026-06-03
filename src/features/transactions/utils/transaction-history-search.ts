import type { Asset, Transaction, TransactionType, Wallet } from '@/shared/types/domain';
import type { ConvertTransactionGroup } from '@/features/transactions/utils/convert-transaction';
import { latinizeDigits } from '@/shared/utils/latinize-digits';

const TYPE_LABELS: Record<TransactionType, string> = {
  BUY: 'خرید',
  SELL: 'فروش',
  TRANSFER: 'انتقال',
  INCOME: 'درآمد',
  EXPENSE: 'هزینه',
};

export type TransactionHistoryLookup = {
  wallets: Pick<Wallet, 'id' | 'name'>[];
  assets: Pick<Asset, 'id' | 'name'>[];
  categories: Pick<{ id: string; name: string }, 'id' | 'name'>[];
};

function normalizeSearchQuery(query: string): string {
  return latinizeDigits(query.trim().toLowerCase());
}

function pushAmount(parts: string[], value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return;
  parts.push(String(value));
}

function walletName(lookup: TransactionHistoryLookup, id: string | null | undefined): string {
  if (!id) return '';
  return lookup.wallets.find((w) => w.id === id)?.name ?? '';
}

function assetName(lookup: TransactionHistoryLookup, id: string | null | undefined): string {
  if (!id) return '';
  return lookup.assets.find((a) => a.id === id)?.name ?? '';
}

function categoryName(lookup: TransactionHistoryLookup, id: string | null | undefined): string {
  if (!id) return '';
  return lookup.categories.find((c) => c.id === id)?.name ?? '';
}

function buildTransactionHaystack(tx: Transaction, lookup: TransactionHistoryLookup): string {
  const parts = [
    tx.date_string,
    tx.note ?? '',
    TYPE_LABELS[tx.type],
    walletName(lookup, tx.source_wallet_id),
    walletName(lookup, tx.target_wallet_id),
    assetName(lookup, tx.source_asset_id),
    assetName(lookup, tx.target_asset_id),
    assetName(lookup, tx.asset_id),
    categoryName(lookup, tx.category_id),
  ];
  pushAmount(parts, tx.source_amount);
  pushAmount(parts, tx.target_amount);
  pushAmount(parts, tx.amount);
  pushAmount(parts, tx.price_toman);
  return normalizeSearchQuery(parts.filter(Boolean).join(' '));
}

export function transactionMatchesSearch(
  tx: Transaction,
  query: string,
  lookup: TransactionHistoryLookup
): boolean {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return true;
  return buildTransactionHaystack(tx, lookup).includes(normalized);
}

export function convertGroupMatchesSearch(
  group: ConvertTransactionGroup,
  query: string,
  lookup: TransactionHistoryLookup
): boolean {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return true;

  const sourceName = assetName(lookup, group.sell.source_asset_id);
  const targetName = assetName(lookup, group.buy.target_asset_id);
  const parts = [
    'تبدیل',
    group.sell.date_string,
    group.sell.note ?? '',
    group.buy.note ?? '',
    sourceName,
    targetName,
    TYPE_LABELS.SELL,
    TYPE_LABELS.BUY,
  ];
  pushAmount(parts, group.sell.source_amount ?? group.sell.amount);
  pushAmount(parts, group.buy.target_amount ?? group.buy.amount);
  pushAmount(parts, group.sell.price_toman);
  pushAmount(parts, group.buy.price_toman);

  return normalizeSearchQuery(parts.filter(Boolean).join(' ')).includes(normalized);
}
