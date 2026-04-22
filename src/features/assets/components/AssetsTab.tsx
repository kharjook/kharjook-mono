'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Plus } from 'lucide-react';
import { EntityIcon } from '@/shared/components/EntityIcon';
import type { Asset, Category } from '@/shared/types/domain';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { formatCurrency } from '@/shared/utils/format-currency';

export function AssetsTab() {
  const router = useRouter();
  const { assets, categories, transactions, isLoadingData } = useData();
  const { currencyMode, usdRate } = useUI();

  const groupedAssets = useMemo(() => {
    const map = new Map<
      string,
      Category & { assets: Asset[] }
    >();
    categories
      .filter((c) => c.kind === 'asset')
      .forEach((c) => map.set(c.id, { ...c, assets: [] }));
    map.set('uncategorized', {
      id: 'uncategorized',
      user_id: '',
      name: 'بدون دسته‌بندی',
      color: '#64748b',
      kind: 'asset',
      parent_id: null,
      assets: [],
    });

    assets.forEach((asset) => {
      const catId = asset.category_id || 'uncategorized';
      if (map.has(catId)) {
        map.get(catId)!.assets.push(asset);
      } else {
        map.get('uncategorized')!.assets.push(asset);
      }
    });
    return Array.from(map.values()).filter((g) => g.assets.length > 0);
  }, [assets, categories]);

  return (
    <div className="p-6 animate-in fade-in duration-300 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">لیست دارایی‌ها</h2>
      </div>

      {isLoadingData && assets.length === 0 && (
        <div className="text-center text-slate-500 py-10 animate-pulse">
          در حال دریافت...
        </div>
      )}

      {!isLoadingData && assets.length === 0 && (
        <div className="text-center py-10 space-y-3">
          <p className="text-slate-500 text-sm">هنوز دارایی‌ای نساخته‌ای.</p>
          <button
            type="button"
            onClick={() => router.push('/manage/assets')}
            className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 text-sm font-medium"
          >
            <Plus size={16} />
            افزودن دارایی
          </button>
        </div>
      )}

      {assets.length > 0 && (
        <div className="space-y-8">
          {groupedAssets.map((group) => (
            <div key={group.id} className="space-y-3">
              <div className="flex items-center gap-2 mb-2 px-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: group.color }}
                ></div>
                <h3 className="text-sm font-medium text-slate-400">
                  {group.name}
                </h3>
              </div>

              {group.assets.map((asset) => {
                const stats = calculateAssetStats(
                  asset,
                  transactions,
                  currencyMode,
                  usdRate
                );
                const displayValue =
                  currencyMode === 'USD'
                    ? stats.currentValueUsd
                    : stats.currentValueToman;
                const displayProfit =
                  currencyMode === 'USD'
                    ? stats.profitLossUsd
                    : stats.profitLossToman;
                const isProfit = displayProfit >= 0;

                return (
                  <div
                    key={asset.id}
                    onClick={() => router.push(`/assets/${asset.id}`)}
                    className="bg-[#1A1B26] border border-white/5 p-4 rounded-2xl flex justify-between items-center cursor-pointer hover:bg-[#222436] transition-colors active:scale-[0.98]"
                  >
                    <div className="flex items-center gap-4">
                      <EntityIcon
                        iconUrl={asset.icon_url}
                        fallback={<Activity size={24} />}
                        bgColor={`${group.color}20`}
                        color={group.color}
                        className="w-12 h-12"
                      />
                      <div>
                        <h3 className="font-semibold text-slate-200">
                          {asset.name}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                          {stats.totalAmount} {asset.unit}
                        </p>
                      </div>
                    </div>

                    <div className="text-left">
                      <p className="font-bold text-slate-200" dir="ltr">
                        {formatCurrency(displayValue, currencyMode)}
                      </p>
                      <p
                        className={`text-xs mt-1 font-medium ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}
                        dir="ltr"
                      >
                        {isProfit ? '+' : ''}
                        {formatCurrency(displayProfit, currencyMode)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
