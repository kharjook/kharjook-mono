'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowRight,
  ChevronLeft,
  Edit3,
  Folder,
  Link2,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import type { Asset } from '@/shared/types/domain';
import { useAuth, useData } from '@/features/portfolio/PortfolioProvider';
import { CategorySheetPicker } from '@/shared/components/CategorySheetPicker';
import { EntityIcon } from '@/shared/components/EntityIcon';
import { IconPicker } from '@/shared/components/IconPicker';
import {
  ListSheetPicker,
  type ListSheetPickerItem,
} from '@/shared/components/ListSheetPicker';
import { useToast } from '@/shared/components/Toast';
import {
  PRICE_SOURCES,
  findPriceSource,
} from '@/features/prices/constants/price-sources';

export function ManageAssetsView() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { categories, assets, setAssets } = useData();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    unit: '',
    categoryId: '',
    iconUrl: null as string | null,
    priceSourceId: '' as string,
    includeInProfitLoss: true,
    includeInBalance: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [priceSourcePickerOpen, setPriceSourcePickerOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const selectedCategory = useMemo(
    () =>
      formData.categoryId
        ? categories.find((c) => c.id === formData.categoryId) ?? null
        : null,
    [categories, formData.categoryId]
  );

  const priceSourceItems = useMemo<ListSheetPickerItem[]>(() => {
    const base: ListSheetPickerItem[] = PRICE_SOURCES.filter(
      (s) => !s.deprecated
    ).map((s) => ({
      id: s.slug,
      label: s.label,
      sublabel: s.slug,
      leading: <Link2 size={14} />,
    }));

    // Preserve the currently-bound slug even if it's no longer in the catalog,
    // so editing never silently drops the binding when a source is removed.
    if (
      formData.priceSourceId &&
      !findPriceSource(formData.priceSourceId)
    ) {
      base.push({
        id: formData.priceSourceId,
        label: formData.priceSourceId,
        sublabel: 'نامعتبر — ممکن است از کاتالوگ حذف شده باشد',
        leading: <Link2 size={14} />,
      });
    }
    return base;
  }, [formData.priceSourceId]);

  const selectedPriceSource = findPriceSource(formData.priceSourceId);
  const selectedPriceSourceLabel = selectedPriceSource
    ? selectedPriceSource.label
    : formData.priceSourceId
      ? `${formData.priceSourceId} (نامعتبر)`
      : null;

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
        icon_url: formData.iconUrl,
        price_source_id: formData.priceSourceId || null,
        include_in_profit_loss: formData.includeInProfitLoss,
        include_in_balance: formData.includeInBalance,
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
        const nextOrder =
          assets.reduce(
            (max, a) => Math.max(max, Number.isFinite(a.order_index) ? Number(a.order_index) : -1),
            -1
          ) + 1;
        const { data, error } = await supabase
          .from('assets')
          .insert([
            { ...payload, user_id: user.id, price_toman: 0, price_usd: 0, order_index: nextOrder },
          ])
          .select()
          .single();

        if (error) throw error;
        setAssets((prev) => [...prev, data]);
        resetForm();
      }
    } catch (err) {
      toast.error('خطا در ثبت دارایی.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const reorderAssets = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const fromIndex = assets.findIndex((a) => a.id === fromId);
    const toIndex = assets.findIndex((a) => a.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = assets.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const normalized = next.map((a, i) => ({ ...a, order_index: i }));
    setAssets(normalized);
    const results = await Promise.all(
      normalized.map((a) =>
        supabase.from('assets').update({ order_index: a.order_index }).eq('id', a.id)
      )
    );
    const err = results.find((r) => r.error)?.error;
    if (err) {
      console.error(err);
      toast.error('ذخیره ترتیب دارایی‌ها ناموفق بود.');
      const { data } = await supabase
        .from('assets')
        .select('*')
        .order('order_index', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (data) setAssets(data as Asset[]);
    }
  };

  const handleEdit = (asset: Asset) => {
    setEditingId(asset.id);
    setFormData({
      name: asset.name,
      unit: asset.unit,
      categoryId: asset.category_id || '',
      iconUrl: asset.icon_url ?? null,
      priceSourceId: asset.price_source_id ?? '',
      includeInProfitLoss: asset.include_in_profit_loss ?? true,
      includeInBalance: asset.include_in_balance ?? true,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditingId(null);
    setFormData({
      name: '',
      unit: '',
      categoryId: '',
      iconUrl: null,
      priceSourceId: '',
      includeInProfitLoss: true,
      includeInBalance: true,
    });
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
      toast.error('خطا در حذف دارایی.');
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
          <IconPicker
            value={formData.iconUrl}
            onChange={(url) => setFormData({ ...formData, iconUrl: url })}
            userId={user.id}
            folder="assets"
            fallback={<Activity size={22} className="text-slate-400" />}
            label="آیکون (اختیاری)"
          />

          <div>
            <label className="block text-xs text-slate-400 mb-2">
              دسته‌بندی (اختیاری)
            </label>
            <button
              type="button"
              onClick={() => setCategoryPickerOpen(true)}
              className="w-full flex items-center gap-3 bg-[#222436] border border-white/5 rounded-xl p-3 text-right hover:bg-[#2a2c40] transition-colors"
            >
              {selectedCategory ? (
                <>
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: selectedCategory.color }}
                  />
                  <span className="flex-1 min-w-0 text-sm text-white truncate">
                    {selectedCategory.name}
                  </span>
                </>
              ) : (
                <>
                  <Folder size={14} className="text-slate-500 shrink-0" />
                  <span className="flex-1 min-w-0 text-sm text-slate-500">
                    بدون دسته
                  </span>
                </>
              )}
              <ChevronLeft size={16} className="text-slate-500 shrink-0" />
            </button>
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

          <div>
            <label className="block text-xs text-slate-400 mb-2">
              منبع قیمت (اختیاری)
            </label>
            <button
              type="button"
              onClick={() => setPriceSourcePickerOpen(true)}
              className="w-full flex items-center gap-3 bg-[#222436] border border-white/5 rounded-xl p-3 text-right hover:bg-[#2a2c40] transition-colors"
            >
              {selectedPriceSourceLabel ? (
                <>
                  <Link2
                    size={14}
                    className={`shrink-0 ${
                      selectedPriceSource
                        ? 'text-purple-300'
                        : 'text-amber-400'
                    }`}
                  />
                  <span className="flex-1 min-w-0 text-sm text-white truncate">
                    {selectedPriceSourceLabel}
                  </span>
                </>
              ) : (
                <>
                  <Link2 size={14} className="text-slate-500 shrink-0" />
                  <span className="flex-1 min-w-0 text-sm text-slate-500">
                    دستی (بدون منبع)
                  </span>
                </>
              )}
              <ChevronLeft size={16} className="text-slate-500 shrink-0" />
            </button>
            <p className="text-[11px] text-slate-500 mt-1">
              در صورت انتخاب، قیمت از این منبع در صفحهٔ قیمت‌ها قابل به‌روزرسانی خواهد بود.
            </p>
          </div>

          <label className="flex items-center justify-between bg-[#222436] border border-white/5 rounded-xl p-3 cursor-pointer">
            <div>
              <p className="text-sm text-slate-200">شامل در ارزش کل سبد</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                خاموش: در جمع «ارزش کل سبد» و نمودار پراکندگی داشبورد لحاظ نمی‌شود
              </p>
            </div>
            <input
              type="checkbox"
              checked={formData.includeInBalance}
              onChange={(e) =>
                setFormData({ ...formData, includeInBalance: e.target.checked })
              }
              className="accent-purple-600 w-4 h-4"
            />
          </label>

          <label className="flex items-center justify-between bg-[#222436] border border-white/5 rounded-xl p-3 cursor-pointer">
            <div>
              <p className="text-sm text-slate-200">شامل در سود/زیان</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                خاموش: در گزارش سود/زیان لحاظ نمی‌شود؛ ارزش فعلی در صفحهٔ دارایی
                همان است مگر «ارزش کل سبد» هم خاموش باشد.
              </p>
            </div>
            <input
              type="checkbox"
              checked={formData.includeInProfitLoss}
              onChange={(e) =>
                setFormData({ ...formData, includeInProfitLoss: e.target.checked })
              }
              className="accent-purple-600 w-4 h-4"
            />
          </label>
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
          const source = findPriceSource(asset.price_source_id);

          return (
            <div
              key={asset.id}
              draggable
              onDragStart={() => setDraggingId(asset.id)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (draggingId) void reorderAssets(draggingId, asset.id);
                setDraggingId(null);
              }}
              className={`bg-[#1A1B26] p-4 rounded-xl border flex items-center justify-between transition-colors ${editingId === asset.id ? 'border-purple-500/50 bg-purple-500/5' : 'border-white/5'}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <EntityIcon
                  iconUrl={asset.icon_url}
                  fallback={<Activity size={18} />}
                  bgColor={`${color}20`}
                  color={color}
                  className="w-10 h-10 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-slate-200 font-medium text-sm truncate">
                    {asset.name}
                  </p>
                  <p className="text-slate-500 text-xs mt-1 truncate">
                    {cat ? cat.name : 'بدون دسته'} • {asset.unit}
                  </p>
                  {asset.include_in_balance === false && (
                    <span className="inline-block mt-1.5 text-[10px] text-sky-300/90 bg-sky-500/10 border border-sky-500/20 rounded-full px-2 py-0.5">
                      خارج از ارزش کل سبد
                    </span>
                  )}
                  {asset.include_in_profit_loss === false && (
                    <span className="inline-block mt-1.5 text-[10px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
                      خارج از سود/زیان
                    </span>
                  )}
                  {source && (
                    <span className="inline-block mt-1.5 text-[10px] text-purple-300/80 bg-purple-500/10 border border-purple-500/20 rounded-full px-2 py-0.5">
                      {source.label}
                    </span>
                  )}
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

      <CategorySheetPicker
        open={categoryPickerOpen}
        onClose={() => setCategoryPickerOpen(false)}
        title="انتخاب دسته‌بندی دارایی"
        kind="asset"
        categories={categories}
        value={formData.categoryId || null}
        onSelect={(id) =>
          setFormData({ ...formData, categoryId: id ?? '' })
        }
        allowNone
        noneLabel="بدون دسته"
      />

      <ListSheetPicker
        open={priceSourcePickerOpen}
        onClose={() => setPriceSourcePickerOpen(false)}
        title="انتخاب منبع قیمت"
        items={priceSourceItems}
        value={formData.priceSourceId || null}
        onSelect={(id) =>
          setFormData({ ...formData, priceSourceId: id ?? '' })
        }
        allowNone
        noneLabel="دستی (بدون منبع)"
        noneLeading={<Link2 size={14} />}
        emptyLabel="منبع قیمتی پیکربندی نشده."
      />
    </div>
  );
}
