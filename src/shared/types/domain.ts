import type { User } from '@supabase/supabase-js';

export type CurrencyMode = 'TOMAN' | 'USD';

export type TransactionType = 'BUY' | 'SELL' | 'DEPOSIT' | 'WITHDRAW';

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
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

export interface Transaction {
  id: string;
  user_id: string;
  asset_id: string;
  type: TransactionType;
  date_string: string;
  amount: number;
  price_toman: number;
  usd_rate: number;
  note: string | null;
  created_at: string;
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
