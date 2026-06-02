-- Telegram bot linking & notification preferences

CREATE TABLE IF NOT EXISTS telegram_connections (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  telegram_chat_id bigint NOT NULL UNIQUE,
  telegram_user_id bigint,
  telegram_username text,
  is_active boolean NOT NULL DEFAULT true,
  linked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_id_idx ON telegram_link_tokens (user_id);

CREATE TYPE notification_report_interval AS ENUM ('daily', 'weekly');

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  report_enabled boolean NOT NULL DEFAULT true,
  report_interval notification_report_interval NOT NULL DEFAULT 'daily',
  report_day_of_week smallint NOT NULL DEFAULT 0 CHECK (report_day_of_week >= 0 AND report_day_of_week <= 6),
  report_time time NOT NULL DEFAULT '08:00',
  timezone text NOT NULL DEFAULT 'Asia/Tehran',
  show_portfolio_irt boolean NOT NULL DEFAULT true,
  show_portfolio_usd boolean NOT NULL DEFAULT true,
  show_cashflow_irt boolean NOT NULL DEFAULT true,
  show_cashflow_usd boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE notification_delivery_kind AS ENUM ('daily_report', 'loan_reminder');

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind notification_delivery_kind NOT NULL,
  dedup_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, dedup_key)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_user_id_idx ON notification_deliveries (user_id);

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS reminder_days_before integer[] NOT NULL DEFAULT '{}';

-- RLS
ALTER TABLE telegram_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY telegram_connections_select_own ON telegram_connections
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY telegram_connections_delete_own ON telegram_connections
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY telegram_link_tokens_select_own ON telegram_link_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY telegram_link_tokens_insert_own ON telegram_link_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY notification_settings_select_own ON notification_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY notification_settings_insert_own ON notification_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY notification_settings_update_own ON notification_settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY notification_deliveries_select_own ON notification_deliveries
  FOR SELECT USING (auth.uid() = user_id);
