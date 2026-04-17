import { AssetDetailsView } from '@/features/assets/components/AssetDetailsView';
import { Modal } from '@/features/shell/components/Modal';

export default async function AssetDetailsModal({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Modal>
      <AssetDetailsView assetId={id} />
    </Modal>
  );
}
