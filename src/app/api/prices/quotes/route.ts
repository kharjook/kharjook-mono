import { createContext, Script } from 'node:vm';
import dns from 'node:dns';
import { NextResponse } from 'next/server';
import {
  APP_GLOBAL_USD_SLUG,
  findPriceSource,
  type PriceSource,
} from '@/features/prices/constants/price-sources';

export const runtime = 'nodejs';
export const maxDuration = 60;

dns.setDefaultResultOrder('ipv4first');

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

const BROWSER_LIKE_HEADERS: Record<string, string> = {
  'accept-language': 'en-US,en;q=0.9,fa;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
};

const ABAN_FETCH_TIMEOUT_MS = 25_000;
const ZARPAY_FETCH_TIMEOUT_MS = 25_000;

const ABORT_RETRY_DELAY_MS = 600;

function isAbortLike(reason: unknown): boolean {
  const msg =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'object' && reason !== null && 'message' in reason
        ? String((reason as { message: unknown }).message)
        : String(reason);
  const name = reason instanceof Error ? reason.name : '';
  return (
    name === 'AbortError' ||
    msg.includes('aborted') ||
    msg.includes('The operation was aborted')
  );
}

function formatUpstreamError(reason: unknown): string {
  if (isAbortLike(reason)) {
    return 'Upstream request timed out or was aborted (network or serverless limit)';
  }
  const msg =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'object' && reason !== null && 'message' in reason
        ? String((reason as { message: unknown }).message)
        : String(reason);
  return msg;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin');
  if (origin) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      Vary: 'Origin',
    };
  }
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
}

