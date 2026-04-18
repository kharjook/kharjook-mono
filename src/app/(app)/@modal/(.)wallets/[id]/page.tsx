import { WalletDetailsView } from '@/features/wallets/components/WalletDetailsView';
import { Modal } from '@/features/shell/components/Modal';

export default async function WalletModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Modal>
      <WalletDetailsView walletId={id} />
    </Modal>
  );
}
