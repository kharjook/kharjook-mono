'use client';

import { Target } from 'lucide-react';
import type { GoalProgress } from '@/features/goals/utils/goal-progress';
import {
  computeGoalBarMetricsForKind,
  computeGoalDelta,
  formatGoalValue,
  goalGapLabel,
  type GoalValueKind,
} from '@/features/goals/utils/goal-progress-display';

export interface GoalProgressDisplayProps {
  label: string;
  progress: GoalProgress | null;
  kind: GoalValueKind;
  /** Unit for quantity goals (e.g. گرم). Ignored for percent. */
  unit?: string;
  variant?: 'compact' | 'default';
  showIcon?: boolean;
  className?: string;
}

export function GoalProgressDisplay({
  label,
  progress,
  kind,
  unit = '',
  variant = 'default',
  showIcon = true,
  className = '',
}: GoalProgressDisplayProps) {
  const valueUnit = kind === 'percent' ? '%' : unit;
  const delta = computeGoalDelta(progress, kind, valueUnit);
  const bar = computeGoalBarMetricsForKind(progress, kind);

  const baseBarClass =
    delta.status === 'under'
      ? 'bg-linear-to-l from-purple-500 to-cyan-400'
      : 'bg-linear-to-l from-emerald-500 to-teal-400';

  if (variant === 'compact') {
    return (
      <div className={`min-w-0 space-y-1 ${className}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1 truncate text-[10px] text-purple-300">
            {showIcon && <Target size={10} className="shrink-0" />}
            <span className="truncate">{label}</span>
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${delta.badgeClassName}`}
            dir="ltr"
          >
            {delta.deltaLabel}
          </span>
        </div>
        <GoalProgressBar bar={bar} baseBarClass={baseBarClass} size="sm" />
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        {label ? (
          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            {showIcon && <Target size={12} className="shrink-0 text-purple-300" />}
            <span>{label}</span>
          </p>
        ) : (
          <span />
        )}
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${delta.badgeClassName}`}
          dir="ltr"
        >
          {delta.deltaLabel}
        </span>
      </div>

      <GoalProgressBar bar={bar} baseBarClass={baseBarClass} size="md" />

      <div
        className="grid grid-cols-3 gap-2 text-[10px] text-slate-500"
        dir="ltr"
      >
        <div>
          <p className="text-slate-600 mb-0.5">فعلی</p>
          <p className="text-slate-300 font-medium">
            {formatGoalValue(progress?.current ?? 0, kind, valueUnit)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-slate-600 mb-0.5">هدف</p>
          <p className="text-slate-300 font-medium">
            {formatGoalValue(progress?.target ?? 0, kind, valueUnit)}
          </p>
        </div>
        <div className="text-left">
          <p className="text-slate-600 mb-0.5">فاصله</p>
          <p className="text-slate-300 font-medium">
            {goalGapLabel(progress, kind, valueUnit)}
          </p>
        </div>
      </div>
    </div>
  );
}

function GoalProgressBar({
  bar,
  baseBarClass,
  size,
}: {
  bar: ReturnType<typeof computeGoalBarMetricsForKind>;
  baseBarClass: string;
  size: 'sm' | 'md';
}) {
  const height = size === 'sm' ? 'h-1.5' : 'h-2.5';
  const markerHeight = size === 'sm' ? 'h-3.5' : 'h-5';

  return (
    <div className={`relative ${height} rounded-full bg-white/5`}>
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${baseBarClass}`}
        style={{ width: `${bar.baseFillPct}%` }}
      />
      {bar.showOverflow && bar.overflowPct > 0 && (
        <div
          className="absolute inset-y-0 rounded-r-full bg-emerald-400/90"
          style={{
            left: `${bar.targetPct}%`,
            width: `${bar.overflowPct}%`,
          }}
        />
      )}
      {bar.targetPct > 0 && bar.targetPct < 100 && (
        <div
          className={`absolute top-1/2 ${markerHeight} w-0.5 -translate-y-1/2 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.55)]`}
          style={{ left: `${bar.targetPct}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}
