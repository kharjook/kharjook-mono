import { createContext, Script } from 'node:vm';
import { NextResponse } from 'next/server';
import {
  APP_GLOBAL_USD_SLUG,
  findPriceSource,
  type PriceSource,
} from '@/features/prices/constants/price-sources';

export const runtime = 'nodejs';
/** Vercel: Zarpay is two sequential fetches; prod TLS + cold start needs headroom. */
export const maxDuration = 60;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

/** Aban REST one round-trip; datacenter egress can be slower than localhost. */
const ABAN_FETCH_TIMEOUT_MS = 32_000;
/** Zarpay: HTML challenge then JSON — one budget for both hops. */
const ZARPAY_CHAIN_TIMEOUT_MS = 52_000;

function formatUpstreamError(reason: unknown): string {
  const msg =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'object' && reason !== null && 'message' in reason
        ? String((reason as { message: unknown }).message)
        : String(reason);
  const name = reason instanceof Error ? reason.name : '';
  if (
    name === 'AbortError' ||
    msg.includes('aborted') ||
    msg.includes('The operation was aborted')
  ) {
    return 'Upstream request timed out or was aborted (network or serverless limit)';
  }
  return msg;
}

interface ProviderQuote {
  slug: string;
  provider: PriceSource['provider'];
  priceToman: number;
  fetchedAt: string;
}

interface ZarpayCoinRow {
  symbol: string;
  buy_price: string;
  sell_price: string;
}

interface AbanTetherMarketRow {
  symbol: string;
  buy_price: string;
  sell_price: string;
  active?: boolean;
}

function solveZarpayCookieHeader(html: string): string {
  const challenge = html.match(
    /<script type="text\/javascript">([\s\S]*?)<\/script><\/body>/
  )?.[1];

  if (!challenge) {
    throw new Error('Zarpay challenge script not found.');
  }

  const cookies: string[] = [];
  const document = {
    addEventListener: (_event: string, callback: () => void) => callback(),
  };

  Object.defineProperty(document, 'cookie', {
    get() {
      return cookies.at(-1) ?? '';
    },
    set(value: string) {
      cookies.push(value);
    },
  });

  const context = createContext({
    define: undefined,
    exports: undefined,
    module: undefined,
    document,
    location: { reload() {} },
    setTimeout: (callback: () => void) => callback(),
    encodeURIComponent,
    Math,
    String,
    Array,
    Object,
    Number,
    Boolean,
    RegExp,
    Date,
    eval,
    console,
  });

  new Script(challenge).runInContext(context, { timeout: 5000 });

  const header = cookies.map((value) => value.split(';', 1)[0]).join('; ');
  if (!header) {
    throw new Error('Zarpay challenge produced no cookies.');
  }
  return header;
}

async function fetchZarpayCoins(): Promise<ZarpayCoinRow[]> {
  const url = 'https://zarpay24.com/market/coins/';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ZARPAY_CHAIN_TIMEOUT_MS);
  let challengeHtml: string;
  let payload: string;
  try {
    const res1 = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'user-agent': USER_AGENT },
    });
    if (!res1.ok) {
      throw new Error(`Remote fetch failed: ${res1.status} ${res1.statusText}`);
    }
    challengeHtml = await res1.text();
    const cookie = solveZarpayCookieHeader(challengeHtml);
    const res2 = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        cookie,
        accept: 'application/json, text/plain, */*',
      },
    });
    if (!res2.ok) {
      throw new Error(`Remote fetch failed: ${res2.status} ${res2.statusText}`);
    }
    payload = await res2.text();
  } finally {
    clearTimeout(timer);
  }

  const parsed = JSON.parse(payload) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Zarpay market payload is not an array.');
  }

  return parsed as ZarpayCoinRow[];
}

