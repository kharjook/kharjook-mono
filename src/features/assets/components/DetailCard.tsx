'use client';

export interface DetailCardProps {
  label: string;
  value: string;
}

export function DetailCard({ label, value }: DetailCardProps) {
  return (
    <div className="bg-[#1A1B26] p-4 rounded-2xl border border-white/5">
      <p className="text-slate-500 text-xs mb-1">{label}</p>
      <p className="text-slate-200 font-semibold text-sm" dir="ltr">
        {value}
      </p>
    </div>
  );
}
