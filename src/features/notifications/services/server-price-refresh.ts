import { APP_GLOBAL_USD_SLUG } from '@/features/prices/constants/price-sources';
import {
  applyConversionRatesToQuotes,
  buildConversionConfigMap,
} from '@/features/prices/utils/conversion-rate';
import {
  catalogToApiSources,
  defaultRecordsForUser,
  recordsToCatalog,
} from '@/features/prices/utils/price-source-catalog';
import { fetchProviderQuotes } from '@/features/prices/services/fetch-provider-quotes';
import {
  mergeGlobalUsdDollarQuotes,
  type ProviderQuote,
} from '@/features/prices/utils/provider-quote-utils';
import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type {
  Asset,
  CurrencyRate,
  DailyPrice,
  PriceSourceRecord,
  PriceSourceSetting,
  RateCurrency,
  Transaction,
} from '@/shared/types/domain';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { formatJalaali, todayJalaaliInTimezone } from '@/shared/utils/jalali';
import { TEHRAN_TIMEZONE } from '@/features/notifications/telegram/utils/format-debts-list';

const USD_RATE_SOURCE_SLUG = 'abantether.usdt';

async function ensureDefaultPriceSourcesAdmin(userId: string): Promise<PriceSourceRecord[]> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from('price_sources')
    .select('slug')
    .eq('user_id', userId)
    .limit(1);

  if ((existing?.length ?? 0) > 0) return [];

  const rows = defaultRecordsForUser(userId);
  const { data, error } = await admin
    .from('price_sources')
    .upsert(rows, { onConflict: 'user_id,slug', ignoreDuplicates: true })
    .select();
  if (error) throw error;

  const now = new Date().toISOString();
  await admin.from('price_source_settings').upsert(
    rows.map((row) => ({
      user_id: userId,
      slug: row.slug,
      conversion_rate: 1,
      usd_factor: 'none' as const,
      updated_at: now,
    })),
    { onConflict: 'user_id,slug', ignoreDuplicates: true }
  );

  return (data as PriceSourceRecord[]) || rows;
}

