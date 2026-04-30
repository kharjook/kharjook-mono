'use client';

import { supabase } from '@/shared/lib/supabase/client';
import {
  APP_GLOBAL_USD_SLUG,
  findPriceSource,
} from '@/features/prices/constants/price-sources';
import { formatJalaali, todayJalaali } from '@/shared/utils/jalali';
import type {
  Asset,
  CurrencyRate,
  DailyPrice,
  RateCurrency,
} from '@/shared/types/domain';

export interface ProviderQuote {
  slug: string;
  provider: string;
  priceToman: number;
  fetchedAt: string;
}

interface FetchProviderQuotesResponse {
  quotes: ProviderQuote[];
  failedProviders?: Array<{ provider: string; error: string }>;
  unresolvedSlugs?: Array<{ slug: string; reason: string }>;
  unknownRequestedSlugs?: string[];
}

export interface ProviderQuoteFetchResult {
  quotes: ProviderQuote[];
  failedProviders: Array<{ provider: string; error: string }>;
  unresolvedSlugs: Array<{ slug: string; reason: string }>;
  unknownRequestedSlugs: string[];
}

type AbanMarketRow = {
  symbol?: string;
  coin_symbol?: string;
  base_symbol?: string;
  buy?: number | string;
  sell?: number | string;
  buy_price?: number | string;
  sell_price?: number | string;
  price?: number | string;
  [key: string]: unknown;
};

function parseAbanCoins(payload: unknown): AbanMarketRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const directCandidates = [root.data, root.payload, root.result, root.coins, root.items];
  for (const c of directCandidates) {
    if (Array.isArray(c)) return c as AbanMarketRow[];
    if (c && typeof c === 'object') {
      const nested = c as Record<string, unknown>;
      const arrCandidates = [nested.coins, nested.items, nested.list, nested.data];
      for (const arr of arrCandidates) {
        if (Array.isArray(arr)) return arr as AbanMarketRow[];
      }
      const mapCandidates = [nested.symbols, nested.markets, nested.tickers];
      for (const map of mapCandidates) {
        if (map && typeof map === 'object' && !Array.isArray(map)) {
          return Object.values(map as Record<string, unknown>).filter(
            (v): v is AbanMarketRow => !!v && typeof v === 'object'
          );
        }
      }
    }
  }
  return [];
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function fetchAbanQuotesClient(
  abanSlugs: string[]
): Promise<{
  quotes: ProviderQuote[];
  failedProviders: Array<{ provider: string; error: string }>;
  unresolvedSlugs: Array<{ slug: string; reason: string }>;
}> {
  if (abanSlugs.length === 0) {
    return { quotes: [], failedProviders: [], unresolvedSlugs: [] };
  }
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
    return {
      quotes: [],
      failedProviders: [{ provider: 'abantether', error: 'WebSocket unavailable in this runtime' }],
      unresolvedSlugs: abanSlugs.map((slug) => ({ slug, reason: 'AbanTether websocket unavailable' })),
    };
  }

  const markets = await new Promise<Record<string, { sell: number; buy: number }>>((resolve, reject) => {
    const ws = new WebSocket('wss://ws.abantether.com/public');
    let done = false;
    let seenFrames = 0;
    const maxFrames = 20;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      reject(new Error('AbanTether websocket timeout'));
    }, 20000);
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try { ws.close(); } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const succeed = (data: Record<string, { sell: number; buy: number }>) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try { ws.close(); } catch {}
      resolve(data);
    };
    ws.onerror = () => fail(new Error('AbanTether websocket error'));
    ws.onclose = () => {
      if (!done) fail(new Error('AbanTether websocket closed before payload'));
    };
    ws.onopen = () => {
      const packets = [
        { action: 'subscribe', channel: 'coins_list_v2' },
        { action: 'subscribe', channel: 'coin_list_v2' },
        { event: 'subscribe', channel: 'coins_list_v2' },
        { event: 'subscribe', channel: 'coin_list_v2' },
        { op: 'subscribe', channel: 'coins_list_v2' },
        { op: 'subscribe', channel: 'coin_list_v2' },
        { action: 'subscribe', channels: ['coins_list_v2'] },
        { action: 'subscribe', channels: ['coin_list_v2'] },
        { channel: 'coins_list_v2' },
        { channel: 'coin_list_v2' },
      ];
      for (const packet of packets) ws.send(JSON.stringify(packet));
      // Some gateways stay silent unless heartbeat is seen.
      const heartbeats = [{ action: 'ping' }, { event: 'ping' }, { op: 'ping' }];
      for (const hb of heartbeats) ws.send(JSON.stringify(hb));
    };
    ws.onmessage = (event) => {
      seenFrames += 1;
      try {
        const raw = JSON.parse(String(event.data ?? '')) as unknown;
        const coins = parseAbanCoins(raw);
        if (coins.length === 0) {
          if (seenFrames >= maxFrames) fail(new Error('AbanTether websocket did not deliver coins payload'));
          return;
        }
        const parsed: Record<string, { sell: number; buy: number }> = {};
        for (const coin of coins) {
          const symbol = String(coin.symbol ?? coin.coin_symbol ?? coin.base_symbol ?? '').toUpperCase();
          if (!symbol) continue;
          const sell = toNumber(coin.sell_price ?? coin.sell ?? coin.price);
          const buy = toNumber(coin.buy_price ?? coin.buy ?? coin.price);
          if (!(sell > 0) && !(buy > 0)) continue;
          parsed[`${symbol}IRT`] = { sell: sell > 0 ? sell : buy, buy: buy > 0 ? buy : sell };
        }
        if (Object.keys(parsed).length === 0) {
          if (seenFrames >= maxFrames) fail(new Error('AbanTether websocket payload had no usable prices'));
          return;
        }
        succeed(parsed);
      } catch (error) {
        fail(error);
      }
    };
  });

  const quotes: ProviderQuote[] = [];
  const unresolvedSlugs: Array<{ slug: string; reason: string }> = [];
  for (const slug of abanSlugs) {
    const source = findPriceSource(slug);
    if (!source) {
      unresolvedSlugs.push({ slug, reason: 'Unknown source slug' });
      continue;
    }
    const key = slug === APP_GLOBAL_USD_SLUG ? 'USDTIRT' : `${source.fetchKey ?? ''}IRT`;
    const row = markets[key];
    if (!row) {
      unresolvedSlugs.push({ slug, reason: `No ${key} quote in websocket payload` });
      continue;
    }
    const priceToman = row.sell > 0 ? row.sell : row.buy;
    if (!(priceToman > 0)) {
      unresolvedSlugs.push({ slug, reason: `Invalid ${key} quote value` });
      continue;
    }
    quotes.push({
      slug,
      provider: source.provider,
      priceToman,
      fetchedAt: new Date().toISOString(),
    });
  }
  return { quotes, failedProviders: [], unresolvedSlugs };
}

