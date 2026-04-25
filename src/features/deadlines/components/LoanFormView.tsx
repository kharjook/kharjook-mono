'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Calendar, ChevronLeft } from 'lucide-react';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { useToast } from '@/shared/components/Toast';
import { supabase } from '@/shared/lib/supabase/client';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { IOSDatePicker } from '@/shared/components/IOSDatePicker';
import { CategorySheetPicker } from '@/shared/components/CategorySheetPicker';
import { ListSheetPicker } from '@/shared/components/ListSheetPicker';
import type {
  Loan,
  LoanInstallment,
  LoanIntervalPeriod,
  LoanType,
  Transaction,
  Wallet,
} from '@/shared/types/domain';
import { formatJalaali, formatJalaaliHuman, parseJalaali, todayJalaali } from '@/shared/utils/jalali';
import { buildInstallmentSchedule } from '@/features/deadlines/utils/schedule';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';

type LoanFormState = {
  title: string;
  type: LoanType;
  categoryId: string | null;
  currencyWalletId: string | null;
  totalAmount: string;
  installmentAmount: string;
  loanStartDate: string;
  firstDueDate: string;
  description: string;
  repeatCount: string;
  intervalNumber: string;
  intervalPeriod: LoanIntervalPeriod;
  autoIncomeOnCreate: boolean;
  autoIncomeWalletId: string | null;
};

const INTERVAL_OPTIONS: { id: LoanIntervalPeriod; label: string }[] = [
  { id: 'day', label: 'روز' },
  { id: 'week', label: 'هفته' },
  { id: 'month', label: 'ماه' },
  { id: 'year', label: 'سال' },
];

function initialState(): LoanFormState {
  const today = formatJalaali(todayJalaali());
  return {
    title: '',
    type: 'expense',
    categoryId: null,
    currencyWalletId: null,
    totalAmount: '',
    installmentAmount: '',
    loanStartDate: today,
    firstDueDate: today,
    description: '',
    repeatCount: '12',
    intervalNumber: '1',
    intervalPeriod: 'month',
    autoIncomeOnCreate: false,
    autoIncomeWalletId: null,
  };
}

