import type { Asset } from '@/shared/types/domain';

const DEFAULT_ASSET_DECIMALS = 4;
const MIN_ASSET_DECIMALS = 0;
const MAX_ASSET_DECIMALS = 12;

export function normalizeAssetDecimals(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_ASSET_DECIMALS;
  const int = Math.trunc(n);
  return Math.max(MIN_ASSET_DECIMALS, Math.min(MAX_ASSET_DECIMALS, int));
}

export function assetDecimals(asset: Pick<Asset, 'decimal_places'> | null | undefined): number {
  return normalizeAssetDecimals(asset?.decimal_places);
}

export function formatAssetAmount(value: unknown, decimals: number): string {
  const safe = Number(value ?? 0);
  if (!Number.isFinite(safe)) return '0';
  const places = normalizeAssetDecimals(decimals);
  const factor = 10 ** places;
  const truncated = Math.trunc(safe * factor) / factor;
  const sign = truncated < 0 ? '-' : '';
  const abs = Math.abs(truncated);
  const [intPartRaw, fracPartRaw = ''] = abs.toFixed(places).split('.');
  const intPart = Number(intPartRaw).toLocaleString('en-US');
  const fracPart = fracPartRaw.replace(/0+$/, '');
  return fracPart ? `${sign}${intPart}.${fracPart}` : `${sign}${intPart}`;
}
