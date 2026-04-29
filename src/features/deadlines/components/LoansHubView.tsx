'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
import {
  formatJalaali,
  formatJalaaliHuman,
  jalaaliMonthLength,
  jalaaliWeekday,
  JALALI_MONTHS,
  parseJalaali,
  todayJalaali,
} from '@/shared/utils/jalali';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';
import { ListSheetPicker } from '@/shared/components/ListSheetPicker';

type TabKey = 'loans' | 'installments' | 'calendar';
type InstallmentFilter = 'all' | 'paid' | 'remaining';
type InstallmentRow = { installment: LoanInstallment; loan: Loan };

const WEEKDAY_LABELS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] as const;
const toFaDigits = (value: number | string) =>
  String(value).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]!);

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
  const [isSettlementPickerOpen, setIsSettlementPickerOpen] = useState(false);
  const [installmentFilter, setInstallmentFilter] = useState<InstallmentFilter>('all');
  const today = useMemo(() => todayJalaali(), []);
  const todayStr = useMemo(() => formatJalaali(today), [today]);
  const [calendarMonth, setCalendarMonth] = useState<{ jy: number; jm: number }>({
    jy: today.jy,
    jm: today.jm,
  });
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string>(todayStr);

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

  const installmentRows = useMemo<InstallmentRow[]>(() => {
    return installments
      .map((it) => ({ installment: it, loan: loansById.get(it.loan_id) ?? null }))
      .filter(
        (row): row is { installment: LoanInstallment; loan: Loan } => row.loan !== null
      );
  }, [installments, loansById]);

  const displayAmount = useCallback(
    (row: InstallmentRow) => {
      const loanRate = tomanPerUnit(row.loan.currency, currencyRates);
      if (!(loanRate > 0)) return row.installment.amount;
      if (currencyMode === 'USD' && usdRate > 0) {
        return (row.installment.amount * loanRate) / usdRate;
      }
      return row.installment.amount;
    },
    [currencyMode, currencyRates, usdRate]
  );

  const filteredInstallmentRows = useMemo(() => {
    if (installmentFilter === 'all') return installmentRows;
    if (installmentFilter === 'paid') {
      return installmentRows.filter((row) => row.installment.is_paid);
    }
    return installmentRows.filter((row) => !row.installment.is_paid);
  }, [installmentFilter, installmentRows]);

  const groupedInstallments = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      label: string;
      rows: Array<{ installment: LoanInstallment; loan: Loan }>;
    }>();
    for (const row of filteredInstallmentRows) {
      const parsed = parseJalaali(row.installment.due_date_string);
      const key = parsed
        ? `${parsed.jy}/${String(parsed.jm).padStart(2, '0')}`
        : row.installment.due_date_string.slice(0, 7);
      const label = parsed
        ? `${JALALI_MONTHS[parsed.jm - 1]} ${String(parsed.jy).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]!)}`
        : key;
      const existing = groups.get(key);
      if (existing) {
        existing.rows.push(row);
      } else {
        groups.set(key, { key, label, rows: [row] });
      }
    }
    return Array.from(groups.values());
  }, [filteredInstallmentRows]);

  const monthKey = `${calendarMonth.jy}/${String(calendarMonth.jm).padStart(2, '0')}`;
  const monthLength = useMemo(
    () => jalaaliMonthLength(calendarMonth.jy, calendarMonth.jm),
    [calendarMonth.jm, calendarMonth.jy]
  );
  const firstWeekday = useMemo(
    () => jalaaliWeekday({ jy: calendarMonth.jy, jm: calendarMonth.jm, jd: 1 }),
    [calendarMonth.jm, calendarMonth.jy]
  );
  const monthInstallments = useMemo(
    () =>
      installmentRows.filter(
        (row) =>
          !row.installment.is_paid &&
          row.installment.due_date_string.startsWith(`${monthKey}/`)
      ),
    [installmentRows, monthKey]
  );
  const installmentsByDate = useMemo(() => {
    const map = new Map<string, InstallmentRow[]>();
    for (const row of monthInstallments) {
      const key = row.installment.due_date_string;
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return map;
  }, [monthInstallments]);
  const selectedDayRows = useMemo(
    () => installmentsByDate.get(selectedCalendarDate) ?? [],
    [installmentsByDate, selectedCalendarDate]
  );
  const selectedDayLabel = useMemo(() => {
    const parsed = parseJalaali(selectedCalendarDate);
    return parsed ? formatJalaaliHuman(parsed) : selectedCalendarDate;
  }, [selectedCalendarDate]);
  const monthRemainingTotal = useMemo(() => {
    return monthInstallments.reduce((sum, row) => sum + displayAmount(row), 0);
  }, [displayAmount, monthInstallments]);
  const selectedRemainingTotal = useMemo(() => {
    return selectedDayRows.reduce((sum, row) => sum + displayAmount(row), 0);
  }, [displayAmount, selectedDayRows]);
  const calendarCells = useMemo(() => {
    const out: Array<{ date: string; day: number; rows: InstallmentRow[] } | null> = [];
    for (let i = 0; i < firstWeekday; i += 1) out.push(null);
    for (let day = 1; day <= monthLength; day += 1) {
      const date = `${monthKey}/${String(day).padStart(2, '0')}`;
      out.push({ date, day, rows: installmentsByDate.get(date) ?? [] });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [firstWeekday, installmentsByDate, monthKey, monthLength]);

  useEffect(() => {
    const parsed = parseJalaali(selectedCalendarDate);
    if (parsed && parsed.jy === calendarMonth.jy && parsed.jm === calendarMonth.jm) return;
    setSelectedCalendarDate(`${monthKey}/01`);
  }, [calendarMonth.jm, calendarMonth.jy, monthKey, selectedCalendarDate]);

  const moveCalendarMonth = (delta: 1 | -1) => {
    setCalendarMonth((prev) => {
      if (delta === 1) {
        return prev.jm === 12 ? { jy: prev.jy + 1, jm: 1 } : { jy: prev.jy, jm: prev.jm + 1 };
      }
      return prev.jm === 1 ? { jy: prev.jy - 1, jm: 12 } : { jy: prev.jy, jm: prev.jm - 1 };
    });
  };

  const remainingTotalDisplay = useMemo(() => {
    const remainingRows = installmentRows.filter((row) => !row.installment.is_paid);
    let totalToman = 0;
    for (const row of remainingRows) {
      const rate = tomanPerUnit(row.loan.currency, currencyRates);
      if (!(rate > 0)) continue;
      totalToman += row.installment.amount * rate;
    }
    if (currencyMode === 'USD') {
      return usdRate > 0 ? totalToman / usdRate : 0;
    }
    return totalToman;
  }, [installmentRows, currencyMode, currencyRates, usdRate]);

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
    setIsSettlementPickerOpen(true);
  };

  const closeSettle = () => {
    setSettlementTarget(null);
    setSettlementWalletId(null);
    setIsSettlementPickerOpen(false);
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

      <div className="grid grid-cols-3 gap-1 bg-[#1A1B26] p-1 rounded-xl">
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
        <button
          type="button"
          onClick={() => setTab('calendar')}
          className={`py-2 text-xs font-bold rounded-lg transition-all ${
            tab === 'calendar' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          تقویم بدهی
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
      ) : tab === 'installments' ? installmentRows.length === 0 ? (
        <div className="text-center py-10 space-y-2">
          <p className="text-slate-500 text-sm">قسطی برای نمایش نیست.</p>
          <p className="text-slate-600 text-xs">بعد از ثبت وام، برنامه اقساط اینجا نمایش داده می‌شود.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">جمع باقی‌مانده</span>
              <span className="text-sm font-semibold text-slate-100" dir="ltr">
                {formatCurrency(remainingTotalDisplay, currencyMode)}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setInstallmentFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                  installmentFilter === 'all'
                    ? 'bg-purple-600/25 border-purple-500/50 text-purple-200'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                }`}
              >
                همه
              </button>
              <button
                type="button"
                onClick={() => setInstallmentFilter('paid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                  installmentFilter === 'paid'
                    ? 'bg-purple-600/25 border-purple-500/50 text-purple-200'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                }`}
              >
                تسویه شده
              </button>
              <button
                type="button"
                onClick={() => setInstallmentFilter('remaining')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                  installmentFilter === 'remaining'
                    ? 'bg-purple-600/25 border-purple-500/50 text-purple-200'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
                }`}
              >
                باقی‌مانده
              </button>
            </div>
          </div>

          {groupedInstallments.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-6">
              موردی با این فیلتر وجود ندارد.
            </div>
          ) : groupedInstallments.map((group) => (
            <div key={group.key} className="space-y-2">
              <h3 className="text-xs font-bold text-slate-400 px-1">{group.label}</h3>
              {group.rows.map(({ installment, loan }) => {
                const parsed = parseJalaali(installment.due_date_string);
                const dueLabel = parsed ? formatJalaaliHuman(parsed) : installment.due_date_string;
                const amountDisplay = displayAmount({ installment, loan });
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
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => moveCalendarMonth(1)}
                className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 inline-flex items-center justify-center"
                aria-label="ماه بعد"
              >
                <ChevronLeft size={16} />
              </button>
              <div className="text-center">
                <p className="text-sm font-semibold text-white">
                  {JALALI_MONTHS[calendarMonth.jm - 1]} {toFaDigits(calendarMonth.jy)}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  جمع بدهی ماه: {formatCurrency(monthRemainingTotal, currencyMode)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => moveCalendarMonth(-1)}
                className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 inline-flex items-center justify-center"
                aria-label="ماه قبل"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className="text-[11px] text-slate-500 py-1">
                  {label}
                </div>
              ))}
              {calendarCells.map((cell, idx) => {
                if (!cell) {
                  return <div key={`empty-${idx}`} className="h-12 rounded-lg bg-transparent" />;
                }
                const isSelected = selectedCalendarDate === cell.date;
                const isToday = cell.date === todayStr;
                const isOverdue = cell.rows.length > 0 && cell.date < todayStr;
                return (
                  <button
                    type="button"
                    key={cell.date}
                    onClick={() => setSelectedCalendarDate(cell.date)}
                    className={`h-12 rounded-lg border transition relative ${
                      isSelected
                        ? 'bg-purple-600/30 border-purple-500/60'
                        : cell.rows.length > 0
                          ? 'bg-amber-500/8 border-amber-500/30 hover:bg-amber-500/15'
                          : 'bg-white/3 border-white/5 hover:bg-white/6'
                    }`}
                  >
                    <span
                      className={`text-xs ${isSelected ? 'text-purple-100 font-bold' : 'text-slate-300'}`}
                    >
                      {toFaDigits(cell.day)}
                    </span>
                    {cell.rows.length > 0 && (
                      <span
                        className={`absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] px-1.5 rounded-full ${
                          isOverdue ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {toFaDigits(cell.rows.length)}
                      </span>
                    )}
                    {isToday && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-sky-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-[#1A1B26] border border-white/5 rounded-2xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-100">{selectedDayLabel}</h3>
              <span className="text-xs text-slate-400" dir="ltr">
                {formatCurrency(selectedRemainingTotal, currencyMode)}
              </span>
            </div>
            {selectedDayRows.length === 0 ? (
              <p className="text-xs text-slate-500 py-3 text-center">برای این روز قسطی ثبت نشده.</p>
            ) : (
              <div className="space-y-2">
                {selectedDayRows.map((row) => (
                  <div
                    key={row.installment.id}
                    className="bg-white/3 border border-white/5 rounded-xl p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-slate-100 truncate">{row.loan.title}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        قسط {toFaDigits(row.installment.sequence_no)}
                      </p>
                      <p className="text-xs text-slate-200 mt-1" dir="ltr">
                        {formatCurrency(displayAmount(row), currencyMode)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openSettle(row.installment)}
                      className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition shrink-0"
                    >
                      <CreditCard size={14} />
                      تسویه
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <ListSheetPicker
        open={isSettlementPickerOpen}
        onClose={() => setIsSettlementPickerOpen(false)}
        title="انتخاب کیف پول پرداخت"
        items={walletItems}
        value={settlementWalletId}
        onSelect={(id) => {
          setSettlementWalletId(id);
          setIsSettlementPickerOpen(false);
        }}
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
              onClick={() => setIsSettlementPickerOpen(true)}
              disabled={isSubmitting}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-sm disabled:opacity-50"
            >
              انتخاب کیف پول
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
