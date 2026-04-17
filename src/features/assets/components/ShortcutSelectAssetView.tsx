'use client';

import { useRouter } from 'next/navigation';
import { Activity, ArrowRight } from 'lucide-react';
import { useData } from '@/features/portfolio/PortfolioProvider';

export function ShortcutSelectAssetView() {
  const router = useRouter();
  const { assets, categories } = useData();

  return (
    <div className="bg-[#0F1015] min-h-full pb-10 animate-in slide-in-from-bottom-8 duration-300">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">انتخاب دارایی</h2>
      </div>
      <div className="p-6 space-y-3">
        {assets.map((asset) => {
          const cat = categories.find((c) => c.id === asset.category_id);
          const color = cat ? cat.color : '#64748b';
          return (
            <button
              key={asset.id}
              onClick={() =>
                router.push(`/transactions/new?assetId=${asset.id}`)
              }
              className="w-full bg-[#1A1B26] p-4 rounded-2xl border border-white/5 flex items-center gap-4 hover:bg-[#222436] transition-colors"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${color}20`, color: color }}
              >
                <Activity size={20} />
              </div>
              <span className="font-semibold text-slate-200">{asset.name}</span>
            </button>
          );
        })}
        {assets.length === 0 && (
          <p className="text-center text-slate-500 text-sm">
            هیچ دارایی ثبت نشده.
          </p>
        )}
      </div>
    </div>
  );
}
