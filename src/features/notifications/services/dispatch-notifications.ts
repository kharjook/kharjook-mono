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
import { formatTodayCashflowMessage } from '@/features/notifications/telegram/utils/format-today-cashflow';
import { formatJalaali, todayJalaaliInTimezone } from '@/shared/utils/jalali';
import {
  formatDebtsListMessage,
  installmentDaysUntilDue,
  TEHRAN_TIMEZONE,
  type DebtListItem,
  type DebtsListScope,
} from '@/features/notifications/telegram/utils/format-debts-list';
import {
  sendTelegramMessage,
  TelegramSendError,
  type TelegramReplyMarkup,
} from '@/features/notifications/telegram/utils/telegram-client';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';

/** Defaults for new rows; only `enabled` is user-facing in the app. */
export const DEFAULT_NOTIFICATION_SETTINGS: Omit<
  NotificationSettings,
  'user_id' | 'updated_at'
> = {
  enabled: true,
};

export async function loadNotificationEnabled(userId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('notification_settings')
    .select('enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return DEFAULT_NOTIFICATION_SETTINGS.enabled;
  return (data as { enabled: boolean }).enabled;
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

async function loadUnpaidDebtItems(userId: string): Promise<DebtListItem[]> {
  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const admin = createSupabaseAdminClient();
  const { data: installments } = await admin
    .from('loan_installments')
    .select('*')
    .eq('user_id', userId)
    .eq('is_paid', false)
    .order('due_date_string', { ascending: true });

  if (!installments?.length) return [];

  const loanIds = Array.from(new Set(installments.map((i) => i.loan_id)));
  const [{ data: loans }, { data: currencyRates }] = await Promise.all([
    admin.from('loans').select('*').in('id', loanIds).is('deleted_at', null),
    admin.from('currency_rates').select('*').eq('user_id', userId),
  ]);

  const loanMap = new Map(((loans ?? []) as Loan[]).map((l) => [l.id, l]));
  const rates = (currencyRates ?? []) as CurrencyRate[];

  const items: DebtListItem[] = [];
  for (const row of installments as LoanInstallment[]) {
    const loan = loanMap.get(row.loan_id);
    if (!loan) continue;
    const daysUntil = installmentDaysUntilDue(row.due_date_string, today);
    if (daysUntil == null) continue;
    const rate = tomanPerUnit(loan.currency, rates);
    items.push({
      loanTitle: loan.title,
      dueDateString: row.due_date_string,
      amountToman: row.amount * rate,
      daysUntilDue: daysUntil,
    });
  }
  return items;
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

async function sendTelegramToConnection(
  connection: TelegramConnection,
  text: string,
  replyMarkup?: TelegramReplyMarkup
): Promise<void> {
  try {
    await sendTelegramMessage(connection.telegram_chat_id, text, replyMarkup);
  } catch (err) {
    if (err instanceof TelegramSendError && err.blocked) {
      await markConnectionInactive(connection.user_id);
    }
    throw err;
  }
}

export async function sendTodayCashflowForUser(
  userId: string,
  connection: TelegramConnection,
  options?: { replyMarkup?: TelegramReplyMarkup }
): Promise<void> {
  const data = await loadUserData(userId);
  const snapshot = buildUserNotificationSnapshot(data);
  const text = formatTodayCashflowMessage(snapshot.today, snapshot.todayUsd);
  await sendTelegramToConnection(connection, text, options?.replyMarkup);
}

/** Daily cron at 09:00 Tehran — today's installments only, skip if none. */
export async function sendDebtsListForUser(
  userId: string,
  connection: TelegramConnection,
  options?: { skipDedup?: boolean; todayOnly?: boolean }
): Promise<boolean> {
  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const dedupKey = formatJalaali(today);
  const scope: DebtsListScope = options?.todayOnly ? 'today' : 'all';

  if (!options?.skipDedup && (await wasDelivered(userId, 'loan_reminder', dedupKey))) {
    return false;
  }

  let items = await loadUnpaidDebtItems(userId);
  if (options?.todayOnly) {
    items = items.filter((item) => item.daysUntilDue === 0);
    if (items.length === 0) return false;
  }

  const text = formatDebtsListMessage(items, scope);
  await sendTelegramToConnection(connection, text);

  if (!options?.skipDedup) {
    await markDelivered(userId, 'loan_reminder', dedupKey);
  }
  return true;
}

/** Daily cron at 09:00 Tehran — today's installments only, skip if none. */
export async function processScheduledNotifications(): Promise<{
  debtsDigestsSent: number;
  errors: string[];
}> {
  const admin = createSupabaseAdminClient();
  const { data: connections } = await admin
    .from('telegram_connections')
    .select('*')
    .eq('is_active', true);

  let debtsDigestsSent = 0;
  const errors: string[] = [];

  for (const conn of (connections ?? []) as TelegramConnection[]) {
    const enabled = await loadNotificationEnabled(conn.user_id);
    if (!enabled) continue;

    try {
      const sent = await sendDebtsListForUser(conn.user_id, conn, { todayOnly: true });
      if (sent) debtsDigestsSent += 1;
    } catch (err) {
      errors.push(
        `${conn.user_id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { debtsDigestsSent, errors };
}

export { loadUnpaidDebtItems };
