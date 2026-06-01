import type { GoalProgress } from '@/features/goals/utils/goal-progress';

export type GoalValueKind = 'percent' | 'quantity';

export type GoalDeltaStatus = 'under' | 'met' | 'over';

export const GOAL_PERCENT_TOLERANCE = 0.5;

export interface GoalDeltaInfo {
  status: GoalDeltaStatus;
  delta: number;
  deltaLabel: string;
  badgeClassName: string;
}

export interface GoalBarMetrics {
  scaleMax: number;
  targetPct: number;
  currentPct: number;
  baseFillPct: number;
  overflowPct: number;
  showOverflow: boolean;
}

export function goalValueKindFromGoal(
  targetKind: 'allocation_percent' | 'quantity'
): GoalValueKind {
  return targetKind === 'quantity' ? 'quantity' : 'percent';
}

export function isGoalMet(
  current: number,
  target: number,
  kind: GoalValueKind
): boolean {
  if (target <= 0) return current <= 0;
  const delta = current - target;
  if (kind === 'percent') {
    return Math.abs(delta) <= GOAL_PERCENT_TOLERANCE;
  }
  const tolerance = target * (GOAL_PERCENT_TOLERANCE / 100);
  return Math.abs(delta) <= tolerance;
}

export function formatGoalValue(
  value: number,
  kind: GoalValueKind,
  unit: string
): string {
  if (!Number.isFinite(value)) return '—';
  if (kind === 'percent') return `${value.toFixed(1)}%`;
  const formatted = value.toLocaleString('en-US', {
    maximumFractionDigits: 4,
  });
  return unit ? `${formatted} ${unit}` : formatted;
}

export function computeGoalDelta(
  progress: GoalProgress | null,
  kind: GoalValueKind,
  unit: string
): GoalDeltaInfo {
  const fallback: GoalDeltaInfo = {
    status: 'under',
    delta: 0,
    deltaLabel: '—',
    badgeClassName: 'bg-white/5 text-slate-500',
  };

  if (!progress || progress.target <= 0) return fallback;

  const { current, target } = progress;
  const delta = current - target;

  if (isGoalMet(current, target, kind)) {
    return {
      status: 'met',
      delta,
      deltaLabel: 'رسیده',
      badgeClassName: 'bg-emerald-400/10 text-emerald-300',
    };
  }

  if (delta > 0) {
    const amount =
      kind === 'percent'
        ? `+${delta.toFixed(1)}%`
        : `+${formatGoalValue(delta, 'quantity', unit)}`;
    return {
      status: 'over',
      delta,
      deltaLabel: `${amount} بالاتر`,
      badgeClassName: 'bg-emerald-400/10 text-emerald-300',
    };
  }

  const abs = Math.abs(delta);
  const amount =
    kind === 'percent'
      ? `−${abs.toFixed(1)}%`
      : `−${formatGoalValue(abs, 'quantity', unit)}`;
  return {
    status: 'under',
    delta,
    deltaLabel: `${amount} پایین‌تر`,
    badgeClassName: 'bg-amber-400/10 text-amber-300',
  };
}

export function computeGoalBarMetrics(
  progress: GoalProgress | null
): GoalBarMetrics {
  if (!progress || progress.target <= 0) {
    return {
      scaleMax: 1,
      targetPct: 100,
      currentPct: 0,
      baseFillPct: 0,
      overflowPct: 0,
      showOverflow: false,
    };
  }

  const { current, target } = progress;
  const scaleMax =
    current > target ? Math.max(target, current) * 1.06 : target;
  const targetPct = (target / scaleMax) * 100;
  const currentPct = (current / scaleMax) * 100;
  const baseFillPct = Math.min(currentPct, targetPct);
  const overflowPct = current > target ? currentPct - targetPct : 0;

  return {
    scaleMax,
    targetPct,
    currentPct,
    baseFillPct,
    overflowPct,
    showOverflow: false,
  };
}

/** Bar metrics with quantity-aware overflow (uses absolute values). */
export function computeGoalBarMetricsForKind(
  progress: GoalProgress | null,
  kind: GoalValueKind
): GoalBarMetrics {
  const metrics = computeGoalBarMetrics(progress);
  if (!progress || progress.target <= 0) return metrics;

  const met = isGoalMet(progress.current, progress.target, kind);
  return {
    ...metrics,
    showOverflow: progress.current > progress.target && !met,
  };
}

export function goalGapLabel(
  progress: GoalProgress | null,
  kind: GoalValueKind,
  unit: string
): string {
  if (!progress || progress.target <= 0) return '—';
  const { current, target } = progress;
  if (isGoalMet(current, target, kind)) return '۰';
  const gap = Math.abs(current - target);
  return formatGoalValue(gap, kind, unit);
}
