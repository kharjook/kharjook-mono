'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Plus, Settings2, TargetIcon, TrendingUp } from 'lucide-react';
import { EntityIcon } from '@/shared/components/EntityIcon';
import { EmptyState } from '@/shared/components/EmptyState';
import type { Asset, Category } from '@/shared/types/domain';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { formatCurrency } from '@/shared/utils/format-currency';
import { assetDecimals, formatAssetAmount } from '@/shared/utils/format-asset-amount';
import {
  buildAssetSnapshots,
  calculateAssetGoalProgress,
  calculateGroupGoalProgress,
  totalSnapshotValueToman,
} from '@/features/goals/utils/goal-progress';
import { GoalProgressDisplay } from '@/features/goals/components/GoalProgressDisplay';
import { goalValueKindFromGoal } from '@/features/goals/utils/goal-progress-display';

export function AssetsTab() {
  const router = useRouter();
  const { assets, categories, transactions, goals, isLoadingData } = useData();
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

  const snapshots = useMemo(
    () => buildAssetSnapshots(assets, transactions, currencyMode, usdRate),
    [assets, transactions, currencyMode, usdRate]
  );
  const totalValueToman = useMemo(() => totalSnapshotValueToman(snapshots), [snapshots]);

  const assetGoalsByAsset = useMemo(() => {
    const map = new Map<string, typeof goals>();
    goals
      .filter((goal) => goal.scope === 'asset')
      .forEach((goal) => {
        if (!goal.asset_id) return;
        map.set(goal.asset_id, [...(map.get(goal.asset_id) ?? []), goal]);
      });
    return map;
  }, [goals]);

  const groupGoalByCategory = useMemo(() => {
    const map = new Map<string, (typeof goals)[number]>();
    goals
      .filter((goal) => goal.scope === 'asset_group' && goal.target_kind === 'allocation_percent')
      .forEach((goal) => {
        if (goal.category_id) map.set(goal.category_id, goal);
      });
    return map;
  }, [goals]);

  return (
    <div className="p-6 animate-in fade-in duration-300 space-y-6">
      <div className="flex justify-between items-center gap-3">
        <h2 className="text-xl font-bold text-white shrink-0">لیست دارایی‌ها</h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => router.push('/manage/goals')}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-purple-300 hover:border-purple-500/30 transition-colors"
            aria-label="هدف‌ها"
            title="هدف‌ها"
          >
            <TargetIcon size={18} />
          </button>
          <button
            type="button"
            onClick={() => router.push('/prices')}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-colors"
            aria-label="قیمت‌ها و نرخ‌ها"
            title="قیمت‌ها و نرخ‌ها"
          >
            <TrendingUp size={18} />
          </button>
          <button
            type="button"
            onClick={() => router.push('/manage/assets')}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-purple-500/30 transition-colors"
            aria-label="مدیریت دارایی‌ها"
            title="مدیریت"
          >
            <Settings2 size={18} />
          </button>
        </div>
      </div>

      {isLoadingData && assets.length === 0 && (
        <div className="text-center text-slate-500 py-10 animate-pulse">
          در حال دریافت...
        </div>
      )}

      {!isLoadingData && assets.length === 0 && (
        <EmptyState
          icon={<TrendingUp size={24} />}
          title="هنوز دارایی‌ای نساخته‌ای."
          actionLabel="افزودن دارایی"
          onAction={() => router.push('/manage/assets')}
        />
      )}

      {assets.length > 0 && (
        <div className="space-y-8">
          {groupedAssets.map((group) => (
            <div key={group.id} className="space-y-3">
              <div className="space-y-2 mb-2 px-1">
                <div className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: group.color }}
                  ></div>
                  <h3 className="text-sm font-medium text-slate-400">
                    {group.name}
                  </h3>
                </div>
                {group.id !== 'uncategorized' && groupGoalByCategory.has(group.id) && (
                  <GoalProgressDisplay
                    label="هدف گروه"
                    kind="percent"
                    variant="compact"
                    progress={calculateGroupGoalProgress(
                      groupGoalByCategory.get(group.id)!,
                      snapshots,
                      totalValueToman
                    )}
                  />
                )}
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
                const decimals = assetDecimals(asset);
                const assetGoals = assetGoalsByAsset.get(asset.id) ?? [];

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
                          {formatAssetAmount(stats.totalAmount, decimals)} {asset.unit}
                        </p>
                        {asset.include_in_balance === false && (
                          <p className="text-[10px] text-sky-300/80 mt-1">
                            خارج از ارزش کل سبد
                          </p>
                        )}
                        {asset.include_in_profit_loss === false && (
                          <p className="text-[10px] text-amber-300/80 mt-1">
                            خارج از سود/زیان
                          </p>
                        )}
                        {assetGoals.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {assetGoals.slice(0, 2).map((goal) => (
                              <GoalProgressDisplay
                                key={goal.id}
                                label={
                                  goal.target_kind === 'quantity'
                                    ? 'هدف مقدار'
                                    : 'هدف درصد سبد'
                                }
                                kind={goalValueKindFromGoal(goal.target_kind)}
                                unit={asset.unit}
                                variant="compact"
                                progress={calculateAssetGoalProgress(
                                  goal,
                                  snapshots,
                                  totalValueToman
                                )}
                              />
                            ))}
                          </div>
                        )}
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
