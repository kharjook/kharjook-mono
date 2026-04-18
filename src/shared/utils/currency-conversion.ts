import type { Currency, CurrencyRate } from '@/shared/types/domain';

/**
 * Tomans per 1 unit of the given currency. IRT is the base unit (= 1).
 * Non-IRT currencies are looked up from the user-maintained `currency_rates`
 * table — the single source of truth. If a row is missing or invalid we
 * return 0 so callers can decide how to surface "no rate set".
 *
 * USD intentionally has no special-case fallback here: its rate must live in
 * `currency_rates` like every other currency. The legacy `globalUsd` UI state
 * has been removed.
 */
export function tomanPerUnit(
  currency: Currency,
  rates: CurrencyRate[]
): number {
  if (currency === 'IRT') return 1;
  const r = rates.find((x) => x.currency === currency);
  if (r && Number(r.toman_per_unit) > 0) return Number(r.toman_per_unit);
  return 0;
}

/** Convert an amount denominated in `currency` into toman. */
export function toToman(
  amount: number,
  currency: Currency,
  rates: CurrencyRate[]
): number {
  return amount * tomanPerUnit(currency, rates);
}
