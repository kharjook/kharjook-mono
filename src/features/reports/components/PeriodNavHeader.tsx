'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  currentPeriod,
  encodePeriodParams,
  formatPeriodLabel,
  isCurrentPeriod,
  PERIOD_KINDS,
  shiftPeriod,
  type Period,
  type PeriodKind,
  formatPeriodKindLabel,
} from '@/shared/utils/period';

interface PeriodNavHeaderProps {
  period: Period;
  onChange: (next: Period) => void;
}

export function PeriodNavHeader({ period, onChange }: PeriodNavHeaderProps) {
  const onKind = (kind: PeriodKind) => {
    // When switching granularity, anchor on the current period's start so the
    // view stays centered on the same "now moment" the user was looking at.
    if (kind === period.kind) return;
    onChange(currentPeriod(kind));
  };

  const atCurrent = isCurrentPeriod(period);
  const isAllPeriod = period.kind === 'all';

  return (
    <div className="space-y-3">
      {/* Kind tabs */}
      <div className="flex bg-[#1A1B26] rounded-xl border border-white/5 p-1">
        {PERIOD_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onKind(k)}
            className={`flex-1 text-xs font-bold py-2 rounded-lg transition ${
              k === period.kind
                ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {formatPeriodKindLabel(k)}
          </button>
        ))}
      </div>

      {/* Prev / label / next */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(shiftPeriod(period, -1))}
          aria-label="قبلی"
          disabled={isAllPeriod}
          className={`shrink-0 w-9 h-9 rounded-xl border border-white/5 flex items-center justify-center transition ${
            isAllPeriod
              ? 'bg-[#1A1B26] text-slate-700 cursor-not-allowed'
              : 'bg-[#1A1B26] text-slate-300 hover:bg-white/5'
          }`}
        >
          <ChevronRight size={18} />
        </button>
        <div className="flex-1 text-center">
          <div className="text-sm font-bold text-white">{formatPeriodLabel(period)}</div>
          {!atCurrent && !isAllPeriod && (
            <button
              type="button"
              onClick={() => onChange(currentPeriod(period.kind))}
              className="text-[10px] text-purple-400 hover:text-purple-300 mt-0.5"
            >
              برگشت به {formatPeriodKindLabel(period.kind)} جاری
            </button>
          )}
          {atCurrent && !isAllPeriod && (
            <div className="text-[10px] text-slate-500 mt-0.5">{formatPeriodKindLabel(period.kind)} جاری</div>
          )}
          {isAllPeriod && (
            <div className="text-[10px] text-slate-500 mt-0.5">نمایش تمام تاریخچه</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onChange(shiftPeriod(period, 1))}
          aria-label="بعدی"
          disabled={isAllPeriod}
          className={`shrink-0 w-9 h-9 rounded-xl border border-white/5 flex items-center justify-center transition ${
            isAllPeriod
              ? 'bg-[#1A1B26] text-slate-700 cursor-not-allowed'
              : 'bg-[#1A1B26] text-slate-300 hover:bg-white/5'
          }`}
        >
          <ChevronLeft size={18} />
        </button>
      </div>
    </div>
  );
}

// Keep the helper in scope for consumers that need to push URL state.
export function periodToSearchParams(p: Period): URLSearchParams {
  const { period, d } = encodePeriodParams(p);
  return new URLSearchParams({ period, d });
}
