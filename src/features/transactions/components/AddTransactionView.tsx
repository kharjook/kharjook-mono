'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { supabase } from '@/shared/lib/supabase/client';
import { latinizeDigits } from '@/shared/utils/latinize-digits';
import type { Transaction, TransactionType } from '@/shared/types/domain';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';

type TxFormState = {
  type: TransactionType;
  date: string;
  amount: string;
  priceToman: string;
  usdRate: string;
  note: string;
};

export interface AddTransactionViewProps {
  assetId?: string;
  transactionId?: string;
}

export function AddTransactionView({
  assetId,
  transactionId,
}: AddTransactionViewProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { assets, transactions, setTransactions } = useData();
  const { globalUsd } = useUI();

  const transactionToEdit = transactionId
    ? transactions.find((t) => t.id === transactionId)
    : undefined;

  const effectiveAssetId = transactionToEdit?.asset_id ?? assetId;
  const asset = assets.find((a) => a.id === effectiveAssetId);

  const [formData, setFormData] = useState<TxFormState>(() =>
    transactionToEdit
      ? {
          type: transactionToEdit.type,
          date: latinizeDigits(transactionToEdit.date_string),
          amount: transactionToEdit.amount.toString(),
          priceToman: transactionToEdit.price_toman.toString(),
          usdRate: transactionToEdit.usd_rate.toString(),
          note: transactionToEdit.note || '',
        }
      : {
          type: 'BUY',
          date: new Date().toLocaleDateString('fa-IR-u-nu-latn'),
          amount: '',
          priceToman: asset ? asset.price_toman.toString() : '',
          usdRate: globalUsd.toString(),
          note: '',
        }
  );

  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!user || !asset) {
    return (
      <div className="bg-[#0F1015] min-h-full flex items-center justify-center p-6">
        <div className="text-center text-slate-500 text-sm">
          {transactionId && !transactionToEdit
            ? 'تراکنش پیدا نشد.'
            : 'دارایی پیدا نشد.'}
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.amount || !formData.priceToman || !formData.date) return;
    setIsSubmitting(true);

    try {
      const payloadData = {
        user_id: user.id,
        asset_id: asset.id,
        type: formData.type,
        date_string: formData.date,
        amount: Number(formData.amount),
        price_toman: Number(formData.priceToman),
        usd_rate: Number(formData.usdRate),
        note: formData.note,
      };

      if (transactionToEdit) {
        const { data, error } = await supabase
          .from('transactions')
          .update(payloadData)
          .eq('id', transactionToEdit.id)
          .select()
          .single();
        if (error) throw error;
        setTransactions((prev: Transaction[]) =>
          prev.map((tx) => (tx.id === transactionToEdit.id ? data : tx))
        );
      } else {
        const { data, error } = await supabase
          .from('transactions')
          .insert([payloadData])
          .select()
          .single();
        if (error) throw error;
        setTransactions((prev: Transaction[]) => [...prev, data]);
      }
      router.back();
    } catch (err) {
      alert('خطا در ثبت تراکنش');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const types = [
    { id: 'BUY' as const, label: 'خرید' },
    { id: 'SELL' as const, label: 'فروش' },
    { id: 'DEPOSIT' as const, label: 'واریز' },
    { id: 'WITHDRAW' as const, label: 'برداشت' },
  ];

  return (
    <div className="bg-[#0F1015] min-h-full pb-10 animate-in slide-in-from-bottom-8 duration-300 relative z-50">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5">
        <button
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">
          {transactionToEdit ? 'ویرایش عملیات:' : 'ثبت عملیات:'} {asset.name}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        <div className="grid grid-cols-4 gap-2 bg-[#1A1B26] p-1 rounded-xl">
          {types.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFormData({ ...formData, type: t.id })}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${formData.type === t.id ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">تاریخ</label>
              <input
                type="text"
                value={formData.date}
                onChange={(e) =>
                  setFormData({ ...formData, date: e.target.value })
                }
                className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none text-center"
                dir="ltr"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                مقدار ({asset.unit})
              </label>
              <FormattedNumberInput
                value={formData.amount}
                onValueChange={(amount) =>
                  setFormData({ ...formData, amount })
                }
                className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none text-left"
                dir="ltr"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              قیمت واحد (تومان)
            </label>
            <FormattedNumberInput
              value={formData.priceToman}
              onValueChange={(priceToman) =>
                setFormData({ ...formData, priceToman })
              }
              className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none text-left font-mono"
              dir="ltr"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              قیمت دلار در لحظه (تومان)
            </label>
            <FormattedNumberInput
              value={formData.usdRate}
              onValueChange={(usdRate) =>
                setFormData({ ...formData, usdRate })
              }
              className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none text-left font-mono"
              dir="ltr"
              required
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              توضیحات (اختیاری)
            </label>
            <textarea
              value={formData.note}
              onChange={(e) =>
                setFormData({ ...formData, note: e.target.value })
              }
              className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none min-h-[80px]"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-xl font-bold shadow-[0_4px_20px_rgba(147,51,234,0.3)] transition-all mt-4 disabled:opacity-50"
        >
          {isSubmitting
            ? 'در حال ارسال...'
            : transactionToEdit
              ? 'ثبت تغییرات'
              : 'ثبت تراکنش'}
        </button>
      </form>
    </div>
  );
}