function quoteResponse(
  request: Request,
  data: unknown,
  init?: { status?: number }
): NextResponse {
  return NextResponse.json(data, {
    status: init?.status ?? 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      ...corsHeaders(request),
    },
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withUpstreamRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (first) {
    if (!isAbortLike(first)) throw first;
    console.warn(`price quotes: ${label} aborted, retrying once`, first);
    await sleep(ABORT_RETRY_DELAY_MS);
    return await fn();
  }
}

interface ProviderQuote {
  slug: string;
  provider: PriceSource['provider'];
  priceToman: number;
  fetchedAt: string;
}

interface ZarpayCoinRow {
  symbol?: string;
  buy_price?: string | number;
  sell_price?: string | number;
  price?: string | number;
}

interface AbanTetherMarketRow {
  symbol?: string;
  buy_price?: string | number;
  sell_price?: string | number;
  buy?: string | number;
  sell?: string | number;
  price?: string | number;
  active?: boolean;
}

function tryParseJsonPayload(payload: string): unknown | null {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json, text/plain, */*',
        ...BROWSER_LIKE_HEADERS,
        ...(headers ?? {}),
      },
    });
    const payload = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} body=${payload.slice(0, 180)}`);
    }
    const parsed = tryParseJsonPayload(payload);
    if (!parsed) {
      throw new Error(`Upstream returned non-JSON payload: ${payload.slice(0, 180)}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function parseZarpayRows(payload: unknown): ZarpayCoinRow[] {
  if (Array.isArray(payload)) {
    return payload as ZarpayCoinRow[];
  }
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.data)) return root.data as ZarpayCoinRow[];
  if (Array.isArray(root.result)) return root.result as ZarpayCoinRow[];
  if (Array.isArray(root.coins)) return root.coins as ZarpayCoinRow[];
  return [];
}

function solveZarpayCookieHeader(html: string): string {
  const scripts = Array.from(
    html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi),
    (match) => match[1]?.trim()
  ).filter((code): code is string => !!code);

  if (scripts.length === 0) {
    throw new Error('Zarpay challenge scripts not found');
  }

  const cookies: string[] = [];
  const document = {
    addEventListener: (_event: string, callback: () => void) => callback(),
    getElementsByTagName: () => [{ innerHTML: '' }],
    getElementById: () => ({
      getElementsByClassName: () => [{ textContent: '' }],
      classList: { remove() {} },
    }),
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
    window: { Intl },
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

  for (const code of scripts) {
    new Script(code).runInContext(context, { timeout: 5000 });
  }

  const header = cookies.map((value) => value.split(';', 1)[0]).join('; ');
  if (!header) {
    throw new Error('Zarpay challenge produced no cookies');
  }
  return header;
}

async function fetchZarpayCoinsCore(): Promise<ZarpayCoinRow[]> {
  const url = 'https://zarpay24.com/market/coins/';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ZARPAY_FETCH_TIMEOUT_MS);
  let parsed: unknown | null = null;
  try {
    const first = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/json, text/plain, */*',
        ...BROWSER_LIKE_HEADERS,
      },
    });
    const firstPayload = await first.text();
    if (!first.ok) {
      throw new Error(`HTTP ${first.status} ${first.statusText} body=${firstPayload.slice(0, 180)}`);
    }
    parsed = tryParseJsonPayload(firstPayload);
    if (!parsed) {
      const cookie = solveZarpayCookieHeader(firstPayload);
      const second = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/json, text/plain, */*',
          ...BROWSER_LIKE_HEADERS,
          cookie,
        },
      });
      const secondPayload = await second.text();
      if (!second.ok) {
        throw new Error(
          `HTTP ${second.status} ${second.statusText} body=${secondPayload.slice(0, 180)}`
        );
      }
      parsed = tryParseJsonPayload(secondPayload);
      if (!parsed) {
        throw new Error(
          `Zarpay returned non-JSON after challenge: ${secondPayload.slice(0, 180)}`
        );
      }
    }
  } finally {
    clearTimeout(timer);
  }

  if (!parsed) {
    throw new Error('Zarpay response parsing failed');
  }

  const rows = parseZarpayRows(parsed);
  if (rows.length === 0) {
    throw new Error('Zarpay API payload contained no rows');
  }
  return rows;
}

function fetchZarpayCoins(): Promise<ZarpayCoinRow[]> {
  return withUpstreamRetry('zarpay', fetchZarpayCoinsCore);
}

async function fetchAbanTetherMarketsCore(): Promise<Record<string, AbanTetherMarketRow>> {
  const parsed = await fetchJsonWithTimeout(
    'https://api.abantether.com/api/v1/manager/otc/ticker',
    ABAN_FETCH_TIMEOUT_MS
  );
  const markets = extractAbanMarketsFromPayload(parsed);
  if (Object.keys(markets).length === 0) {
    throw new Error('AbanTether API payload has no parseable markets');
  }
  return markets;
}

function fetchAbanTetherMarkets(): Promise<Record<string, AbanTetherMarketRow>> {
  return withUpstreamRetry('abantether', fetchAbanTetherMarketsCore);
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

  const bySymbol = new Map(
    market.map((row) => [String(row.symbol ?? '').trim().toUpperCase(), row])
  );
  const row = bySymbol.get(String(source.fetchKey).trim().toUpperCase());
  if (!row) return null;

  const sell = toNumber(row.sell_price ?? row.price);
  const buy = toNumber(row.buy_price ?? row.price);
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

  const sell = toNumber(row.sell_price ?? row.sell ?? row.price);
  const buy = toNumber(row.buy_price ?? row.buy ?? row.price);
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

function abanSourcesSatisfiedByMarkets(
  abanTetherSources: PriceSource[],
  markets: Record<string, AbanTetherMarketRow>
): boolean {
  for (const s of abanTetherSources) {
    if (s.slug === APP_GLOBAL_USD_SLUG) {
      if (!toAppDollarQuote(s, markets)) return false;
    } else {
      if (!toAbanTetherQuote(s, markets)) return false;
    }
  }
  return true;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export async function POST(request: Request) {
  let unknownRequestedSlugs: string[] = [];
  try {
    let requestedSlugs: string[];
    try {
      const body = (await request.json()) as { slugs?: unknown };
      requestedSlugs = Array.isArray(body?.slugs)
        ? body.slugs.filter((value): value is string => typeof value === 'string')
        : [];
    } catch {
      return quoteResponse(
        request,
        { error: 'INVALID_JSON', quotes: [] as ProviderQuote[] },
        { status: 400 }
      );
    }

    unknownRequestedSlugs = Array.from(
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
      return quoteResponse(request, { quotes: [] satisfies ProviderQuote[] });
    }

    const abanTetherSources = sources.filter(
      (source) => source.provider === 'abantether'
    );
    const zarpaySources = sources.filter((source) => source.provider === 'zarpay');
    const needAbanFamily = abanTetherSources.length > 0;

    const [abanTetherRes, zarpayRes] = await Promise.allSettled([
      needAbanFamily
        ? fetchAbanTetherMarkets()
        : Promise.resolve({} as Record<string, AbanTetherMarketRow>),
      zarpaySources.length > 0 ? fetchZarpayCoins() : Promise.resolve([] as ZarpayCoinRow[]),
    ]);

    const abanTetherMarkets = abanTetherRes.status === 'fulfilled' ? abanTetherRes.value : {};
    const zarpayMarket = zarpayRes.status === 'fulfilled' ? zarpayRes.value : [];

    if (abanTetherRes.status === 'rejected') {
      console.warn('price quote refresh warning: abantether failed', abanTetherRes.reason);
    }
    if (zarpayRes.status === 'rejected') {
      console.warn('price quote refresh warning: zarpay failed', zarpayRes.reason);
    }

    const abanOk = needAbanFamily
      ? abanSourcesSatisfiedByMarkets(abanTetherSources, abanTetherMarkets)
      : true;

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
            : s.provider === 'abantether' && !abanOk
              ? 'No quote from AbanTether for this asset'
              : s.provider === 'zarpay' && zarpayRes.status === 'rejected'
                ? 'Zarpay provider unavailable'
                : 'Provider responded but no quote found for fetchKey',
      }));

    const failedProviders: Array<{ provider: string; error: string }> = [];
    if (needAbanFamily && !abanOk) {
      failedProviders.push({
        provider: 'abantether',
        error:
          abanTetherRes.status === 'rejected'
            ? formatUpstreamError(abanTetherRes.reason)
            : 'AbanTether returned no matching markets for requested slugs',
      });
    }
    if (zarpayRes.status === 'rejected') {
      failedProviders.push({
        provider: 'zarpay',
        error: formatUpstreamError(zarpayRes.reason),
      });
    }

    return quoteResponse(request, {
      quotes,
      failedProviders,
      unresolvedSlugs,
      unknownRequestedSlugs,
    });
  } catch (error) {
    console.error('price quote refresh failed', error);
    return quoteResponse(request, {
      quotes: [] satisfies ProviderQuote[],
      failedProviders: [
        {
          provider: 'server',
          error:
            error instanceof Error ? error.message : formatUpstreamError(error),
        },
      ],
      unresolvedSlugs: [],
      unknownRequestedSlugs,
    });
  }
}
