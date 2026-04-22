import type { User } from '@supabase/supabase-js';

export type CurrencyMode = 'TOMAN' | 'USD';

export const CURRENCIES = ['IRT', 'USD', 'USDT', 'TRY', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const RATE_CURRENCIES = ['USD', 'USDT', 'TRY', 'EUR'] as const;
export type RateCurrency = (typeof RATE_CURRENCIES)[number];

export type TransactionType =
  | 'BUY'
  | 'SELL'
  | 'TRANSFER'
  | 'INCOME'
  | 'EXPENSE';

export type CategoryKind = 'asset' | 'income' | 'expense';

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  kind: CategoryKind;
  parent_id: string | null;
  created_at?: string;
}

export interface Asset {
  id: string;
  user_id: string;
  category_id: string | null;
  name: string;
  unit: string;
  price_toman: number;
  price_usd: number;
  icon_url: string | null;
  /**
   * Slug from `PRICE_SOURCES` catalog used to auto-fetch prices later.
   * Nullable = user marks the asset manual-priced. Stored value is the slug
   * string so the catalog can evolve without schema changes; unknown slugs
   * must degrade to "manual" in UI.
   */
  price_source_id: string | null;
  created_at?: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  name: string;
  currency: Currency;
  initial_balance: number;
  icon_url: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface CurrencyRate {
  id: string;
  user_id: string;
  currency: RateCurrency;
  toman_per_unit: number;
  updated_at: string;
}

/**
 * End-of-day price snapshot per user × asset × Jalali date.
 *
 * `source` priority (higher wins on the same key):
 *   manual (user explicit) > trade (derived from a BUY/SELL) > auto (reserved)
 *
 * `date_string` is canonical zero-padded Jalali "YYYY/MM/DD" — lexicographic
 * comparison is chronological; reports rely on that invariant.
 */
export type DailyPriceSource = 'manual' | 'trade' | 'auto';

export interface DailyPrice {
  user_id: string;
  asset_id: string;
  date_string: string;
  price_toman: number;
  price_usd: number;
  source: DailyPriceSource;
  created_at?: string;
  updated_at?: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  date_string: string;
  note: string | null;
  created_at: string;

  // Polymorphic endpoints — exactly one side per type per CHECK constraint.
  source_wallet_id: string | null;
  source_asset_id: string | null;
  target_wallet_id: string | null;
  target_asset_id: string | null;
  source_amount: number | null;
  target_amount: number | null;
  category_id: string | null;

  // Legacy columns, still populated for BUY/SELL so asset PnL keeps working.
  // Retired in a later PR once calculate-asset-stats is rewritten.
  asset_id: string | null;
  amount: number | null;
  price_toman: number | null;
  usd_rate: number | null;

  /**
   * Cashflow snapshot captured AT THE MOMENT the tx was written. Populated
   * for BUY/SELL/INCOME/EXPENSE; always NULL for TRANSFER (neutral).
   *
   * Reports SUM these columns directly — never reconvert via today's rate.
   * This is the only way to survive IRT inflation without rewriting
   * history each time the toman/USD rate moves.
   *
   * NULL = legacy row not backfillable (no currency rate at migration
   * time). Reports must surface the unpriced count rather than silently
   * treating it as 0.
   */
  amount_toman_at_time: number | null;
  amount_usd_at_time: number | null;
}

export interface AssetStats {
  totalAmount: number;
  totalCostToman: number;
  avgBuyPriceToman: number;
  currentValueToman: number;
  currentValueUsd: number;
  profitLossToman: number;
  profitLossUsd: number;
  profitLossPercent: number;
  realizedProfitToman: number;
  realizedProfitUsd: number;
  unrealizedProfitToman: number;
  unrealizedProfitUsd: number;
}

export type AuthUser = User;
