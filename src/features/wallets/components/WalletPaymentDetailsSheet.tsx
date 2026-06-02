'use client';

import { useEffect, useState } from 'react';
import { BottomSheet } from '@/shared/components/BottomSheet';
import { useToast } from '@/shared/components/Toast';
import { supabase } from '@/shared/lib/supabase/client';
import type { Wallet } from '@/shared/types/domain';
import { runOptimisticMutation } from '@/shared/utils/optimistic-mutation';
import {
  formatCardNumber,
  formatIban,
  normalizeWalletPaymentDetails,
  paymentDetailsFormFromWallet,
} from '@/features/wallets/utils/wallet-payment-details';

const inputClassName =
  'w-full bg-[#222436] border border-white/10 rounded-xl p-3 text-white text-sm outline-none focus:border-purple-500 font-mono';

export interface WalletPaymentDetailsSheetProps {
  open: boolean;
  onClose: () => void;
  wallet: Wallet;
  onSaved: (wallet: Wallet) => void;
}

export function WalletPaymentDetailsSheet({
  open,
  onClose,
  wallet,
  onSaved,
}: WalletPaymentDetailsSheetProps) {
  const toast = useToast();
  const [cardNumber, setCardNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [iban, setIban] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const form = paymentDetailsFormFromWallet(wallet);
    setCardNumber(form.card_number);
    setAccountNumber(form.account_number);
    setIban(form.iban);
  }, [open, wallet]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeWalletPaymentDetails({
      card_number: cardNumber,
      account_number: accountNumber,
      iban,
    });

    setIsSubmitting(true);
    try {
      await runOptimisticMutation({
        snapshot: wallet,
        applyOptimistic: () => {
          onSaved({ ...wallet, ...normalized });
        },
        rollback: (prev) => {
          onSaved(prev);
        },
        commit: async () => {
          const { data, error } = await supabase
            .from('wallets')
            .update(normalized)
            .eq('id', wallet.id)
            .select()
            .single();
          if (error) throw error;
          return data as Wallet;
        },
        onSuccess: (saved) => {
          onSaved(saved);
          toast.success('اطلاعات حساب ذخیره شد.');
          onClose();
        },
        onError: () => {
          toast.error('خطا در ذخیره.');
        },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="اطلاعات حساب"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pb-2">
        <p className="text-xs text-slate-500 leading-relaxed">
          همه فیلدها اختیاری‌اند. برای کارت و حساب فقط رقم وارد کنید.
        </p>

        <div>
          <label className="block text-xs text-slate-400 mb-1">شماره کارت</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            placeholder="۶۰۳۷ ۹۹۱۲ ۳۴۵۶ ۷۸۹۰"
            value={cardNumber}
            onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
            maxLength={19}
            className={inputClassName}
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">شماره حساب</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            dir="ltr"
            placeholder="۱۰ رقمی یا بیشتر"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
            className={inputClassName}
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">شبا (IBAN)</label>
          <input
            type="text"
            autoComplete="off"
            dir="ltr"
            placeholder="IR12 3456 7890 1234 5678 9012 34"
            value={iban}
            onChange={(e) => setIban(formatIban(e.target.value))}
            maxLength={32}
            className={inputClassName}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white py-3 rounded-xl font-bold text-sm transition-colors"
        >
          {isSubmitting ? 'در حال ذخیره...' : 'ذخیره'}
        </button>
      </form>
    </BottomSheet>
  );
}
