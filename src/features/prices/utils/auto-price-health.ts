import type { Asset, DailyPrice } from '@/shared/types/domain';

export type AutoPriceHealth = {
  autoAssetCount: number;
  syncedTodayCount: number;
  missingTodayCount: number;
  isHealthy: boolean;
};

export function evaluateAutoPriceHealth(input: {
  assets: Asset[];
  dailyPrices: DailyPrice[];
  todayStr: string;
}): AutoPriceHealth {
  const autoAssets = input.assets.filter((asset) => !!asset.price_source_id);
  if (autoAssets.length === 0) {
    return {
      autoAssetCount: 0,
      syncedTodayCount: 0,
      missingTodayCount: 0,
      isHealthy: true,
    };
  }

  const autoIds = new Set(autoAssets.map((asset) => asset.id));
  const syncedIds = new Set(
    input.dailyPrices
      .filter(
        (row) =>
          row.date_string === input.todayStr &&
          row.source === 'auto' &&
          autoIds.has(row.asset_id)
      )
      .map((row) => row.asset_id)
  );

  const syncedTodayCount = syncedIds.size;
  const missingTodayCount = autoAssets.length - syncedTodayCount;

  return {
    autoAssetCount: autoAssets.length,
    syncedTodayCount,
    missingTodayCount,
    isHealthy: missingTodayCount === 0,
  };
}
