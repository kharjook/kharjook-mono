'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  Edit3,
  Plus,
  Trash2,
  Wallet as WalletIcon,
} from 'lucide-react';
import { EntityIcon } from '@/shared/components/EntityIcon';
import { useToast } from '@/shared/components/Toast';
import { supabase } from '@/shared/lib/supabase/client';
import type { Asset, Transaction, TransactionType, Wallet } from '@/shared/types/domain';
import { useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import { formatCurrency, formatCurrencyAmount } from '@/shared/utils/format-currency';
import { latinizeDigits } from '@/shared/utils/latinize-digits';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';
import { DetailCard } from '@/features/assets/components/DetailCard';
import {
  ConvertTransactionCard,
  convertGroupsForWallet,
} from '@/features/transactions/components/ConvertTransactionCard';
import {
  groupConvertTransactions,
  transactionIdsInConvertGroups,
  type ConvertTransactionGroup,
} from '@/features/transactions/utils/convert-transaction';
import { CopyableDetailRow } from '@/features/wallets/components/CopyableDetailRow';
import { WalletPaymentDetailsSheet } from '@/features/wallets/components/WalletPaymentDetailsSheet';
import { WalletSavingsPotsSection } from '@/features/wallets/components/WalletSavingsPotsSection';
import {
  formatCardNumber,
  formatIban,
  walletHasPaymentDetails,
} from '@/features/wallets/utils/wallet-payment-details';
import {
  TransactionHistoryTypeFilter,
  type TxHistoryTypeFilter,
} from '@/features/transactions/components/TransactionHistoryTypeFilter';
import { TransactionHistorySearchBar } from '@/features/transactions/components/TransactionHistorySearchBar';
import {
  convertGroupMatchesSearch,
  transactionMatchesSearch,
} from '@/features/transactions/utils/transaction-history-search';

const TYPE_LABELS: Record<TransactionType, string> = {
  BUY: 'خرید',
  SELL: 'فروش',
  TRANSFER: 'انتقال',
  INCOME: 'درآمد',
  EXPENSE: 'هزینه',
};

export interface WalletDetailsViewProps {
  walletId: string;
}

export function WalletDetailsView({ walletId }: WalletDetailsViewProps) {
  const router = useRouter();
  const toast = useToast();
  const {
    wallets,
    assets,
    categories,
    transactions,
    setTransactions,
    setWallets,
    currencyRates,
  } = useData();
  const { currencyMode, usdRate } = useUI();
  const [txTypeFilter, setTxTypeFilter] = useState<TxHistoryTypeFilter>('ALL');
  const [txSearchQuery, setTxSearchQuery] = useState('');
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);

  const wallet = wallets.find((w) => w.id === walletId);

  const stats = useMemo(
    () => (wallet ? calculateWalletStats(wallet, transactions) : null),
    [wallet, transactions]
  );

  const visibleWalletTxs = useMemo(() => {
    if (!stats) return [];
    const txs = stats.transactions;
    if (txTypeFilter === 'ALL') return txs;
    return txs.filter((tx) => tx.type === txTypeFilter);
  }, [stats, txTypeFilter]);

  const convertGroups = useMemo(
    () =>
      stats
        ? convertGroupsForWallet(walletId, groupConvertTransactions(transactions))
        : [],
    [stats, walletId, transactions]
  );
  const convertTxIds = useMemo(
    () => transactionIdsInConvertGroups(transactions),
    [transactions]
  );
  const historyLookup = useMemo(
    () => ({ wallets, assets, categories }),
    [wallets, assets, categories]
  );

  const walletHistoryItems = useMemo(() => {
    if (!stats) return [];
    type HistoryItem =
      | { kind: 'convert'; date: string; group: ConvertTransactionGroup }
      | { kind: 'tx'; date: string; tx: Transaction };
    const items: HistoryItem[] = [];
    for (const group of convertGroups) {
      if (txTypeFilter !== 'ALL') {
        const matches =
          (txTypeFilter === 'SELL' && group.sell.target_wallet_id === walletId) ||
          (txTypeFilter === 'BUY' && group.buy.source_wallet_id === walletId);
        if (!matches) continue;
      }
      if (!convertGroupMatchesSearch(group, txSearchQuery, historyLookup)) continue;
      items.push({ kind: 'convert', date: group.sell.date_string, group });
    }
    for (const tx of visibleWalletTxs) {
      if (convertTxIds.has(tx.id)) continue;
      if (!transactionMatchesSearch(tx, txSearchQuery, historyLookup)) continue;
      items.push({ kind: 'tx', date: tx.date_string, tx });
    }
    items.sort((a, b) => b.date.localeCompare(a.date));
    return items;
  }, [
    stats,
    convertGroups,
    visibleWalletTxs,
    convertTxIds,
    txTypeFilter,
    txSearchQuery,
    historyLookup,
    walletId,
  ]);

  if (!wallet || !stats) {
    return (
      <div className="bg-[#0F1015] min-h-full flex items-center justify-center p-6">
        <div className="text-center text-slate-500 text-sm">
          کیف پول پیدا نشد.
        </div>
      </div>
    );
  }

  const meta = CURRENCY_META[wallet.currency];
  const rate = tomanPerUnit(wallet.currency, currencyRates);
  const balanceToman = stats.balance * rate;
  const balanceDisplay =
    currencyMode === 'USD' && usdRate > 0
      ? balanceToman / usdRate
      : balanceToman;

  const hasPaymentDetails = walletHasPaymentDetails(wallet);

  const updateWallet = (next: Wallet) => {
    setWallets((prev) => prev.map((w) => (w.id === next.id ? next : w)));
  };

  const deleteTx = async (id: string) => {
    if (!window.confirm('آیا از حذف این تراکنش مطمئن هستید؟')) return;
    try {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) throw error;
      setTransactions((prev) => prev.filter((tx) => tx.id !== id));
    } catch (err) {
      console.error(err);
      toast.error('خطا در حذف رکورد.');
    }
  };

  const deleteConvert = async (group: ConvertTransactionGroup) => {
    if (!window.confirm('آیا از حذف این تبدیل (فروش + خرید) مطمئن هستید؟')) return;
    try {
      const { error } = await supabase
        .from('transactions')
        .delete()
        .in('id', [group.sell.id, group.buy.id]);
      if (error) throw error;
      setTransactions((prev) =>
        prev.filter((tx) => tx.id !== group.sell.id && tx.id !== group.buy.id)
      );
    } catch (err) {
      console.error(err);
      toast.error('خطا در حذف تبدیل.');
    }
  };

  return (
    <div className="bg-[#0F1015] min-h-full pb-24 animate-in slide-in-from-right-8 duration-300">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">{wallet.name}</h2>
      </div>

      <div className="p-6 space-y-6">
        <div className="text-center py-6 bg-linear-to-b from-purple-500/10 to-transparent rounded-3xl border border-purple-500/20 relative overflow-hidden">
          <div className="absolute top-3 left-3 right-3 flex justify-between items-center text-[11px] text-slate-500" dir="ltr">
            <span>{meta.symbol} {wallet.currency}</span>
            <WalletIcon size={14} />
          </div>
          <div className="flex justify-center mt-2 mb-3">
            <EntityIcon
              iconUrl={wallet.icon_url}
              fallback={<WalletIcon size={22} />}
              bgColor="rgba(168, 85, 247, 0.12)"
              color="#c084fc"
              className="w-14 h-14"
            />
          </div>
          <p className="text-slate-400 text-sm mb-2">موجودی فعلی</p>
          <p className="text-3xl font-bold text-white" dir="ltr">
            {meta.symbol}{' '}
            {formatCurrencyAmount(stats.balance, wallet.currency)}
          </p>
          <p className="text-xs text-slate-500 mt-2" dir="ltr">
            ≈ {formatCurrency(balanceDisplay, currencyMode)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <DetailCard
            label="موجودی اولیه"
            value={`${meta.symbol} ${formatCurrencyAmount(wallet.initial_balance, wallet.currency)}`}
          />
          <DetailCard
            label="جریان خالص"
            value={`${stats.netFlow >= 0 ? '+' : ''}${meta.symbol} ${formatCurrencyAmount(stats.netFlow, wallet.currency)}`}
          />
          <DetailCard
            label="جمع درآمد"
            value={`${meta.symbol} ${formatCurrencyAmount(stats.incomeTotal, wallet.currency)}`}
          />
          <DetailCard
            label="جمع هزینه"
            value={`${meta.symbol} ${formatCurrencyAmount(stats.expenseTotal, wallet.currency)}`}
          />
        </div>

        <WalletSavingsPotsSection wallet={wallet} walletBalance={stats.balance} />

        <div className="bg-[#1A1B26] rounded-2xl border border-white/5 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <CreditCard size={16} className="text-purple-300 shrink-0" />
              <h3 className="text-sm font-semibold text-white">اطلاعات حساب</h3>
            </div>
            <button
              type="button"
              onClick={() => setPaymentSheetOpen(true)}
              className="shrink-0 text-xs font-medium text-purple-300 hover:text-purple-200 transition-colors"
            >
              {hasPaymentDetails ? 'ویرایش' : 'افزودن'}
            </button>
          </div>

          {hasPaymentDetails ? (
            <div className="space-y-2">
              {wallet.account_owner_name && (
                <CopyableDetailRow
                  label="نام صاحب حساب"
                  value={wallet.account_owner_name}
                  valueDir="auto"
                />
              )}
              {wallet.card_number && (
                <CopyableDetailRow
                  label="شماره کارت"
                  value={formatCardNumber(wallet.card_number)}
                  copyValue={wallet.card_number}
                />
              )}
              {wallet.account_number && (
                <CopyableDetailRow
                  label="شماره حساب"
                  value={wallet.account_number}
                  copyValue={wallet.account_number}
                />
              )}
              {wallet.iban && (
                <CopyableDetailRow
                  label="شبا"
                  value={formatIban(wallet.iban)}
                  copyValue={wallet.iban}
                />
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500 leading-relaxed">
              نام صاحب حساب، شماره کارت، حساب یا شبا را اضافه کنید تا با یک لمس کپی شود.
            </p>
          )}
        </div>

        <div className="pt-2">
          <h3 className="text-lg font-semibold text-white mb-3">تاریخچه تراکنش‌ها</h3>
          {stats.transactions.length > 0 && (
            <div className="mb-4 space-y-3">
              <TransactionHistorySearchBar
                value={txSearchQuery}
                onChange={setTxSearchQuery}
              />
              <TransactionHistoryTypeFilter
                value={txTypeFilter}
                onChange={setTxTypeFilter}
              />
            </div>
          )}
          <div className="space-y-3">
            {stats.transactions.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-6">
                هنوز تراکنشی برای این کیف پول ثبت نشده.
              </div>
            )}
            {stats.transactions.length > 0 && visibleWalletTxs.length === 0 && walletHistoryItems.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-6">
                {txSearchQuery.trim()
                  ? 'تراکنشی با این جستجو پیدا نشد.'
                  : 'تراکنشی با این نوع وجود ندارد.'}
              </div>
            )}
            {walletHistoryItems.map((item) => {
              if (item.kind === 'convert') {
                return (
                  <ConvertTransactionCard
                    key={item.group.operationId}
                    group={item.group}
                    assets={assets}
                    onEdit={() =>
                      router.push(`/transactions/${item.group.sell.id}/edit`)
                    }
                    onDelete={() => void deleteConvert(item.group)}
                  />
                );
              }
              const tx = item.tx;
              return (
              <TxRow
                key={tx.id}
                tx={tx}
                wallet={wallet}
                wallets={wallets}
                assets={assets}
                categories={categories}
                onEdit={() => router.push(`/transactions/${tx.id}/edit`)}
                onDelete={() => deleteTx(tx.id)}
              />
            );
            })}
          </div>
        </div>
      </div>

      <WalletPaymentDetailsSheet
        open={paymentSheetOpen}
        onClose={() => setPaymentSheetOpen(false)}
        wallet={wallet}
        onSaved={updateWallet}
      />

      <button
        type="button"
        onClick={() => router.push(`/transactions/new?walletId=${wallet.id}`)}
        className="fixed bottom-6 right-1/2 translate-x-1/2 w-[calc(100%-3rem)] max-w-100 bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-2xl font-bold shadow-[0_4px_20px_rgba(147,51,234,0.4)] transition-all flex justify-center items-center gap-2 z-30"
      >
        <Plus size={20} />
        ثبت تراکنش جدید
      </button>
    </div>
  );
}

