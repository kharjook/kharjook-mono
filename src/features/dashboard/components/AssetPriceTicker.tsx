'use client';

import { useRouter } from 'next/navigation';
import { TrendingUp } from 'lucide-react';

export interface PriceTickerItem {
  id: string;
  label: string;
  price: string;
  href: string;
}

export interface AssetPriceTickerProps {
  items: PriceTickerItem[];
}

export function AssetPriceTicker({ items }: AssetPriceTickerProps) {
  const router = useRouter();

  if (items.length === 0) return null;

  const loop = [...items, ...items];

  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-500/15 bg-[#1A1B26]">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <TrendingUp size={14} className="text-cyan-400 shrink-0" />
        <p className="text-[11px] font-medium text-slate-400">قیمت لحظه‌ای</p>
      </div>

      <div className="relative">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-linear-to-l from-[#1A1B26] to-transparent"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-linear-to-r from-[#1A1B26] to-transparent"
          aria-hidden
        />

        <div className="overflow-x-auto overflow-y-hidden py-2.5 scrollbar-hide">
          <div className="price-ticker-track flex w-max items-stretch gap-2 px-3">
            {loop.map((item, index) => (
              <button
                key={`${item.id}-${index}`}
                type="button"
                onClick={() => router.push(item.href)}
                className="shrink-0 rounded-xl border border-white/8 bg-[#0F1015]/80 px-3 py-2 text-right transition-colors hover:border-cyan-500/30 hover:bg-[#222436] active:scale-[0.98]"
              >
                <p className="text-[11px] text-slate-400 whitespace-nowrap">{item.label}</p>
                <p className="mt-0.5 text-sm font-bold text-white whitespace-nowrap" dir="ltr">
                  {item.price}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
