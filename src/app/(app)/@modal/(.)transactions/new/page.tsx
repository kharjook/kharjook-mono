import { AddTransactionView } from '@/features/transactions/components/AddTransactionView';
import { Modal } from '@/features/shell/components/Modal';

export default async function NewTransactionModal({
  searchParams,
}: {
  searchParams: Promise<{ assetId?: string }>;
}) {
  const { assetId } = await searchParams;
  return (
    <Modal>
      <AddTransactionView assetId={assetId} />
    </Modal>
  );
}