export function LoanFormView({ loanId }: { loanId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { wallets, categories, currencyRates, setTransactions } = useData();
  const { usdRate } = useUI();
  const isEdit = !!loanId;

  const [form, setForm] = useState<LoanFormState>(initialState);
  const [isLoading, setIsLoading] = useState<boolean>(isEdit);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [currencyWalletOpen, setCurrencyWalletOpen] = useState(false);
  const [autoWalletOpen, setAutoWalletOpen] = useState(false);
  const [loanStartDateOpen, setLoanStartDateOpen] = useState(false);
  const [firstDueDateOpen, setFirstDueDateOpen] = useState(false);

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.kind === 'expense'),
    [categories]
  );

  const currencyWallet = wallets.find((wallet) => wallet.id === form.currencyWalletId) ?? null;
  const autoIncomeWallet =
    wallets.find((wallet) => wallet.id === form.autoIncomeWalletId) ?? null;

  useEffect(() => {
    if (!isEdit || !loanId) return;
    let cancelled = false;
    const run = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from('loans')
          .select('*')
          .eq('id', loanId)
          .single();
        if (error) throw error;
        if (cancelled) return;
        const loan = data as Loan;
        setForm({
          title: loan.title,
          type: loan.type,
          categoryId: loan.category_id,
          currencyWalletId: null,
          totalAmount: loan.total_amount != null ? String(loan.total_amount) : '',
          installmentAmount: String(loan.installment_amount),
          loanStartDate: loan.loan_start_date_string,
          firstDueDate: loan.first_due_date_string,
          description: loan.description ?? '',
          repeatCount: String(loan.repeat_count),
          intervalNumber: String(loan.interval_number),
          intervalPeriod: loan.interval_period,
          autoIncomeOnCreate: loan.auto_income_on_create,
          autoIncomeWalletId: loan.auto_income_wallet_id,
        });
      } catch (error) {
        console.error(error);
        toast.error('خطا در دریافت اطلاعات وام.');
        router.back();
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isEdit, loanId, router, toast]);

  const validateCreate = () => {
    if (!form.title.trim()) return 'عنوان الزامی است.';
    if (!parseJalaali(form.loanStartDate)) return 'تاریخ شروع وام نامعتبر است.';
    if (!parseJalaali(form.firstDueDate)) return 'تاریخ اولین قسط نامعتبر است.';
    if (!form.currencyWalletId) return 'کیف پول مبنا برای تعیین ارز وام الزامی است.';
    if (form.type === 'expense' && !form.categoryId) return 'انتخاب دسته هزینه الزامی است.';

    const installmentAmount = Number(form.installmentAmount);
    const repeatCount = Number(form.repeatCount);
    const intervalNumber = Number(form.intervalNumber);
    if (!Number.isFinite(installmentAmount) || installmentAmount <= 0) {
      return 'مبلغ هر قسط نامعتبر است.';
    }
    if (!Number.isFinite(repeatCount) || repeatCount <= 0 || !Number.isInteger(repeatCount)) {
      return 'تعداد اقساط نامعتبر است.';
    }
    if (
      !Number.isFinite(intervalNumber) ||
      intervalNumber <= 0 ||
      !Number.isInteger(intervalNumber)
    ) {
      return 'فاصله تکرار نامعتبر است.';
    }
    if (form.type === 'loan' && form.autoIncomeOnCreate && !form.autoIncomeWalletId) {
      return 'برای تراکنش خودکار، کیف پول دریافت را انتخاب کن.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      toast.error('کاربر معتبر نیست.');
      return;
    }

    if (isEdit) {
      if (!form.title.trim()) {
        toast.error('عنوان الزامی است.');
        return;
      }
      setIsSubmitting(true);
      try {
        const { error } = await supabase
          .from('loans')
          .update({
            title: form.title.trim(),
            description: form.description.trim() || null,
          })
          .eq('id', loanId);
        if (error) throw error;
        toast.success('وام ویرایش شد.');
        router.push('/deadlines/loans');
      } catch (error) {
        console.error(error);
        toast.error('خطا در ویرایش وام.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const err = validateCreate();
    if (err) {
      toast.error(err);
      return;
    }

    const repeatCount = Number(form.repeatCount);
    const intervalNumber = Number(form.intervalNumber);
    const installmentAmount = Number(form.installmentAmount);
    const totalAmount =
      form.type === 'loan' && form.totalAmount.trim()
        ? Number(form.totalAmount)
        : installmentAmount * repeatCount;
    const baseWallet = wallets.find((wallet) => wallet.id === form.currencyWalletId) as Wallet;
    const schedule = buildInstallmentSchedule({
      firstDueDate: form.firstDueDate,
      repeatCount,
      intervalNumber,
      intervalPeriod: form.intervalPeriod,
    });
    if (schedule.length !== repeatCount) {
      toast.error('برنامه اقساط قابل تولید نیست.');
      return;
    }

    setIsSubmitting(true);
    try {
      const loanPayload = {
        user_id: user.id,
        title: form.title.trim(),
        type: form.type,
        category_id: form.type === 'expense' ? form.categoryId : null,
        currency: baseWallet.currency,
        installment_amount: installmentAmount,
        total_amount: Number.isFinite(totalAmount) ? totalAmount : null,
        loan_start_date_string: form.loanStartDate,
        first_due_date_string: form.firstDueDate,
        repeat_count: repeatCount,
        interval_number: intervalNumber,
        interval_period: form.intervalPeriod,
        auto_income_on_create: form.type === 'loan' ? form.autoIncomeOnCreate : false,
        auto_income_wallet_id:
          form.type === 'loan' && form.autoIncomeOnCreate ? form.autoIncomeWalletId : null,
        description: form.description.trim() || null,
        deleted_at: null,
      };
      const { data: loanData, error: loanErr } = await supabase
        .from('loans')
        .insert(loanPayload)
        .select()
        .single();
      if (loanErr) throw loanErr;
      const loan = loanData as Loan;

      const installmentsPayload = schedule.map((dueDate, idx) => ({
        user_id: user.id,
        loan_id: loan.id,
        due_date_string: dueDate,
        amount: installmentAmount,
        sequence_no: idx + 1,
        is_paid: false,
        paid_at: null,
        paid_transaction_id: null,
      }));

      const { error: installmentErr } = await supabase
        .from('loan_installments')
        .insert(installmentsPayload);
      if (installmentErr) throw installmentErr;

      if (form.type === 'loan' && form.autoIncomeOnCreate && form.autoIncomeWalletId) {
        const incomeWallet = wallets.find((wallet) => wallet.id === form.autoIncomeWalletId);
        if (incomeWallet) {
          const rate = tomanPerUnit(incomeWallet.currency, currencyRates);
          const txPayload = {
            user_id: user.id,
            type: 'INCOME',
            date_string: form.loanStartDate,
            note: `وام: ${form.title.trim()}`,
            source_wallet_id: null,
            source_asset_id: null,
            target_wallet_id: incomeWallet.id,
            target_asset_id: null,
            source_amount: null,
            target_amount: Number(totalAmount),
            category_id: null,
            asset_id: null,
            amount: null,
            price_toman: incomeWallet.currency === 'IRT' ? null : rate,
            usd_rate: incomeWallet.currency === 'IRT' ? null : usdRate,
            amount_toman_at_time: Number(totalAmount) * rate,
            amount_usd_at_time: usdRate > 0 ? (Number(totalAmount) * rate) / usdRate : null,
          };
          const { data: txData, error: txErr } = await supabase
            .from('transactions')
            .insert(txPayload)
            .select()
            .single();
          if (txErr) throw txErr;
          setTransactions((prev) => [txData as Transaction, ...prev]);
        }
      }

      toast.success('وام با برنامه اقساط ثبت شد.');
      router.push('/deadlines/loans');
    } catch (error) {
      console.error(error);
      toast.error('خطا در ثبت وام.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 text-center text-slate-500 animate-pulse">
        در حال دریافت...
      </div>
    );
  }

  const repeatPreviewCount = Number(form.repeatCount);
  const repeatPreviewInterval = Number(form.intervalNumber);
  const previewDates =
    repeatPreviewCount > 0 &&
    repeatPreviewCount <= 3 &&
    repeatPreviewInterval > 0 &&
    parseJalaali(form.firstDueDate)
      ? buildInstallmentSchedule({
          firstDueDate: form.firstDueDate,
          repeatCount: repeatPreviewCount,
          intervalNumber: repeatPreviewInterval,
          intervalPeriod: form.intervalPeriod,
        })
      : [];

  return (
    <div className="bg-[#0F1015] min-h-full pb-10 animate-in slide-in-from-bottom-8 duration-300">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-10">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">
          {isEdit ? 'ویرایش وام' : 'ثبت وام جدید'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        <div>
          <label className="block text-xs text-slate-400 mb-1">عنوان</label>
          <input
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white focus:border-purple-500 outline-none"
            placeholder="مثال: خرید لپ‌تاپ"
            required
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">نوع وام</label>
          <div className="grid grid-cols-2 gap-1 bg-[#1A1B26] p-1 rounded-xl">
            <button
              type="button"
              disabled={isEdit}
              onClick={() => setForm((prev) => ({ ...prev, type: 'expense' }))}
              className={`py-2 text-xs font-bold rounded-lg transition ${
                form.type === 'expense'
                  ? 'bg-purple-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              } disabled:opacity-60`}
            >
              خرید اعتباری
            </button>
            <button
              type="button"
              disabled={isEdit}
              onClick={() => setForm((prev) => ({ ...prev, type: 'loan' }))}
              className={`py-2 text-xs font-bold rounded-lg transition ${
                form.type === 'loan'
                  ? 'bg-purple-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              } disabled:opacity-60`}
            >
              وام نقدی
            </button>
          </div>
        </div>

        {!isEdit && (
          <button
            type="button"
            onClick={() => setCurrencyWalletOpen(true)}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 flex items-center justify-between text-right hover:bg-[#222436] transition"
          >
            <div>
              <p className="text-xs text-slate-500">کیف پول مبنا (ارز وام)</p>
              <p className="text-sm text-slate-100 mt-1">
                {currencyWallet
                  ? `${currencyWallet.name} · ${currencyWallet.currency}`
                  : 'انتخاب کنید'}
              </p>
            </div>
            <ChevronLeft size={16} className="text-slate-500" />
          </button>
        )}

        {form.type === 'expense' && (
          <button
            type="button"
            disabled={isEdit}
            onClick={() => setCategoryOpen(true)}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 flex items-center justify-between text-right hover:bg-[#222436] transition disabled:opacity-60"
          >
            <div>
              <p className="text-xs text-slate-500">دسته هزینه</p>
              <p className="text-sm text-slate-100 mt-1">
                {form.categoryId
                  ? expenseCategories.find((category) => category.id === form.categoryId)?.name ??
                    'انتخاب کنید'
                  : 'انتخاب کنید'}
              </p>
            </div>
            <ChevronLeft size={16} className="text-slate-500" />
          </button>
        )}

        {form.type === 'loan' && (
          <>
            <div>
              <label className="block text-xs text-slate-400 mb-1">مبلغ کل وام</label>
              <FormattedNumberInput
                value={form.totalAmount}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, totalAmount: value }))
                }
                className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white focus:border-purple-500 outline-none text-left"
                dir="ltr"
                disabled={isEdit}
              />
            </div>

            {!isEdit && (
              <>
                <label className="flex items-center justify-between bg-[#1A1B26] border border-white/10 rounded-xl p-3 cursor-pointer">
                  <span className="text-sm text-slate-200">ثبت تراکنش درآمد خودکار</span>
                  <input
                    type="checkbox"
                    checked={form.autoIncomeOnCreate}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        autoIncomeOnCreate: e.target.checked,
                        autoIncomeWalletId: e.target.checked ? prev.autoIncomeWalletId : null,
                      }))
                    }
                    className="accent-purple-600 w-4 h-4"
                  />
                </label>

                {form.autoIncomeOnCreate && (
                  <button
                    type="button"
                    onClick={() => setAutoWalletOpen(true)}
                    className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 flex items-center justify-between text-right hover:bg-[#222436] transition"
                  >
                    <div>
                      <p className="text-xs text-slate-500">کیف پول دریافت</p>
                      <p className="text-sm text-slate-100 mt-1">
                        {autoIncomeWallet
                          ? `${autoIncomeWallet.name} · ${autoIncomeWallet.currency}`
                          : 'انتخاب کنید'}
                      </p>
                    </div>
                    <ChevronLeft size={16} className="text-slate-500" />
                  </button>
                )}
              </>
            )}
          </>
        )}

        <div>
          <label className="block text-xs text-slate-400 mb-1">مبلغ هر قسط</label>
          <FormattedNumberInput
            value={form.installmentAmount}
            onValueChange={(value) => setForm((prev) => ({ ...prev, installmentAmount: value }))}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white focus:border-purple-500 outline-none text-left"
            dir="ltr"
            required
            disabled={isEdit}
          />
        </div>

        <button
          type="button"
          disabled={isEdit}
          onClick={() => setLoanStartDateOpen(true)}
          className="w-full flex items-center gap-3 bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-right hover:bg-[#222436] transition disabled:opacity-60"
        >
          <Calendar size={16} className="text-purple-400" />
          <div className="flex-1">
            <p className="text-xs text-slate-500">تاریخ شروع وام</p>
            <p className="text-sm text-slate-100 mt-1">
              {parseJalaali(form.loanStartDate)
                ? formatJalaaliHuman(parseJalaali(form.loanStartDate)!)
                : form.loanStartDate}
            </p>
          </div>
        </button>

        <button
          type="button"
          disabled={isEdit}
          onClick={() => setFirstDueDateOpen(true)}
          className="w-full flex items-center gap-3 bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-right hover:bg-[#222436] transition disabled:opacity-60"
        >
          <Calendar size={16} className="text-purple-400" />
          <div className="flex-1">
            <p className="text-xs text-slate-500">تاریخ اولین قسط</p>
            <p className="text-sm text-slate-100 mt-1">
              {parseJalaali(form.firstDueDate)
                ? formatJalaaliHuman(parseJalaali(form.firstDueDate)!)
                : form.firstDueDate}
            </p>
          </div>
        </button>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">تعداد اقساط</label>
            <FormattedNumberInput
              value={form.repeatCount}
              onValueChange={(value) => setForm((prev) => ({ ...prev, repeatCount: value }))}
              className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white focus:border-purple-500 outline-none text-left"
              dir="ltr"
              required
              disabled={isEdit}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">فاصله تکرار</label>
            <FormattedNumberInput
              value={form.intervalNumber}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, intervalNumber: value }))
              }
              className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white focus:border-purple-500 outline-none text-left"
              dir="ltr"
              required
              disabled={isEdit}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">واحد فاصله</label>
          <div className="grid grid-cols-4 gap-1 bg-[#1A1B26] p-1 rounded-xl">
            {INTERVAL_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                disabled={isEdit}
                onClick={() => setForm((prev) => ({ ...prev, intervalPeriod: option.id }))}
                className={`py-2 text-xs rounded-lg transition ${
                  form.intervalPeriod === option.id
                    ? 'bg-purple-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                } disabled:opacity-60`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {previewDates.length > 0 && (
          <div className="bg-[#1A1B26] border border-white/5 rounded-xl p-3">
            <p className="text-xs text-slate-500 mb-2">پیش‌نمایش سررسیدها</p>
            <div className="space-y-1">
              {previewDates.map((date) => (
                <p key={date} className="text-sm text-slate-200">
                  {parseJalaali(date) ? formatJalaaliHuman(parseJalaali(date)!) : date}
                </p>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs text-slate-400 mb-1">توضیحات</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white focus:border-purple-500 outline-none min-h-[80px]"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-xl font-bold transition-all disabled:opacity-50"
        >
          {isSubmitting ? 'در حال ثبت...' : isEdit ? 'ثبت تغییرات' : 'ایجاد وام'}
        </button>

        {isEdit && (
          <p className="text-[11px] text-slate-500 text-center">
            بعد از ثبت وام فقط عنوان و توضیحات قابل ویرایش است.
          </p>
        )}
      </form>

      <CategorySheetPicker
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        title="انتخاب دسته هزینه"
        kind="expense"
        categories={categories}
        value={form.categoryId}
        onSelect={(id) => setForm((prev) => ({ ...prev, categoryId: id }))}
      />

      <ListSheetPicker
        open={currencyWalletOpen}
        onClose={() => setCurrencyWalletOpen(false)}
        title="انتخاب کیف پول مبنا"
        items={wallets.map((wallet) => ({
          id: wallet.id,
          label: wallet.name,
          sublabel: `${CURRENCY_META[wallet.currency].label} · ${wallet.currency}`,
        }))}
        value={form.currencyWalletId}
        onSelect={(id) => setForm((prev) => ({ ...prev, currencyWalletId: id }))}
      />

      <ListSheetPicker
        open={autoWalletOpen}
        onClose={() => setAutoWalletOpen(false)}
        title="انتخاب کیف پول دریافت"
        items={wallets.map((wallet) => ({
          id: wallet.id,
          label: wallet.name,
          sublabel: `${CURRENCY_META[wallet.currency].label} · ${wallet.currency}`,
        }))}
        value={form.autoIncomeWalletId}
        onSelect={(id) => setForm((prev) => ({ ...prev, autoIncomeWalletId: id }))}
      />

      <IOSDatePicker
        open={loanStartDateOpen}
        onClose={() => setLoanStartDateOpen(false)}
        value={form.loanStartDate}
        onChange={(value) => setForm((prev) => ({ ...prev, loanStartDate: value }))}
      />
      <IOSDatePicker
        open={firstDueDateOpen}
        onClose={() => setFirstDueDateOpen(false)}
        value={form.firstDueDate}
        onChange={(value) => setForm((prev) => ({ ...prev, firstDueDate: value }))}
      />
    </div>
  );
}
