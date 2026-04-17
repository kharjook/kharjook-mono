import { AddTransactionView } from '@/features/transactions/components/AddTransactionView';
import { Modal } from '@/features/shell/components/Modal';

export default async function EditTransactionModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Modal>
      <AddTransactionView transactionId={id} />
    </Modal>
  );
}
