'use client';

import { useLayoutEffect, useRef } from 'react';
import {
  formatCanonicalNumberDisplay,
  parseFormattedNumberToCanonical,
} from '@/shared/utils/format-number-input';

function countDigitsBeforeIndex(s: string, index: number): number {
  let c = 0;
  for (let i = 0; i < index && i < s.length; i++) {
    const ch = s[i]!;
    if (/[0-9]/.test(ch)) c++;
  }
  return c;
}

function indexAfterDigitCount(s: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < s.length; i++) {
    if (/[0-9]/.test(s[i]!)) {
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
  const caretRef = useRef<{ digitsBefore: number } | null>(null);
  const display = formatCanonicalNumberDisplay(value);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const sel = el.selectionStart ?? 0;
    // Count digits in the RAW post-change value at the current caret. Using the
    // stale pre-change `display` here is off-by-one whenever the typed char is
    // itself a digit, which caused the caret to drift left while typing.
    caretRef.current = { digitsBefore: countDigitsBeforeIndex(el.value, sel) };
    onValueChange(parseFormattedNumberToCanonical(el.value));
  };

  useLayoutEffect(() => {
    if (!caretRef.current || !inputRef.current) return;
    const { digitsBefore } = caretRef.current;
    caretRef.current = null;
    const nextDisplay = formatCanonicalNumberDisplay(value);
    const pos = indexAfterDigitCount(nextDisplay, digitsBefore);
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
