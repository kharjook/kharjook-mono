'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { useToast } from '@/shared/components/Toast';
import { supabase } from '@/shared/lib/supabase/client';
import type { CurrencyRate, RateCurrency } from '@/shared/types/domain';
import { useAuth, useData } from '@/features/portfolio/PortfolioProvider';
import {
  CURRENCY_META,
  RATE_ORDER,
} from '@/features/wallets/constants/currency-meta';

type LocalRates = Record<RateCurrency, string>;

const buildLocal = (rates: CurrencyRate[]): LocalRates => {
  const out = {} as LocalRates;
  for (const c of RATE_ORDER) {
    const found = rates.find((r) => r.currency === c);
    out[c] = found ? String(found.toman_per_unit) : '';
  }
  return out;
};

export function CurrencyRatesView() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { currencyRates, setCurrencyRates } = useData();

  const initial = useMemo(() => buildLocal(currencyRates), [currencyRates]);
  const [local, setLocal] = useState<LocalRates>(initial);
  const [isSaving, setIsSaving] = useState(false);

  // If the underlying context refreshes (e.g. another tab) reset the form to it.
  useEffect(() => {
    setLocal(buildLocal(currencyRates));
  }, [currencyRates]);

  if (!user) return null;

  const setOne = (c: RateCurrency, canonical: string) =>
    setLocal((prev) => ({ ...prev, [c]: canonical }));

  const handleSave = async () => {
    // Validate: every entered value must be > 0. Empty values are allowed
    // (= "no rate set"); they're upserted only when present.
    const rows: { user_id: string; currency: RateCurrency; toman_per_unit: number; updated_at: string }[] = [];
    const now = new Date().toISOString();
    for (const c of RATE_ORDER) {
      const raw = local[c]?.trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        toast.error(`نرخ نامعتبر برای ${CURRENCY_META[c].label}.`);
        return;
      }
      rows.push({
        user_id: user.id,
        currency: c,
        toman_per_unit: n,
        updated_at: now,
      });
    }

    if (rows.length === 0) {
      router.back();
      return;
    }

    setIsSaving(true);
    try {
      const { data, error } = await supabase
        .from('currency_rates')
        .upsert(rows, { onConflict: 'user_id,currency' })
        .select();
      if (error) throw error;

      const fresh = (data as CurrencyRate[]) || [];
      // Merge: keep any existing rate the user didn't touch, replace the rest.
      setCurrencyRates((prev) => {
        const map = new Map(prev.map((r) => [r.currency, r]));
        fresh.forEach((r) => map.set(r.currency, r));
        return Array.from(map.values());
      });

      router.back();
    } catch (err) {
      console.error(err);
      toast.error('خطا در ذخیره نرخ‌ها.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-[#0F1015] min-h-full pb-24 animate-in slide-in-from-right-8 duration-300 relative">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">نرخ تبدیل ارزها</h2>
      </div>

      <div className="px-6 pt-4">
        <p className="text-xs text-slate-500 leading-5">
          هر مقدار نشان می‌دهد یک واحد از ارز انتخابی چند تومان ارزش دارد. این
          نرخ‌ها به‌صورت خودکار در فرم‌های تراکنش پیش‌نهاد می‌شوند و در صورت نیاز
          می‌توانی آن‌ها را در همان لحظه تغییر دهی.
        </p>
      </div>

      <div className="p-6 space-y-3">
        {RATE_ORDER.map((c) => {
          const meta = CURRENCY_META[c];
          return (
            <div
              key={c}
              className="bg-[#1A1B26] p-4 rounded-2xl border border-white/5 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-300 text-sm font-bold" dir="ltr">
                    {meta.symbol}
                  </div>
                  <div>
                    <p className="text-slate-200 text-sm font-medium">
                      {meta.label}
                    </p>
                    <p className="text-slate-500 text-[11px]" dir="ltr">
                      1 {c} = ? تومان
                    </p>
                  </div>
                </div>
              </div>
              <FormattedNumberInput
                value={local[c]}
                onValueChange={(canonical) => setOne(c, canonical)}
                className="w-full bg-[#222436] border border-white/10 rounded-xl p-3 text-white text-sm font-mono outline-none focus:border-purple-500 text-left"
                dir="ltr"
                placeholder="0"
              />
            </div>
          );
        })}
      </div>

      <button
        onClick={handleSave}
        disabled={isSaving}
        className="fixed bottom-6 right-1/2 translate-x-1/2 w-[calc(100%-3rem)] max-w-100 bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-2xl font-bold shadow-[0_4px_20px_rgba(147,51,234,0.4)] transition-all flex justify-center items-center gap-2 z-30 disabled:opacity-50"
      >
        {isSaving ? (
          <RefreshCw className="animate-spin" size={20} />
        ) : (
          'ذخیره نرخ‌ها'
        )}
      </button>
    </div>
  );
}
