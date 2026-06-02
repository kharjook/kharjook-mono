import type {
  Asset,
  Category,
  CurrencyRate,
  Loan,
  LoanInstallment,
  NotificationDeliveryKind,
  NotificationSettings,
  TelegramConnection,
  Transaction,
  Wallet,
} from '@/shared/types/domain';
import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import { buildUserNotificationSnapshot } from '@/features/notifications/utils/build-user-snapshot';
import { isDueForReminder } from '@/features/notifications/utils/jalali-days';
import {
  formatDailyReportMessage,
  formatLoanReminderMessage,
} from '@/features/notifications/telegram/utils/format-messages';
import {
  sendTelegramMessage,
  TelegramSendError,
} from '@/features/notifications/telegram/utils/telegram-client';
import { formatJalaali, jalaaliWeekday, todayJalaali } from '@/shared/utils/jalali';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';

export const DEFAULT_NOTIFICATION_SETTINGS: Omit<
  NotificationSettings,
  'user_id' | 'updated_at'
> = {
  enabled: true,
  report_enabled: true,
  report_interval: 'daily',
  report_day_of_week: 0,
  report_time: '08:00:00',
  timezone: 'Asia/Tehran',
  show_portfolio_irt: true,
  show_portfolio_usd: true,
  show_cashflow_irt: true,
  show_cashflow_usd: true,
};

function parseReportHour(reportTime: string): number {
  const [h] = reportTime.split(':');
  return Number(h ?? 0);
}

function getZonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = {
    Sat: 0,
    Sun: 1,
    Mon: 2,
    Tue: 3,
    Wed: 4,
    Thu: 5,
    Fri: 6,
  };
  return {
    hour: Number(map.hour ?? 0),
    weekday: weekdayMap[map.weekday ?? 'Sat'] ?? 0,
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

async function loadUserData(userId: string) {
  const admin = createSupabaseAdminClient();
  const [
    { data: transactions },
    { data: categories },
    { data: wallets },
    { data: assets },
    { data: currencyRates },
  ] = await Promise.all([
    admin.from('transactions').select('*').eq('user_id', userId),
    admin.from('categories').select('*').eq('user_id', userId),
    admin.from('wallets').select('*').eq('user_id', userId).is('archived_at', null),
    admin.from('assets').select('*').eq('user_id', userId),
    admin.from('currency_rates').select('*').eq('user_id', userId),
  ]);

  return {
    transactions: (transactions ?? []) as Transaction[],
    categories: (categories ?? []) as Category[],
    wallets: (wallets ?? []) as Wallet[],
    assets: (assets ?? []) as Asset[],
    currencyRates: (currencyRates ?? []) as CurrencyRate[],
  };
}

async function wasDelivered(
  userId: string,
  kind: NotificationDeliveryKind,
  dedupKey: string
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('notification_deliveries')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('dedup_key', dedupKey)
    .maybeSingle();
  return !!data;
}

async function markDelivered(
  userId: string,
  kind: NotificationDeliveryKind,
  dedupKey: string
): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from('notification_deliveries').insert({
    user_id: userId,
    kind,
    dedup_key: dedupKey,
  });
}

async function markConnectionInactive(userId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from('telegram_connections').update({ is_active: false }).eq('user_id', userId);
}

export function shouldSendReportNow(
  settings: NotificationSettings,
  now = new Date()
): boolean {
  if (!settings.enabled || !settings.report_enabled) return false;
  const zoned = getZonedParts(now, settings.timezone);
  if (zoned.hour !== parseReportHour(settings.report_time)) return false;
  if (settings.report_interval === 'daily') return true;
  return zoned.weekday === settings.report_day_of_week;
}

export async function sendDailyReportForUser(
  userId: string,
  connection: TelegramConnection,
  settings: NotificationSettings,
  options?: { skipDedup?: boolean }
): Promise<boolean> {
  const today = todayJalaali();
  const dedupKey = formatJalaali(today);
  if (!options?.skipDedup && (await wasDelivered(userId, 'daily_report', dedupKey))) {
    return false;
  }

  const data = await loadUserData(userId);
  const snapshot = buildUserNotificationSnapshot(data);
  const text = formatDailyReportMessage(settings, snapshot);

  try {
    await sendTelegramMessage(connection.telegram_chat_id, text);
  } catch (err) {
    if (err instanceof TelegramSendError && err.blocked) {
      await markConnectionInactive(userId);
    }
    throw err;
  }

  if (!options?.skipDedup) {
    await markDelivered(userId, 'daily_report', dedupKey);
  }
  return true;
}

