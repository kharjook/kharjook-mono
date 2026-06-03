-- Monthly spending caps per expense category (includes descendant categories in totals).

CREATE TABLE IF NOT EXISTS category_spending_caps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  monthly_limit_toman numeric NOT NULL CHECK (monthly_limit_toman > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, category_id)
);

CREATE INDEX IF NOT EXISTS category_spending_caps_user_idx
  ON category_spending_caps (user_id);

ALTER TABLE category_spending_caps ENABLE ROW LEVEL SECURITY;

CREATE POLICY category_spending_caps_select_own ON category_spending_caps
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY category_spending_caps_insert_own ON category_spending_caps
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY category_spending_caps_update_own ON category_spending_caps
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY category_spending_caps_delete_own ON category_spending_caps
  FOR DELETE USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.get_category_expense_toman_for_period(
  p_user_id uuid,
  p_category_id uuid,
  p_start text,
  p_end text
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE subtree AS (
    SELECT id
    FROM categories
    WHERE id = p_category_id
      AND user_id = p_user_id
    UNION ALL
    SELECT c.id
    FROM categories c
    INNER JOIN subtree s ON c.parent_id = s.id
    WHERE c.user_id = p_user_id
  )
  SELECT COALESCE(SUM(t.amount_toman_at_time), 0)::numeric
  FROM transactions t
  WHERE t.user_id = p_user_id
    AND t.type = 'EXPENSE'
    AND t.category_id IN (SELECT id FROM subtree)
    AND t.date_string >= p_start
    AND t.date_string <= p_end
    AND t.amount_toman_at_time IS NOT NULL
    AND t.amount_toman_at_time > 0;
$$;

REVOKE ALL ON FUNCTION public.get_category_expense_toman_for_period(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_category_expense_toman_for_period(uuid, uuid, text, text)
  TO authenticated, service_role;

ALTER TYPE notification_delivery_kind ADD VALUE IF NOT EXISTS 'category_cap_alert';
