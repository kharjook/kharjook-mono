import type { RateCurrency } from '@/shared/types/domain';

/**
 * Curated catalog of external price providers users can attach to an asset.
 *
 * Design contract (read before touching this file):
 *
 *  1. `slug` is the PUBLIC contract stored in `assets.price_source_id`. Once a
 *     user has adopted a slug, renaming it = a data migration. Deprecating a
 *     provider = leave the slug here marked `deprecated: true` so assets still
 *     resolve to a label; never delete entries.
 *
 *  2. All sources normalize to **Toman per unit of the asset**. Anything that
 *     quotes in USD / EUR / etc. is converted by the (future) fetch layer
 *     before hitting the DB. Consumers don't care where it came from.
 *
 *  3. `updatesRate` lets a source double as the authoritative FX rate for a
 *     given currency (e.g. `tgju.usd` → writes both the asset's price_toman
 *     AND `currency_rates.USD.toman_per_unit`). This is wired in the fetch
 *     layer later; catalog just declares intent here.
 */
export type PriceSourceProvider = 'abantether' | 'tgju' | 'zarpay';

export interface PriceSource {
  slug: string;
  provider: PriceSourceProvider;
  label: string;
  /** If non-null, a successful fetch also upserts this row in currency_rates. */
  updatesRate: RateCurrency | null;
  deprecated?: boolean;
}

export const PRICE_SOURCES: readonly PriceSource[] = [
  {
    slug: 'abantether.usdt',
    provider: 'abantether',
    label: 'تتر · آبان‌تتر',
    updatesRate: null,
  },
  {
    slug: 'abantether.btc',
    provider: 'abantether',
    label: 'بیت‌کوین · آبان‌تتر',
    updatesRate: null,
  },
	 {
    slug: 'abantether.sol',
    provider: 'abantether',
    label: 'سولانا · آبان‌تتر',
    updatesRate: null,
  },
	{
    slug: 'abantether.eth',
    provider: 'abantether',
    label: 'اتریوم · آبان‌تتر',
    updatesRate: null,
  },
  {
    slug: 'abantether.paxg',
    provider: 'abantether',
    label: 'پکس گلد · آبان‌تتر',
    updatesRate: null,
  },
	{
    slug: 'zarpay.gold',
    provider: 'zarpay',
    label: 'طلا ۱۸ عیار · زرپی',
    updatesRate: null,
  },
	{
    slug: 'zarpay.silver',
    provider: 'zarpay',
    label: 'نقره · زرپی',
    updatesRate: null,
  },
];

export const PRICE_SOURCE_MAP: Readonly<Record<string, PriceSource>> =
  Object.freeze(
    Object.fromEntries(PRICE_SOURCES.map((s) => [s.slug, s]))
  );

/** Resolve a slug defensively; unknown slugs return null so UI can degrade. */
export function findPriceSource(slug: string | null | undefined): PriceSource | null {
  if (!slug) return null;
  return PRICE_SOURCE_MAP[slug] ?? null;
}
