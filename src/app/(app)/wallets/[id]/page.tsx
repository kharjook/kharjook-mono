import { WalletDetailsView } from '@/features/wallets/components/WalletDetailsView';

export default async function WalletPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <WalletDetailsView walletId={id} />;
}
