import { createContext, Script } from 'node:vm';
import { NextResponse } from 'next/server';
import {
  APP_GLOBAL_USD_SLUG,
  findPriceSource,
  type PriceSource,
} from '@/features/prices/constants/price-sources';

export const runtime = 'nodejs';
/** Vercel / long upstream chains (Aban WS + Zarpay challenge). */
export const maxDuration = 45;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

const UPSTREAM_TIMEOUT_MS = 14_000;

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

interface AbanSocketCoinRow {
  symbol?: string;
  coin_symbol?: string;
  base_symbol?: string;
  buy?: number | string;
  sell?: number | string;
  buy_price?: number | string;
  sell_price?: number | string;
  price?: number | string;
  [key: string]: unknown;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Remote fetch failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  } finally {
    clearTimeout(timer);
  }
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
  const challengeHtml = await fetchText(url);
  const cookie = solveZarpayCookieHeader(challengeHtml);
  const payload = await fetchText(url, {
    headers: {
      cookie,
      accept: 'application/json, text/plain, */*',
    },
  });

  const parsed = JSON.parse(payload) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Zarpay market payload is not an array.');
  }

  return parsed as ZarpayCoinRow[];
}

async function fetchAbanTetherMarkets(): Promise<Record<string, AbanTetherMarketRow>> {
  const ws = new WebSocket('wss://ws.abantether.com/public');
  return new Promise((resolve, reject) => {
    let done = false;
    const close = () => {
      try {
        ws.close();
      } catch {
        // no-op
      }
    };
    const fail = (error: unknown) => {
      if (done) return;
      done = true;
      close();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const succeed = (markets: Record<string, AbanTetherMarketRow>) => {
      if (done) return;
      done = true;
      close();
      resolve(markets);
    };
    const timer = setTimeout(() => fail(new Error('AbanTether websocket timeout')), 12_000);
    const maxFrames = 8;
    let seenFrames = 0;
    ws.onerror = (event) => {
      clearTimeout(timer);
      fail(new Error(`AbanTether websocket error: ${String(event.type)}`));
    };
    ws.onclose = () => {
      if (!done) {
        clearTimeout(timer);
        fail(new Error('AbanTether websocket closed before first payload'));
      }
    };
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          action: 'subscribe',
          channel: 'coins_list_v2',
        })
      );
    };
    ws.onmessage = (event) => {
      seenFrames += 1;
      try {
        const raw = JSON.parse(String(event.data)) as unknown;
        const coins = extractAbanCoins(raw);
        if (coins.length === 0) {
          // First frame is often an ack/heartbeat; ignore and keep waiting for
          // the first payload that actually carries coin rows.
          if (seenFrames >= maxFrames) {
            clearTimeout(timer);
            throw new Error('AbanTether websocket did not deliver coins payload');
          }
          return;
        }
        const markets: Record<string, AbanTetherMarketRow> = {};
        for (const coin of coins) {
          const symbol =
            String(coin.symbol ?? coin.coin_symbol ?? coin.base_symbol ?? '').toUpperCase();
          if (!symbol) continue;
          const sell = toNumber(coin.sell_price ?? coin.sell ?? coin.price);
          const buy = toNumber(coin.buy_price ?? coin.buy ?? coin.price);
          if (!(sell > 0) && !(buy > 0)) continue;
          markets[`${symbol}IRT`] = {
            symbol: `${symbol}IRT`,
            sell_price: String(sell > 0 ? sell : buy),
            buy_price: String(buy > 0 ? buy : sell),
          };
        }
        if (Object.keys(markets).length === 0) {
          if (seenFrames >= maxFrames) {
            clearTimeout(timer);
            throw new Error('AbanTether websocket payload had no usable prices');
          }
          return;
        }
        clearTimeout(timer);
        succeed(markets);
      } catch (error) {
        clearTimeout(timer);
        fail(error);
      }
    };
  });
}

async function fetchAbanTetherMarketsRest(): Promise<Record<string, AbanTetherMarketRow>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
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
    const text = await response.text();
    const parsed = JSON.parse(text) as unknown;
    const markets = extractAbanMarketsFromRestPayload(parsed);
    if (Object.keys(markets).length > 0) return markets;
    throw new Error(
      `AbanTether REST ticker has no parseable markets (status=${response.status})`
    );
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAbanTetherMarketsWithFallback(): Promise<Record<string, AbanTetherMarketRow>> {
  try {
    return await fetchAbanTetherMarkets();
  } catch (wsError) {
    console.warn('AbanTether websocket failed, falling back to REST ticker', wsError);
    return fetchAbanTetherMarketsRest();
  }
}

function extractAbanMarketsFromRestPayload(
  payload: unknown
): Record<string, AbanTetherMarketRow> {
  if (!payload || typeof payload !== 'object') return {};
  const root = payload as Record<string, unknown>;

  // Legacy/expected structure
  const oldMarkets = (root.data as { markets?: unknown } | undefined)?.markets;
  if (oldMarkets && typeof oldMarkets === 'object') {
    return oldMarkets as Record<string, AbanTetherMarketRow>;
  }

  // Alternative structures seen in Aban API variants
  const directSymbols = root.symbols;
  const nestedSymbols = (root.data as { symbols?: unknown } | undefined)?.symbols;
  const symbols = (nestedSymbols ?? directSymbols) as Record<string, unknown> | undefined;
  if (symbols && typeof symbols === 'object') {
    const out: Record<string, AbanTetherMarketRow> = {};
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
    if (Object.keys(out).length > 0) return out;
  }

  // New 422 payload still includes usable rows under error details `data[*].input`.
  const details = root.data;
  if (Array.isArray(details)) {
    const out: Record<string, AbanTetherMarketRow> = {};
    for (const detail of details) {
      if (!detail || typeof detail !== 'object') continue;
      const rec = detail as Record<string, unknown>;
      const loc = rec.loc;
      const input = rec.input;
      if (!Array.isArray(loc) || loc.length < 2) continue;
      if (loc[0] !== 'symbols') continue;
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
    if (Object.keys(out).length > 0) return out;
  }

  return {};
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function extractAbanCoins(payload: unknown): AbanSocketCoinRow[] {
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as Record<string, unknown>;
  const directCandidates = [root.data, root.payload, root.result, root.coins, root.items];
  for (const c of directCandidates) {
    if (Array.isArray(c)) return c as AbanSocketCoinRow[];
    if (c && typeof c === 'object') {
      const nested = c as Record<string, unknown>;
      const arrCandidates = [nested.coins, nested.items, nested.list, nested.data];
      for (const arr of arrCandidates) {
        if (Array.isArray(arr)) return arr as AbanSocketCoinRow[];
      }
    }
  }
  return [];
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
        ? fetchAbanTetherMarketsWithFallback()
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

    return NextResponse.json(
      { quotes },
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
