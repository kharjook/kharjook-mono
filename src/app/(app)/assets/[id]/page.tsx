import { AssetDetailsView } from '@/features/assets/components/AssetDetailsView';

export default async function AssetDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AssetDetailsView assetId={id} />;
}
