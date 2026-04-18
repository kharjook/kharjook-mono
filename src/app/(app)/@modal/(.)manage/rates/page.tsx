import { CurrencyRatesView } from '@/features/rates/components/CurrencyRatesView';
import { Modal } from '@/features/shell/components/Modal';

export default function ManageRatesModal() {
  return (
    <Modal>
      <CurrencyRatesView />
    </Modal>
  );
}
