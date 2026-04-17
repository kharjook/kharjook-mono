import { ManageCategoriesView } from '@/features/categories/components/ManageCategoriesView';
import { Modal } from '@/features/shell/components/Modal';

export default function ManageCategoriesModal() {
  return (
    <Modal>
      <ManageCategoriesView />
    </Modal>
  );
}
