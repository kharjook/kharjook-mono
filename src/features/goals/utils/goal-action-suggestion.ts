import type { CurrencyMode } from '@/shared/types/domain';
import { formatCurrency } from '@/shared/utils/format-currency';
import { isGoalMet, type GoalValueKind } from '@/features/goals/utils/goal-progress-display';

export type GoalActionKind = 'buy' | 'sell';

export interface GoalActionSuggestion {
  action: GoalActionKind;
  message: string;
}

/** Toman to buy so allocation reaches `targetPercent` without selling anything. */
export function computeBuyOnlyValueToman(
  currentValueToman: number,
  portfolioValueToman: number,
  targetPercent: number
): number | null {
  if (targetPercent <= 0 || targetPercent >= 100) return null;
  if (!Number.isFinite(currentValueToman) || !Number.isFinite(portfolioValueToman)) {
    return null;
  }

  const numerator = targetPercent * portfolioValueToman - 100 * currentValueToman;
  if (numerator <= 0) return null;

  return numerator / (100 - targetPercent);
}

/** Toman to sell so allocation reaches `targetPercent` without buying anything. */
export function computeSellOnlyValueToman(
  currentValueToman: number,
  portfolioValueToman: number,
  targetPercent: number
): number | null {
  if (targetPercent <= 0 || targetPercent >= 100) return null;
  if (!Number.isFinite(currentValueToman) || !Number.isFinite(portfolioValueToman)) {
    return null;
  }

  const numerator = 100 * currentValueToman - targetPercent * portfolioValueToman;
  if (numerator <= 0) return null;

  return numerator / (100 - targetPercent);
}

function formatQuantityAmount(value: number, decimalPlaces: number): string {
  return value.toLocaleString('en-US', {
    maximumFractionDigits: decimalPlaces,
    minimumFractionDigits: 0,
  });
}

function formatCurrencyAmount(
  toman: number,
  currencyMode: CurrencyMode,
  usdRate: number
): string {
  const displayAmount =
    currencyMode === 'USD' && usdRate > 0 ? toman / usdRate : toman;
  return formatCurrency(displayAmount, currencyMode);
}

function buildBuyMessage(input: {
  name: string;
  kind: GoalValueKind;
  current: number;
  target: number;
  unit?: string;
  decimalPlaces?: number;
  currentValueToman?: number;
  portfolioValueToman?: number;
  priceToman?: number;
  currencyMode?: CurrencyMode;
  usdRate?: number;
}): GoalActionSuggestion | null {
  const { name, kind, current, target } = input;

  if (kind === 'quantity') {
    const buyQty = Math.max(0, target - current);
    if (buyQty <= 0) return null;
    const unitSuffix = input.unit ? ` ${input.unit}` : '';
    return {
      action: 'buy',
      message: `${formatQuantityAmount(buyQty, input.decimalPlaces ?? 4)}${unitSuffix} ${name} بیشتر بخر`,
    };
  }

  const portfolio = input.portfolioValueToman ?? 0;
  const currentValueToman = input.currentValueToman ?? 0;
  const buyToman = computeBuyOnlyValueToman(currentValueToman, portfolio, target);
  if (buyToman === null || buyToman <= 0) return null;

  const priceToman = input.priceToman ?? 0;
  if (priceToman > 0) {
    const buyQty = buyToman / priceToman;
    const unitSuffix = input.unit ? ` ${input.unit}` : '';
    return {
      action: 'buy',
      message: `${formatQuantityAmount(buyQty, input.decimalPlaces ?? 4)}${unitSuffix} ${name} بیشتر بخر`,
    };
  }

  const currencyMode = input.currencyMode ?? 'TOMAN';
  return {
    action: 'buy',
    message: `حدود ${formatCurrencyAmount(buyToman, currencyMode, input.usdRate ?? 0)} از ${name} بخر`,
  };
}

function buildSellMessage(input: {
  name: string;
  kind: GoalValueKind;
  current: number;
  target: number;
  unit?: string;
  decimalPlaces?: number;
  currentValueToman?: number;
  portfolioValueToman?: number;
  priceToman?: number;
  currencyMode?: CurrencyMode;
  usdRate?: number;
  maxQuantity?: number;
}): GoalActionSuggestion | null {
  const { name, kind, current, target } = input;

  if (kind === 'quantity') {
    const sellQty = Math.max(0, current - target);
    if (sellQty <= 0) return null;
    const cappedQty =
      input.maxQuantity !== undefined
        ? Math.min(sellQty, Math.max(0, input.maxQuantity))
        : sellQty;
    if (cappedQty <= 0) return null;
    const unitSuffix = input.unit ? ` ${input.unit}` : '';
    return {
      action: 'sell',
      message: `${formatQuantityAmount(cappedQty, input.decimalPlaces ?? 4)}${unitSuffix} ${name} بفروش`,
    };
  }

  const portfolio = input.portfolioValueToman ?? 0;
  const currentValueToman = input.currentValueToman ?? 0;
  const sellToman = computeSellOnlyValueToman(currentValueToman, portfolio, target);
  if (sellToman === null || sellToman <= 0) return null;

  const priceToman = input.priceToman ?? 0;
  if (priceToman > 0) {
    let sellQty = sellToman / priceToman;
    if (input.maxQuantity !== undefined) {
      sellQty = Math.min(sellQty, Math.max(0, input.maxQuantity));
    }
    if (sellQty <= 0) return null;
    const unitSuffix = input.unit ? ` ${input.unit}` : '';
    return {
      action: 'sell',
      message: `${formatQuantityAmount(sellQty, input.decimalPlaces ?? 4)}${unitSuffix} ${name} بفروش`,
    };
  }

  const currencyMode = input.currencyMode ?? 'TOMAN';
  return {
    action: 'sell',
    message: `حدود ${formatCurrencyAmount(sellToman, currencyMode, input.usdRate ?? 0)} از ${name} بفروش`,
  };
}

export function buildGoalActionSuggestion(input: {
  name: string;
  kind: GoalValueKind;
  current: number;
  target: number;
  unit?: string;
  decimalPlaces?: number;
  currentValueToman?: number;
  portfolioValueToman?: number;
  priceToman?: number;
  currencyMode?: CurrencyMode;
  usdRate?: number;
  maxQuantity?: number;
  allowSell?: boolean;
}): GoalActionSuggestion | null {
  const { current, target, kind, allowSell = false } = input;
  if (target <= 0 || isGoalMet(current, target, kind)) return null;

  if (current < target) {
    return buildBuyMessage(input);
  }

  if (allowSell && current > target) {
    return buildSellMessage(input);
  }

  return null;
}

/** Homepage helper — buy suggestions only. */
export function buildGoalBuySuggestion(input: {
  name: string;
  kind: GoalValueKind;
  current: number;
  target: number;
  unit?: string;
  decimalPlaces?: number;
  currentValueToman?: number;
  portfolioValueToman?: number;
  priceToman?: number;
  currencyMode?: CurrencyMode;
  usdRate?: number;
}): string | null {
  const suggestion = buildGoalActionSuggestion({ ...input, allowSell: false });
  return suggestion?.message ?? null;
}
