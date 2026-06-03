import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type { TelegramConnection, Transaction } from '@/shared/types/domain';
import { formatExpenseAlertMessage } from '@/features/notifications/telegram/utils/format-expense-alert';
import { TEHRAN_TIMEZONE } from '@/features/notifications/telegram/utils/format-debts-list';
import {
  sendTelegramMessage,
  TelegramSendError,
} from '@/features/notifications/telegram/utils/telegram-client';
import { loadExpenseAlertEnabled } from '@/features/notifications/services/bot-notification-settings';
import { findCapStatusForCategory } from '@/features/categories/services/category-cap-alerts';
import { formatExpenseCapLine } from '@/features/notifications/telegram/utils/format-category-caps';
import { todayJalaaliInTimezone, formatJalaali } from '@/shared/utils/jalali';

async function loadActiveConnection(userId: string): Promise<TelegramConnection | null> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('telegram_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  return (data as TelegramConnection | null) ?? null;
}

async function markConnectionInactive(userId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from('telegram_connections').update({ is_active: false }).eq('user_id', userId);
}

function expenseAmountToman(tx: Transaction): number | null {
  const value = Number(tx.amount_toman_at_time);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function loadCategoryName(
  userId: string,
  categoryId: string | null
): Promise<string | null> {
  if (!categoryId) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('categories')
    .select('name')
    .eq('user_id', userId)
    .eq('id', categoryId)
    .maybeSingle();
  return (data as { name?: string } | null)?.name?.trim() ?? null;
}

async function loadTodayExpenseTotalToman(
  userId: string,
  todayJalaali: string
): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data: rpcTotal, error: rpcError } = await admin.rpc('get_today_expense_total_toman', {
    p_user_id: userId,
    p_date_string: todayJalaali,
  });

  if (!rpcError && rpcTotal != null) {
    const parsed = Number(rpcTotal);
    if (Number.isFinite(parsed)) return parsed;
  }

  const { data } = await admin
    .from('transactions')
    .select('amount_toman_at_time')
    .eq('user_id', userId)
    .eq('type', 'EXPENSE')
    .eq('date_string', todayJalaali)
    .not('amount_toman_at_time', 'is', null);

  let total = 0;
  for (const row of data ?? []) {
    const value = Number((row as { amount_toman_at_time: number }).amount_toman_at_time);
    if (Number.isFinite(value) && value > 0) total += value;
  }
  return total;
}

async function claimExpenseAlertDelivery(
  userId: string,
  transactionId: string
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('notification_deliveries').insert({
    user_id: userId,
    kind: 'expense_alert',
    dedup_key: transactionId,
  });

  if (!error) return true;
  if (error.code === '23505') return false;
  console.error('claimExpenseAlertDelivery failed', error);
  return false;
}

export async function notifyExpenseTransaction(
  userId: string,
  tx: Transaction
): Promise<void> {
  if (tx.type !== 'EXPENSE' || tx.user_id !== userId) return;

  const addedAmountToman = expenseAmountToman(tx);
  if (addedAmountToman == null) return;

  const alertEnabled = await loadExpenseAlertEnabled(userId);
  if (!alertEnabled) return;

  const claimed = await claimExpenseAlertDelivery(userId, tx.id);
  if (!claimed) return;

  const connection = await loadActiveConnection(userId);
  if (!connection) return;

  const todayJalaali = formatJalaali(todayJalaaliInTimezone(TEHRAN_TIMEZONE));
  const [todayTotalExpenseToman, categoryName, capStatus] = await Promise.all([
    loadTodayExpenseTotalToman(userId, todayJalaali),
    loadCategoryName(userId, tx.category_id),
    findCapStatusForCategory(userId, tx.category_id),
  ]);

  const capLine =
    capStatus && capStatus.percent >= 80
      ? formatExpenseCapLine({
          categoryName: capStatus.categoryName,
          spentToman: capStatus.spentToman,
          limitToman: capStatus.limitToman,
          percent: capStatus.percent,
        })
      : null;

  const text = formatExpenseAlertMessage({
    addedAmountToman,
    todayTotalExpenseToman,
    categoryName,
    note: tx.note,
    capLine,
  });

  try {
    await sendTelegramMessage(connection.telegram_chat_id, text);
  } catch (err) {
    if (err instanceof TelegramSendError && err.blocked) {
      await markConnectionInactive(userId);
    } else {
      console.error('notifyExpenseTransaction failed', err);
    }
    return;
  }
}

export async function notifyExpenseTransactions(
  userId: string,
  transactions: Transaction[]
): Promise<void> {
  for (const tx of transactions) {
    await notifyExpenseTransaction(userId, tx);
  }
}
