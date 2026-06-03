-- Expense alerts are opt-in: default off for new and existing users.
-- Safe when expense_alert_enabled column is not yet applied (runs after 20250607120000).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_settings'
      AND column_name = 'expense_alert_enabled'
  ) THEN
    ALTER TABLE notification_settings
      ALTER COLUMN expense_alert_enabled SET DEFAULT false;

    UPDATE notification_settings
    SET expense_alert_enabled = false;
  END IF;
END $$;