interface PersistProviderQuotesInput {
  userId: string;
  assets: Asset[];
  dailyPrices: DailyPrice[];
  usdRate: number;
  quotes: ProviderQuote[];
}

interface PersistProviderQuotesResult {
  assets: Asset[];
  dailyPrices: DailyPrice[];
}

export function mergeById<T extends { id: string }>(prev: T[], next: T[]): T[] {
  if (next.length === 0) return prev;
  const map = new Map(prev.map((item) => [item.id, item]));
  for (const item of next) map.set(item.id, item);
  return Array.from(map.values());
}

export function mergeDailyPrices(prev: DailyPrice[], next: DailyPrice[]): DailyPrice[] {
  if (next.length === 0) return prev;
  const keyOf = (price: DailyPrice) =>
    `${price.user_id}|${price.asset_id}|${price.date_string}`;
  const map = new Map(prev.map((price) => [keyOf(price), price]));
  for (const price of next) map.set(keyOf(price), price);
  return Array.from(map.values());
}

export function mergeCurrencyRates(
  prev: CurrencyRate[],
  next: CurrencyRate[]
): CurrencyRate[] {
  if (next.length === 0) return prev;
  const map = new Map(prev.map((rate) => [rate.currency, rate]));
  for (const rate of next) map.set(rate.currency, rate);
  return Array.from(map.values());
}

/**
 * Ensures a quote for {@link APP_GLOBAL_USD_SLUG} exists whenever any asset uses
 * it, using the same canonical USD/Toman rate as the rest of the app.
 */
export function mergeGlobalUsdDollarQuotes(
  quotes: ProviderQuote[],
  assets: { price_source_id?: string | null }[],
  usdTomanPerUnit: number
): ProviderQuote[] {
  if (!(usdTomanPerUnit > 0)) return quotes;
  const needs = assets.some((a) => a.price_source_id === APP_GLOBAL_USD_SLUG);
  if (!needs) return quotes;

  const merged = quotes.filter((q) => q.slug !== APP_GLOBAL_USD_SLUG);
  merged.push({
    slug: APP_GLOBAL_USD_SLUG,
    provider: 'app',
    priceToman: usdTomanPerUnit,
    fetchedAt: new Date().toISOString(),
  });
  return merged;
}

