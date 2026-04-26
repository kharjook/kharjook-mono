/**
 * TGJU free-market USD (ریال) → app stores **تومان** (÷10).
 * Fetches may run on Vercel: prefer Jina Reader with optional API key; fall back
 * to direct TGJU HTML when Jina rate-limits or blocks datacenter egress.
 */

import { latinizeDigits } from '@/shared/utils/latinize-digits';

const TGJU_PROFILE_PATH = '/profile/price_dollar_rl';

const JINA_READERS = [
  (target: string) => `https://r.jina.ai/http://${target}`,
  (target: string) => `https://r.jina.ai/https://${target}`,
] as const;

function jinaAuthHeader(): Record<string, string> {
  const key = process.env.JINA_API_KEY?.trim();
  if (!key) return {};
  return { Authorization: `Bearer ${key}` };
}

function parseRialToToman(payload: string): number {
  const patterns: RegExp[] = [
    /###\s*نرخ فعلی:?\s*:?\s*([0-9,]+)/u,
    /\|\s*دلار\s*\|\s*([0-9,]+)\s*\|/u,
    /نرخ\s*فعلی[^0-9۰-۹]*([0-9,۰-۹]+)/u,
    /data-price=["']([0-9,]+)["']/u,
    /"price"\s*:\s*"?([0-9,]+)"?/u,
  ];

  for (const re of patterns) {
    const m = payload.match(re);
    const raw = latinizeDigits(m?.[1] ?? '').replaceAll(',', '');
    if (!raw) continue;
    const rial = Number(raw);
    if (Number.isFinite(rial) && rial > 50_000) {
      return rial / 10;
    }
  }

  throw new Error('TGJU USD price could not be parsed.');
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 14_000, ...rest } = init;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(t);
  }
}

async function fetchTextOk(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<string> {
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers,
    timeoutMs,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

const BROWSER_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'accept-language': 'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7',
};

/**
 * Best-effort USD→Toman (free market). Throws only if every strategy fails.
 */
export async function fetchTgjuUsdToman(): Promise<number> {
  const jinaAuth = jinaAuthHeader();
  const host = 'www.tgju.org';
  const targetUrl = `${host}${TGJU_PROFILE_PATH}`;

  const errors: string[] = [];

  for (const build of JINA_READERS) {
    const url = build(targetUrl);
    try {
      const headers: Record<string, string> = {
        ...BROWSER_HEADERS,
        accept: 'text/plain, text/markdown;q=0.9, */*;q=0.8',
        ...jinaAuth,
      };
      const text = await fetchTextOk(url, headers, 16_000);
      return parseRialToToman(text);
    } catch (e) {
      errors.push(`jina(${url}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const direct = `https://${host}${TGJU_PROFILE_PATH}`;
  try {
    const html = await fetchTextOk(direct, BROWSER_HEADERS, 14_000);
    return parseRialToToman(html);
  } catch (e) {
    errors.push(`direct: ${e instanceof Error ? e.message : String(e)}`);
  }

  throw new Error(`TGJU fetch failed: ${errors.join(' | ')}`);
}
