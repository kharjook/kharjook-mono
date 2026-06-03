-- SQL helpers for notification and report aggregates (avoid full-table client loads).

CREATE OR REPLACE FUNCTION public.get_today_expense_total_toman(
  p_user_id uuid,
  p_date_string text
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(amount_toman_at_time), 0)::numeric
  FROM transactions
  WHERE user_id = p_user_id
    AND type = 'EXPENSE'
    AND date_string = p_date_string
    AND amount_toman_at_time IS NOT NULL
    AND amount_toman_at_time > 0;
$$;

CREATE OR REPLACE FUNCTION public.get_period_cashflow_toman(
  p_user_id uuid,
  p_start text,
  p_end text
)
RETURNS TABLE(income_toman numeric, expense_toman numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(CASE WHEN type = 'INCOME' THEN amount_toman_at_time END), 0)::numeric,
    COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount_toman_at_time END), 0)::numeric
  FROM transactions
  WHERE user_id = p_user_id
    AND type IN ('INCOME', 'EXPENSE')
    AND date_string >= p_start
    AND date_string <= p_end
    AND amount_toman_at_time IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_today_expense_total_toman(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_period_cashflow_toman(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_today_expense_total_toman(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_period_cashflow_toman(uuid, text, text) TO authenticated, service_role;