async function fetchAbanTetherMarkets(): Promise<Record<string, AbanTetherMarketRow>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ABAN_FETCH_TIMEOUT_MS);
  let payload = '';
  try {
    const response = await fetch('https://api.abantether.com/api/v1/manager/otc/ticker', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json',
      },
    });
    payload = await response.text();
  } finally {
    clearTimeout(timer);
  }
  const parsed = JSON.parse(payload) as unknown;
  const markets = extractAbanMarketsFromPayload(parsed);
  if (Object.keys(markets).length === 0) {
    throw new Error(`AbanTether API payload has no parseable markets. body=${payload.slice(0, 300)}`);
  }
  return markets;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function extractAbanMarketsFromPayload(payload: unknown): Record<string, AbanTetherMarketRow> {
  if (!payload || typeof payload !== 'object') return {};
  const root = payload as Record<string, unknown>;
  const out: Record<string, AbanTetherMarketRow> = {};

  const oldMarkets = (root.data as { markets?: unknown } | undefined)?.markets;
  if (oldMarkets && typeof oldMarkets === 'object') {
    return oldMarkets as Record<string, AbanTetherMarketRow>;
  }

  const symbols = (
    (root.data as { symbols?: unknown } | undefined)?.symbols ??
    root.symbols
  ) as Record<string, unknown> | undefined;
  if (symbols && typeof symbols === 'object') {
    for (const [pair, row] of Object.entries(symbols)) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const sell = toNumber(rec.sell_price ?? rec.sell ?? rec.price);
      const buy = toNumber(rec.buy_price ?? rec.buy ?? rec.price);
      if (!(sell > 0) && !(buy > 0)) continue;
      out[pair] = {
        symbol: String(rec.symbol ?? pair),
        sell_price: String(sell > 0 ? sell : buy),
        buy_price: String(buy > 0 ? buy : sell),
      };
    }
  }

  const details = root.data;
  if (Array.isArray(details)) {
    for (const detail of details) {
      if (!detail || typeof detail !== 'object') continue;
      const rec = detail as Record<string, unknown>;
      const loc = rec.loc;
      const input = rec.input;
      if (!Array.isArray(loc) || loc.length < 2 || loc[0] !== 'symbols') continue;
      if (!input || typeof input !== 'object') continue;
      const pair = String(loc[1]);
      const row = input as Record<string, unknown>;
      const sell = toNumber(row.sell_price ?? row.sell ?? row.price);
      const buy = toNumber(row.buy_price ?? row.buy ?? row.price);
      if (!(sell > 0) && !(buy > 0)) continue;
      out[pair] = {
        symbol: String(row.symbol ?? pair),
        sell_price: String(sell > 0 ? sell : buy),
        buy_price: String(buy > 0 ? buy : sell),
      };
    }
  }

  return out;
}

function toZarpayQuote(
  source: PriceSource,
  market: ZarpayCoinRow[]
): ProviderQuote | null {
  if (source.provider !== 'zarpay' || !source.fetchKey) return null;

  const row = market.find((item) => item.symbol === source.fetchKey);
  if (!row) return null;

  // For portfolio valuation we prefer the realizable mark, so use sell_price.
  const sell = Number(row.sell_price);
  const buy = Number(row.buy_price);
  const priceToman = sell > 0 ? sell : buy;

  if (!Number.isFinite(priceToman) || priceToman <= 0) return null;

  return {
    slug: source.slug,
    provider: source.provider,
    priceToman,
    fetchedAt: new Date().toISOString(),
  };
}

function toAbanTetherQuote(
  source: PriceSource,
  markets: Record<string, AbanTetherMarketRow>
): ProviderQuote | null {
  if (source.provider !== 'abantether' || !source.fetchKey) return null;

  const pairKey = `${source.fetchKey}IRT`;
  const row = markets[pairKey];
  if (!row) return null;

  // Same valuation rule as other providers: realizable mark = sell side.
  const sell = Number(row.sell_price);
  const buy = Number(row.buy_price);
  const priceToman = sell > 0 ? sell : buy;

  if (!Number.isFinite(priceToman) || priceToman <= 0) return null;

  return {
    slug: source.slug,
    provider: source.provider,
    priceToman,
    fetchedAt: new Date().toISOString(),
  };
}