function TxRow({
  tx,
  wallet,
  wallets,
  assets,
  categories,
  onEdit,
  onDelete,
}: {
  tx: Transaction;
  wallet: Wallet;
  wallets: Wallet[];
  assets: Asset[];
  categories: { id: string; name: string }[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isSource = tx.source_wallet_id === wallet.id;
  const meta = CURRENCY_META[wallet.currency];
  const amount = isSource ? Number(tx.source_amount) : Number(tx.target_amount);
  const sign = isSource ? -1 : 1;
  const displayAmount = sign * amount;
  const isIn = sign > 0;

  // Counterparty resolution: show the "other side" of the transaction.
  const counterparty = describeCounterparty(tx, wallet, wallets, assets, categories);

  const accent = isIn ? 'bg-emerald-500' : 'bg-rose-500';
  const tone = isIn ? 'text-emerald-400' : 'text-rose-400';
  const Icon = tx.type === 'TRANSFER' ? ArrowLeftRight : isIn ? ArrowDownRight : ArrowUpRight;

  return (
    <div className="bg-[#1A1B26] p-4 rounded-2xl border border-white/5 flex flex-col gap-3 relative overflow-hidden">
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${accent}`} />
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center ${tone} shrink-0`}>
            <Icon size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-slate-200 text-sm font-medium">
              {TYPE_LABELS[tx.type]}
            </p>
            <p className="text-slate-500 text-xs mt-0.5 truncate">
              {counterparty}
            </p>
          </div>
        </div>
        <div className="text-left shrink-0">
          <p className={`text-sm font-bold  ${tone}`} dir="ltr">
            {isIn ? '+' : '-'}
            {meta.symbol} {formatCurrencyAmount(Math.abs(displayAmount), wallet.currency)}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {latinizeDigits(tx.date_string)}
          </p>
        </div>
      </div>
      <div className="flex justify-between items-center pt-2 border-t border-white/5">
        <span className="text-[10px] text-slate-600 truncate" dir="ltr">
          {tx.note || ''}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="text-blue-400/50 hover:text-blue-400 transition-colors p-1.5"
            aria-label="ویرایش"
          >
            <Edit3 size={16} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="text-rose-400/50 hover:text-rose-400 transition-colors p-1.5"
            aria-label="حذف"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function describeCounterparty(
  tx: Transaction,
  wallet: Wallet,
  wallets: Wallet[],
  assets: Asset[],
  categories: { id: string; name: string }[]
): string {
  // Pick the side opposite to `wallet`.
  const isSource = tx.source_wallet_id === wallet.id;
  const otherWalletId = isSource ? tx.target_wallet_id : tx.source_wallet_id;
  const otherAssetId = isSource ? tx.target_asset_id : tx.source_asset_id;

  if (otherWalletId) {
    const w = wallets.find((x) => x.id === otherWalletId);
    return w ? `→ ${w.name}` : '— کیف پول حذف‌شده';
  }
  if (otherAssetId) {
    const a = assets.find((x) => x.id === otherAssetId);
    return a ? `→ ${a.name}` : '— دارایی حذف‌شده';
  }
  // INCOME / EXPENSE have no endpoint counterparty; show category title.
  if ((tx.type === 'INCOME' || tx.type === 'EXPENSE') && tx.category_id) {
    const c = categories.find((x) => x.id === tx.category_id);
    if (c) return c.name;
  }
  if (tx.type === 'INCOME') return 'درآمد بدون دسته';
  if (tx.type === 'EXPENSE') return 'هزینه بدون دسته';
  return '';
}
