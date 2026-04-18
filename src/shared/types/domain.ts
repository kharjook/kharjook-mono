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
  created_at?: string;
}

export interface Wallet {
  id: string;
  user_id: string;
  name: string;
  currency: Currency;
  initial_balance: number;
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
