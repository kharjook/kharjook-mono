'use client';

import { useMemo } from 'react';
import { RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { formatCurrency } from '@/shared/utils/format-currency';

export function HomeTab() {
  const { assets, categories, transactions, isLoadingData, refresh } = useData();
  const { currencyMode, globalUsd } = useUI();

  const portfolioStats = useMemo(() => {
    let totalValueToman = 0;
    let totalValueUsd = 0;
    let totalCostToman = 0;

    const categoryMap = new Map<
      string,
      { name: string; value: number; color: string; percent?: number }
    >();

    assets.forEach((asset) => {
      const stats = calculateAssetStats(
        asset,
        transactions,
        currencyMode,
        globalUsd
      );
      totalValueToman += stats.currentValueToman;
      totalValueUsd += stats.currentValueUsd;
      totalCostToman += stats.totalCostToman;

      if (stats.currentValueToman > 0 && asset.category_id) {
        const cat = categories.find((c) => c.id === asset.category_id);
        const catName = cat ? cat.name : 'بدون دسته';
        const catColor = cat ? cat.color : '#64748b';

        if (categoryMap.has(asset.category_id)) {
          categoryMap.get(asset.category_id)!.value += stats.currentValueToman;
        } else {
          categoryMap.set(asset.category_id, {
            name: catName,
            value: stats.currentValueToman,
            color: catColor,
          });
        }
      }
    });

    const totalProfitToman = totalValueToman - totalCostToman;
    const isProfit = totalProfitToman >= 0;

    const distributions = Array.from(categoryMap.values());
    distributions.forEach((d) => {
      d.percent = totalValueToman > 0 ? (d.value / totalValueToman) * 100 : 0;
    });
    distributions.sort((a, b) => b.value - a.value);

    return {
      totalValueToman,
      totalValueUsd,
      totalCostToman,
      totalProfitToman,
      isProfit,
      distributions,
    };
  }, [assets, categories, transactions, currencyMode, globalUsd]);

  const displayValue =
    currencyMode === 'USD'
      ? portfolioStats.totalValueUsd
      : portfolioStats.totalValueToman;
  const displayProfit =
    currencyMode === 'USD'
      ? portfolioStats.totalValueUsd -
        portfolioStats.totalCostToman / globalUsd
      : portfolioStats.totalProfitToman;

  return (
    <div className="p-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">داشبورد</h2>
        <button
          onClick={refresh}
          disabled={isLoadingData}
          className="text-slate-400 hover:text-white p-2"
        >
          <RefreshCw size={18} className={isLoadingData ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="bg-gradient-to-br from-[#23253A] to-[#1A1B26] rounded-3xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.4)] border border-white/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
        <p className="text-slate-400 text-sm mb-2 relative z-10">
          ارزش کل دارایی‌ها
        </p>
        <h2
          className="text-4xl font-bold text-white mb-6 tracking-tight relative z-10"
          dir="ltr"
        >
          {formatCurrency(displayValue, currencyMode)}
        </h2>

        <div className="flex items-center gap-3 relative z-10">
          <div
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium ${portfolioStats.isProfit ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}
            dir="ltr"
          >
            {portfolioStats.isProfit ? (
              <TrendingUp size={16} />
            ) : (
              <TrendingDown size={16} />
            )}
            <span>{formatCurrency(Math.abs(displayProfit), currencyMode)}</span>
          </div>
          <span className="text-slate-500 text-xs">سود کل سبد</span>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-slate-200 mb-4">
          پراکندگی سبد (دسته‌بندی)
        </h3>
        <div className="bg-[#1A1B26] p-5 rounded-3xl border border-white/5">
          {isLoadingData ? (
            <div className="text-center text-slate-500 py-4 animate-pulse">
              در حال دریافت...
            </div>
          ) : portfolioStats.distributions.length > 0 ? (
            <>
              <div className="w-full h-3 flex rounded-full overflow-hidden mb-6 bg-slate-800">
                {portfolioStats.distributions.map((dist, idx) => (
                  <div
                    key={idx}
                    style={{
                      width: `${dist.percent ?? 0}%`,
                      backgroundColor: dist.color,
                    }}
                    className="h-full transition-all duration-1000"
                  />
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                {portfolioStats.distributions.map((dist, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: dist.color }}
                    />
                    <div>
                      <p className="text-sm text-slate-300">{dist.name}</p>
                      <p className="text-xs text-slate-500">
                        {(dist.percent ?? 0).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center text-slate-500 text-sm py-4">
              دیتایی برای نمایش نیست.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
