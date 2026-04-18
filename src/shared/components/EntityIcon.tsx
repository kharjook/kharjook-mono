import type { ReactNode } from 'react';

type Props = {
  iconUrl: string | null | undefined;
  fallback: ReactNode;
  bgColor?: string;
  color?: string;
  className?: string;
};

/**
 * Circular avatar that renders either a user-uploaded icon (from Supabase
 * Storage) or the feature-specific fallback lucide icon. The colored
 * background + tint is only applied when falling back so uploaded artwork
 * isn't color-washed.
 */
export function EntityIcon({
  iconUrl,
  fallback,
  bgColor,
  color,
  className,
}: Props) {
  if (iconUrl) {
    return (
      <div
        className={`rounded-xl overflow-hidden bg-white/5 ${className ?? ''}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconUrl}
          alt=""
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>
    );
  }
  return (
    <div
      className={`rounded-xl flex items-center justify-center ${className ?? ''}`}
      style={{
        backgroundColor: bgColor ?? 'rgba(148, 163, 184, 0.12)',
        color: color ?? '#94a3b8',
      }}
    >
      {fallback}
    </div>
  );
}
