'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, AlertCircle, ChevronDown, RefreshCw } from 'lucide-react';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { useToast } from '@/shared/components/Toast';
import { supabase } from '@/shared/lib/supabase/client';
import type { CurrencyRate, DailyPrice, RateCurrency } from '@/shared/types/domain';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { formatJalaali, todayJalaali } from '@/shared/utils/jalali';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import {
  fetchProviderQuotesDetailed,
  mergeGlobalUsdDollarQuotes,
} from '@/features/prices/utils/provider-refresh';
import {
  applyConversionRatesToQuotes,
  buildConversionConfigMap,
} from '@/features/prices/utils/conversion-rate';
import { catalogToApiSources } from '@/features/prices/utils/price-source-catalog';
import {
  boundFetchablePriceSourceSlugs,
  PriceSourceAdvancedSection,
  usePriceSourceAdvancedSave,
} from '@/features/prices/components/PriceSourceAdvancedSection';
import { PriceSourceCatalogSection } from '@/features/prices/components/PriceSourceCatalogSection';
import {
  CURRENCY_META,
  RATE_ORDER,
} from '@/features/wallets/constants/currency-meta';
import { evaluateAutoPriceHealth } from '@/features/prices/utils/auto-price-health';

type LocalPrices = Record<string, { toman: string; usd: string }>;
type LocalRates = Partial<Record<RateCurrency, string>>;
const USD_RATE_SOURCE_SLUG = 'abantether.usdt';

const toTomanInput = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '';
  return String(Math.round(value));
};

const toUsdInput = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return '';
  return value.toFixed(2);
};

const buildOtherRatesLocal = (
  rates: CurrencyRate[],
  currencies: RateCurrency[]
): LocalRates => {
  const out: LocalRates = {};
  for (const c of currencies) {
    const found = rates.find((r) => r.currency === c);
    out[c] = found ? String(found.toman_per_unit) : '';
  }
  return out;
};

