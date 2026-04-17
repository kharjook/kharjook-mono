'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { supabase } from '@/shared/lib/supabase/client';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';

type LocalPrices = Record<string, { toman: string; usd: string }>;

export function DailyPricesView() {
  const router = useRouter();
  const { assets, setAssets } = useData();
  const { globalUsd, setGlobalUsd } = useUI();

  const [isSaving, setIsSaving] = useState(false);
  const [localPrices, setLocalPrices] = useState<LocalPrices>({});

  useEffect(() => {
    const p: LocalPrices = {};
    assets.forEach((a) => {
      p[a.id] = {
        toman: a.price_toman ? String(a.price_toman) : '',
        usd: a.price_usd ? String(a.price_usd) : '',
      };
    });
    setLocalPrices(p);
  }, [assets]);

  const handlePriceChange = (
    id: string,
    field: 'toman' | 'usd',
    canonical: string
  ) => {
    setLocalPrices((prev) => {
      const current = prev[id] || { toman: '', usd: '' };
      let newToman = current.toman;
      let newUsd = current.usd;

      if (field === 'toman') {
        newToman = canonical;
        const n = Number(canonical);
        if (
          canonical !== '' &&
          canonical !== '.' &&
          !Number.isNaN(n) &&
          globalUsd > 0
        ) {
          newUsd = String(n / globalUsd);
        }
      } else {
        newUsd = canonical;
        const n = Number(canonical);
        if (canonical !== '' && canonical !== '.' && !Number.isNaN(n)) {
          newToman = String(n * globalUsd);
        }
      }
      return { ...prev, [id]: { toman: newToman, usd: newUsd } };
    });
  };

  const handleGlobalUsdCanonical = (canonical: string) => {
    const newUsd =
      canonical === '' || canonical === '.' ? 0 : Number(canonical);
    if (canonical !== '' && canonical !== '.' && Number.isNaN(newUsd)) return;

    setGlobalUsd(newUsd);

    setLocalPrices((prev) => {
      const next: LocalPrices = { ...prev };
      for (const id of Object.keys(next)) {
        const row = next[id]!;
        const u = Number(row.usd);
        if (row.usd !== '' && !Number.isNaN(u)) {
          next[id] = { ...row, toman: String(u * newUsd) };
        }
      }
      return next;
    });
  };

  const handleSavePrices = async () => {
    setIsSaving(true);
    try {
      const updates = assets.map((a) => ({
        id: a.id,
        user_id: a.user_id,
        category_id: a.category_id,
        name: a.name,
        unit: a.unit,
        price_toman: Number(localPrices[a.id]?.toman || 0),
        price_usd: Number(localPrices[a.id]?.usd || 0),
      }));

      const { data, error } = await supabase.from('assets').upsert(updates).select();
      if (error) throw error;

      setAssets(data);
      router.back();
    } catch (error) {
      alert('خطا در ذخیره قیمت‌ها');
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-[#0F1015] min-h-full pb-24 animate-in slide-in-from-right-8 duration-300 relative">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">بروزرسانی قیمت‌ها</h2>
      </div>

      <div className="p-6 space-y-6">
        <div className="bg-purple-900/20 border border-purple-500/30 p-5 rounded-3xl">
          <label className="block text-sm text-purple-300 mb-2 font-medium">
            قیمت جهانی دلار (تومان)
          </label>
          <FormattedNumberInput
            value={globalUsd ? String(globalUsd) : ''}
            onValueChange={handleGlobalUsdCanonical}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-white text-left font-mono focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all"
            dir="ltr"
          />
        </div>

        <div className="space-y-4">
          {assets.map((asset) => (
            <div
              key={asset.id}
              className="bg-[#1A1B26] p-4 rounded-2xl border border-white/5 space-y-4"
            >
              <h3 className="font-semibold text-white">{asset.name}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">دلار</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                      $
                    </span>
                    <FormattedNumberInput
                      value={localPrices[asset.id]?.usd || ''}
                      onValueChange={(c) =>
                        handlePriceChange(asset.id, 'usd', c)
                      }
                      className="w-full bg-[#222436] border border-white/5 rounded-xl py-2 px-3 pl-7 text-white text-left text-sm focus:border-purple-500 outline-none transition-all"
                      dir="ltr"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">تومان</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs">
                      ت
                    </span>
                    <FormattedNumberInput
                      value={localPrices[asset.id]?.toman || ''}
                      onValueChange={(c) =>
                        handlePriceChange(asset.id, 'toman', c)
                      }
                      className="w-full bg-[#222436] border border-white/5 rounded-xl py-2 px-3 pl-7 text-white text-left text-sm focus:border-purple-500 outline-none transition-all"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={handleSavePrices}
        disabled={isSaving}
        className="fixed bottom-6 right-1/2 translate-x-1/2 w-[calc(100%-3rem)] max-w-[calc(28rem-3rem)] bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-2xl font-bold shadow-[0_4px_20px_rgba(147,51,234,0.4)] transition-all flex justify-center items-center gap-2 z-30 disabled:opacity-50"
      >
        {isSaving ? (
          <RefreshCw className="animate-spin" size={20} />
        ) : (
          'ذخیره در دیتابیس'
        )}
      </button>
    </div>
  );
}
