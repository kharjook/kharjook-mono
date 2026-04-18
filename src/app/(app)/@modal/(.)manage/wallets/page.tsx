import { ManageWalletsView } from '@/features/wallets/components/ManageWalletsView';
import { Modal } from '@/features/shell/components/Modal';

export default function ManageWalletsModal() {
  return (
    <Modal>
      <ManageWalletsView />
    </Modal>
  );
}
