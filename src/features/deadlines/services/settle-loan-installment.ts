import { createSupabaseAdminClient } from '@/shared/lib/supabase/admin';
import {
  installmentPaidAmount,
  installmentRemainingAmount,
  validatePartialPayAmount,
} from '@/features/deadlines/utils/installment-remaining';
import { notifyExpenseTransaction } from '@/features/notifications/services/notify-expense-transaction';
import type { Loan, LoanInstallment, Transaction, Wallet } from '@/shared/types/domain';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';

export type SettleInstallmentResult =
  | { ok: true; transactionId: string; fullyPaid: boolean }
  | { ok: false; error: string; code: 'not_found' | 'already_paid' | 'invalid' | 'db' };

export async function settleLoanInstallment(input: {
  userId: string;
  installmentId: string;
  walletId: string;
  /** In loan currency; defaults to remaining balance. */
  payAmountInLoanCurrency?: number;
}): Promise<SettleInstallmentResult> {
  const admin = createSupabaseAdminClient();

  const { data: installmentRow } = await admin
    .from('loan_installments')
    .select('*')
    .eq('id', input.installmentId)
    .eq('user_id', input.userId)
    .maybeSingle();

  if (!installmentRow) {
    return { ok: false, error: 'قسط پیدا نشد.', code: 'not_found' };
  }

  const installment = installmentRow as LoanInstallment;
  if (installment.is_paid) {
    return { ok: false, error: 'این قسط قبلاً پرداخت شده.', code: 'already_paid' };
  }

  const remaining = installmentRemainingAmount(installment);
  if (!(remaining > 0)) {
    return { ok: false, error: 'این قسط قبلاً پرداخت شده.', code: 'already_paid' };
  }

  const payInLoanCurrency = input.payAmountInLoanCurrency ?? remaining;
  const amountError = validatePartialPayAmount(payInLoanCurrency, remaining);
  if (amountError) {
    return { ok: false, error: amountError, code: 'invalid' };
  }

  const [{ data: loanRow }, { data: walletRow }, { data: ratesRows }] = await Promise.all([
    admin
      .from('loans')
      .select('*')
      .eq('id', installment.loan_id)
      .eq('user_id', input.userId)
      .is('deleted_at', null)
      .maybeSingle(),
    admin
      .from('wallets')
      .select('*')
      .eq('id', input.walletId)
      .eq('user_id', input.userId)
      .is('archived_at', null)
      .maybeSingle(),
    admin.from('currency_rates').select('*').eq('user_id', input.userId),
  ]);

  const loan = loanRow as Loan | null;
  const wallet = walletRow as Wallet | null;
  if (!loan || !wallet) {
    return { ok: false, error: 'اطلاعات وام یا کیف پول نامعتبر است.', code: 'invalid' };
  }

  const rates = ratesRows ?? [];
  const usdRate = rates.find((r) => r.currency === 'USD')?.toman_per_unit ?? 0;
  const loanRate = tomanPerUnit(loan.currency, rates);
  const payRate = tomanPerUnit(wallet.currency, rates);

  if (loanRate <= 0 || payRate <= 0 || usdRate <= 0) {
    return { ok: false, error: 'نرخ تبدیل برای تسویه در دسترس نیست.', code: 'invalid' };
  }

  const payAmount = (payInLoanCurrency * loanRate) / payRate;
  if (!Number.isFinite(payAmount) || payAmount <= 0) {
    return { ok: false, error: 'مبلغ تسویه نامعتبر است.', code: 'invalid' };
  }

  const txPayload: Record<string, unknown> = {
    user_id: input.userId,
    type: 'EXPENSE',
    date_string: installment.due_date_string,
    note: loan.title,
    source_wallet_id: wallet.id,
    source_asset_id: null,
    target_wallet_id: null,
    target_asset_id: null,
    source_amount: payAmount,
    target_amount: null,
    category_id: loan.type === 'expense' ? loan.category_id : null,
    asset_id: null,
    amount: null,
    price_toman: wallet.currency === 'IRT' ? null : payRate,
    usd_rate: wallet.currency === 'IRT' ? null : usdRate,
    amount_toman_at_time: payAmount * payRate,
    amount_usd_at_time: (payAmount * payRate) / usdRate,
  };

  const { data: txData, error: txErr } = await admin
    .from('transactions')
    .insert(txPayload)
    .select()
    .single();

  if (txErr || !txData) {
    return { ok: false, error: 'ثبت تراکنش ناموفق بود.', code: 'db' };
  }

  const createdTx = txData as Transaction;
  const actuallyNewPaid = installmentPaidAmount(installment) + payInLoanCurrency;
  const fullyPaid = actuallyNewPaid >= Number(installment.amount) - 1e-9;

  const { error: installmentErr } = await admin
    .from('loan_installments')
    .update({
      paid_amount: actuallyNewPaid,
      is_paid: fullyPaid,
      paid_at: fullyPaid ? new Date().toISOString() : installment.paid_at,
      paid_transaction_id: createdTx.id,
    })
    .eq('id', installment.id)
    .eq('is_paid', false);

  if (installmentErr) {
    return { ok: false, error: 'به‌روزرسانی قسط ناموفق بود.', code: 'db' };
  }

  await notifyExpenseTransaction(input.userId, createdTx);

  return { ok: true, transactionId: createdTx.id, fullyPaid };
}
