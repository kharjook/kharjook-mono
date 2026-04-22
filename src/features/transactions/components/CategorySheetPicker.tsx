'use client';

import { useMemo, useState } from 'react';
import { Folder, Search } from 'lucide-react';
import { BottomSheet } from '@/shared/components/BottomSheet';
import type { Category, CategoryKind } from '@/shared/types/domain';

export interface CategorySheetPickerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  kind: Extract<CategoryKind, 'income' | 'expense'>;
  categories: Category[];
  value: string | null;
  onSelect: (id: string | null) => void;
}

// Flattened item that renders the forest with indentation.
interface FlatItem {
  id: string;
  name: string;
  color: string;
  depth: number;
}

function flattenForest(
  scoped: Category[],
  query: string
): FlatItem[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of scoped) {
    const key = c.parent_id ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(c);
    byParent.set(key, arr);
  }

  const q = query.trim().toLowerCase();
  const out: FlatItem[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const nodes = byParent.get(parentId) ?? [];
    for (const n of nodes) {
      out.push({ id: n.id, name: n.name, color: n.color, depth });
      visit(n.id, depth + 1);
    }
  };
  visit(null, 0);

  // Categories whose parent is out of scope (e.g. different kind) should
  // still appear — as roots, to avoid orphans being silently dropped.
  const scopedIds = new Set(scoped.map((c) => c.id));
  for (const c of scoped) {
    if (!c.parent_id || scopedIds.has(c.parent_id)) continue;
    if (out.some((o) => o.id === c.id)) continue;
    out.push({ id: c.id, name: c.name, color: c.color, depth: 0 });
  }

  if (!q) return out;
  return out.filter((it) => it.name.toLowerCase().includes(q));
}

export function CategorySheetPicker({
  open,
  onClose,
  title,
  kind,
  categories,
  value,
  onSelect,
}: CategorySheetPickerProps) {
  const [query, setQuery] = useState('');

  const scoped = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind]
  );
  const items = useMemo(() => flattenForest(scoped, query), [scoped, query]);

  const handleSelect = (id: string) => {
    onSelect(id);
    onClose();
    setQuery('');
  };

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        onClose();
        setQuery('');
      }}
      title={title}
      header={
        <div className="relative">
          <Search
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو..."
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl py-2.5 pr-9 pl-3 text-sm text-white placeholder:text-slate-500 focus:border-purple-500 outline-none"
            autoFocus
          />
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="text-xs text-slate-500 py-8 text-center">
          دسته‌ای یافت نشد.
        </p>
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => {
            const selected = value === it.id;
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => handleSelect(it.id)}
                className={`w-full flex items-center gap-3 border rounded-xl p-3 text-right transition ${
                  selected
                    ? 'bg-purple-500/10 border-purple-500/40'
                    : 'bg-[#1A1B26] border-white/5 hover:bg-[#222436]'
                }`}
                style={{ paddingInlineStart: `${12 + it.depth * 18}px` }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: it.color }}
                />
                <Folder
                  size={14}
                  className={selected ? 'text-purple-300' : 'text-slate-500'}
                />
                <span
                  className={`flex-1 min-w-0 text-sm truncate ${
                    selected ? 'text-white font-semibold' : 'text-slate-200'
                  }`}
                >
                  {it.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </BottomSheet>
  );
}
