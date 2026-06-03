import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type { Category, CategorySpendingCap, TelegramConnection } from '@/shared/types/domain';
import {
  buildCapStatuses,
  capLevelForPercent,
  monthKeyFromPeriod,
  type CapStatus,
} from '@/features/categories/utils/category-spending-caps';
import {
  formatCapThresholdAlertMessage,
  formatCategoryCapsMessage,
} from '@/features/notifications/telegram/utils/format-category-caps';
import { TEHRAN_TIMEZONE } from '@/features/notifications/telegram/utils/format-debts-list';
import {
  sendTelegramMessage,
  TelegramSendError,
} from '@/features/notifications/telegram/utils/telegram-client';
import { formatJalaali, todayJalaaliInTimezone } from '@/shared/utils/jalali';
import { periodContaining } from '@/shared/utils/period';

async function loadCaps(userId: string): Promise<CategorySpendingCap[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('category_spending_caps')
    .select('*')
    .eq('user_id', userId);
  return (data ?? []) as CategorySpendingCap[];
}

async function loadExpenseCategories(userId: string): Promise<Category[]> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .eq('kind', 'expense');
  return (data ?? []) as Category[];
}

async function loadCategoryExpenseToman(
  userId: string,
  categoryId: string,
  start: string,
  end: string
): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('get_category_expense_toman_for_period', {
    p_user_id: userId,
    p_category_id: categoryId,
    p_start: start,
    p_end: end,
  });
  if (error) {
    console.error('get_category_expense_toman_for_period failed', error);
    return 0;
  }
  const parsed = Number(data);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function wasCapAlertDelivered(
  userId: string,
  dedupKey: string
): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('notification_deliveries')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', 'category_cap_alert')
    .eq('dedup_key', dedupKey)
    .maybeSingle();
  return !!data;
}

async function markCapAlertDelivered(userId: string, dedupKey: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from('notification_deliveries').insert({
    user_id: userId,
    kind: 'category_cap_alert',
    dedup_key: dedupKey,
  });
}

async function markConnectionInactive(userId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from('telegram_connections').update({ is_active: false }).eq('user_id', userId);
}

export async function loadCapStatusesForUser(userId: string): Promise<CapStatus[]> {
  const caps = await loadCaps(userId);
  if (caps.length === 0) return [];

  const categories = await loadExpenseCategories(userId);
  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const period = periodContaining('month', today);
  const start = formatJalaali(period.start);
  const end = formatJalaali(period.end);

  const rows: CapStatus[] = [];
  for (const cap of caps) {
    const category = categories.find((item) => item.id === cap.category_id);
    if (!category) continue;
    const limitToman = Number(cap.monthly_limit_toman);
    if (!(limitToman > 0)) continue;
    const spentToman = await loadCategoryExpenseToman(userId, cap.category_id, start, end);
    const percent = (spentToman / limitToman) * 100;
    rows.push({
      categoryId: cap.category_id,
      categoryName: category.name,
      categoryColor: category.color,
      limitToman,
      spentToman,
      percent,
      level: capLevelForPercent(percent),
    });
  }

  return rows.sort((a, b) => b.percent - a.percent);
}

export async function sendCategoryCapsForUser(
  userId: string,
  connection: TelegramConnection
): Promise<void> {
  const rows = await loadCapStatusesForUser(userId);
  const text = formatCategoryCapsMessage(rows);
  try {
    await sendTelegramMessage(connection.telegram_chat_id, text);
  } catch (err) {
    if (err instanceof TelegramSendError && err.blocked) {
      await markConnectionInactive(userId);
    }
    throw err;
  }
}

export async function processCategoryCapAlertsForUser(
  userId: string,
  connection: TelegramConnection
): Promise<number> {
  const rows = await loadCapStatusesForUser(userId);
  if (rows.length === 0) return 0;

  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const monthKey = monthKeyFromPeriod(periodContaining('month', today));
  let sent = 0;

  for (const row of rows) {
    for (const threshold of [80, 100] as const) {
      if (row.percent < threshold) continue;
      const dedupKey = `${row.categoryId}:${monthKey}:${threshold}`;
      if (await wasCapAlertDelivered(userId, dedupKey)) continue;

      const text = formatCapThresholdAlertMessage({
        categoryName: row.categoryName,
        threshold,
        spentToman: row.spentToman,
        limitToman: row.limitToman,
      });

      try {
        await sendTelegramMessage(connection.telegram_chat_id, text);
        await markCapAlertDelivered(userId, dedupKey);
        sent += 1;
      } catch (err) {
        if (err instanceof TelegramSendError && err.blocked) {
          await markConnectionInactive(userId);
        }
        throw err;
      }
    }
  }

  return sent;
}

export async function findCapStatusForCategory(
  userId: string,
  categoryId: string | null
): Promise<CapStatus | null> {
  if (!categoryId) return null;

  const caps = await loadCaps(userId);
  if (caps.length === 0) return null;

  const categories = await loadExpenseCategories(userId);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const period = periodContaining('month', today);
  const start = formatJalaali(period.start);
  const end = formatJalaali(period.end);

  for (const cap of caps) {
    const root = categoryById.get(cap.category_id);
    if (!root) continue;

    const subtreeIds = new Set<string>([cap.category_id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categories) {
        if (category.parent_id && subtreeIds.has(category.parent_id) && !subtreeIds.has(category.id)) {
          subtreeIds.add(category.id);
          changed = true;
        }
      }
    }

    if (!subtreeIds.has(categoryId)) continue;

    const limitToman = Number(cap.monthly_limit_toman);
    if (!(limitToman > 0)) continue;
    const spentToman = await loadCategoryExpenseToman(userId, cap.category_id, start, end);
    const percent = (spentToman / limitToman) * 100;

    return {
      categoryId: cap.category_id,
      categoryName: root.name,
      categoryColor: root.color,
      limitToman,
      spentToman,
      percent,
      level: capLevelForPercent(percent),
    };
  }

  return null;
}

export async function maybeNotifyCapThresholdsForExpense(
  userId: string,
  categoryId: string | null
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: connectionRow } = await admin
    .from('telegram_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle();
  const connection = (connectionRow as TelegramConnection | null) ?? null;
  if (!connection) return;

  const status = await findCapStatusForCategory(userId, categoryId);
  if (!status || status.percent < 80) return;

  const today = todayJalaaliInTimezone(TEHRAN_TIMEZONE);
  const monthKey = monthKeyFromPeriod(periodContaining('month', today));

  for (const threshold of [80, 100] as const) {
    if (status.percent < threshold) continue;
    const dedupKey = `${status.categoryId}:${monthKey}:${threshold}`;
    if (await wasCapAlertDelivered(userId, dedupKey)) continue;

    const text = formatCapThresholdAlertMessage({
      categoryName: status.categoryName,
      threshold,
      spentToman: status.spentToman,
      limitToman: status.limitToman,
    });

    try {
      await sendTelegramMessage(connection.telegram_chat_id, text);
      await markCapAlertDelivered(userId, dedupKey);
    } catch (err) {
      if (err instanceof TelegramSendError && err.blocked) {
        await markConnectionInactive(userId);
      } else {
        console.error('maybeNotifyCapThresholdsForExpense failed', err);
      }
    }
  }
}
