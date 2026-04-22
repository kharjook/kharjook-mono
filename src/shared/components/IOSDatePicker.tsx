'use client';

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BottomSheet } from '@/shared/components/BottomSheet';
import {
  JALALI_MONTHS,
  formatJalaali,
  jalaaliMonthLength,
  parseJalaali,
  todayJalaali,
  type JalaaliDate,
} from '@/shared/utils/jalali';

export interface IOSDatePickerProps {
  open: boolean;
  onClose: () => void;
  /** Canonical `YYYY/MM/DD` Jalali string. */
  value: string;
  onChange: (value: string) => void;
  /** Inclusive lower bound on year. Default: currentJalaliYear - 15. */
  minYear?: number;
  /** Inclusive upper bound on year. Default: currentJalaliYear + 2. */
  maxYear?: number;
}

const ITEM_HEIGHT = 40;
const VISIBLE_ITEMS = 5;
const PADDING = ((VISIBLE_ITEMS - 1) / 2) * ITEM_HEIGHT;

const faDigit = (n: number) =>
  String(n).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[Number(c)]!);

export function IOSDatePicker(props: IOSDatePickerProps) {
  const { open, onClose } = props;

  // The inner body owns all draft state. We re-mount it every time the sheet
  // opens by keying on `open`, which cleanly resets state without the
  // setState-in-effect anti-pattern.
  return (
    <BottomSheet open={open} onClose={onClose} title="انتخاب تاریخ">
      {open && <PickerBody {...props} />}
    </BottomSheet>
  );
}

function PickerBody({ value, onChange, onClose, minYear, maxYear }: IOSDatePickerProps) {
  const today = useMemo(() => todayJalaali(), []);
  const yStart = minYear ?? today.jy - 15;
  const yEnd = maxYear ?? today.jy + 2;

  const [draft, setDraft] = useState<JalaaliDate>(() => parseJalaali(value) ?? today);

  // Clamp day at render time if the selected month is shorter. No effect,
  // no cascading renders — just a derived read.
  const effective: JalaaliDate = useMemo(() => {
    const len = jalaaliMonthLength(draft.jy, draft.jm);
    return draft.jd > len ? { ...draft, jd: len } : draft;
  }, [draft]);

  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = yStart; y <= yEnd; y++) out.push(y);
    return out;
  }, [yStart, yEnd]);
  const months = useMemo(() => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], []);
  const days = useMemo(() => {
    const len = jalaaliMonthLength(effective.jy, effective.jm);
    return Array.from({ length: len }, (_, i) => i + 1);
  }, [effective.jy, effective.jm]);

  const confirm = useCallback(() => {
    onChange(formatJalaali(effective));
    onClose();
  }, [effective, onChange, onClose]);

  const goToday = () => setDraft(today);

  return (
    <div className="relative" dir="ltr">
      <div
        className="relative flex justify-center gap-1"
        style={{ height: ITEM_HEIGHT * VISIBLE_ITEMS }}
      >
        {/* Center selection guide */}
        <div
          className="pointer-events-none absolute inset-x-2 bg-white/5 rounded-xl"
          style={{
            top: PADDING,
            height: ITEM_HEIGHT,
          }}
        />

        {/* Source column order: day, month, year. dir="rtl" on the outer
            wrapper flips the visual to `day month year` read right-to-left —
            matches how Persian speakers read a date. */}
        <div className="flex-1 min-w-0" dir="rtl">
          <Wheel
            items={days}
            render={(d) => faDigit(d)}
            value={effective.jd}
            onChange={(jd) => setDraft((prev) => ({ ...prev, jd }))}
          />
        </div>
        <div className="flex-[1.4] min-w-0" dir="rtl">
          <Wheel
            items={months}
            render={(m) => JALALI_MONTHS[m - 1]!}
            value={effective.jm}
            onChange={(jm) => setDraft((prev) => ({ ...prev, jm }))}
          />
        </div>
        <div className="flex-1 min-w-0" dir="rtl">
          <Wheel
            items={years}
            render={(y) => faDigit(y)}
            value={effective.jy}
            onChange={(jy) => setDraft((prev) => ({ ...prev, jy }))}
          />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2" dir="rtl">
        <button
          type="button"
          onClick={goToday}
          className="px-3 py-2 text-xs font-bold rounded-xl bg-white/5 text-slate-300 hover:bg-white/10"
        >
          امروز
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-xl bg-white/5 text-slate-300 hover:bg-white/10"
        >
          انصراف
        </button>
        <button
          type="button"
          onClick={confirm}
          className="px-5 py-2 text-sm font-bold rounded-xl bg-purple-600 text-white hover:bg-purple-500"
        >
          تایید
        </button>
      </div>
    </div>
  );
}

// ─── Wheel ───────────────────────────────────────────────────────────────────

function Wheel<T extends number>({
  items,
  render,
  value,
  onChange,
}: {
  items: T[];
  render: (v: T) => string;
  value: T;
  onChange: (v: T) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settleRef = useRef<number | null>(null);
  const programmaticRef = useRef(false);

  const indexOfValue = Math.max(0, items.indexOf(value));

  // Snap to the correct item whenever the value changes externally. We use a
  // layout effect to avoid a one-frame flash at a wrong offset before paint.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    programmaticRef.current = true;
    el.scrollTop = indexOfValue * ITEM_HEIGHT;
    const t = window.setTimeout(() => {
      programmaticRef.current = false;
    }, 80);
    return () => window.clearTimeout(t);
  }, [indexOfValue]);

  const onScroll = () => {
    if (programmaticRef.current) return;
    const el = ref.current;
    if (!el) return;
    if (settleRef.current != null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      const idx = Math.round(el.scrollTop / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(items.length - 1, idx));
      const snappedTop = clamped * ITEM_HEIGHT;
      if (Math.abs(el.scrollTop - snappedTop) > 1) {
        programmaticRef.current = true;
        el.scrollTo({ top: snappedTop, behavior: 'smooth' });
        window.setTimeout(() => {
          programmaticRef.current = false;
        }, 150);
      }
      const next = items[clamped];
      if (next !== undefined && next !== value) onChange(next);
    }, 100);
  };

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className="h-full overflow-y-scroll scrollbar-hide snap-y snap-mandatory touch-pan-y"
      style={{
        paddingTop: PADDING,
        paddingBottom: PADDING,
        height: ITEM_HEIGHT * VISIBLE_ITEMS,
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {items.map((it) => {
        const active = it === value;
        return (
          <div
            key={String(it)}
            className={`flex items-center justify-center snap-center text-sm transition-colors ${
              active ? 'text-white font-bold' : 'text-slate-500'
            }`}
            style={{ height: ITEM_HEIGHT }}
          >
            {render(it)}
          </div>
        );
      })}
    </div>
  );
}
