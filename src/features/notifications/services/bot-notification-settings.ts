import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';

export interface BotNotificationSettings {
  enabled: boolean;
  price_alert_enabled: boolean;
  expense_alert_enabled: boolean;
}

export const DEFAULT_NOTIFICATION_SETTINGS: BotNotificationSettings = {
  enabled: true,
  price_alert_enabled: false,
  expense_alert_enabled: false,
};

export async function loadBotNotificationSettings(
  userId: string
): Promise<BotNotificationSettings> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('notification_settings')
    .select('enabled, price_alert_enabled, expense_alert_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return DEFAULT_NOTIFICATION_SETTINGS;

  const row = data as {
    enabled: boolean;
    price_alert_enabled?: boolean;
    expense_alert_enabled?: boolean;
  };
  return {
    enabled: row.enabled,
    price_alert_enabled: row.price_alert_enabled ?? false,
    expense_alert_enabled: row.expense_alert_enabled ?? false,
  };
}

export async function updateBotNotificationSettings(
  userId: string,
  patch: Partial<BotNotificationSettings>
): Promise<BotNotificationSettings> {
  const admin = createSupabaseAdminClient();
  const current = await loadBotNotificationSettings(userId);
  const next = { ...current, ...patch };

  const { error } = await admin.from('notification_settings').upsert(
    {
      user_id: userId,
      enabled: next.enabled,
      price_alert_enabled: next.price_alert_enabled,
      expense_alert_enabled: next.expense_alert_enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) throw error;
  return next;
}

export async function loadPriceAlertEnabled(userId: string): Promise<boolean> {
  const settings = await loadBotNotificationSettings(userId);
  return settings.price_alert_enabled;
}

export async function loadNotificationEnabled(userId: string): Promise<boolean> {
  const settings = await loadBotNotificationSettings(userId);
  return settings.enabled;
}

export async function loadExpenseAlertEnabled(userId: string): Promise<boolean> {
  const settings = await loadBotNotificationSettings(userId);
  return settings.expense_alert_enabled;
}
