import type {
  Asset,
  Category,
  CurrencyMode,
  CurrencyRate,
  NotificationSettings,
  Transaction,
  Wallet,
} from '@/shared/types/domain';
import { rollupCategories } from '@/features/reports/utils/category-rollup';
import { calculateAssetStats } from '@/shared/utils/calculate-asset-stats';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';
import {
  clampPeriodToToday,
  currentPeriod,
  type Period,
} from '@/shared/utils/period';

export interface CashflowSummary {
  income: number;
  expense: number;
  net: number;
  unpricedCount: number;
}

export interface PortfolioSummary {
  totalToman: number;
  totalUsd: number;
  cashToman: number;
  assetsToman: number;
  usdRate: number;
}

export interface UserNotificationSnapshot {
  today: CashflowSummary;
  month: CashflowSummary;
  portfolio: PortfolioSummary;
}

function summarizeCashflow(
  transactions: Transaction[],
  categories: Category[],
  wallets: Wallet[],
  period: Period,
  currencyMode: CurrencyMode
): CashflowSummary {
  const income = rollupCategories({
    transactions,
    categories,
    wallets,
    period,
    kind: 'income',
    walletId: null,
    currencyMode,
  });
  const expense = rollupCategories({
    transactions,
    categories,
    wallets,
    period,
    kind: 'expense',
    walletId: null,
    currencyMode,
  });
  return {
    income: income.total,
    expense: expense.total,
    net: income.total - expense.total,
    unpricedCount: income.unpricedCount + expense.unpricedCount,
  };
}

export function buildUserNotificationSnapshot(input: {
  assets: Asset[];
  categories: Category[];
  transactions: Transaction[];
  wallets: Wallet[];
  currencyRates: CurrencyRate[];
}): UserNotificationSnapshot & {
  todayUsd: CashflowSummary;
  monthUsd: CashflowSummary;
} {
  const { assets, categories, transactions, wallets, currencyRates } = input;
  const usdRate =
    currencyRates.find((r) => r.currency === 'USD')?.toman_per_unit ?? 0;

  const dayPeriod = clampPeriodToToday(currentPeriod('day'));
  const monthPeriod = clampPeriodToToday(currentPeriod('month'));

  const todayToman = summarizeCashflow(
    transactions,
    categories,
    wallets,
    dayPeriod,
    'TOMAN'
  );
  const monthToman = summarizeCashflow(
    transactions,
    categories,
    wallets,
    monthPeriod,
    'TOMAN'
  );
  const todayUsd = summarizeCashflow(
    transactions,
    categories,
    wallets,
    dayPeriod,
    'USD'
  );
  const monthUsd = summarizeCashflow(
    transactions,
    categories,
    wallets,
    monthPeriod,
    'USD'
  );

  let assetsValueToman = 0;
  for (const asset of assets) {
    if (asset.include_in_balance === false) continue;
    const stats = calculateAssetStats(asset, transactions, 'TOMAN', usdRate);
    assetsValueToman += stats.currentValueToman;
  }

  let cashToman = 0;
  for (const wallet of wallets) {
    if (wallet.archived_at) continue;
    const balance = calculateWalletStats(wallet, transactions).balance;
    cashToman += balance * tomanPerUnit(wallet.currency, currencyRates);
  }

  const totalToman = assetsValueToman + cashToman;
  const totalUsd = usdRate > 0 ? totalToman / usdRate : 0;

  return {
    today: todayToman,
    month: monthToman,
    todayUsd,
    monthUsd,
    portfolio: {
      totalToman,
      totalUsd,
      cashToman,
      assetsToman: assetsValueToman,
      usdRate,
    },
  };
}
