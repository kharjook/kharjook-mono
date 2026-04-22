'use client';

import { useLayoutEffect, useRef } from 'react';
import {
  formatCanonicalNumberDisplay,
  parseFormattedNumberToCanonical,
} from '@/shared/utils/format-number-input';

// "Canonical chars" are what survives parsing: digits and the single decimal
// point. Thousand separators, spaces and anything else are display-only noise.
// Counting THESE gives us a caret position that's invariant to re-grouping,
// so reformat + restore lands the caret back where the user expects — even
// when they just typed a bare `.` (which earlier digit-only counting ignored,
// causing the caret to jump left of the decimal).
function isCanonicalChar(ch: string): boolean {
  return ch === '.' || (ch >= '0' && ch <= '9');
}

function countCanonicalBeforeIndex(s: string, index: number): number {
  let c = 0;
  const end = Math.min(index, s.length);
  for (let i = 0; i < end; i++) {
    if (isCanonicalChar(s[i]!)) c++;
  }
  return c;
}

function indexAfterCanonicalCount(s: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < s.length; i++) {
    if (isCanonicalChar(s[i]!)) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return s.length;
}

export type FormattedNumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange'
> & {
  /** Canonical value: ASCII digits and optional single `.` */
  value: string;
  onValueChange: (canonical: string) => void;
};

export function FormattedNumberInput({
  value,
  onValueChange,
  className,
  ...rest
}: FormattedNumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<{ canonicalBefore: number } | null>(null);
  const display = formatCanonicalNumberDisplay(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const sel = el.selectionStart ?? 0;
    caretRef.current = {
      canonicalBefore: countCanonicalBeforeIndex(el.value, sel),
    };
    onValueChange(parseFormattedNumberToCanonical(el.value));
  };

  useLayoutEffect(() => {
    if (!caretRef.current || !inputRef.current) return;
    const { canonicalBefore } = caretRef.current;
    caretRef.current = null;
    const nextDisplay = formatCanonicalNumberDisplay(value);
    const pos = indexAfterCanonicalCount(nextDisplay, canonicalBefore);
    inputRef.current.setSelectionRange(pos, pos);
  }, [value]);

  return (
    <input
      ref={inputRef}
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={display}
      onChange={handleChange}
      className={className}
    />
  );
}
