'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight, Edit3, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { formatCurrency } from '@/shared/utils/format-currency';
import { latinizeDigits } from '@/shared/utils/latinize-digits';
import { DetailCard } from '@/features/assets/components/DetailCard';

export interface AssetDetailsViewProps {
  assetId: string;
}

export function AssetDetailsView({ assetId }: AssetDetailsViewProps) {
  const router = useRouter();
  const { assets, transactions, setTransactions } = useData();
  const { currencyMode, globalUsd } = useUI();

  const asset = assets.find((a) => a.id === assetId);

  if (!asset) {
    return (
      <div className="bg-[#0F1015] min-h-full flex items-center justify-center p-6">
        <div className="text-center text-slate-500 text-sm">
          دارایی پیدا نشد.
        </div>
      </div>
    );
  }

  const assetTxs = transactions
    .filter((tx) => tx.asset_id === assetId)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

  const stats = calculateAssetStats(asset, transactions, currencyMode, globalUsd);

  const displayValue =
    currencyMode === 'USD' ? stats.currentValueUsd : stats.currentValueToman;
  const displayProfit =
    currencyMode === 'USD' ? stats.profitLossUsd : stats.profitLossToman;
  const isProfit = displayProfit >= 0;

  const displayRealized =
    currencyMode === 'USD'
      ? stats.realizedProfitUsd
      : stats.realizedProfitToman;
  const isRealizedProfit = displayRealized >= 0;

  const displayUnrealized =
    currencyMode === 'USD'
      ? stats.unrealizedProfitUsd
      : stats.unrealizedProfitToman;
  const isUnrealizedProfit = displayUnrealized >= 0;

  const deleteTx = async (id: string) => {
    if (!window.confirm('آیا از حذف این تراکنش مطمئن هستید؟')) return;
    try {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) throw error;
      setTransactions((prev) => prev.filter((tx) => tx.id !== id));
    } catch {
      alert('خطا در حذف رکورد');
    }
  };

  return (
    <div className="bg-[#0F1015] min-h-full pb-24 animate-in slide-in-from-right-8 duration-300">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">{asset.name}</h2>
      </div>

      <div className="p-6 space-y-6">
        <div className="text-center py-6 bg-gradient-to-b from-purple-500/10 to-transparent rounded-3xl border border-purple-500/20">
          <p className="text-slate-400 text-sm mb-2">ارزش فعلی کل</p>
          <h2 className="text-3xl font-bold text-white mb-2" dir="ltr">
            {formatCurrency(displayValue, currencyMode)}
          </h2>
          <div
            className={`inline-flex items-center gap-1 text-sm font-medium ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}
            dir="ltr"
          >
            {isProfit ? '+' : ''}
            {formatCurrency(displayProfit, currencyMode)} (
            {stats.profitLossPercent.toFixed(2)}%)
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-[#1A1B26] p-4 rounded-2xl border border-white/5">
            <p className="text-slate-500 text-xs mb-1">
              سود/زیان محقق شده (فروش)
            </p>
            <p
              className={`font-bold text-sm ${isRealizedProfit ? 'text-emerald-400' : 'text-rose-400'}`}
              dir="ltr"
            >
              {isRealizedProfit ? '+' : ''}
              {formatCurrency(displayRealized, currencyMode)}
            </p>
          </div>
          <div className="bg-[#1A1B26] p-4 rounded-2xl border border-white/5">
            <p className="text-slate-500 text-xs mb-1">
              سود/زیان مانده (ارزش روز)
            </p>
            <p
              className={`font-bold text-sm ${isUnrealizedProfit ? 'text-emerald-400' : 'text-rose-400'}`}
              dir="ltr"
            >
              {isUnrealizedProfit ? '+' : ''}
              {formatCurrency(displayUnrealized, currencyMode)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DetailCard
            label="موجودی"
            value={`${stats.totalAmount} ${asset.unit}`}
          />
          <DetailCard
            label="میانگین خرید"
            value={formatCurrency(
              currencyMode === 'USD'
                ? stats.avgBuyPriceToman / globalUsd
                : stats.avgBuyPriceToman,
              currencyMode
            )}
          />
          <DetailCard
            label="ارزش خرید کل"
            value={formatCurrency(
              currencyMode === 'USD'
                ? stats.totalCostToman / globalUsd
                : stats.totalCostToman,
              currencyMode
            )}
          />
          <DetailCard
            label="قیمت روز"
            value={formatCurrency(
              currencyMode === 'USD' ? asset.price_usd : asset.price_toman,
              currencyMode
            )}
          />
        </div>

        <div className="pt-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-white">تاریخچه عملیات</h3>
          </div>
          <div className="space-y-3">
            {assetTxs.map((tx) => (
              <div
                key={tx.id}
                className="bg-[#1A1B26] p-4 rounded-2xl border border-white/5 flex flex-col gap-3 relative overflow-hidden group"
              >
                <div
                  className={`absolute left-0 top-0 bottom-0 w-1 ${tx.type === 'BUY' || tx.type === 'DEPOSIT' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                ></div>
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-slate-200 font-medium text-sm">
                      {tx.type === 'BUY'
                        ? 'خرید'
                        : tx.type === 'SELL'
                          ? 'فروش'
                          : tx.type === 'DEPOSIT'
                            ? 'واریز'
                            : 'برداشت'}
                    </span>
                    <p className="text-slate-500 text-xs mt-1">
                      {latinizeDigits(tx.date_string)}
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="text-slate-200 font-bold text-sm" dir="ltr">
                      {tx.amount} {asset.unit}
                    </p>
                    <p className="text-slate-500 text-xs mt-1" dir="ltr">
                      {formatCurrency(tx.price_toman, 'TOMAN')}
                    </p>
                  </div>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-white/5">
                  <span className="text-[10px] text-slate-600" dir="ltr">
                    دلار: {formatCurrency(tx.usd_rate, 'TOMAN')}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() =>
                        router.push(`/transactions/${tx.id}/edit`)
                      }
                      className="text-blue-400/50 hover:text-blue-400 transition-colors p-1.5"
                    >
                      <Edit3 size={16} />
                    </button>
                    <button
                      onClick={() => deleteTx(tx.id)}
                      className="text-rose-400/50 hover:text-rose-400 transition-colors p-1.5"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {assetTxs.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-4">
                تراکنشی ثبت نشده است.
              </div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={() => router.push(`/transactions/new?assetId=${asset.id}`)}
        className="fixed bottom-6 right-1/2 translate-x-1/2 w-[calc(100%-3rem)] max-w-[calc(28rem-3rem)] bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-2xl font-bold shadow-[0_4px_20px_rgba(147,51,234,0.4)] transition-all flex justify-center items-center gap-2 z-30"
      >
        <Plus size={20} />
        ثبت عملیات جدید
      </button>
    </div>
  );
}