export async function fetchProviderQuotes(slugs: string[]): Promise<ProviderQuote[]> {
  const result = await fetchProviderQuotesDetailed(slugs);
  return result.quotes;
}

export async function fetchProviderQuotesDetailed(slugs: string[]): Promise<ProviderQuoteFetchResult> {
  const uniqueSlugs = Array.from(new Set(slugs.filter(Boolean)));
  if (uniqueSlugs.length === 0) {
    return {
      quotes: [],
      failedProviders: [],
      unresolvedSlugs: [],
      unknownRequestedSlugs: [],
    };
  }

  const unknownRequestedSlugs = uniqueSlugs.filter((slug) => !findPriceSource(slug));
  const knownSlugs = uniqueSlugs.filter((slug) => !!findPriceSource(slug));
  const abanSlugs = knownSlugs.filter((slug) => findPriceSource(slug)?.provider === 'abantether' || slug === APP_GLOBAL_USD_SLUG);
  const nonAbanSlugs = knownSlugs.filter((slug) => !abanSlugs.includes(slug));

  const abanResult = await fetchAbanQuotesClient(abanSlugs).catch((error) => ({
    quotes: [] as ProviderQuote[],
    failedProviders: [
      { provider: 'abantether', error: error instanceof Error ? error.message : String(error) },
    ],
    unresolvedSlugs: abanSlugs.map((slug) => ({ slug, reason: 'AbanTether websocket unavailable' })),
  }));

  if (nonAbanSlugs.length === 0) {
    return {
      quotes: abanResult.quotes,
      failedProviders: abanResult.failedProviders,
      unresolvedSlugs: abanResult.unresolvedSlugs,
      unknownRequestedSlugs,
    };
  }

  const response = await fetch('/api/prices/quotes', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    credentials: 'omit',
    cache: 'no-store',
    body: JSON.stringify({ slugs: nonAbanSlugs }),
  });

  const raw = await response.text();
  if (!response.ok) {
    const hint = raw.slice(0, 400).trim() || '(empty body)';
    throw new Error(`Provider quote request failed: ${response.status} — ${hint}`);
  }

  const payload = JSON.parse(raw) as FetchProviderQuotesResponse;
  return {
    quotes: [...abanResult.quotes, ...(Array.isArray(payload.quotes) ? payload.quotes : [])],
    failedProviders: [
      ...abanResult.failedProviders,
      ...(Array.isArray(payload.failedProviders) ? payload.failedProviders : []),
    ],
    unresolvedSlugs: [
      ...abanResult.unresolvedSlugs,
      ...(Array.isArray(payload.unresolvedSlugs) ? payload.unresolvedSlugs : []),
    ],
    unknownRequestedSlugs: [
      ...unknownRequestedSlugs,
      ...(Array.isArray(payload.unknownRequestedSlugs) ? payload.unknownRequestedSlugs : []),
    ],
  };
}

export async function persistCurrencyRate(
  userId: string,
  currency: RateCurrency,
  tomanPerUnit: number
): Promise<CurrencyRate[]> {
  const { data, error } = await supabase
    .from('currency_rates')
    .upsert(
      [
        {
          user_id: userId,
          currency,
          toman_per_unit: tomanPerUnit,
          updated_at: new Date().toISOString(),
        },
      ],
      { onConflict: 'user_id,currency' }
    )
    .select();

  if (error) throw error;
  return (data as CurrencyRate[]) || [];
}

export async function persistProviderQuotes({
  userId,
  assets,
  dailyPrices,
  usdRate,
  quotes,
}: PersistProviderQuotesInput): Promise<PersistProviderQuotesResult> {
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

  if (assetUpdates.length === 0) {
    return { assets: [], dailyPrices: [] };
  }

  const { data: assetRows, error: assetError } = await supabase
    .from('assets')
    .upsert(assetUpdates)
    .select();

  if (assetError) throw assetError;

  const today = formatJalaali(todayJalaali());
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

  if (snapshotPayload.length === 0) {
    return {
      assets: (assetRows as Asset[]) || [],
      dailyPrices: [],
    };
  }

  const { data: dailyPriceRows, error: dailyPriceError } = await supabase
    .from('daily_prices')
    .upsert(snapshotPayload, {
      onConflict: 'user_id,asset_id,date_string',
    })
    .select();

  if (dailyPriceError) throw dailyPriceError;

  return {
    assets: (assetRows as Asset[]) || [],
    dailyPrices: (dailyPriceRows as DailyPrice[]) || [],
  };
}
