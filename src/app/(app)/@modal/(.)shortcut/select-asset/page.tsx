import { ShortcutSelectAssetView } from '@/features/assets/components/ShortcutSelectAssetView';
import { Modal } from '@/features/shell/components/Modal';

export default function ShortcutSelectAssetModal() {
  return (
    <Modal>
      <ShortcutSelectAssetView />
    </Modal>
  );
}
