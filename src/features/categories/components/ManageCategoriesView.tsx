'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Edit3, Trash2, X } from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import type { Category } from '@/shared/types/domain';
import { useAuth, useData } from '@/features/portfolio/PortfolioProvider';
import { CATEGORY_COLORS } from '@/features/categories/constants/category-colors';

export function ManageCategoriesView() {
  const router = useRouter();
  const { user } = useAuth();
  const { categories, setCategories } = useData();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name) return;
    setIsSubmitting(true);

    try {
      if (editingId) {
        const { data, error } = await supabase
          .from('categories')
          .update({ name, color })
          .eq('id', editingId)
          .select()
          .single();
        if (error) throw error;
        setCategories((prev) => prev.map((c) => (c.id === editingId ? data : c)));
        resetForm();
      } else {
        const { data, error } = await supabase
          .from('categories')
          .insert([{ user_id: user.id, name, color }])
          .select()
          .single();

        if (error) throw error;
        setCategories((prev) => [...prev, data]);
        resetForm();
      }
    } catch (err) {
      alert('خطا در ثبت دسته بندی');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (cat: Category) => {
    setEditingId(cat.id);
    setName(cat.name);
    setColor(cat.color);
  };

  const resetForm = () => {
    setEditingId(null);
    setName('');
    setColor(CATEGORY_COLORS[0]);
  };

  const handleDelete = async (id: string) => {
    if (
      !window.confirm(
        'مطمئنی؟ با پاک کردن دسته، دارایی‌های مرتبط بی‌دسته میشن.'
      )
    )
      return;

    try {
      const { error } = await supabase.from('categories').delete().eq('id', id);
      if (error) throw error;
      setCategories((prev) => prev.filter((c) => c.id !== id));
    } catch {
      alert('خطا در حذف');
    }
  };

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

      <form
        onSubmit={handleSubmit}
        className="p-6 border-b border-white/5 bg-[#1A1B26]"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm text-slate-400">
            {editingId ? 'ویرایش دسته' : 'دسته جدید'}
          </h3>
          {editingId && (
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
          <div>
            <input
              type="text"
              placeholder="نام دسته (مثلا: خودرو)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#222436] border border-white/10 rounded-xl p-3 text-white text-sm outline-none focus:border-purple-500"
              required
            />
          </div>
          <div className="flex gap-2 justify-between">
            {CATEGORY_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                onClick={() => setColor(c)}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
                style={{ backgroundColor: c }}
              >
                {color === c && (
                  <Check size={16} className="text-white/90" />
                )}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full text-white p-3 rounded-xl text-sm font-medium transition-colors ${editingId ? 'bg-purple-600 hover:bg-purple-500' : 'bg-white/10 hover:bg-white/20'}`}
          >
            {isSubmitting
              ? 'در حال ثبت...'
              : editingId
                ? 'ثبت تغییرات'
                : 'افزودن دسته'}
          </button>
        </div>
      </form>

      <div className="p-6 space-y-3">
        {categories.map((c) => (
          <div
            key={c.id}
            className="bg-[#1A1B26] p-4 rounded-xl border border-white/5 flex items-center justify-between group"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: c.color }}
              ></div>
              <span className="text-slate-200 text-sm">{c.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleEdit(c)}
                className="text-blue-400/50 hover:text-blue-400 p-1.5 transition-colors"
              >
                <Edit3 size={16} />
              </button>
              <button
                onClick={() => handleDelete(c.id)}
                className="text-rose-400/50 hover:text-rose-400 p-1.5 transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        {categories.length === 0 && (
          <p className="text-center text-slate-500 text-sm">
            هیچ دسته‌بندی ثبت نشده.
          </p>
        )}
      </div>
    </div>
  );
}
