import { AddTransactionView } from '@/features/transactions/components/AddTransactionView';

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AddTransactionView transactionId={id} />;
}
