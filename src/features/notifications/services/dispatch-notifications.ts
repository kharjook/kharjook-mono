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
import {
  formatMonthCashflowMessage,
  formatTodayCashflowMessage,
} from '@/features/notifications/telegram/utils/format-today-cashflow';
import { formatJalaali, todayJalaaliInTimezone } from '@/shared/utils/jalali';
import {
  formatDebtsListMessage,
  buildInstallmentPayInlineKeyboard,
  installmentDaysUntilDue,
  TEHRAN_TIMEZONE,
  type DebtListItem,
  type DebtsListScope,
} from '@/features/notifications/telegram/utils/format-debts-list';
import {
  sendTelegramInlineMessage,
  sendTelegramMessage,
  TelegramSendError,
  type TelegramInlineMarkup,
  type TelegramReplyMarkup,
} from '@/features/notifications/telegram/utils/telegram-client';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { isInPeriod, periodContaining } from '@/shared/utils/period';
import {
  loadUserAssetsWithRates,
  refreshUserPricesFromProviders,
} from '@/features/notifications/services/server-price-refresh';
import { formatPortfolioMessage } from '@/features/notifications/telegram/utils/format-portfolio';
import {
  formatPriceRefreshResultMessage,
  formatPricesListMessage,
} from '@/features/notifications/telegram/utils/format-prices-list';
import { formatWalletBalancesMessage } from '@/features/notifications/telegram/utils/format-wallets-list';
import { formatTelegramMoney, toPersianDigits } from '@/features/notifications/telegram/utils/format-helpers';
import {
  DEFAULT_NOTIFICATION_SETTINGS as BOT_DEFAULT_NOTIFICATION_SETTINGS,
  loadNotificationEnabled,
  loadPriceAlertEnabled,
  type BotNotificationSettings,
} from '@/features/notifications/services/bot-notification-settings';

/** Defaults for new rows. */
export const DEFAULT_NOTIFICATION_SETTINGS: Omit<
  NotificationSettings,
  'user_id' | 'updated_at'
> = {
  enabled: BOT_DEFAULT_NOTIFICATION_SETTINGS.enabled,
  price_alert_enabled: BOT_DEFAULT_NOTIFICATION_SETTINGS.price_alert_enabled,
  expense_alert_enabled: BOT_DEFAULT_NOTIFICATION_SETTINGS.expense_alert_enabled,
};

export type { BotNotificationSettings };

export { loadNotificationEnabled };

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
      installmentId: row.id,
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

