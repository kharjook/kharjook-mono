-- Financial report digests are opt-in (default off).

ALTER TABLE notification_settings
  ALTER COLUMN report_enabled SET DEFAULT false;

UPDATE notification_settings
SET report_enabled = false;
