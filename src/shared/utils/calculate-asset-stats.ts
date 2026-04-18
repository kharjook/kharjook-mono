import type { Asset, AssetStats, CurrencyMode, Transaction } from '@/shared/types/domain';
import { parseDateToNumber } from '@/shared/utils/parse-date';

export function calculateAssetStats(
  asset: Asset,
  transactions: Transaction[],
  _currencyMode: CurrencyMode,
  usdRate: number
): AssetStats {
  const assetTxs = transactions.filter((tx) => tx.asset_id === asset.id);

  let totalAmount = 0;
  let totalCostToman = 0;
  let totalCostUsd = 0;
  let realizedProfitToman = 0;
  let realizedProfitUsd = 0;
  let historicalCostToman = 0; // Used for accurate ROI percentage

  // Bulletproof sort: Oldest to Newest, handling same-day trades logically
  const sortedTxs = [...assetTxs].sort((a, b) => {
    const dateA = parseDateToNumber(a.date_string);
    const dateB = parseDateToNumber(b.date_string);

    if (dateA !== dateB) return dateA - dateB;

    // If exact same date, process BUYS before SELLS to avoid phantom zero balances
    if (a.type === 'BUY' && b.type !== 'BUY') return -1;
    if (a.type !== 'BUY' && b.type === 'BUY') return 1;

    // Final fallback to real creation timestamp
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  sortedTxs.forEach((tx) => {
    if (tx.type !== 'BUY' && tx.type !== 'SELL') return;

    const amount = Number(tx.amount);
    const priceToman = Number(tx.price_toman);
    const txUsdRate = Number(tx.usd_rate) || usdRate;
    const priceUsd = priceToman / txUsdRate;

    if (tx.type === 'BUY') {
      totalAmount += amount;
      const txCostToman = amount * priceToman;
      totalCostToman += txCostToman;
      totalCostUsd += amount * priceUsd;
      historicalCostToman += txCostToman;
    } else {
      if (totalAmount > 0) {
        const avgCostToman = totalCostToman / totalAmount;
        const avgCostUsd = totalCostUsd / totalAmount;

        // Calculate Realized Profit
        realizedProfitToman += amount * (priceToman - avgCostToman);
        realizedProfitUsd += amount * (priceUsd - avgCostUsd);

        // Reduce Cost Basis proportionately
        totalCostToman -= amount * avgCostToman;
        totalCostUsd -= amount * avgCostUsd;
        totalAmount -= amount;
      }

      // Handle JS floating point issues when amount reaches 0
      if (totalAmount <= 0.000001) {
        totalAmount = 0;
        totalCostToman = 0;
        totalCostUsd = 0;
      }
    }
  });

  const avgBuyPriceToman = totalAmount > 0 ? totalCostToman / totalAmount : 0;
  const currentPriceToman = asset.price_toman || 0;
  const currentPriceUsd =
    asset.price_usd || (usdRate > 0 ? currentPriceToman / usdRate : 0);

  const currentValueToman = totalAmount * currentPriceToman;
  const currentValueUsd = totalAmount * currentPriceUsd;

  // Calculate Unrealized Profit (from remaining holdings)
  const unrealizedProfitToman = currentValueToman - totalCostToman;
  const unrealizedProfitUsd = currentValueUsd - totalCostUsd;

  // Total PNL = Realized (from sells) + Unrealized (from current bags)
  const profitLossToman = realizedProfitToman + unrealizedProfitToman;
  const profitLossUsd = realizedProfitUsd + unrealizedProfitUsd;

  // Accurate Lifetime ROI percentage
  const profitLossPercent =
    historicalCostToman > 0
      ? (profitLossToman / historicalCostToman) * 100
      : 0;

  return {
    totalAmount,
    totalCostToman,
    avgBuyPriceToman,
    currentValueToman,
    currentValueUsd,
    profitLossToman,
    profitLossUsd,
    profitLossPercent,
    realizedProfitToman,
    realizedProfitUsd,
    unrealizedProfitToman,
    unrealizedProfitUsd,
  };
}