export function DailyPricesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { user } = useAuth();
  const {
    assets,
    wallets,
    transactions,
    currencyRates,
    setAssets,
    setCurrencyRates,
    setDailyPrices,
    priceSourceSettings,
    priceSourceCatalog,
    dailyPrices,
  } = useData();
  const { usdRate } = useUI();

  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const [localPrices, setLocalPrices] = useState<LocalPrices>({});
  const [localUsd, setLocalUsd] = useState<string>(() =>
    usdRate ? String(usdRate) : ''
  );
  const [advancedOpen, setAdvancedOpen] = useState(
    () => searchParams.get('advanced') === '1'
  );

  const boundSlugs = useMemo(
    () =>
      boundFetchablePriceSourceSlugs(
        assets.map((a) => a.price_source_id),
        priceSourceCatalog
      ),
    [assets, priceSourceCatalog]
  );
  const priceSourceControl = usePriceSourceAdvancedSave(boundSlugs);

  const otherCurrencies = useMemo(() => {
    const used = new Set<RateCurrency>();
    for (const wallet of wallets) {
      if (wallet.currency !== 'IRT' && wallet.currency !== 'USD') {
        used.add(wallet.currency as RateCurrency);
      }
    }
    return RATE_ORDER.filter((c) => c !== 'USD' && used.has(c));
  }, [wallets]);

  const [localOtherRates, setLocalOtherRates] = useState<LocalRates>(() =>
    buildOtherRatesLocal(currencyRates, otherCurrencies)
  );

  useEffect(() => {
    const p: LocalPrices = {};
    assets.forEach((a) => {
      p[a.id] = {
        toman: toTomanInput(Number(a.price_toman)),
        usd: toUsdInput(Number(a.price_usd)),
      };
    });
    setLocalPrices(p);
  }, [assets]);

  useEffect(() => {
    setLocalUsd(usdRate ? String(usdRate) : '');
  }, [usdRate]);

  useEffect(() => {
    setLocalOtherRates(buildOtherRatesLocal(currencyRates, otherCurrencies));
  }, [currencyRates, otherCurrencies]);

  const currentUsdNum = Number(localUsd);
  const effectiveUsd =
    Number.isFinite(currentUsdNum) && currentUsdNum > 0 ? currentUsdNum : 0;

  const refreshableAssets = assets.filter((asset) => !!asset.price_source_id);
  const todayStr = useMemo(() => formatJalaali(todayJalaali()), []);
  const autoPriceHealth = useMemo(
    () => evaluateAutoPriceHealth({ assets, dailyPrices, todayStr }),
    [assets, dailyPrices, todayStr]
  );
  const visibleAssets = useMemo(
    () =>
      assets.filter((asset) => {
        if (asset.include_in_balance === false) return false;
        const stats = calculateAssetStats(asset, transactions, 'TOMAN', usdRate);
        return stats.totalAmount > 0;
      }),
    [assets, transactions, usdRate]
  );

  const applyProviderQuotes = async () => {
    const slugs = [
      USD_RATE_SOURCE_SLUG,
      ...refreshableAssets
        .map((asset) => asset.price_source_id)
        .filter((slug): slug is string => !!slug),
    ];

    const result = await fetchProviderQuotesDetailed(
      slugs,
      catalogToApiSources(priceSourceCatalog)
    );
    const quotesRaw = result.quotes;
    const usdQuoteFromFetch = quotesRaw.find((quote) => quote.slug === USD_RATE_SOURCE_SLUG);
    const nextUsdRate =
      usdQuoteFromFetch && usdQuoteFromFetch.priceToman > 0
        ? usdQuoteFromFetch.priceToman
        : effectiveUsd;

    const quotes = applyConversionRatesToQuotes(
      mergeGlobalUsdDollarQuotes(quotesRaw, refreshableAssets, nextUsdRate),
      buildConversionConfigMap(priceSourceSettings),
      nextUsdRate
    );
    if (quotes.length === 0) {
      return {
        updatedAssetCount: 0,
        failedProviders: result.failedProviders,
        unresolvedSlugs: result.unresolvedSlugs,
        unknownRequestedSlugs: result.unknownRequestedSlugs,
      };
    }

    const quoteBySlug = new Map(quotes.map((quote) => [quote.slug, quote]));

    if (usdQuoteFromFetch && usdQuoteFromFetch.priceToman > 0) {
      setLocalUsd(String(usdQuoteFromFetch.priceToman));
    }

    setLocalPrices((prev) => {
      const next = { ...prev };
      for (const asset of refreshableAssets) {
        const slug = asset.price_source_id;
        if (!slug) continue;
        const quote = quoteBySlug.get(slug);
        if (!quote) continue;
        next[asset.id] = {
          toman: toTomanInput(quote.priceToman),
          usd:
            nextUsdRate > 0
              ? toUsdInput(quote.priceToman / nextUsdRate)
              : (next[asset.id]?.usd ?? ''),
        };
      }
      return next;
    });

    return {
      updatedAssetCount: quotes.filter((quote) => quote.slug !== USD_RATE_SOURCE_SLUG).length,
      failedProviders: result.failedProviders,
      unresolvedSlugs: result.unresolvedSlugs,
      unknownRequestedSlugs: result.unknownRequestedSlugs,
    };
  };

  const handleRefreshProviders = async (silent = false) => {
    setIsRefreshingProviders(true);
    try {
      const refresh = await applyProviderQuotes();
      if (!silent) {
        if (refresh.updatedAssetCount > 0) {
          toast.success(`${refresh.updatedAssetCount} قیمت دارایی و نرخ دلار بروزرسانی شد.`);
        } else {
          toast.info('قیمت معتبری برای بروزرسانی دریافت نشد.');
        }
        if (refresh.failedProviders.length > 0 || refresh.unresolvedSlugs.length > 0 || refresh.unknownRequestedSlugs.length > 0) {
          const providerMsg = refresh.failedProviders
            .map((p) => `${p.provider}: ${p.error}`)
            .join(' | ');
          const unresolvedMsg = refresh.unresolvedSlugs
            .map((u) => `${u.slug}: ${u.reason}`)
            .join(' | ');
          const unknownMsg = refresh.unknownRequestedSlugs.join(', ');
          const detail = [providerMsg, unresolvedMsg, unknownMsg ? `unknown: ${unknownMsg}` : '']
            .filter(Boolean)
            .join(' | ');
          toast.error(`بخشی از بروزرسانی انجام نشد. ${detail}`, { duration: 10000 });
        }
      }
    } catch (error) {
      if (!silent) {
        const detail = error instanceof Error ? error.message : String(error);
        toast.error(`دریافت قیمت از منبع بیرونی ناموفق بود. ${detail}`, {
          duration: 14_000,
        });
      }
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
          newUsd = toUsdInput(n / effectiveUsd);
        }
      } else {
        newUsd = canonical;
        const n = Number(canonical);
        if (canonical !== '' && canonical !== '.' && !Number.isNaN(n)) {
          newToman = toTomanInput(n * effectiveUsd);
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
          next[id] = { ...row, toman: toTomanInput(u * newUsd) };
        }
      }
      return next;
    });
  };

  const handleSavePrices = async () => {
    if (!user) return;
    setIsSaving(true);
    try {
      for (const c of otherCurrencies) {
        const raw = localOtherRates[c]?.trim();
        if (!raw) continue;
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          toast.error(`نرخ نامعتبر برای ${CURRENCY_META[c].label}.`);
          return;
        }
      }

      const assetUpdates = assets.map((a) => ({
        id: a.id,
        user_id: a.user_id,
        category_id: a.category_id,
        name: a.name,
        unit: a.unit,
        decimal_places: a.decimal_places,
        price_toman: Number(localPrices[a.id]?.toman || 0),
        price_usd: Number(localPrices[a.id]?.usd || 0),
        icon_url: a.icon_url,
        price_source_id: a.price_source_id,
        include_in_profit_loss: a.include_in_profit_loss ?? true,
        include_in_balance: a.include_in_balance ?? true,
      }));

      const usdNum = Number(localUsd);
      const now = new Date().toISOString();
      const rateRows: {
        user_id: string;
        currency: RateCurrency;
        toman_per_unit: number;
        updated_at: string;
      }[] = [];

      if (Number.isFinite(usdNum) && usdNum > 0) {
        rateRows.push({
          user_id: user.id,
          currency: 'USD',
          toman_per_unit: usdNum,
          updated_at: now,
        });
      }

      for (const c of otherCurrencies) {
        const raw = localOtherRates[c]?.trim();
        if (!raw) continue;
        rateRows.push({
          user_id: user.id,
          currency: c,
          toman_per_unit: Number(raw),
          updated_at: now,
        });
      }

      const assetPromise = supabase.from('assets').upsert(assetUpdates).select();
      const ratePromise =
        rateRows.length > 0
          ? supabase
              .from('currency_rates')
              .upsert(rateRows, { onConflict: 'user_id,currency' })
              .select()
          : null;

      const [assetRes, rateRes] = await Promise.all([assetPromise, ratePromise]);

      if (assetRes.error) throw assetRes.error;
      if (rateRes?.error) throw rateRes.error;

      const priceSourceOk = await priceSourceControl.save();
      if (!priceSourceOk) return;

      setAssets((assetRes.data as typeof assets) || []);

      if (rateRes) {
        const fresh = (rateRes.data as CurrencyRate[]) || [];
        setCurrencyRates((prev) => {
          const map = new Map(prev.map((r) => [r.currency, r]));
          fresh.forEach((r) => map.set(r.currency, r));
          return Array.from(map.values());
        });
      }

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

      toast.success('قیمت‌ها و نرخ‌ها ذخیره شد.');
      router.back();
    } catch (error) {
      toast.error('خطا در ذخیره.');
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
        <h2 className="text-lg font-bold text-white flex-1">قیمت‌ها و نرخ‌ها</h2>
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
        {refreshableAssets.length > 0 && (
          <div
            className={`flex items-start gap-2 rounded-xl px-3 py-2.5 border ${
              autoPriceHealth.isHealthy
                ? 'bg-emerald-500/10 border-emerald-500/20'
                : 'bg-amber-500/10 border-amber-500/20'
            }`}
          >
            {autoPriceHealth.isHealthy ? (
              <RefreshCw size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle size={14} className="text-amber-400 mt-0.5 shrink-0" />
            )}
            <p
              className={`text-[11px] leading-relaxed ${
                autoPriceHealth.isHealthy ? 'text-emerald-200' : 'text-amber-200'
              }`}
            >
              {autoPriceHealth.isHealthy
                ? `قیمت خودکار ${autoPriceHealth.syncedTodayCount.toLocaleString('fa-IR')} دارایی امروز دریافت شده (بروزرسانی روزانه ~۰۹:۰۰).`
                : `قیمت خودکار ${autoPriceHealth.missingTodayCount.toLocaleString('fa-IR')} از ${autoPriceHealth.autoAssetCount.toLocaleString('fa-IR')} دارایی امروز دریافت نشده — دکمه بروزرسانی را بزنید یا منبع قیمت را بررسی کنید.`}
            </p>
          </div>
        )}

        <div className="bg-purple-900/20 border border-purple-500/30 p-5 rounded-3xl">
          <label className="block text-sm text-purple-300 mb-2 font-medium">
            نرخ دلار (تومان)
          </label>
          <FormattedNumberInput
            value={localUsd}
            onValueChange={handleUsdRateChange}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-white text-left focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all"
            dir="ltr"
          />
        </div>

        {otherCurrencies.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-slate-300">نرخ ارزهای کیف پول</p>
            {otherCurrencies.map((c) => {
              const meta = CURRENCY_META[c];
              return (
                <div
                  key={c}
                  className="bg-[#1A1B26] p-4 rounded-2xl border border-white/5 space-y-2"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-300 text-sm font-bold"
                      dir="ltr"
                    >
                      {meta.symbol}
                    </div>
                    <div>
                      <p className="text-slate-200 text-sm font-medium">{meta.label}</p>
                      <p className="text-slate-500 text-[11px]" dir="ltr">
                        1 {c} = ? تومان
                      </p>
                    </div>
                  </div>
                  <FormattedNumberInput
                    value={localOtherRates[c] ?? ''}
                    onValueChange={(canonical) =>
                      setLocalOtherRates((prev) => ({ ...prev, [c]: canonical }))
                    }
                    className="w-full bg-[#222436] border border-white/10 rounded-xl p-3 text-white text-sm outline-none focus:border-purple-500 text-left"
                    dir="ltr"
                    placeholder="0"
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="bg-white/5 border border-white/8 p-4 rounded-2xl text-sm text-slate-300">
          دریافت قیمت زنده با دکمهٔ رفرش یا رفرش داشبورد انجام می‌شود.
        </div>

        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-300">قیمت دارایی‌ها</p>
          {visibleAssets.map((asset) => (
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
                      onValueChange={(c) => handlePriceChange(asset.id, 'usd', c)}
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
                      onValueChange={(c) => handlePriceChange(asset.id, 'toman', c)}
                      className="w-full bg-[#222436] border border-white/5 rounded-xl py-2 px-3 pl-7 text-white text-left text-sm focus:border-purple-500 outline-none transition-all"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
          {visibleAssets.length === 0 && (
            <div className="bg-[#1A1B26] p-6 rounded-2xl border border-white/5 text-center text-slate-500 text-sm">
              دارایی با مقدار بیشتر از صفر برای بروزرسانی قیمت وجود ندارد.
            </div>
          )}
        </div>

        <div className="border border-white/5 rounded-2xl overflow-hidden">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="w-full flex items-center justify-between p-4 bg-[#1A1B26] text-right hover:bg-[#222436] transition-colors"
          >
            <span className="text-sm font-medium text-slate-300">تنظیمات پیشرفته</span>
            <ChevronDown
              size={18}
              className={`text-slate-500 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {advancedOpen && (
            <div className="p-4 pt-0 bg-[#1A1B26] border-t border-white/5 space-y-6">
              <PriceSourceCatalogSection />
              <div className="border-t border-white/5 pt-4">
                <p className="text-xs font-medium text-slate-400 mb-3">ضرایب تبدیل</p>
                <PriceSourceAdvancedSection
                  slugs={boundSlugs}
                  control={priceSourceControl}
                />
              </div>
            </div>
          )}
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
          'ذخیره'
        )}
      </button>
    </div>
  );
}
