-- Recurring income/expense templates; instances created by daily cron.

CREATE TABLE IF NOT EXISTS recurring_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  title text NOT NULL,
  type text NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
  amount_toman numeric NOT NULL CHECK (amount_toman > 0),
  wallet_id uuid NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  interval_number integer NOT NULL DEFAULT 1 CHECK (interval_number > 0),
  interval_period text NOT NULL DEFAULT 'month'
    CHECK (interval_period IN ('day', 'week', 'month', 'year')),
  next_due_date_string text NOT NULL,
  end_date_string text,
  is_active boolean NOT NULL DEFAULT true,
  note text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recurring_transactions_due_active_idx
  ON recurring_transactions (next_due_date_string)
  WHERE is_active = true AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS recurring_transaction_runs (
  recurring_id uuid NOT NULL REFERENCES recurring_transactions (id) ON DELETE CASCADE,
  due_date_string text NOT NULL,
  transaction_id uuid NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recurring_id, due_date_string)
);

ALTER TABLE recurring_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_transaction_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY recurring_transactions_select_own ON recurring_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY recurring_transactions_insert_own ON recurring_transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY recurring_transactions_update_own ON recurring_transactions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY recurring_transactions_delete_own ON recurring_transactions
  FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY recurring_transaction_runs_select_own ON recurring_transaction_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM recurring_transactions r
      WHERE r.id = recurring_id AND r.user_id = auth.uid()
    )
  );

CREATE POLICY recurring_transaction_runs_insert_own ON recurring_transaction_runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM recurring_transactions r
      WHERE r.id = recurring_id AND r.user_id = auth.uid()
    )
  );