async function persistCurrencyRateAdmin(
  userId: string,
  currency: RateCurrency,
  tomanPerUnit: number
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('currency_rates').upsert(
    {
      user_id: userId,
      currency,
      toman_per_unit: tomanPerUnit,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,currency' }
  );
  if (error) throw error;
}

async function persistProviderQuotesAdmin(input: {
  userId: string;
  assets: Asset[];
  dailyPrices: DailyPrice[];
  usdRate: number;
  quotes: ProviderQuote[];
}): Promise<number> {
  const { userId, assets, dailyPrices, usdRate, quotes } = input;
  const admin = createSupabaseAdminClient();
  const quoteBySlug = new Map(quotes.map((quote) => [quote.slug, quote]));

  const assetUpdates = assets
    .filter((asset) => !!asset.price_source_id && quoteBySlug.has(asset.price_source_id))
    .map((asset) => {
      const quote = quoteBySlug.get(asset.price_source_id!)!;
      return {
        id: asset.id,
        user_id: asset.user_id,
        category_id: asset.category_id,
        name: asset.name,
        unit: asset.unit,
        price_toman: quote.priceToman,
        price_usd: usdRate > 0 ? quote.priceToman / usdRate : 0,
        include_in_profit_loss: asset.include_in_profit_loss ?? true,
        include_in_balance: asset.include_in_balance ?? true,
      };
    });

  if (assetUpdates.length === 0) return 0;

  const { error: assetError } = await admin.from('assets').upsert(assetUpdates);
  if (assetError) throw assetError;

  const today = formatJalaali(todayJalaaliInTimezone(TEHRAN_TIMEZONE));
  const snapshotByAssetId = new Map(
    dailyPrices
      .filter((price) => price.date_string === today)
      .map((price) => [price.asset_id, price])
  );

  const snapshotPayload = assetUpdates
    .filter((asset) => {
      const existing = snapshotByAssetId.get(asset.id);
      return !existing || existing.source === 'auto';
    })
    .map((asset) => ({
      user_id: userId,
      asset_id: asset.id,
      date_string: today,
      price_toman: asset.price_toman,
      price_usd: asset.price_usd,
      source: 'auto' as const,
    }));

  if (snapshotPayload.length > 0) {
    const { error: dailyPriceError } = await admin.from('daily_prices').upsert(snapshotPayload, {
      onConflict: 'user_id,asset_id,date_string',
    });
    if (dailyPriceError) throw dailyPriceError;
  }

  return assetUpdates.length;
}

export interface RefreshUserPricesResult {
  updatedCount: number;
  usdRate: number;
  failedProviders: string[];
}

export async function refreshUserPricesFromProviders(
  userId: string
): Promise<RefreshUserPricesResult> {
  const admin = createSupabaseAdminClient();

  const [
    { data: assetsRows },
    { data: ratesRows },
    { data: dailyRows },
    { data: settingsRows },
    { data: sourcesRows },
  ] = await Promise.all([
    admin.from('assets').select('*').eq('user_id', userId),
    admin.from('currency_rates').select('*').eq('user_id', userId),
    admin.from('daily_prices').select('*').eq('user_id', userId),
    admin.from('price_source_settings').select('*').eq('user_id', userId),
    admin.from('price_sources').select('*').eq('user_id', userId),
  ]);

  let priceSources = (sourcesRows ?? []) as PriceSourceRecord[];
  let priceSourceSettings = (settingsRows ?? []) as PriceSourceSetting[];
  if (priceSources.length === 0) {
    const seeded = await ensureDefaultPriceSourcesAdmin(userId);
    if (seeded.length > 0) {
      priceSources = seeded;
      const { data: freshSettings } = await admin
        .from('price_source_settings')
        .select('*')
        .eq('user_id', userId);
      if (freshSettings) {
        priceSourceSettings = freshSettings as PriceSourceSetting[];
      }
    }
  }

  const assets = (assetsRows ?? []) as Asset[];
  const currencyRates = (ratesRows ?? []) as CurrencyRate[];
  const dailyPrices = (dailyRows ?? []) as DailyPrice[];

  const catalog = recordsToCatalog(priceSources);
  const conversionConfigs = buildConversionConfigMap(priceSourceSettings);
  const providerSlugs = Array.from(
    new Set(
      [USD_RATE_SOURCE_SLUG, ...assets.map((a) => a.price_source_id)].filter(
        (slug): slug is string => !!slug
      )
    )
  );

  if (providerSlugs.length === 0) {
    const usdRate = currencyRates.find((r) => r.currency === 'USD')?.toman_per_unit ?? 0;
    return { updatedCount: 0, usdRate, failedProviders: [] };
  }

  const { quotes: quotesRaw, failedProviders } = await fetchProviderQuotes({
    slugs: providerSlugs,
    sources: catalogToApiSources(catalog),
  });

  const usdQuote = quotesRaw.find((q) => q.slug === USD_RATE_SOURCE_SLUG);
  let effectiveUsdRate =
    usdQuote?.priceToman && usdQuote.priceToman > 0
      ? usdQuote.priceToman
      : Number(currencyRates.find((r) => r.currency === 'USD')?.toman_per_unit ?? 0);

  if (usdQuote && usdQuote.priceToman > 0) {
    await persistCurrencyRateAdmin(userId, 'USD', usdQuote.priceToman);
    effectiveUsdRate = usdQuote.priceToman;
  }

  if (!(effectiveUsdRate > 0)) {
    return {
      updatedCount: 0,
      usdRate: 0,
      failedProviders: failedProviders.map((f) => f.provider),
    };
  }

  const quotes = applyConversionRatesToQuotes(
    mergeGlobalUsdDollarQuotes(quotesRaw, assets, effectiveUsdRate),
    conversionConfigs,
    effectiveUsdRate
  );

  const updatedCount = await persistProviderQuotesAdmin({
    userId,
    assets,
    dailyPrices,
    usdRate: effectiveUsdRate,
    quotes,
  });

  return {
    updatedCount,
    usdRate: effectiveUsdRate,
    failedProviders: failedProviders.map((f) => f.provider),
  };
}

export async function processAutoPriceRefresh(): Promise<{
  usersProcessed: number;
  assetsUpdated: number;
  errors: string[];
}> {
  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await admin
    .from('assets')
    .select('user_id')
    .not('price_source_id', 'is', null);

  if (error) {
    return { usersProcessed: 0, assetsUpdated: 0, errors: [error.message] };
  }

  const userIds = Array.from(new Set((rows ?? []).map((row) => row.user_id as string)));
  let assetsUpdated = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    try {
      const result = await refreshUserPricesFromProviders(userId);
      assetsUpdated += result.updatedCount;
      if (result.failedProviders.length > 0) {
        errors.push(`${userId}:providers:${result.failedProviders.join(',')}`);
      }
    } catch (err) {
      errors.push(`${userId}:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { usersProcessed: userIds.length, assetsUpdated, errors };
}

export async function loadUserAssetsWithRates(userId: string): Promise<{
  assets: Asset[];
  usdRate: number;
}> {
  const admin = createSupabaseAdminClient();
  const [{ data: assets }, { data: rates }, { data: transactions }] = await Promise.all([
    admin.from('assets').select('*').eq('user_id', userId),
    admin.from('currency_rates').select('*').eq('user_id', userId),
    admin.from('transactions').select('*').eq('user_id', userId),
  ]);
  const usdRate =
    ((rates ?? []) as CurrencyRate[]).find((r) => r.currency === 'USD')?.toman_per_unit ?? 0;
  const txs = (transactions ?? []) as Transaction[];

  const held = ((assets ?? []) as Asset[]).filter((asset) => {
    if (asset.include_in_balance === false) return false;
    const stats = calculateAssetStats(asset, txs, 'TOMAN', usdRate);
    return stats.totalAmount > 0;
  });

  return { assets: held, usdRate };
}
