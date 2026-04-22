'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, ChevronDown, Edit3, Trash2, X } from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/Toast';
import type { Category, CategoryKind } from '@/shared/types/domain';
import { useAuth, useData } from '@/features/portfolio/PortfolioProvider';
import { CATEGORY_COLORS } from '@/features/categories/constants/category-colors';

type FormState = {
  editingId: string | null;
  name: string;
  color: string;
  parentId: string | null;
};

const KIND_TABS: { id: CategoryKind; label: string }[] = [
  { id: 'asset', label: 'دارایی' },
  { id: 'income', label: 'درآمد' },
  { id: 'expense', label: 'هزینه' },
];

const DELETE_PROMPTS: Record<CategoryKind, string> = {
  asset: 'مطمئنی؟ با پاک کردن دسته، دارایی‌های مرتبط بی‌دسته میشن.',
  income: 'مطمئنی؟ با پاک کردن دسته، تراکنش‌های مرتبط بی‌دسته میشن.',
  expense: 'مطمئنی؟ با پاک کردن دسته، تراکنش‌های مرتبط بی‌دسته میشن.',
};

const emptyForm: FormState = {
  editingId: null,
  name: '',
  color: CATEGORY_COLORS[0],
  parentId: null,
};

export function ManageCategoriesView() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { categories, setCategories } = useData();

  const [activeKind, setActiveKind] = useState<CategoryKind>('asset');
  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Categories scoped to the current tab.
  const scoped = useMemo(
    () => categories.filter((c) => c.kind === activeKind),
    [categories, activeKind]
  );

  // Tree derivation. Orphans (parent_id points to missing row or to a row in a
  // different kind) surface as top-level so the user can recover them.
  const { roots, childrenByParent } = useMemo(() => {
    const byId = new Map(scoped.map((c) => [c.id, c]));
    const rootList: Category[] = [];
    const childMap = new Map<string, Category[]>();

    scoped.forEach((c) => {
      if (c.parent_id && byId.has(c.parent_id)) {
        const arr = childMap.get(c.parent_id) ?? [];
        arr.push(c);
        childMap.set(c.parent_id, arr);
      } else {
        rootList.push(c);
      }
    });

    // Stable order inside each bucket: creation order (backend already sorts).
    return { roots: rootList, childrenByParent: childMap };
  }, [scoped]);

  // Set of ids that are descendants of the category currently being edited.
  // Used to prevent cycles when picking a parent.
  const descendantsOfEditing = useMemo(() => {
    if (!form.editingId) return new Set<string>();
    const acc = new Set<string>();
    const stack = [form.editingId];
    while (stack.length) {
      const id = stack.pop()!;
      const kids = childrenByParent.get(id) ?? [];
      for (const k of kids) {
        if (!acc.has(k.id)) {
          acc.add(k.id);
          stack.push(k.id);
        }
      }
    }
    return acc;
  }, [form.editingId, childrenByParent]);

  // Flatten the tree for the parent <select>, with indented labels so the user
  // can see exactly where a new category will be nested.
  const parentOptions = useMemo(() => {
    if (activeKind === 'asset') return [];
    const out: { id: string; label: string }[] = [];
    const walk = (nodes: Category[], depth: number) => {
      for (const n of nodes) {
        if (n.id !== form.editingId && !descendantsOfEditing.has(n.id)) {
          out.push({
            id: n.id,
            label: `${'— '.repeat(depth)}${n.name}`,
          });
        }
        const kids = childrenByParent.get(n.id);
        if (kids && kids.length) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [activeKind, roots, childrenByParent, form.editingId, descendantsOfEditing]);

  if (!user) return null;

  const switchTab = (kind: CategoryKind) => {
    if (kind === activeKind) return;
    setActiveKind(kind);
    setForm(emptyForm);
  };

  const resetForm = () => setForm(emptyForm);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;

    const parentId = activeKind === 'asset' ? null : form.parentId;

    // Defense in depth: a client can't make a category its own ancestor.
    if (parentId && form.editingId && descendantsOfEditing.has(parentId)) {
      toast.error('نمی‌توان والدی انتخاب کرد که خودش زیرمجموعه‌ی این دسته است.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (form.editingId) {
        const { data, error } = await supabase
          .from('categories')
          .update({ name, color: form.color, parent_id: parentId })
          .eq('id', form.editingId)
          .select()
          .single();
        if (error) throw error;
        setCategories((prev) =>
          prev.map((c) => (c.id === form.editingId ? (data as Category) : c))
        );
      } else {
        const { data, error } = await supabase
          .from('categories')
          .insert([
            {
              user_id: user.id,
              name,
              color: form.color,
              kind: activeKind,
              parent_id: parentId,
            },
          ])
          .select()
          .single();
        if (error) throw error;
        setCategories((prev) => [...prev, data as Category]);
      }
      resetForm();
    } catch (err) {
      console.error(err);
      toast.error('خطا در ثبت دسته‌بندی.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (cat: Category) => {
    setForm({
      editingId: cat.id,
      name: cat.name,
      color: cat.color,
      parentId: cat.parent_id,
    });
  };

  const handleDelete = async (cat: Category) => {
    if (!window.confirm(DELETE_PROMPTS[cat.kind])) return;

    try {
      const { error } = await supabase
        .from('categories')
        .delete()
        .eq('id', cat.id);
      if (error) throw error;
      // DB cascades parent_id → null on direct children (and category_id →
      // null on transactions), so direct children become roots; grandchildren
      // keep their parent. Mirror that locally.
      setCategories((prev) =>
        prev
          .map((c) => (c.parent_id === cat.id ? { ...c, parent_id: null } : c))
          .filter((c) => c.id !== cat.id)
      );
      if (form.editingId === cat.id) resetForm();
    } catch (err) {
      console.error(err);
      toast.error('خطا در حذف.');
    }
  };

  const namePlaceholder =
    activeKind === 'asset'
      ? 'نام دسته (مثلا: خودرو)'
      : activeKind === 'income'
        ? 'نام دسته (مثلا: حقوق)'
        : 'نام دسته (مثلا: خوراک)';

  const submitLabel = isSubmitting
    ? 'در حال ثبت...'
    : form.editingId
      ? 'ثبت تغییرات'
      : 'افزودن دسته';

  return (
    <div className="bg-[#0F1015] min-h-full pb-10 animate-in slide-in-from-right-8 duration-300">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">
          مدیریت دسته‌بندی‌ها
        </h2>
      </div>

      <div className="px-6 pt-4">
        <div className="grid grid-cols-3 gap-2 bg-[#1A1B26] p-1 rounded-xl">
          {KIND_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                activeKind === t.id
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-6 border-b border-white/5 bg-[#1A1B26] mt-4 mx-6 rounded-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm text-slate-400">
            {form.editingId ? 'ویرایش دسته' : 'دسته جدید'}
          </h3>
          {form.editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-slate-500 hover:text-white flex items-center gap-1 text-xs"
            >
              <X size={14} /> انصراف
            </button>
          )}
        </div>

        <div className="space-y-4">
          <input
            type="text"
            placeholder={namePlaceholder}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-[#222436] border border-white/10 rounded-xl p-3 text-white text-sm outline-none focus:border-purple-500"
            required
            maxLength={64}
          />

          <div className="flex gap-2 justify-between">
            {CATEGORY_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setForm({ ...form, color: c })}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                style={{ backgroundColor: c }}
              >
                {form.color === c && (
                  <Check size={16} className="text-white/90" />
                )}
              </button>
            ))}
          </div>

          {activeKind !== 'asset' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                زیرمجموعه‌ی (اختیاری)
              </label>
              <div className="relative">
                <select
                  value={form.parentId ?? ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      parentId: e.target.value ? e.target.value : null,
                    })
                  }
                  className="w-full appearance-none bg-[#222436] border border-white/10 rounded-xl p-3 text-white text-sm outline-none focus:border-purple-500 pr-10"
                >
                  <option value="">— بدون والد (دسته اصلی) —</option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full text-white p-3 rounded-xl text-sm font-medium transition-colors ${
              form.editingId
                ? 'bg-purple-600 hover:bg-purple-500'
                : 'bg-white/10 hover:bg-white/20'
            } disabled:opacity-50`}
          >
            {submitLabel}
          </button>
        </div>
      </form>

      <div className="px-6 pt-6 space-y-2">
        {roots.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-6">
            هیچ دسته‌بندی ثبت نشده.
          </p>
        )}
        {roots.map((root) => (
          <CategoryNode
            key={root.id}
            category={root}
            depth={0}
            childrenByParent={childrenByParent}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}

interface CategoryNodeProps {
  category: Category;
  depth: number;
  childrenByParent: Map<string, Category[]>;
  onEdit: (c: Category) => void;
  onDelete: (c: Category) => void;
}

function CategoryNode({
  category,
  depth,
  childrenByParent,
  onEdit,
  onDelete,
}: CategoryNodeProps) {
  const kids = childrenByParent.get(category.id) ?? [];
  const compact = depth > 0;
  return (
    <div className="space-y-2">
      <div
        className={`bg-[#1A1B26] ${compact ? 'p-3' : 'p-4'} rounded-xl border border-white/5 flex items-center justify-between`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} rounded-full shrink-0`}
            style={{ backgroundColor: category.color }}
          />
          <span
            className={`text-slate-200 ${compact ? 'text-xs' : 'text-sm'} truncate`}
          >
            {category.name}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onEdit(category)}
            className="text-blue-400/50 hover:text-blue-400 p-1.5 transition-colors"
            aria-label="ویرایش"
          >
            <Edit3 size={compact ? 14 : 16} />
          </button>
          <button
            onClick={() => onDelete(category)}
            className="text-rose-400/50 hover:text-rose-400 p-1.5 transition-colors"
            aria-label="حذف"
          >
            <Trash2 size={compact ? 14 : 16} />
          </button>
        </div>
      </div>
      {kids.length > 0 && (
        <div className="pr-6 space-y-2 border-r border-white/5 mr-3">
          {kids.map((kid) => (
            <CategoryNode
              key={kid.id}
              category={kid}
              depth={depth + 1}
              childrenByParent={childrenByParent}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
