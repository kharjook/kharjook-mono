import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type { RecurringTransaction } from '@/shared/types/domain';
import { addIntervalDate } from '@/features/deadlines/utils/schedule';
import { createBotWalletTransaction } from '@/features/notifications/services/bot-quick-add-transaction';
import { compareJalaaliStrings } from '@/features/notifications/utils/jalali-days';
import { TEHRAN_TIMEZONE } from '@/features/notifications/telegram/utils/format-debts-list';
import { formatJalaali, parseJalaali, todayJalaaliInTimezone } from '@/shared/utils/jalali';

async function generateDueInstance(
  row: RecurringTransaction,
  dueDateString: string,
  todayStr: string
): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  const { data: existing } = await admin
    .from('recurring_transaction_runs')
    .select('transaction_id')
    .eq('recurring_id', row.id)
    .eq('due_date_string', dueDateString)
    .maybeSingle();
  if (existing) return false;

  const note = [row.title, row.note?.trim()].filter(Boolean).join(' · ');
  const notifyExpense =
    row.type === 'EXPENSE' && dueDateString === todayStr;

  const result = await createBotWalletTransaction({
    userId: row.user_id,
    type: row.type,
    amountToman: Number(row.amount_toman),
    walletId: row.wallet_id,
    categoryId: row.category_id,
    note,
    dateString: dueDateString,
    notifyExpense,
  });

  if (!result.ok) {
    console.error(`recurring ${row.id} @ ${dueDateString}: ${result.error}`);
    return false;
  }

  const { error: runErr } = await admin.from('recurring_transaction_runs').insert({
    recurring_id: row.id,
    due_date_string: dueDateString,
    transaction_id: result.transactionId,
  });
  if (runErr) {
    console.error('recurring_transaction_runs insert failed', runErr);
    return false;
  }

  return true;
}

async function processOneRecurring(row: RecurringTransaction, todayStr: string): Promise<number> {
  if (!row.is_active || row.deleted_at) return 0;

  let dueStr = row.next_due_date_string;
  let created = 0;
  const maxCatchUp = 24;

  for (let i = 0; i < maxCatchUp && compareJalaaliStrings(dueStr, todayStr) <= 0; i += 1) {
    if (row.end_date_string && compareJalaaliStrings(dueStr, row.end_date_string) > 0) {
      break;
    }

    if (await generateDueInstance(row, dueStr, todayStr)) {
      created += 1;
    }

    const due = parseJalaali(dueStr);
    if (!due) break;
    dueStr = formatJalaali(
      addIntervalDate(due, row.interval_number, row.interval_period)
    );
  }

  const admin = createSupabaseAdminClient();
  const stillActive =
    !row.end_date_string || compareJalaaliStrings(dueStr, row.end_date_string) <= 0;

  await admin
    .from('recurring_transactions')
    .update({
      next_due_date_string: dueStr,
      is_active: stillActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  return created;
}

export async function processRecurringTransactions(): Promise<{
  created: number;
  errors: string[];
}> {
  const todayStr = formatJalaali(todayJalaaliInTimezone(TEHRAN_TIMEZONE));
  const admin = createSupabaseAdminClient();

  const { data: rows, error } = await admin
    .from('recurring_transactions')
    .select('*')
    .eq('is_active', true)
    .is('deleted_at', null)
    .lte('next_due_date_string', todayStr);

  if (error) {
    return { created: 0, errors: [error.message] };
  }

  let created = 0;
  const errors: string[] = [];

  for (const row of (rows ?? []) as RecurringTransaction[]) {
    try {
      created += await processOneRecurring(row, todayStr);
    } catch (err) {
      errors.push(
        `${row.id}:${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { created, errors };
}
