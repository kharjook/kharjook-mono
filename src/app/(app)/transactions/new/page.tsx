import { AddTransactionView } from '@/features/transactions/components/AddTransactionView';
import type { TransactionType } from '@/shared/types/domain';

const VALID_TYPES: ReadonlySet<TransactionType> = new Set([
  'BUY',
  'SELL',
  'TRANSFER',
  'INCOME',
  'EXPENSE',
]);

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{
    assetId?: string;
    walletId?: string;
    type?: string;
  }>;
}) {
  const { assetId, walletId, type } = await searchParams;
  const defaultType =
    type && VALID_TYPES.has(type as TransactionType)
      ? (type as TransactionType)
      : undefined;
  return (
    <AddTransactionView
      assetId={assetId}
      walletId={walletId}
      defaultType={defaultType}
    />
  );
}
