'use client';

export function RouteSkeleton({
  blocks = 4,
  compact = false,
}: {
  blocks?: number;
  compact?: boolean;
}) {
  return (
    <div className={`p-6 space-y-4 animate-pulse ${compact ? 'pt-3' : ''}`}>
      <div className="h-8 w-40 rounded-xl bg-white/8" />
      {Array.from({ length: blocks }).map((_, index) => (
        <div
          key={index}
          className={`rounded-2xl bg-white/6 ${
            index % 3 === 0 ? 'h-24' : index % 3 === 1 ? 'h-20' : 'h-28'
          }`}
        />
      ))}
    </div>
  );
}
