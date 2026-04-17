import { AddTransactionView } from '@/features/transactions/components/AddTransactionView';

export default async function NewTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ assetId?: string }>;
}) {
  const { assetId } = await searchParams;
  return <AddTransactionView assetId={assetId} />;
}
