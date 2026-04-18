'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowRight, Edit3, Trash2, X } from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import type { Asset } from '@/shared/types/domain';
import { useAuth, useData } from '@/features/portfolio/PortfolioProvider';

export function ManageAssetsView() {
  const router = useRouter();
  const { user } = useAuth();
  const { categories, assets, setAssets } = useData();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    unit: '',
    categoryId: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.unit) return;
    setIsSubmitting(true);

    try {
      const payload = {
        category_id: formData.categoryId || null,
        name: formData.name,
        unit: formData.unit,
      };

      if (editingId) {
        const { data, error } = await supabase
          .from('assets')
          .update(payload)
          .eq('id', editingId)
          .select()
          .single();
        if (error) throw error;
        setAssets((prev) => prev.map((a) => (a.id === editingId ? data : a)));
        resetForm();
      } else {
        const { data, error } = await supabase
          .from('assets')
          .insert([
            { ...payload, user_id: user.id, price_toman: 0, price_usd: 0 },
          ])
          .select()
          .single();

        if (error) throw error;
        setAssets((prev) => [...prev, data]);
        resetForm();
      }
    } catch (err) {
      alert('خطا در ثبت دارایی');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (asset: Asset) => {
    setEditingId(asset.id);
    setFormData({
      name: asset.name,
      unit: asset.unit,
      categoryId: asset.category_id || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({ name: '', unit: '', categoryId: '' });
  };

  const handleDelete = async (id: string) => {
    const isConfirmed = window.confirm(
      '⚠️ هشدار جدی:\nبا پاک کردن این دارایی، تمام تراکنش‌های متصل به آن (خرید، فروش و...) برای همیشه پاک خواهند شد!\nآیا مطمئن هستید؟'
    );
    if (!isConfirmed) return;

    try {
      const { error } = await supabase.from('assets').delete().eq('id', id);
      if (error) throw error;
      setAssets((prev) => prev.filter((a) => a.id !== id));
      if (editingId === id) resetForm();
    } catch {
      alert('خطا در حذف دارایی');
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
        <h2 className="text-lg font-bold text-white flex-1">مدیریت دارایی‌ها</h2>
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-6 space-y-6 border-b border-white/5 bg-[#1A1B26]"
      >
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-purple-400">
            {editingId ? 'ویرایش دارایی' : 'تعریف دارایی جدید'}
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
            <label className="block text-xs text-slate-400 mb-2">
              دسته‌بندی (اختیاری)
            </label>
            <select
              value={formData.categoryId}
              onChange={(e) =>
                setFormData({ ...formData, categoryId: e.target.value })
              }
              className="w-full bg-[#222436] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none transition-all appearance-none"
            >
              <option value="">بدون دسته</option>
              {categories
                .filter((c) => c.kind === 'asset')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-2">
                نام دارایی
              </label>
              <input
                type="text"
                placeholder="مثلا: طلا"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full bg-[#222436] border border-white/5 rounded-xl p-3 text-white text-sm placeholder-slate-600 focus:border-purple-500 outline-none transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-2">واحد</label>
              <input
                type="text"
                placeholder="مثلا: گرم"
                value={formData.unit}
                onChange={(e) =>
                  setFormData({ ...formData, unit: e.target.value })
                }
                className="w-full bg-[#222436] border border-white/5 rounded-xl p-3 text-white text-sm placeholder-slate-600 focus:border-purple-500 outline-none transition-all"
                required
              />
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full text-white p-3 rounded-xl font-bold transition-all disabled:opacity-50 ${editingId ? 'bg-purple-600 hover:bg-purple-500 shadow-[0_4px_20px_rgba(147,51,234,0.3)]' : 'bg-white/10 hover:bg-white/20'}`}
        >
          {isSubmitting
            ? 'در حال ثبت...'
            : editingId
              ? 'ثبت تغییرات'
              : 'ذخیره دارایی'}
        </button>
      </form>

      <div className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-slate-400 mb-4">
          دارایی‌های تعریف شده
        </h3>
        {assets.map((asset) => {
          const cat = categories.find((c) => c.id === asset.category_id);
          const color = cat ? cat.color : '#64748b';

          return (
            <div
              key={asset.id}
              className={`bg-[#1A1B26] p-4 rounded-xl border flex items-center justify-between transition-colors ${editingId === asset.id ? 'border-purple-500/50 bg-purple-500/5' : 'border-white/5'}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${color}20`, color: color }}
                >
                  <Activity size={18} />
                </div>
                <div>
                  <p className="text-slate-200 font-medium text-sm">
                    {asset.name}
                  </p>
                  <p className="text-slate-500 text-xs mt-1">
                    {cat ? cat.name : 'بدون دسته'} • {asset.unit}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => handleEdit(asset)}
                  className="text-blue-400/60 hover:text-blue-400 p-1.5 bg-blue-500/10 rounded-lg transition-colors"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  onClick={() => handleDelete(asset.id)}
                  className="text-rose-400/60 hover:text-rose-400 p-1.5 bg-rose-500/10 rounded-lg transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {assets.length === 0 && (
          <p className="text-center text-slate-500 text-sm">
            هیچ دارایی ثبت نشده.
          </p>
        )}
      </div>
    </div>
  );
}
