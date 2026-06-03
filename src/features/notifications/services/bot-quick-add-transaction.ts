import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import type { Category, CurrencyRate, Transaction, Wallet } from '@/shared/types/domain';
import { notifyExpenseTransaction } from '@/features/notifications/services/notify-expense-transaction';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { formatJalaali, todayJalaaliInTimezone } from '@/shared/utils/jalali';
import { TEHRAN_TIMEZONE } from '@/features/notifications/telegram/utils/format-debts-list';

export async function createBotWalletTransaction(input: {
  userId: string;
  type: 'INCOME' | 'EXPENSE';
  amountToman: number;
  walletId: string;
  categoryId: string;
  note?: string;
  dateString?: string;
  notifyExpense?: boolean;
}): Promise<{ ok: true; transactionId: string } | { ok: false; error: string }> {
  if (!(input.amountToman > 0)) {
    return { ok: false, error: 'مبلغ نامعتبر است.' };
  }

  const admin = createSupabaseAdminClient();
  const [{ data: walletRow }, { data: categoryRow }, { data: ratesRows }] = await Promise.all([
    admin
      .from('wallets')
      .select('*')
      .eq('id', input.walletId)
      .eq('user_id', input.userId)
      .is('archived_at', null)
      .maybeSingle(),
    admin
      .from('categories')
      .select('*')
      .eq('id', input.categoryId)
      .eq('user_id', input.userId)
      .maybeSingle(),
    admin.from('currency_rates').select('*').eq('user_id', input.userId),
  ]);

  const wallet = walletRow as Wallet | null;
  const category = categoryRow as Category | null;
  const rates = (ratesRows ?? []) as CurrencyRate[];

  if (!wallet) return { ok: false, error: 'کیف پول پیدا نشد.' };
  if (!category) return { ok: false, error: 'دسته‌بندی پیدا نشد.' };

  const expectedKind = input.type === 'INCOME' ? 'income' : 'expense';
  if (category.kind !== expectedKind) {
    return { ok: false, error: 'دسته‌بندی با نوع تراکنش همخوان نیست.' };
  }

  const usdRate = rates.find((r) => r.currency === 'USD')?.toman_per_unit ?? 0;
  const walletRate = tomanPerUnit(wallet.currency, rates);
  if (walletRate <= 0 || usdRate <= 0) {
    return { ok: false, error: 'نرخ تبدیل در دسترس نیست.' };
  }

  const walletAmount =
    wallet.currency === 'IRT' ? input.amountToman : input.amountToman / walletRate;
  const date_string =
    input.dateString?.trim() ||
    formatJalaali(todayJalaaliInTimezone(TEHRAN_TIMEZONE));

  const base = {
    user_id: input.userId,
    type: input.type,
    date_string,
    note: input.note?.trim() || null,
    category_id: input.categoryId,
    amount_toman_at_time: input.amountToman,
    amount_usd_at_time: input.amountToman / usdRate,
    asset_id: null,
    amount: null,
    price_toman: wallet.currency === 'IRT' ? null : walletRate,
    usd_rate: wallet.currency === 'IRT' ? null : usdRate,
  };

  const payload =
    input.type === 'INCOME'
      ? {
          ...base,
          target_wallet_id: wallet.id,
          target_amount: walletAmount,
          source_wallet_id: null,
          source_amount: null,
          target_asset_id: null,
          source_asset_id: null,
        }
      : {
          ...base,
          source_wallet_id: wallet.id,
          source_amount: walletAmount,
          target_wallet_id: null,
          target_amount: null,
          source_asset_id: null,
          target_asset_id: null,
        };

  const { data, error } = await admin.from('transactions').insert(payload).select().single();
  if (error || !data) return { ok: false, error: 'ثبت تراکنش ناموفق بود.' };

  if (input.type === 'EXPENSE' && input.notifyExpense !== false) {
    await notifyExpenseTransaction(input.userId, data as Transaction);
  }

  return { ok: true, transactionId: (data as Transaction).id };
}
