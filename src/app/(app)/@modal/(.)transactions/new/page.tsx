import { AddTransactionView } from '@/features/transactions/components/AddTransactionView';
import { Modal } from '@/features/shell/components/Modal';
import type { TransactionType } from '@/shared/types/domain';

const VALID_TYPES: ReadonlySet<TransactionType> = new Set([
  'BUY',
  'SELL',
  'TRANSFER',
  'INCOME',
  'EXPENSE',
]);

export default async function NewTransactionModal({
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
    <Modal>
      <AddTransactionView
        assetId={assetId}
        walletId={walletId}
        defaultType={defaultType}
      />
    </Modal>
  );
}
