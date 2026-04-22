'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Optional header slot rendered under the title (e.g. a search input). */
  header?: ReactNode;
  children: ReactNode;
  /** If true, dragging down past threshold closes the sheet. Default `true`. */
  dismissOnDrag?: boolean;
}

export function BottomSheet({
  open,
  onClose,
  title,
  header,
  children,
  dismissOnDrag = true,
}: BottomSheetProps) {
  // We render via portal into <body>. The app's column-scoped Shell creates a
  // stacking context that would otherwise clip the sheet.
  const mounted = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);

  // Lock page scroll while open so iOS Safari doesn't rubber-band the parent.
  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  // ESC to close — mirrors the app's Modal behavior for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Drag-to-close. We only track the handle, not the whole sheet, because
  // we don't want to hijack scroll inside the body.
  const [dragY, setDragY] = useState(0);
  const startYRef = useRef<number | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (!dismissOnDrag) return;
    startYRef.current = e.touches[0]!.clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startYRef.current == null) return;
    const dy = e.touches[0]!.clientY - startYRef.current;
    setDragY(Math.max(0, dy));
  };
  const onTouchEnd = () => {
    if (startYRef.current == null) return;
    startYRef.current = null;
    if (dragY > 120) onClose();
    setDragY(0);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-90 ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
      dir="rtl"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="بستن"
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Sheet */}
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto w-full sm:max-w-md bg-[#13141C] rounded-t-3xl border-t border-white/10 shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          transform: open
            ? `translateY(${dragY}px)`
            : 'translateY(100%)',
          maxHeight: '85dvh',
          display: 'flex',
          flexDirection: 'column',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div
          className="pt-3 pb-2 shrink-0 touch-none select-none"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <div className="mx-auto w-10 h-1 rounded-full bg-white/20" />
        </div>

        {title && (
          <div className="px-5 pb-3 shrink-0">
            <h3 className="text-base font-bold text-white">{title}</h3>
          </div>
        )}
        {header && <div className="px-5 pb-3 shrink-0">{header}</div>}

        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide px-5 pb-6">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
