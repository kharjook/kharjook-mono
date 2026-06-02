import type { User } from '@supabase/supabase-js';

export type CurrencyMode = 'TOMAN' | 'USD';

export const CURRENCIES = ['IRT', 'USD', 'TRY', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const RATE_CURRENCIES = ['USD', 'TRY', 'EUR'] as const;
export type RateCurrency = (typeof RATE_CURRENCIES)[number];

export type TransactionType =
  | 'BUY'
  | 'SELL'
  | 'TRANSFER'
  | 'INCOME'
  | 'EXPENSE';

export type CategoryKind = 'asset' | 'income' | 'expense';
export type LoanType = 'expense' | 'loan';
export type LoanIntervalPeriod = 'day' | 'week' | 'month' | 'year';
export type NotificationDeliveryKind = 'daily_report' | 'loan_reminder';
export type GoalScope = 'asset' | 'asset_group';
export type GoalTargetKind = 'quantity' | 'allocation_percent';

export interface Category {
  id: string;
  user_id: string;
  name: string;
  color: string;
  kind: CategoryKind;
  parent_id: string | null;
  order_index?: number;
  created_at?: string;
}

export interface Asset {
  id: string;
  user_id: string;
  category_id: string | null;
  name: string;
  unit: string;
  /** UI-only display precision for asset quantities. */
  decimal_places: number;
  price_toman: number;
  price_usd: number;
  icon_url: string | null;
  /**
   * Slug from the user's price source catalog (`price_sources`) used to auto-fetch
   * prices. Nullable = manual-priced asset. Unknown slugs degrade gracefully in UI.
   */
  price_source_id: string | null;
  /**
   * Reporting-only flag:
   * - true: include this asset in profit/loss calculations
   * - false: exclude from P/L, but still include in portfolio value (unless
   *   `include_in_balance` is also false).
   */
  include_in_profit_loss: boolean;
  /**
   * When false, current value is excluded from dashboard total balance and
   * allocation chart; per-asset screens still show full stats. Omitted = included.
   */
  include_in_balance?: boolean;
  order_index?: number;
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
  /** Optional payment destination — digits only when stored. */
  card_number?: string | null;
  account_number?: string | null;
  /** Optional Sheba / IBAN — stored uppercase without spaces. */
  iban?: string | null;
  order_index?: number;
  created_at: string;
}

export interface Person {
  id: string;
  user_id: string;
  name: string;
  order_index?: number;
  created_at: string;
  updated_at: string;
}

export interface CurrencyRate {
  id: string;
  user_id: string;
  currency: RateCurrency;
  toman_per_unit: number;
  updated_at: string;
}

/** User override for transforming fetched provider quotes before save. */
export type PriceSourceUsdFactor = 'none' | 'multiply' | 'divide';

export interface PriceSourceSetting {
  user_id: string;
  slug: string;
  /** Multiplier applied first: stored = raw × conversion_rate ×/÷ USD (optional). */
  conversion_rate: number;
  /** After conversion_rate: multiply or divide by app USD/Toman rate; none = skip. */
  usd_factor: PriceSourceUsdFactor;
  updated_at: string;
}

/** User-scoped row in `price_sources` — the dynamic catalog backing auto-fetch. */
export interface PriceSourceRecord {
  user_id: string;
  slug: string;
  provider: 'abantether' | 'zarpay';
  label: string;
  fetch_key: string | null;
  updates_rate: RateCurrency | null;
  deprecated: boolean;
  is_builtin: boolean;
  created_at?: string;
  updated_at?: string;
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

export interface Goal {
  id: string;
  user_id: string;
  scope: GoalScope;
  asset_id: string | null;
  category_id: string | null;
  target_kind: GoalTargetKind;
  target_quantity: number | null;
  target_percent: number | null;
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
  source_person_id: string | null;
  target_wallet_id: string | null;
  target_asset_id: string | null;
  target_person_id: string | null;
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
  /** Links paired rows (e.g. convert SELL + BUY). */
  operation_id?: string | null;
}

export interface Loan {
  id: string;
  user_id: string;
  title: string;
  type: LoanType;
  category_id: string | null;
  currency: Currency;
  installment_amount: number;
  total_amount: number | null;
  loan_start_date_string: string;
  first_due_date_string: string;
  repeat_count: number;
  interval_number: number;
  interval_period: LoanIntervalPeriod;
  auto_income_on_create: boolean;
  auto_income_wallet_id: string | null;
  description: string | null;
  /** @deprecated Per-loan offsets removed; daily digest lists all unpaid installments. */
  reminder_days_before?: number[];
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramConnection {
  user_id: string;
  telegram_chat_id: number;
  telegram_user_id: number | null;
  telegram_username: string | null;
  is_active: boolean;
  linked_at: string;
  menu_stack?: string[] | null;
  bot_flow?: Record<string, unknown> | null;
}

export interface NotificationSettings {
  user_id: string;
  /** Daily 9 AM Telegram digest of unpaid installments. */
  enabled: boolean;
  /** Notify on bot price refresh when held assets move materially. */
  price_alert_enabled: boolean;
  updated_at: string;
}

export interface NotificationDelivery {
  id: string;
  user_id: string;
  kind: NotificationDeliveryKind;
  dedup_key: string;
  sent_at: string;
}

export interface LoanInstallment {
  id: string;
  user_id: string;
  loan_id: string;
  due_date_string: string;
  amount: number;
  sequence_no: number;
  is_paid: boolean;
  paid_at: string | null;
  paid_transaction_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssetStats {
  totalAmount: number;
  totalCostToman: number;
  totalCostUsd: number;
  avgBuyPriceToman: number;
  avgBuyPriceUsd: number;
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