export async function sendLoanRemindersForUser(
  userId: string,
  connection: TelegramConnection,
  settings: NotificationSettings,
  options?: { skipDedup?: boolean }
): Promise<number> {
  if (!settings.enabled) return 0;

  const admin = createSupabaseAdminClient();
  const { data: installments } = await admin
    .from('loan_installments')
    .select('*')
    .eq('user_id', userId)
    .eq('is_paid', false);

  if (!installments?.length) return 0;

  const loanIds = Array.from(new Set(installments.map((i) => i.loan_id)));
  const { data: loans } = await admin
    .from('loans')
    .select('*')
    .in('id', loanIds)
    .is('deleted_at', null);

  const loanMap = new Map(((loans ?? []) as Loan[]).map((l) => [l.id, l]));
  const { data: currencyRates } = await admin
    .from('currency_rates')
    .select('*')
    .eq('user_id', userId);
  const usdRate =
    ((currencyRates ?? []) as CurrencyRate[]).find((r) => r.currency === 'USD')
      ?.toman_per_unit ?? 0;

  let sent = 0;
  for (const row of installments as LoanInstallment[]) {
    const loan = loanMap.get(row.loan_id);
    if (!loan?.reminder_days_before?.length) continue;

    const daysUntil = isDueForReminder(row.due_date_string);
    if (daysUntil == null || !loan.reminder_days_before.includes(daysUntil)) continue;

    const dedupKey = `${row.id}:${daysUntil}`;
    if (!options?.skipDedup && (await wasDelivered(userId, 'loan_reminder', dedupKey))) {
      continue;
    }

    const rate = tomanPerUnit(loan.currency, (currencyRates ?? []) as CurrencyRate[]);
    const amountToman = row.amount * rate;
    const amountUsd = usdRate > 0 ? amountToman / usdRate : 0;

    const text = formatLoanReminderMessage({
      loanTitle: loan.title,
      dueDateString: row.due_date_string,
      daysUntilDue: daysUntil,
      amountToman,
      amountUsd,
      showIrt: settings.show_cashflow_irt,
      showUsd: settings.show_cashflow_usd,
    });

    try {
      await sendTelegramMessage(connection.telegram_chat_id, text);
    } catch (err) {
      if (err instanceof TelegramSendError && err.blocked) {
        await markConnectionInactive(userId);
      }
      throw err;
    }

    if (!options?.skipDedup) {
      await markDelivered(userId, 'loan_reminder', dedupKey);
    }
    sent += 1;
  }

  return sent;
}

export async function processScheduledNotifications(now = new Date()): Promise<{
  reportsSent: number;
  remindersSent: number;
  errors: string[];
}> {
  const admin = createSupabaseAdminClient();
  const { data: connections } = await admin
    .from('telegram_connections')
    .select('*')
    .eq('is_active', true);

  let reportsSent = 0;
  let remindersSent = 0;
  const errors: string[] = [];

  for (const conn of (connections ?? []) as TelegramConnection[]) {
    const { data: settingsRow } = await admin
      .from('notification_settings')
      .select('*')
      .eq('user_id', conn.user_id)
      .maybeSingle();

    const settings: NotificationSettings = settingsRow
      ? (settingsRow as NotificationSettings)
      : {
          user_id: conn.user_id,
          ...DEFAULT_NOTIFICATION_SETTINGS,
          updated_at: new Date().toISOString(),
        };

    if (!settings.enabled) continue;

    try {
      if (shouldSendReportNow(settings, now)) {
        const sent = await sendDailyReportForUser(conn.user_id, conn, settings);
        if (sent) reportsSent += 1;
      }
      const reminderCount = await sendLoanRemindersForUser(conn.user_id, conn, settings);
      remindersSent += reminderCount;
    } catch (err) {
      errors.push(
        `${conn.user_id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { reportsSent, remindersSent, errors };
}

export async function sendAllActiveNotificationsForUser(
  userId: string,
  options?: { skipDedup?: boolean }
): Promise<{ reportSent: boolean; remindersSent: number }> {
  const admin = createSupabaseAdminClient();
  const { data: connection } = await admin
    .from('telegram_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();

  if (!connection) {
    throw new Error('Telegram is not connected');
  }

  const { data: settingsRow } = await admin
    .from('notification_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  const settings: NotificationSettings = settingsRow
    ? (settingsRow as NotificationSettings)
    : {
        user_id: userId,
        ...DEFAULT_NOTIFICATION_SETTINGS,
        updated_at: new Date().toISOString(),
      };

  if (!settings.enabled) {
    throw new Error('Notifications are disabled');
  }

  let reportSent = false;
  if (settings.report_enabled) {
    reportSent = await sendDailyReportForUser(
      userId,
      connection as TelegramConnection,
      settings,
      options
    );
  }

  const remindersSent = await sendLoanRemindersForUser(
    userId,
    connection as TelegramConnection,
    settings,
    options
  );

  return { reportSent, remindersSent };
}

/** Jalali weekday for settings UI (0=Sat). */
export function currentJalaaliWeekday(): number {
  return jalaaliWeekday(todayJalaali());
}
