'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  CreditCard,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { useToast } from '@/shared/components/Toast';
import { supabase } from '@/shared/lib/supabase/client';
import type { Loan, LoanInstallment, Transaction } from '@/shared/types/domain';
import { formatCurrency } from '@/shared/utils/format-currency';
import { formatJalaaliHuman, parseJalaali } from '@/shared/utils/jalali';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';
import { ListSheetPicker } from '@/shared/components/ListSheetPicker';

type TabKey = 'loans' | 'installments';

export function LoansHubView() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { wallets, categories, currencyRates, setTransactions } = useData();
  const { currencyMode, usdRate } = useUI();

  const [tab, setTab] = useState<TabKey>('loans');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [installments, setInstallments] = useState<LoanInstallment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [settlementTarget, setSettlementTarget] = useState<LoanInstallment | null>(null);
  const [settlementWalletId, setSettlementWalletId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [loanRes, installmentRes] = await Promise.all([
        supabase
          .from('loans')
          .select('*')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase
          .from('loan_installments')
          .select('*')
          .order('due_date_string', { ascending: true })
          .order('sequence_no', { ascending: true }),
      ]);
      if (loanRes.error) throw loanRes.error;
      if (installmentRes.error) throw installmentRes.error;
      setLoans((loanRes.data ?? []) as Loan[]);
      setInstallments((installmentRes.data ?? []) as LoanInstallment[]);
    } catch (error) {
      console.error(error);
      toast.error('خطا در دریافت اطلاعات اقساط و وام‌ها.');
    } finally {
      setIsLoading(false);
    }
  }, [toast, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loansById = useMemo(() => {
    return new Map(loans.map((loan) => [loan.id, loan]));
  }, [loans]);

  const loansRows = useMemo(() => {
    return loans.map((loan) => {
      const all = installments.filter((it) => it.loan_id === loan.id);
      const paidCount = all.filter((it) => it.is_paid).length;
      return { loan, paidCount, totalCount: all.length };
    });
  }, [installments, loans]);

  const installmentRows = useMemo(() => {
    return installments
      .map((it) => ({ installment: it, loan: loansById.get(it.loan_id) ?? null }))
      .filter(
        (row): row is { installment: LoanInstallment; loan: Loan } => row.loan !== null
      );
  }, [installments, loansById]);

  const walletItems = useMemo(() => {
    return wallets.map((wallet) => ({
      id: wallet.id,
      label: wallet.name,
      sublabel: `${CURRENCY_META[wallet.currency].label} · ${wallet.currency}`,
    }));
  }, [wallets]);

  const openSettle = (installment: LoanInstallment) => {
    setSettlementTarget(installment);
    setSettlementWalletId(null);
  };

  const closeSettle = () => {
    setSettlementTarget(null);
    setSettlementWalletId(null);
  };

  const handleDeleteLoan = async (loan: Loan) => {
    setIsSubmitting(true);
    try {
      const { error: updErr } = await supabase
        .from('loans')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', loan.id);
      if (updErr) throw updErr;

      const { error: delErr } = await supabase
        .from('loan_installments')
        .delete()
        .eq('loan_id', loan.id)
        .eq('is_paid', false);
      if (delErr) throw delErr;

      toast.success('وام حذف شد و اقساط باقی‌مانده پاک شدند.');
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error('خطا در حذف وام.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSettle = async () => {
    if (!settlementTarget || !settlementWalletId) {
      toast.error('کیف پول پرداخت را انتخاب کن.');
      return;
    }
    const loan = loansById.get(settlementTarget.loan_id);
    const wallet = wallets.find((w) => w.id === settlementWalletId);
    if (!loan || !wallet) {
      toast.error('اطلاعات پرداخت نامعتبر است.');
      return;
    }

    const loanRate = tomanPerUnit(loan.currency, currencyRates);
    const payRate = tomanPerUnit(wallet.currency, currencyRates);
    if (loanRate <= 0 || payRate <= 0 || usdRate <= 0) {
      toast.error('نرخ تبدیل برای تسویه در دسترس نیست.');
      return;
    }

    const payAmount = (settlementTarget.amount * loanRate) / payRate;
    if (!Number.isFinite(payAmount) || payAmount <= 0) {
      toast.error('مبلغ تسویه نامعتبر است.');
      return;
    }

    const txPayload: Record<string, unknown> = {
      user_id: user?.id,
      type: 'EXPENSE',
      date_string: settlementTarget.due_date_string,
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

    setIsSubmitting(true);
    try {
      const { data: txData, error: txErr } = await supabase
        .from('transactions')
        .insert(txPayload)
        .select()
        .single();
      if (txErr) throw txErr;
      const createdTx = txData as Transaction;

      const { error: installmentErr } = await supabase
        .from('loan_installments')
        .update({
          is_paid: true,
          paid_at: new Date().toISOString(),
          paid_transaction_id: createdTx.id,
        })
        .eq('id', settlementTarget.id);
      if (installmentErr) throw installmentErr;

      setTransactions((prev) => [createdTx, ...prev]);
      toast.success('قسط تسویه شد و تراکنش ثبت شد.');
      closeSettle();
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error('خطا در تسویه قسط.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">اقساط و وام‌ها</h2>
        <button
          type="button"
          onClick={() => router.push('/deadlines/loans/new')}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          وام جدید
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 bg-[#1A1B26] p-1 rounded-xl">
        <button
          type="button"
          onClick={() => setTab('loans')}
          className={`py-2 text-xs font-bold rounded-lg transition-all ${
            tab === 'loans' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          وام‌ها
        </button>
        <button
          type="button"
          onClick={() => setTab('installments')}
          className={`py-2 text-xs font-bold rounded-lg transition-all ${
            tab === 'installments' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          اقساط
        </button>
      </div>

      {isLoading ? (
        <div className="text-center text-slate-500 py-10 animate-pulse">در حال دریافت...</div>
      ) : tab === 'loans' ? (
        loansRows.length === 0 ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-slate-500 text-sm">هنوز وامی ثبت نشده.</p>
            <button
              type="button"
              onClick={() => router.push('/deadlines/loans/new')}
              className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 text-sm font-medium"
            >
              <Plus size={16} />
              ایجاد اولین وام
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {loansRows.map(({ loan, paidCount, totalCount }) => {
              const category = loan.category_id
                ? categories.find((c) => c.id === loan.category_id)
                : null;
              const totalDisplay =
                loan.total_amount ?? (loan.installment_amount * loan.repeat_count);
              return (
                <div
                  key={loan.id}
                  className="bg-[#1A1B26] border border-white/5 p-4 rounded-2xl space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-100">{loan.title}</h3>
                      <p className="text-xs text-slate-500 mt-1">
                        {loan.type === 'expense' ? 'خرید اعتباری' : 'وام نقدی'}
                        {category ? ` · ${category.name}` : ''}
                      </p>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {paidCount}/{totalCount} تسویه
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-white/3 rounded-xl p-2.5">
                      <p className="text-slate-500">مبلغ هر قسط</p>
                      <p className="text-slate-200 mt-1" dir="ltr">
                        {formatCurrency(loan.installment_amount, currencyMode)}
                      </p>
                    </div>
                    <div className="bg-white/3 rounded-xl p-2.5">
                      <p className="text-slate-500">جمع کل</p>
                      <p className="text-slate-200 mt-1" dir="ltr">
                        {formatCurrency(totalDisplay, currencyMode)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Link
                      href={`/deadlines/loans/${loan.id}/edit`}
                      className="text-[12px] px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 transition"
                    >
                      ویرایش
                    </Link>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => void handleDeleteLoan(loan)}
                      className="text-[12px] px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 transition disabled:opacity-50"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Trash2 size={13} />
                        حذف
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : installmentRows.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <p className="text-slate-500 text-sm">قسطی برای نمایش نیست.</p>
          <p className="text-slate-600 text-xs">بعد از ثبت وام، برنامه اقساط اینجا نمایش داده می‌شود.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {installmentRows.map(({ installment, loan }) => {
            const parsed = parseJalaali(installment.due_date_string);
            const dueLabel = parsed ? formatJalaaliHuman(parsed) : installment.due_date_string;
            const loanRate = tomanPerUnit(loan.currency, currencyRates);
            const amountDisplay =
              currencyMode === 'USD' && usdRate > 0
                ? (installment.amount * loanRate) / usdRate
                : installment.amount;
            return (
              <div
                key={installment.id}
                className="bg-[#1A1B26] border border-white/5 p-4 rounded-2xl flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-100 truncate">{loan.title}</p>
                  <p className="text-xs text-slate-500 mt-1">{dueLabel}</p>
                  <p className="text-xs text-slate-300 mt-1" dir="ltr">
                    {formatCurrency(amountDisplay, currencyMode)}
                  </p>
                </div>

                {installment.is_paid ? (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 shrink-0">
                    <CheckCircle2 size={14} />
                    تسویه‌شده
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openSettle(installment)}
                    className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition shrink-0"
                  >
                    <CreditCard size={14} />
                    تسویه
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ListSheetPicker
        open={settlementTarget !== null}
        onClose={closeSettle}
        title="انتخاب کیف پول پرداخت"
        items={walletItems}
        value={settlementWalletId}
        onSelect={(id) => setSettlementWalletId(id)}
      />

      {settlementTarget && (
        <div className="fixed inset-x-0 bottom-24 px-6 sm:max-w-md sm:mx-auto z-40">
          <div className="bg-[#13141C] border border-white/10 rounded-2xl p-3 shadow-2xl flex items-center gap-2">
            <button
              type="button"
              onClick={handleSettle}
              disabled={isSubmitting || !settlementWalletId}
              className="flex-1 px-3 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 size={14} className="animate-spin" />
                  در حال تسویه...
                </span>
              ) : (
                'ثبت تسویه'
              )}
            </button>
            <button
              type="button"
              onClick={closeSettle}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-sm"
            >
              انصراف
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
