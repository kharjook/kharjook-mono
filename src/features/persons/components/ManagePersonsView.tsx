'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Edit3, Plus, Trash2, UserRound, X } from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import { useAuth, useData } from '@/features/portfolio/PortfolioProvider';
import { useToast } from '@/shared/components/Toast';
import type { Person } from '@/shared/types/domain';
import { calculatePersonBalance } from '@/shared/utils/calculate-person-balance';

export function ManagePersonsView() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { persons, transactions, setPersons } = useData();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const balances = useMemo(() => {
    const map = new Map<string, number>();
    for (const person of persons) {
      map.set(person.id, calculatePersonBalance(person, transactions));
    }
    return map;
  }, [persons, transactions]);

  if (!user) return null;

  const reset = () => {
    setEditingId(null);
    setName('');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('نام شخص الزامی است.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (editingId) {
        const { data, error } = await supabase
          .from('persons')
          .update({ name: trimmed })
          .eq('id', editingId)
          .select()
          .single();
        if (error) throw error;
        setPersons((prev) =>
          prev.map((p) => (p.id === editingId ? (data as Person) : p))
        );
        toast.success('شخص ویرایش شد.');
      } else {
        const nextOrder =
          persons.reduce(
            (max, p) => Math.max(max, Number.isFinite(p.order_index) ? Number(p.order_index) : -1),
            -1
          ) + 1;
        const { data, error } = await supabase
          .from('persons')
          .insert({ user_id: user.id, name: trimmed, order_index: nextOrder })
          .select()
          .single();
        if (error) throw error;
        setPersons((prev) => [...prev, data as Person]);
        toast.success('شخص ثبت شد.');
      }
      reset();
    } catch (error) {
      console.error(error);
      toast.error('خطا در ثبت شخص.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const reorderPersons = async (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const fromIndex = persons.findIndex((p) => p.id === fromId);
    const toIndex = persons.findIndex((p) => p.id === toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = persons.slice();
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    const normalized = next.map((p, i) => ({ ...p, order_index: i }));
    setPersons(normalized);
    const results = await Promise.all(
      normalized.map((p) =>
        supabase.from('persons').update({ order_index: p.order_index }).eq('id', p.id)
      )
    );
    const err = results.find((r) => r.error)?.error;
    if (err) {
      console.error(err);
      toast.error('ذخیره ترتیب اشخاص ناموفق بود.');
      const { data } = await supabase
        .from('persons')
        .select('*')
        .order('order_index', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (data) setPersons(data as Person[]);
    }
  };

  const handleEdit = (person: Person) => {
    setEditingId(person.id);
    setName(person.name);
  };

  const handleDelete = async (person: Person) => {
    const used = transactions.some(
      (tx) => tx.source_person_id === person.id || tx.target_person_id === person.id
    );
    if (used) {
      toast.error('این شخص در تراکنش‌ها استفاده شده و قابل حذف نیست.');
      return;
    }
    const ok = window.confirm('آیا از حذف این شخص مطمئن هستید؟');
    if (!ok) return;
    try {
      const { error } = await supabase.from('persons').delete().eq('id', person.id);
      if (error) throw error;
      setPersons((prev) => prev.filter((p) => p.id !== person.id));
      if (editingId === person.id) reset();
      toast.success('شخص حذف شد.');
    } catch (error) {
      console.error(error);
      toast.error('خطا در حذف شخص.');
    }
  };

  return (
    <div className="bg-[#0F1015] min-h-full pb-24 animate-in slide-in-from-right-8 duration-300">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">اشخاص</h2>
      </div>

      <form
        onSubmit={onSubmit}
        className="p-6 space-y-4 border-b border-white/5 bg-[#1A1B26]"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-purple-400">
            {editingId ? 'ویرایش شخص' : 'ثبت شخص جدید'}
          </h3>
          {editingId && (
            <button
              type="button"
              onClick={reset}
              className="text-slate-500 hover:text-white flex items-center gap-1 text-xs"
            >
              <X size={14} /> انصراف
            </button>
          )}
        </div>

        <input
          type="text"
          placeholder="نام شخص"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-[#222436] border border-white/5 rounded-xl p-3 text-white text-sm placeholder-slate-600 focus:border-purple-500 outline-none"
          required
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white p-3 rounded-xl font-bold transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          {isSubmitting ? 'در حال ثبت...' : editingId ? 'ثبت تغییرات' : 'ذخیره شخص'}
        </button>
      </form>

      <div className="p-6 space-y-3">
        <h3 className="text-sm font-semibold text-slate-400 mb-4">لیست اشخاص</h3>
        {persons.map((person) => {
          const balance = balances.get(person.id) ?? 0;
          const status =
            balance > 0 ? 'بدهکار' : balance < 0 ? 'بستانکار' : 'تسویه';
          const tone =
            balance > 0
              ? 'text-amber-300'
              : balance < 0
                ? 'text-cyan-300'
                : 'text-slate-400';
          return (
            <div
              key={person.id}
              draggable
              onDragStart={() => setDraggingId(person.id)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (draggingId) void reorderPersons(draggingId, person.id);
                setDraggingId(null);
              }}
              className={`bg-[#1A1B26] p-4 rounded-xl border flex items-center justify-between ${
                editingId === person.id ? 'border-purple-500/50 bg-purple-500/5' : 'border-white/5'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 text-cyan-300 flex items-center justify-center shrink-0">
                  <UserRound size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-slate-200 font-medium text-sm truncate">{person.name}</p>
                  <p className={`text-xs mt-1 ${tone}`} dir="ltr">
                    {status} · {Math.abs(balance).toLocaleString('en-US', { maximumFractionDigits: 6 })}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => handleEdit(person)}
                  className="text-blue-400/60 hover:text-blue-400 p-1.5 bg-blue-500/10 rounded-lg transition-colors"
                >
                  <Edit3 size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(person)}
                  className="text-rose-400/60 hover:text-rose-400 p-1.5 bg-rose-500/10 rounded-lg transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
        {persons.length === 0 && (
          <p className="text-center text-slate-500 text-sm">هنوز شخصی ثبت نشده.</p>
        )}
      </div>
    </div>
  );
}
