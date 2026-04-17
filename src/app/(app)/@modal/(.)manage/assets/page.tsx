import { ManageAssetsView } from '@/features/assets/components/ManageAssetsView';
import { Modal } from '@/features/shell/components/Modal';

export default function ManageAssetsModal() {
  return (
    <Modal>
      <ManageAssetsView />
    </Modal>
  );
}
