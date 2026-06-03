-- Dedup key for per-transaction expense Telegram alerts.

ALTER TYPE notification_delivery_kind ADD VALUE IF NOT EXISTS 'expense_alert';
