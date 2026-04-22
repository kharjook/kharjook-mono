'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Auto-dismiss after N ms. Default: 4000 (success/info) / 6000 (error). Pass `0` to disable. */
  duration?: number;
  action?: ToastAction;
}

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  /** Timestamp (ms) when this toast should auto-dismiss. `null` = sticky. */
  expiresAt: number | null;
}

interface ToastApi {
  success: (message: string, opts?: ToastOptions) => number;
  error: (message: string, opts?: ToastOptions) => number;
  info: (message: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_DURATION: Record<ToastKind, number> = {
  success: 4000,
  info: 4000,
  error: 6000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // One consolidated interval beats N per-toast setTimeouts: cheaper, and
  // dismissal is exact enough (16ms granularity on a 4s toast is invisible).
  useEffect(() => {
    if (toasts.length === 0) return;
    const hasDeadline = toasts.some((t) => t.expiresAt !== null);
    if (!hasDeadline) return;
    const handle = window.setInterval(() => {
      const now = Date.now();
      setToasts((prev) => prev.filter((t) => t.expiresAt === null || t.expiresAt > now));
    }, 250);
    return () => window.clearInterval(handle);
  }, [toasts]);

  const push = useCallback((kind: ToastKind, message: string, opts?: ToastOptions): number => {
    const id = ++idRef.current;
    const duration = opts?.duration ?? DEFAULT_DURATION[kind];
    const expiresAt = duration > 0 ? Date.now() + duration : null;
    setToasts((prev) => [...prev, { id, kind, message, action: opts?.action, expiresAt }]);
    return id;
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (msg, opts) => push('success', msg, opts),
      error: (msg, opts) => push('error', msg, opts),
      info: (msg, opts) => push('info', msg, opts),
      dismiss,
    }),
    [push, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ─── View ────────────────────────────────────────────────────────────────────

// Using useSyncExternalStore gives us a SSR-consistent "am I on the client?"
// signal without the lint-discouraged setState-in-effect mount trick.
const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function Toaster({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  // Portal so toasts overlay modal routes too (the Shell's `max-w-md` column
  // creates a stacking context that would otherwise clip them).
  const mounted = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-100 flex flex-col items-center gap-2 p-4 pointer-events-none"
      dir="rtl"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body
  );
}

const KIND_STYLES: Record<ToastKind, { bg: string; border: string; accent: string; icon: ReactNode }> = {
  success: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    accent: 'text-emerald-400',
    icon: <CheckCircle2 size={18} />,
  },
  error: {
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    accent: 'text-rose-400',
    icon: <AlertCircle size={18} />,
  },
  info: {
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    accent: 'text-sky-400',
    icon: <Info size={18} />,
  },
};

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const style = KIND_STYLES[toast.kind];
  return (
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      className={`pointer-events-auto w-full max-w-sm ${style.bg} ${style.border} border backdrop-blur-md rounded-2xl px-4 py-3 shadow-2xl shadow-black/40 flex items-start gap-3 animate-in slide-in-from-bottom-4 fade-in duration-200`}
    >
      <span className={`shrink-0 ${style.accent} mt-0.5`}>{style.icon}</span>
      <div className="flex-1 min-w-0 text-sm text-slate-100 leading-relaxed">{toast.message}</div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
          className={`shrink-0 text-xs font-bold ${style.accent} hover:underline px-2`}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 text-slate-400 hover:text-slate-200 p-0.5"
        aria-label="بستن"
      >
        <X size={14} />
      </button>
    </div>
  );
}
