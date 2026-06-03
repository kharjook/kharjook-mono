-- Query performance indexes (online-safe, idempotent)

CREATE INDEX IF NOT EXISTS transactions_user_created_idx
  ON transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS daily_prices_user_date_idx
  ON daily_prices (user_id, date_string DESC);

CREATE INDEX IF NOT EXISTS loan_installments_unpaid_user_due_idx
  ON loan_installments (user_id, due_date_string)
  WHERE is_paid = false;
