'use client';

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useToast } from '@/shared/components/Toast';

export interface CopyableDetailRowProps {
  label: string;
  value: string;
  /** Raw string copied to clipboard (defaults to `value`). */
  copyValue?: string;
}

export function CopyableDetailRow({ label, value, copyValue }: CopyableDetailRowProps) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = copyValue ?? value;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('کپی شد.');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('کپی ناموفق بود.');
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="w-full flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-[#222436]/60 px-4 py-3 text-right hover:border-purple-500/30 hover:bg-[#222436] transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-500 mb-1">{label}</p>
        <p className="text-sm text-slate-100 font-medium truncate" dir="ltr">
          {value}
        </p>
      </div>
      <span className="shrink-0 text-slate-400">
        {copied ? <Check size={16} className="text-emerald-400" /> : <Copy size={16} />}
      </span>
    </button>
  );
}
