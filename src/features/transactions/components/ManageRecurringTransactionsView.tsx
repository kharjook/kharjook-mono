'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Calendar,
  ChevronLeft,
  Edit3,
  Plus,
  Repeat,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import { useAuth, useData } from '@/features/portfolio/PortfolioProvider';
import { useToast } from '@/shared/components/Toast';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { IOSDatePicker } from '@/shared/components/IOSDatePicker';
import { CategorySheetPicker } from '@/shared/components/CategorySheetPicker';
import { ListSheetPicker } from '@/shared/components/ListSheetPicker';
import type { LoanIntervalPeriod, RecurringTransaction } from '@/shared/types/domain';
import { formatJalaali, formatJalaaliHuman, parseJalaali, todayJalaali } from '@/shared/utils/jalali';
import { formatTelegramMoney } from '@/features/notifications/telegram/utils/format-helpers';
import { intervalLabel } from '@/features/transactions/utils/recurring-transaction-label';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';

const INTERVAL_OPTIONS: { id: LoanIntervalPeriod; label: string }[] = [
  { id: 'day', label: 'روز' },
  { id: 'week', label: 'هفته' },
  { id: 'month', label: 'ماه' },
  { id: 'year', label: 'سال' },
];

type FormState = {
  editingId: string | null;
  title: string;
  type: 'INCOME' | 'EXPENSE';
  amountToman: string;
  walletId: string | null;
  categoryId: string | null;
  intervalNumber: string;
  intervalPeriod: LoanIntervalPeriod;
  nextDueDate: string;
  endDate: string;
  note: string;
  isActive: boolean;
};

function emptyForm(): FormState {
  return {
    editingId: null,
    title: '',
    type: 'EXPENSE',
    amountToman: '',
    walletId: null,
    categoryId: null,
    intervalNumber: '1',
    intervalPeriod: 'month',
    nextDueDate: formatJalaali(todayJalaali()),
    endDate: '',
    note: '',
    isActive: true,
  };
}

