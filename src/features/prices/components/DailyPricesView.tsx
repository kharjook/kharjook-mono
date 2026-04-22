'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { useToast } from '@/shared/components/Toast';
import { supabase } from '@/shared/lib/supabase/client';
import type { CurrencyRate, DailyPrice } from '@/shared/types/domain';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { formatJalaali, todayJalaali } from '@/shared/utils/jalali';
import { fetchProviderQuotes } from '@/features/prices/utils/provider-refresh';

type LocalPrices = Record<string, { toman: string; usd: string }>;

export function DailyPricesView() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { assets, setAssets, setCurrencyRates, setDailyPrices } = useData();
  const { usdRate } = useUI();

  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const [localPrices, setLocalPrices] = useState<LocalPrices>({});
  // Local USD rate input. Seeded from the canonical rate; persisted to
  // `currency_rates.USD` on save (single source of truth — no shadow state).
  const [localUsd, setLocalUsd] = useState<string>(() =>
    usdRate ? String(usdRate) : ''
  );

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

  // If the rate changes elsewhere while this view is mounted, re-seed.
  useEffect(() => {
    setLocalUsd(usdRate ? String(usdRate) : '');
  }, [usdRate]);

  const currentUsdNum = Number(localUsd);
  const effectiveUsd =
    Number.isFinite(currentUsdNum) && currentUsdNum > 0 ? currentUsdNum : 0;

  const refreshableAssets = assets.filter((asset) => !!asset.price_source_id);

  const applyProviderQuotes = async () => {
    const slugs = [
      'tgju.usd',
      ...refreshableAssets
        .map((asset) => asset.price_source_id)
        .filter((slug): slug is string => !!slug),
    ];

    const quotes = await fetchProviderQuotes(slugs);
    if (quotes.length === 0) return 0;

    const quoteBySlug = new Map(quotes.map((quote) => [quote.slug, quote]));
    const usdQuote = quoteBySlug.get('tgju.usd');
    const nextUsdRate =
      usdQuote && usdQuote.priceToman > 0 ? usdQuote.priceToman : effectiveUsd;

    if (usdQuote && usdQuote.priceToman > 0) {
      setLocalUsd(String(usdQuote.priceToman));
    }

    setLocalPrices((prev) => {
      const next = { ...prev };
      for (const asset of refreshableAssets) {
        const slug = asset.price_source_id;
        if (!slug) continue;
        const quote = quoteBySlug.get(slug);
        if (!quote) continue;
        next[asset.id] = {
          toman: String(quote.priceToman),
          usd:
            nextUsdRate > 0
              ? String(quote.priceToman / nextUsdRate)
              : (next[asset.id]?.usd ?? ''),
        };
      }
      return next;
    });

    return quotes.filter((quote) => quote.slug !== 'tgju.usd').length;
  };

  const handleRefreshProviders = async (silent = false) => {
    setIsRefreshingProviders(true);
    try {
      const updated = await applyProviderQuotes();
      if (!silent) {
        if (updated > 0) {
          toast.success(`${updated} قیمت دارایی و نرخ دلار بروزرسانی شد.`);
        } else {
          toast.success('نرخ دلار بروزرسانی شد.');
        }
      }
    } catch (error) {
      if (!silent) toast.error('دریافت قیمت از منبع بیرونی ناموفق بود.');
      console.error(error);
    } finally {
      setIsRefreshingProviders(false);
    }
  };

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
          effectiveUsd > 0
        ) {
          newUsd = String(n / effectiveUsd);
        }
      } else {
        newUsd = canonical;
        const n = Number(canonical);
        if (canonical !== '' && canonical !== '.' && !Number.isNaN(n)) {
          newToman = String(n * effectiveUsd);
        }
      }
      return { ...prev, [id]: { toman: newToman, usd: newUsd } };
    });
  };

  const handleUsdRateChange = (canonical: string) => {
    setLocalUsd(canonical);
    const newUsd =
      canonical === '' || canonical === '.' ? 0 : Number(canonical);
    if (canonical !== '' && canonical !== '.' && Number.isNaN(newUsd)) return;

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
    if (!user) return;
    setIsSaving(true);
    try {
      const assetUpdates = assets.map((a) => ({
        id: a.id,
        user_id: a.user_id,
        category_id: a.category_id,
        name: a.name,
        unit: a.unit,
        price_toman: Number(localPrices[a.id]?.toman || 0),
        price_usd: Number(localPrices[a.id]?.usd || 0),
      }));

      // Persist USD rate alongside asset prices so they can never drift apart.
      const usdNum = Number(localUsd);
      const persistUsd =
        Number.isFinite(usdNum) && usdNum > 0 && usdNum !== usdRate;

      const assetPromise = supabase.from('assets').upsert(assetUpdates).select();
      const ratePromise = persistUsd
        ? supabase
            .from('currency_rates')
            .upsert(
              [
                {
                  user_id: user.id,
                  currency: 'USD',
                  toman_per_unit: usdNum,
                  updated_at: new Date().toISOString(),
                },
              ],
              { onConflict: 'user_id,currency' }
            )
            .select()
        : null;

      const [assetRes, rateRes] = await Promise.all([assetPromise, ratePromise]);

      if (assetRes.error) throw assetRes.error;
      if (rateRes?.error) throw rateRes.error;

      setAssets((assetRes.data as typeof assets) || []);

      if (rateRes) {
        const fresh = (rateRes.data as CurrencyRate[]) || [];
        setCurrencyRates((prev) => {
          const map = new Map(prev.map((r) => [r.currency, r]));
          fresh.forEach((r) => map.set(r.currency, r));
          return Array.from(map.values());
        });
      }

      // -----------------------------------------------------------------
      // Snapshot today's prices into `daily_prices` (source='manual').
      // Manual always overrides any prior trade/auto snapshot for the same
      // day via a normal upsert. Only rows with a positive toman price are
      // worth storing; zeros would pollute historical P/L lookups.
      // This runs AFTER the assets cache is saved; if it fails we show a
      // non-fatal warning — the primary save already succeeded.
      // -----------------------------------------------------------------
      const today = formatJalaali(todayJalaali());
      const snapshotPayload: Omit<DailyPrice, 'created_at' | 'updated_at'>[] =
        assetUpdates
          .filter((a) => a.price_toman > 0 && a.price_usd >= 0)
          .map((a) => ({
            user_id: user.id,
            asset_id: a.id,
            date_string: today,
            price_toman: a.price_toman,
            price_usd: a.price_usd,
            source: 'manual' as const,
          }));

      if (snapshotPayload.length > 0) {
        const { data: dpData, error: dpErr } = await supabase
          .from('daily_prices')
          .upsert(snapshotPayload, { onConflict: 'user_id,asset_id,date_string' })
          .select();

        if (dpErr) {
          // Non-fatal: the live cache is fresh; history just missed today.
          console.error('daily_prices upsert failed', dpErr);
          toast.info('قیمت‌ها ذخیره شد؛ اما ثبت تاریخچه‌ی روزانه ناموفق بود.');
        } else {
          const fresh = (dpData as DailyPrice[]) || [];
          setDailyPrices((prev) => {
            const key = (p: DailyPrice) =>
              `${p.user_id}|${p.asset_id}|${p.date_string}`;
            const map = new Map(prev.map((p) => [key(p), p]));
            for (const p of fresh) map.set(key(p), p);
            return Array.from(map.values());
          });
        }
      }

      router.back();
    } catch (error) {
      toast.error('خطا در ذخیره قیمت‌ها.');
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
        <button
          onClick={() => void handleRefreshProviders()}
          disabled={isRefreshingProviders}
          className="p-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10 disabled:opacity-50"
          aria-label="refresh-provider-prices"
        >
          <RefreshCw
            size={18}
            className={isRefreshingProviders ? 'animate-spin' : undefined}
          />
        </button>
      </div>

      <div className="p-6 space-y-6">
        <div className="bg-purple-900/20 border border-purple-500/30 p-5 rounded-3xl">
          <label className="block text-sm text-purple-300 mb-2 font-medium">
            قیمت جهانی دلار (تومان)
          </label>
          <FormattedNumberInput
            value={localUsd}
            onValueChange={handleUsdRateChange}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-white text-left  focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all"
            dir="ltr"
          />
          <p className="text-[11px] text-purple-300/60 mt-2">
            این مقدار همان نرخ USD در «نرخ تبدیل ارزها» است و در هر دو جا یکی نگه‌داشته می‌شود.
          </p>
        </div>

        <div className="bg-white/5 border border-white/8 p-4 rounded-2xl text-sm text-slate-300">
          در شروع اپ فقط داده‌های ذخیره‌شده از دیتابیس خوانده می‌شوند. دریافت
          دوباره‌ی قیمت زنده فقط با همین دکمه‌ی رفرش یا رفرش داشبورد انجام می‌شود.
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
        className="fixed bottom-6 right-1/2 translate-x-1/2 w-[calc(100%-3rem)] max-w-100 bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-2xl font-bold shadow-[0_4px_20px_rgba(147,51,234,0.4)] transition-all flex justify-center items-center gap-2 z-30 disabled:opacity-50"
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
