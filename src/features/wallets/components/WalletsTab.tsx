'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Plus, Wallet as WalletIcon } from 'lucide-react';
import { EntityIcon } from '@/shared/components/EntityIcon';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { formatCurrency } from '@/shared/utils/format-currency';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';

export function WalletsTab() {
  const router = useRouter();
  const { wallets, transactions, currencyRates, isLoadingData } = useData();
  const { currencyMode, usdRate } = useUI();

  const rows = useMemo(() => {
    return wallets.map((w) => {
      const stats = calculateWalletStats(w, transactions);
      const meta = CURRENCY_META[w.currency];
      const rate = tomanPerUnit(w.currency, currencyRates);
      const balanceToman = stats.balance * rate;
      return { wallet: w, meta, stats, balanceToman, rate };
    });
  }, [wallets, transactions, currencyRates]);

  const totalToman = rows.reduce((acc, r) => acc + r.balanceToman, 0);
  const totalUsd = usdRate > 0 ? totalToman / usdRate : 0;
  const displayTotal = currencyMode === 'USD' ? totalUsd : totalToman;

  const hasMissingRate = rows.some((r) => r.wallet.currency !== 'IRT' && r.rate === 0);

  return (
    <div className="p-6 animate-in fade-in duration-300 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-white">کیف پول‌ها</h2>
      </div>

      <div className="bg-linear-to-br from-purple-500/15 to-transparent border border-purple-500/20 p-5 rounded-3xl">
        <p className="text-slate-400 text-sm mb-2">جمع کل نقد (تبدیل به {currencyMode === 'USD' ? 'دلار' : 'تومان'})</p>
        <p className="text-3xl font-bold text-white tracking-tight" dir="ltr">
          {formatCurrency(displayTotal, currencyMode)}
        </p>
        {hasMissingRate && (
          <p className="text-[11px] text-amber-400/80 mt-3">
            برای برخی ارزها نرخ تبدیل تعریف نشده. از{' '}
            <button
              type="button"
              onClick={() => router.push('/manage/rates')}
              className="underline hover:text-amber-300"
            >
              تنظیمات نرخ‌ها
            </button>{' '}
            مقدار را اضافه کن.
          </p>
        )}
      </div>

      {isLoadingData && wallets.length === 0 && (
        <div className="text-center text-slate-500 py-10 animate-pulse">
          در حال دریافت...
        </div>
      )}

      {!isLoadingData && wallets.length === 0 && (
        <div className="text-center py-10 space-y-3">
          <p className="text-slate-500 text-sm">هنوز کیف پولی نساخته‌ای.</p>
          <button
            type="button"
            onClick={() => router.push('/manage/wallets')}
            className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 text-sm font-medium"
          >
            <Plus size={16} />
            افزودن کیف پول
          </button>
        </div>
      )}

      {wallets.length > 0 && (
        <div className="space-y-3">
          {rows.map(({ wallet, meta, stats, balanceToman }) => {
            const balanceDisplay = currencyMode === 'USD' && usdRate > 0
              ? balanceToman / usdRate
              : balanceToman;
            return (
              <button
                key={wallet.id}
                type="button"
                onClick={() => router.push(`/wallets/${wallet.id}`)}
                className="w-full bg-[#1A1B26] border border-white/5 p-4 rounded-2xl flex items-center justify-between hover:bg-[#222436] active:scale-[0.99] transition-all text-right"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <EntityIcon
                    iconUrl={wallet.icon_url}
                    fallback={<WalletIcon size={22} />}
                    bgColor="rgba(168, 85, 247, 0.10)"
                    color="#c084fc"
                    className="w-12 h-12 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-200 truncate">
                      {wallet.name}
                    </p>
                    <p className="text-xs text-slate-500 mt-1 font-mono" dir="ltr">
                      {meta.symbol}{' '}
                      {stats.balance.toLocaleString('en-US', {
                        maximumFractionDigits: meta.decimals,
                      })}{' '}
                      {wallet.currency}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-left">
                    <p className="text-slate-200 font-bold text-sm" dir="ltr">
                      {formatCurrency(balanceDisplay, currencyMode)}
                    </p>
                    {(stats.incomeTotal > 0 || stats.expenseTotal > 0) && (
                      <p className="text-[10px] text-slate-500 mt-0.5" dir="ltr">
                        +{stats.incomeTotal.toLocaleString('en-US', { maximumFractionDigits: meta.decimals })} / -{stats.expenseTotal.toLocaleString('en-US', { maximumFractionDigits: meta.decimals })}
                      </p>
                    )}
                  </div>
                  <ChevronLeft size={18} className="text-slate-600" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
