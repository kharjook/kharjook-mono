'use client';

type HapticIntent = 'light' | 'selection' | 'medium' | 'success' | 'error';

const PATTERNS: Record<HapticIntent, number | number[]> = {
  light: 8,
  selection: [6, 14, 6],
  medium: 16,
  success: [10, 24, 16],
  error: [22, 36, 22],
};

let lastPulseAt = 0;
const MIN_GAP_MS = 60;

function canVibrate() {
  if (typeof window === 'undefined') return false;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  return true;
}

export function haptic(intent: HapticIntent) {
  if (!canVibrate()) return false;
  const now = Date.now();
  if (now - lastPulseAt < MIN_GAP_MS) return false;
  lastPulseAt = now;
  return navigator.vibrate(PATTERNS[intent]);
}

