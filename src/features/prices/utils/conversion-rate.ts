import type { PriceSourceSetting, PriceSourceUsdFactor } from '@/shared/types/domain';
import type { ProviderQuote } from '@/features/prices/utils/provider-refresh';

export const DEFAULT_CONVERSION_RATE = 1;
export const DEFAULT_USD_FACTOR: PriceSourceUsdFactor = 'none';

export interface PriceSourceConversionConfig {
  conversion_rate: number;
  usd_factor: PriceSourceUsdFactor;
}

const DEFAULT_CONFIG: PriceSourceConversionConfig = {
  conversion_rate: DEFAULT_CONVERSION_RATE,
  usd_factor: DEFAULT_USD_FACTOR,
};

export function buildConversionConfigMap(
  settings: Pick<PriceSourceSetting, 'slug' | 'conversion_rate' | 'usd_factor'>[]
): Map<string, PriceSourceConversionConfig> {
  const map = new Map<string, PriceSourceConversionConfig>();
  for (const row of settings) {
    const conversion_rate = Number(row.conversion_rate);
    if (!Number.isFinite(conversion_rate) || conversion_rate <= 0) continue;

    const usd_factor = row.usd_factor;
    const validUsdFactor =
      usd_factor === 'multiply' || usd_factor === 'divide' ? usd_factor : DEFAULT_USD_FACTOR;

    map.set(row.slug, { conversion_rate, usd_factor: validUsdFactor });
  }
  return map;
}

export function conversionConfigForSlug(
  slug: string,
  configs: Map<string, PriceSourceConversionConfig>
): PriceSourceConversionConfig {
  return configs.get(slug) ?? DEFAULT_CONFIG;
}

/** raw provider quote (Toman) → stored asset price after user conversion rules. */
export function transformProviderPriceToman(
  rawPriceToman: number,
  config: PriceSourceConversionConfig,
  usdTomanPerUnit: number
): number {
  let price = rawPriceToman * config.conversion_rate;

  if (config.usd_factor === 'multiply' && usdTomanPerUnit > 0) {
    price *= usdTomanPerUnit;
  } else if (config.usd_factor === 'divide' && usdTomanPerUnit > 0) {
    price /= usdTomanPerUnit;
  }

  return price;
}

export function applyConversionRatesToQuotes(
  quotes: ProviderQuote[],
  configs: Map<string, PriceSourceConversionConfig>,
  usdTomanPerUnit: number
): ProviderQuote[] {
  return quotes.map((quote) => {
    const config = conversionConfigForSlug(quote.slug, configs);
    const priceToman = transformProviderPriceToman(
      quote.priceToman,
      config,
      usdTomanPerUnit
    );

    if (priceToman === quote.priceToman) return quote;

    return {
      ...quote,
      priceToman,
    };
  });
}