export function ManageRecurringTransactionsView() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { wallets, categories } = useData();

  const [rows, setRows] = useState<RecurringTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [nextDueOpen, setNextDueOpen] = useState(false);
  const [endDateOpen, setEndDateOpen] = useState(false);

  const walletItems = useMemo(
    () =>
      wallets.map((wallet) => ({
        id: wallet.id,
        label: wallet.name,
        sublabel: `${CURRENCY_META[wallet.currency].label} · ${wallet.currency}`,
      })),
    [wallets]
  );

  const selectedWallet = wallets.find((wallet) => wallet.id === form.walletId) ?? null;

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('recurring_transactions')
        .select('*')
        .is('deleted_at', null)
        .order('next_due_date_string', { ascending: true });
      if (error) throw error;
      setRows((data ?? []) as RecurringTransaction[]);
    } catch (error) {
      console.error(error);
      toast.error('خطا در دریافت تراکنش‌های دوره‌ای.');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = () => {
    setForm(emptyForm());
    setFormOpen(false);
  };

  const openCreate = () => {
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEdit = (row: RecurringTransaction) => {
    setForm({
      editingId: row.id,
      title: row.title,
      type: row.type,
      amountToman: String(row.amount_toman),
      walletId: row.wallet_id,
      categoryId: row.category_id,
      intervalNumber: String(row.interval_number),
      intervalPeriod: row.interval_period,
      nextDueDate: row.next_due_date_string,
      endDate: row.end_date_string ?? '',
      note: row.note ?? '',
      isActive: row.is_active,
    });
    setFormOpen(true);
  };

  const validate = () => {
    if (!form.title.trim()) return 'عنوان الزامی است.';
    if (!form.walletId) return 'کیف پول الزامی است.';
    if (!form.categoryId) return 'دسته الزامی است.';
    if (!parseJalaali(form.nextDueDate)) return 'تاریخ بعدی نامعتبر است.';
    if (form.endDate.trim() && !parseJalaali(form.endDate)) return 'تاریخ پایان نامعتبر است.';
    const amount = Number(form.amountToman);
    if (!Number.isFinite(amount) || amount <= 0) return 'مبلغ نامعتبر است.';
    const intervalNumber = Number(form.intervalNumber);
    if (!Number.isFinite(intervalNumber) || intervalNumber <= 0 || !Number.isInteger(intervalNumber)) {
      return 'فاصله تکرار نامعتبر است.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }

    const payload = {
      title: form.title.trim(),
      type: form.type,
      amount_toman: Number(form.amountToman),
      wallet_id: form.walletId!,
      category_id: form.categoryId!,
      interval_number: Number(form.intervalNumber),
      interval_period: form.intervalPeriod,
      next_due_date_string: form.nextDueDate,
      end_date_string: form.endDate.trim() || null,
      note: form.note.trim() || null,
      is_active: form.isActive,
      updated_at: new Date().toISOString(),
    };

    setIsSubmitting(true);
    try {
      if (form.editingId) {
        const { error } = await supabase
          .from('recurring_transactions')
          .update(payload)
          .eq('id', form.editingId);
        if (error) throw error;
        toast.success('الگو ویرایش شد.');
      } else {
        const { error } = await supabase.from('recurring_transactions').insert({
          ...payload,
          user_id: user.id,
          deleted_at: null,
        });
        if (error) throw error;
        toast.success('تراکنش دوره‌ای ثبت شد.');
      }
      resetForm();
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error('خطا در ذخیره.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (row: RecurringTransaction) => {
    if (!window.confirm(`«${row.title}» حذف شود؟`)) return;
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('recurring_transactions')
        .update({ deleted_at: new Date().toISOString(), is_active: false })
        .eq('id', row.id);
      if (error) throw error;
      toast.success('حذف شد.');
      if (form.editingId === row.id) resetForm();
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error('خطا در حذف.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleActive = async (row: RecurringTransaction) => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('recurring_transactions')
        .update({ is_active: !row.is_active, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (error) throw error;
      await refresh();
    } catch (error) {
      console.error(error);
      toast.error('خطا در تغییر وضعیت.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!user) return null;

  return (
    <div className="bg-[#0F1015] min-h-full pb-10 animate-in slide-in-from-right-8 duration-300">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">تراکنش‌های دوره‌ای</h2>
        {!formOpen && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300"
          >
            <Plus size={16} />
            جدید
          </button>
        )}
      </div>

      <div className="px-6 pt-4">
        <p className="text-xs text-slate-500 leading-relaxed">
          حقوق، اجاره و … — هر روز ساعت ۹ صبح (تهران) اگر سررسید رسیده باشد، تراکنش خودکار ثبت
          می‌شود.
        </p>
      </div>

      {formOpen && (
        <form onSubmit={handleSubmit} className="p-6 space-y-4 border-b border-white/5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm text-slate-400">{form.editingId ? 'ویرایش' : 'الگوی جدید'}</h3>
            <button type="button" onClick={resetForm} className="text-slate-500 hover:text-white">
              <X size={16} />
            </button>
          </div>

          <input
            value={form.title}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="عنوان (مثلا: اجاره)"
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white outline-none focus:border-purple-500"
            required
          />

          <div className="grid grid-cols-2 gap-1 bg-[#1A1B26] p-1 rounded-xl">
            {(['EXPENSE', 'INCOME'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    type,
                    categoryId: null,
                  }))
                }
                className={`py-2 text-xs font-bold rounded-lg ${
                  form.type === type ? 'bg-purple-600 text-white' : 'text-slate-400'
                }`}
              >
                {type === 'EXPENSE' ? 'هزینه' : 'درآمد'}
              </button>
            ))}
          </div>

          <FormattedNumberInput
            value={form.amountToman}
            onValueChange={(value) => setForm((prev) => ({ ...prev, amountToman: value }))}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white outline-none text-left"
            dir="ltr"
            placeholder="مبلغ (تومان)"
            required
          />

          <button
            type="button"
            onClick={() => setWalletOpen(true)}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 flex items-center justify-between text-right"
          >
            <div>
              <p className="text-xs text-slate-500">کیف پول</p>
              <p className="text-sm text-white mt-1">{selectedWallet?.name ?? 'انتخاب کنید'}</p>
            </div>
            <ChevronLeft size={16} className="text-slate-500" />
          </button>

          <button
            type="button"
            onClick={() => setCategoryOpen(true)}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 flex items-center justify-between text-right"
          >
            <div>
              <p className="text-xs text-slate-500">دسته</p>
              <p className="text-sm text-white mt-1">
                {form.categoryId
                  ? categories.find((c) => c.id === form.categoryId)?.name ?? 'انتخاب'
                  : 'انتخاب کنید'}
              </p>
            </div>
            <ChevronLeft size={16} className="text-slate-500" />
          </button>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">هر</label>
              <FormattedNumberInput
                value={form.intervalNumber}
                onValueChange={(value) => setForm((prev) => ({ ...prev, intervalNumber: value }))}
                className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white outline-none text-left"
                dir="ltr"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">واحد</label>
              <select
                value={form.intervalPeriod}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    intervalPeriod: e.target.value as LoanIntervalPeriod,
                  }))
                }
                className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white outline-none"
              >
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setNextDueOpen(true)}
            className="w-full flex items-center gap-3 bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-right"
          >
            <Calendar size={16} className="text-purple-400" />
            <div className="flex-1">
              <p className="text-xs text-slate-500">سررسید بعدی</p>
              <p className="text-sm text-white mt-1">
                {parseJalaali(form.nextDueDate)
                  ? formatJalaaliHuman(parseJalaali(form.nextDueDate)!)
                  : form.nextDueDate}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setEndDateOpen(true)}
            className="w-full flex items-center gap-3 bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-right"
          >
            <Calendar size={16} className="text-slate-500" />
            <div className="flex-1">
              <p className="text-xs text-slate-500">پایان (اختیاری)</p>
              <p className="text-sm text-white mt-1">
                {form.endDate.trim()
                  ? parseJalaali(form.endDate)
                    ? formatJalaaliHuman(parseJalaali(form.endDate)!)
                    : form.endDate
                  : 'بدون پایان'}
              </p>
            </div>
          </button>

          <textarea
            value={form.note}
            onChange={(e) => setForm((prev) => ({ ...prev, note: e.target.value }))}
            rows={2}
            placeholder="یادداشت (اختیاری)"
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-sm text-white outline-none resize-none"
          />

          <label className="flex items-center justify-between bg-[#1A1B26] border border-white/10 rounded-xl p-3">
            <span className="text-sm text-slate-200">فعال</span>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((prev) => ({ ...prev, isActive: e.target.checked }))}
              className="accent-purple-600 w-4 h-4"
            />
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium disabled:opacity-50"
          >
            {isSubmitting ? 'در حال ذخیره...' : form.editingId ? 'ذخیره' : 'ثبت الگو'}
          </button>
        </form>
      )}

      <div className="p-6 space-y-3">
        {isLoading ? (
          <p className="text-center text-slate-500 text-sm py-8 animate-pulse">در حال دریافت...</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-slate-500 text-sm py-8">تراکنش دوره‌ای ثبت نشده.</p>
        ) : (
          rows.map((row) => {
            const wallet = wallets.find((w) => w.id === row.wallet_id);
            const category = categories.find((c) => c.id === row.category_id);
            const due = parseJalaali(row.next_due_date_string);
            return (
              <div
                key={row.id}
                className="bg-[#1A1B26] border border-white/5 rounded-2xl p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Repeat size={14} className="text-purple-400 shrink-0" />
                      <h3 className="font-semibold text-slate-100 truncate">{row.title}</h3>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {row.type === 'EXPENSE' ? 'هزینه' : 'درآمد'} · {intervalLabel(row)}
                      {category ? ` · ${category.name}` : ''}
                      {wallet ? ` · ${wallet.name}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void toggleActive(row)}
                    className={`text-[10px] px-2 py-1 rounded-lg shrink-0 ${
                      row.is_active
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-500/15 text-slate-400'
                    }`}
                  >
                    {row.is_active ? 'فعال' : 'متوقف'}
                  </button>
                </div>
                <p className="text-sm text-slate-200" dir="ltr">
                  {formatTelegramMoney(Number(row.amount_toman), 'TOMAN')}
                </p>
                <p className="text-xs text-slate-400">
                  سررسید بعدی:{' '}
                  {due ? formatJalaaliHuman(due) : row.next_due_date_string}
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => openEdit(row)}
                    className="text-[12px] px-2.5 py-1.5 rounded-lg bg-white/5 text-slate-300"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Edit3 size={13} />
                      ویرایش
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleDelete(row)}
                    className="text-[12px] px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-300"
                  >
                    <span className="inline-flex items-center gap-1">
                      <Trash2 size={13} />
                      حذف
                    </span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <ListSheetPicker
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
        title="انتخاب کیف پول"
        items={walletItems}
        value={form.walletId}
        onSelect={(id) => {
          setForm((prev) => ({ ...prev, walletId: id }));
          setWalletOpen(false);
        }}
      />

      <CategorySheetPicker
        open={categoryOpen}
        onClose={() => setCategoryOpen(false)}
        title="انتخاب دسته"
        kind={form.type === 'INCOME' ? 'income' : 'expense'}
        categories={categories}
        value={form.categoryId}
        onSelect={(id) => {
          setForm((prev) => ({ ...prev, categoryId: id }));
          setCategoryOpen(false);
        }}
      />

      <IOSDatePicker
        open={nextDueOpen}
        onClose={() => setNextDueOpen(false)}
        value={form.nextDueDate}
        onChange={(value) => setForm((prev) => ({ ...prev, nextDueDate: value }))}
      />
      <IOSDatePicker
        open={endDateOpen}
        onClose={() => setEndDateOpen(false)}
        value={form.endDate || form.nextDueDate}
        onChange={(value) => setForm((prev) => ({ ...prev, endDate: value }))}
      />
    </div>
  );
}