function toAppDollarQuote(
  source: PriceSource,
  markets: Record<string, AbanTetherMarketRow>
): ProviderQuote | null {
  if (source.slug !== APP_GLOBAL_USD_SLUG) return null;
  const usdt = toAbanTetherQuote(
    { ...source, provider: 'abantether', fetchKey: 'USDT' },
    markets
  );
  if (!usdt) return null;

  return {
    slug: source.slug,
    provider: source.provider,
    priceToman: usdt.priceToman,
    fetchedAt: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  try {
    let requestedSlugs: string[];
    try {
      const body = (await request.json()) as { slugs?: unknown };
      requestedSlugs = Array.isArray(body?.slugs)
        ? body.slugs.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return NextResponse.json(
        { error: 'INVALID_JSON', quotes: [] as ProviderQuote[] },
        {
          status: 400,
          headers: { 'Cache-Control': 'no-store, max-age=0' },
        }
      );
    }

    const unknownRequestedSlugs = Array.from(
      new Set(requestedSlugs.filter((slug) => !findPriceSource(slug)))
    );

    const sources = Array.from(
      new Map(
        requestedSlugs
          .map((slug) => findPriceSource(slug))
          .filter((source): source is PriceSource => !!source && !!source.fetchKey)
          .map((source) => [source.slug, source])
      ).values()
    );

    if (sources.length === 0) {
      return NextResponse.json(
        { quotes: [] satisfies ProviderQuote[] },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } }
      );
    }

    const abanTetherSources = sources.filter(
      (source) => source.provider === 'abantether'
    );
    const zarpaySources = sources.filter((source) => source.provider === 'zarpay');
    // Provider outages should degrade partially, not take down the whole API.
    const [abanTetherRes, zarpayRes] = await Promise.allSettled([
      abanTetherSources.length > 0
        ? fetchAbanTetherMarkets()
        : Promise.resolve({} as Record<string, AbanTetherMarketRow>),
      zarpaySources.length > 0 ? fetchZarpayCoins() : Promise.resolve([] as ZarpayCoinRow[]),
    ]);
    const abanTetherMarkets =
      abanTetherRes.status === 'fulfilled' ? abanTetherRes.value : {};
    const zarpayMarket = zarpayRes.status === 'fulfilled' ? zarpayRes.value : [];

    if (abanTetherRes.status === 'rejected') {
      console.warn('price quote refresh warning: abantether failed', abanTetherRes.reason);
    }
    if (zarpayRes.status === 'rejected') {
      console.warn('price quote refresh warning: zarpay failed', zarpayRes.reason);
    }

    const quotes = sources
      .map((source) =>
        source.slug === APP_GLOBAL_USD_SLUG
          ? toAppDollarQuote(source, abanTetherMarkets)
          : source.provider === 'abantether'
            ? toAbanTetherQuote(source, abanTetherMarkets)
            : toZarpayQuote(source, zarpayMarket)
      )
      .filter((quote): quote is ProviderQuote => !!quote);

    const resolved = new Set(quotes.map((q) => q.slug));
    const unresolvedSlugs = sources
      .filter((s) => !resolved.has(s.slug))
      .map((s) => ({
        slug: s.slug,
        reason:
          s.provider === 'abantether' && abanTetherRes.status === 'rejected'
            ? 'AbanTether API unavailable'
            : s.provider === 'zarpay' && zarpayRes.status === 'rejected'
              ? 'Zarpay provider unavailable'
              : 'Provider responded but no quote found for fetchKey',
      }));

    const failedProviders: Array<{ provider: string; error: string }> = [];
    if (abanTetherRes.status === 'rejected') {
      failedProviders.push({
        provider: 'abantether',
        error: formatUpstreamError(abanTetherRes.reason),
      });
    }
    if (zarpayRes.status === 'rejected') {
      failedProviders.push({
        provider: 'zarpay',
        error: formatUpstreamError(zarpayRes.reason),
      });
    }

    return NextResponse.json(
      {
        quotes,
        failedProviders,
        unresolvedSlugs,
        unknownRequestedSlugs,
      },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (error) {
    console.error('price quote refresh failed', error);
    return NextResponse.json(
      { error: 'PRICE_QUOTE_REFRESH_FAILED' },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  }
}