async function sendTelegramInlineToConnection(
  connection: TelegramConnection,
  text: string,
  inlineMarkup: TelegramInlineMarkup
): Promise<void> {
  try {
    await sendTelegramInlineMessage(connection.telegram_chat_id, text, inlineMarkup);
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

export async function sendMonthCashflowForUser(
  userId: string,
  connection: TelegramConnection,
  options?: { replyMarkup?: TelegramReplyMarkup }
): Promise<void> {
  const data = await loadUserData(userId);
  const snapshot = buildUserNotificationSnapshot(data);
  const text = formatMonthCashflowMessage(snapshot.month, snapshot.monthUsd);
  await sendTelegramToConnection(connection, text, options?.replyMarkup);
}

export async function sendPortfolioForUser(
  userId: string,
  connection: TelegramConnection,
  options?: { replyMarkup?: TelegramReplyMarkup }
): Promise<void> {
  const data = await loadUserData(userId);
  const snapshot = buildUserNotificationSnapshot(data);
  const text = formatPortfolioMessage(snapshot.portfolio);
  await sendTelegramToConnection(connection, text, options?.replyMarkup);
}

export async function sendMonthDebtsForUser(
  userId: string,
  connection: TelegramConnection,
  options?: { replyMarkup?: TelegramReplyMarkup }
): Promise<void> {
  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const monthPeriod = periodContaining('month', today);
  let items = await loadUnpaidDebtItems(userId);
  items = items.filter((item) => isInPeriod(item.dueDateString, monthPeriod));
  const text = formatDebtsListMessage(items, 'month');
  await sendTelegramToConnection(connection, text, options?.replyMarkup);
}

export async function sendOverdueDebtsForUser(
  userId: string,
  connection: TelegramConnection,
  options?: { replyMarkup?: TelegramReplyMarkup; withPayButtons?: boolean }
): Promise<void> {
  let items = await loadUnpaidDebtItems(userId);
  items = items.filter((item) => item.daysUntilDue < 0);
  const text = formatDebtsListMessage(items, 'overdue');
  const inline = options?.withPayButtons ? buildInstallmentPayInlineKeyboard(items) : null;
  if (inline) {
    await sendTelegramInlineToConnection(connection, text, inline);
  } else {
    await sendTelegramToConnection(connection, text, options?.replyMarkup);
  }
}

export async function sendWalletBalancesForUser(
  userId: string,
  connection: TelegramConnection,
  options?: { replyMarkup?: TelegramReplyMarkup }
): Promise<void> {
  const data = await loadUserData(userId);
  const text = formatWalletBalancesMessage(data);
  await sendTelegramToConnection(connection, text, options?.replyMarkup);
}

export async function sendPricesListForUser(
  userId: string,
  connection: TelegramConnection,
  options?: { replyMarkup?: TelegramReplyMarkup }
): Promise<void> {
  const { assets, usdRate } = await loadUserAssetsWithRates(userId);
  const text = formatPricesListMessage(assets, usdRate);
  await sendTelegramToConnection(connection, text, options?.replyMarkup);
}

export async function refreshAndReportPricesForUser(
  userId: string,
  connection: TelegramConnection,
  options?: { replyMarkup?: TelegramReplyMarkup }
): Promise<void> {
  const alertEnabled = await loadPriceAlertEnabled(userId);
  const before = alertEnabled ? await loadUserAssetsWithRates(userId) : null;

  const result = await refreshUserPricesFromProviders(userId);
  const text = formatPriceRefreshResultMessage({
    updatedCount: result.updatedCount,
    usdRate: result.usdRate,
    failedProviders: result.failedProviders,
  });
  await sendTelegramToConnection(connection, text, options?.replyMarkup);

  if (alertEnabled && before) {
    const after = await loadUserAssetsWithRates(userId);
    const changes = detectMaterialPriceChanges(before.assets, after.assets);
    if (changes.length > 0) {
      const alertText = formatPriceChangeAlert(changes);
      await sendTelegramToConnection(connection, alertText, options?.replyMarkup);
    }
  }
}

function detectMaterialPriceChanges(
  before: Awaited<ReturnType<typeof loadUserAssetsWithRates>>['assets'],
  after: Awaited<ReturnType<typeof loadUserAssetsWithRates>>['assets']
): Array<{ name: string; oldPrice: number; newPrice: number; pct: number }> {
  const beforeMap = new Map(before.map((a) => [a.id, a]));
  const changes: Array<{ name: string; oldPrice: number; newPrice: number; pct: number }> = [];

  for (const asset of after) {
    const prev = beforeMap.get(asset.id);
    if (!prev || prev.price_toman <= 0 || asset.price_toman <= 0) continue;
    const pct = ((asset.price_toman - prev.price_toman) / prev.price_toman) * 100;
    if (Math.abs(pct) >= 1) {
      changes.push({
        name: asset.name,
        oldPrice: prev.price_toman,
        newPrice: asset.price_toman,
        pct,
      });
    }
  }

  return changes.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

function formatPriceChangeAlert(
  changes: Array<{ name: string; oldPrice: number; newPrice: number; pct: number }>
): string {
  const lines = ['📈 تغییر قیمت دارایی‌ها', '────────────'];
  for (const row of changes.slice(0, 8)) {
    const arrow = row.pct >= 0 ? '📈' : '📉';
    lines.push(
      `${arrow} ${row.name}`,
      `   ${formatTelegramMoney(row.oldPrice, 'TOMAN')} → ${formatTelegramMoney(row.newPrice, 'TOMAN')} (${toPersianDigits(row.pct.toFixed(1))}٪)`
    );
  }
  lines.push('────────────');
  return lines.join('\n');
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
  const inline =
    options?.todayOnly && items.length > 0 ? buildInstallmentPayInlineKeyboard(items) : null;

  if (inline) {
    await sendTelegramInlineToConnection(connection, text, inline);
  } else {
    await sendTelegramToConnection(connection, text);
  }

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

  const activeConnections = (connections ?? []) as TelegramConnection[];
  if (activeConnections.length === 0) {
    return { debtsDigestsSent: 0, errors: [] };
  }

  const userIds = activeConnections.map((conn) => conn.user_id);
  const { data: settingsRows } = await admin
    .from('notification_settings')
    .select('user_id, enabled')
    .in('user_id', userIds);

  const enabledByUser = new Map<string, boolean>();
  for (const row of settingsRows ?? []) {
    const settings = row as { user_id: string; enabled: boolean };
    enabledByUser.set(settings.user_id, settings.enabled);
  }

  let debtsDigestsSent = 0;
  const errors: string[] = [];

  for (const conn of activeConnections) {
    const enabled = enabledByUser.get(conn.user_id) ?? BOT_DEFAULT_NOTIFICATION_SETTINGS.enabled;
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
