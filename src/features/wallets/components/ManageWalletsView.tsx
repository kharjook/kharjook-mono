'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, ArrowRight, Edit3, GripVertical, Wallet as WalletIcon, X } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EntityIcon } from '@/shared/components/EntityIcon';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { IconPicker } from '@/shared/components/IconPicker';
import { useToast } from '@/shared/components/Toast';
import { formatCurrencyAmount } from '@/shared/utils/format-currency';
import { runOptimisticMutation } from '@/shared/utils/optimistic-mutation';
import { haptic } from '@/shared/utils/haptics';
import { supabase } from '@/shared/lib/supabase/client';
import type { Currency, Wallet } from '@/shared/types/domain';
import { useAuth, useData } from '@/features/portfolio/PortfolioProvider';
import {
  CURRENCY_META,
  CURRENCY_ORDER,
} from '@/features/wallets/constants/currency-meta';

type FormState = {
  editingId: string | null;
  name: string;
  currency: Currency;
  initialBalance: string;
  iconUrl: string | null;
};

const emptyForm: FormState = {
  editingId: null,
  name: '',
  currency: 'IRT',
  initialBalance: '',
  iconUrl: null,
};

export function ManageWalletsView() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { wallets, setWallets } = useData();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [pendingWalletIds, setPendingWalletIds] = useState<Set<string>>(new Set());

  if (!user) return null;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 8 } })
  );

  const resetForm = () => setForm(emptyForm);

  const handleEdit = (w: Wallet) => {
    setForm({
      editingId: w.id,
      name: w.name,
      currency: w.currency,
      initialBalance: String(w.initial_balance ?? ''),
      iconUrl: w.icon_url ?? null,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const initial = Number(form.initialBalance || '0');
    if (!name || Number.isNaN(initial)) return;

    const execute = async () => {
      if (form.editingId) {
        const editingId = form.editingId;
        const snapshot = wallets;
        const patch = {
          name,
          initial_balance: initial,
          icon_url: form.iconUrl,
        };
        // Currency is intentionally immutable post-creation: changing it would
        // silently alter the meaning of every transaction touching this wallet.
        await runOptimisticMutation({
          snapshot,
          applyOptimistic: () => {
            setPendingWalletIds((prev) => new Set(prev).add(editingId));
            setWallets((prev) =>
              prev.map((w) =>
                w.id === editingId ? { ...w, ...patch } : w
              )
            );
          },
          rollback: (prev) => {
            setPendingWalletIds((p) => {
              const next = new Set(p);
              next.delete(editingId);
              return next;
            });
            setWallets(prev);
          },
          commit: async () => {
            const { data, error } = await supabase
              .from('wallets')
              .update(patch)
              .eq('id', editingId)
              .select()
              .single();
            if (error) throw error;
            return data as Wallet;
          },
          onSuccess: (saved) => {
            setPendingWalletIds((p) => {
              const next = new Set(p);
              next.delete(editingId);
              return next;
            });
            setWallets((prev) =>
              prev.map((w) => (w.id === editingId ? saved : w))
            );
          },
        });
      } else {
        const nextOrder =
          wallets.reduce(
            (max, w) => Math.max(max, Number.isFinite(w.order_index) ? Number(w.order_index) : -1),
            -1
          ) + 1;
        const snapshot = wallets;
        const tempId = `temp-wallet-${crypto.randomUUID()}`;
        const optimisticWallet: Wallet = {
          id: tempId,
          user_id: user.id,
          name,
          currency: form.currency,
          initial_balance: initial,
          icon_url: form.iconUrl,
          archived_at: null,
          order_index: nextOrder,
          created_at: new Date().toISOString(),
        };
        await runOptimisticMutation({
          snapshot,
          applyOptimistic: () => {
            setPendingWalletIds((prev) => new Set(prev).add(tempId));
            setWallets((prev) => [...prev, optimisticWallet]);
          },
          rollback: (prev) => {
            setPendingWalletIds((p) => {
              const next = new Set(p);
              next.delete(tempId);
              return next;
            });
            setWallets(prev);
          },
          commit: async () => {
            const { data, error } = await supabase
              .from('wallets')
              .insert([
                {
                  user_id: user.id,
                  name,
                  currency: form.currency,
                  initial_balance: initial,
                  icon_url: form.iconUrl,
                  order_index: nextOrder,
                },
              ])
              .select()
              .single();
            if (error) throw error;
            return data as Wallet;
          },
          onSuccess: (saved) => {
            setPendingWalletIds((p) => {
              const next = new Set(p);
              next.delete(tempId);
              return next;
            });
            setWallets((prev) =>
              prev.map((w) => (w.id === tempId ? saved : w))
            );
          },
        });
      }
      resetForm();
    };

    setIsSubmitting(true);
    try {
      await execute();
    } catch (err) {
      console.error(err);
      toast.error('خطا در ثبت کیف پول.', {
        action: { label: 'تلاش مجدد', onClick: () => void execute() },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const persistWalletOrder = async (ordered: Wallet[]) => {
    const normalized = ordered.map((w, i) => ({ ...w, order_index: i }));
    const updates = normalized.map((w) =>
      supabase.from('wallets').update({ order_index: w.order_index }).eq('id', w.id)
    );
    const results = await Promise.all(updates);
    const err = results.find((r) => r.error)?.error;
    if (err) {
      console.error(err);
      toast.error('ذخیره ترتیب کیف پول‌ها ناموفق بود.');
      const { data } = await supabase
        .from('wallets')
        .select('*')
        .is('archived_at', null)
        .order('order_index', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true });
      if (data) setWallets(data as Wallet[]);
    }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    haptic('selection');
    setWallets((prev) => {
      const fromIndex = prev.findIndex((w) => w.id === active.id);
      const toIndex = prev.findIndex((w) => w.id === over.id);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const reordered = arrayMove(prev, fromIndex, toIndex);
      void persistWalletOrder(reordered);
      return reordered;
    });
  };

  const onDragStart = (_event: DragStartEvent) => {
    haptic('light');
  };

  const handleArchive = async (w: Wallet) => {
    if (
      !window.confirm(
        `«${w.name}» بایگانی می‌شود و دیگر در فهرست‌ها نمایش داده نمی‌شود. تراکنش‌های قبلی دست‌نخورده باقی می‌ماند. ادامه می‌دهی؟`
      )
    )
      return;

    const execute = async () => {
      const snapshot = wallets;
      setArchivingId(w.id);
      setPendingWalletIds((prev) => new Set(prev).add(w.id));
      await runOptimisticMutation({
        snapshot,
        applyOptimistic: () => {
          setWallets((prev) => prev.filter((x) => x.id !== w.id));
        },
        rollback: (prev) => {
          setPendingWalletIds((p) => {
            const next = new Set(p);
            next.delete(w.id);
            return next;
          });
          setWallets(prev);
        },
        commit: async () => {
          const { error } = await supabase
            .from('wallets')
            .update({ archived_at: new Date().toISOString() })
            .eq('id', w.id);
          if (error) throw error;
        },
        onSuccess: () => {
          setPendingWalletIds((p) => {
            const next = new Set(p);
            next.delete(w.id);
            return next;
          });
        },
      });
      if (form.editingId === w.id) resetForm();
    };

    try {
      await execute();
    } catch (err) {
      console.error(err);
      toast.error('خطا در بایگانی.', {
        action: { label: 'تلاش مجدد', onClick: () => void execute() },
      });
    } finally {
      setPendingWalletIds((p) => {
        const next = new Set(p);
        next.delete(w.id);
        return next;
      });
      setArchivingId(null);
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
        <h2 className="text-lg font-bold text-white flex-1">مدیریت کیف پول‌ها</h2>
      </div>

      <form
        onSubmit={handleSubmit}
        className="p-6 mt-4 mx-6 rounded-2xl border border-white/5 bg-[#1A1B26]"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm text-slate-400">
            {form.editingId ? 'ویرایش کیف پول' : 'کیف پول جدید'}
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
          <IconPicker
            value={form.iconUrl}
            onChange={(url) => setForm({ ...form, iconUrl: url })}
            userId={user.id}
            folder="wallets"
            fallback={<WalletIcon size={22} className="text-purple-300" />}
            bgColor="rgba(168, 85, 247, 0.12)"
            label="آیکون (اختیاری)"
          />

          <div>
            <label className="block text-xs text-slate-400 mb-1">نام</label>
            <input
              type="text"
              placeholder="مثلا: ملی، صرافی نوبیتکس، نقد دلاری"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full bg-[#222436] border border-white/10 rounded-xl p-3 text-white text-sm outline-none focus:border-purple-500"
              required
              maxLength={64}
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">ارز</label>
            <div className="grid grid-cols-5 gap-2">
              {CURRENCY_ORDER.map((c) => {
                const meta = CURRENCY_META[c];
                const selected = form.currency === c;
                const disabled = form.editingId !== null && !selected;
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={disabled}
                    onClick={() => setForm({ ...form, currency: c })}
                    className={`p-2 rounded-xl border text-xs font-bold transition-all ${
                      selected
                        ? 'bg-purple-600 border-purple-500 text-white'
                        : 'bg-[#222436] border-white/10 text-slate-300 hover:bg-[#2a2c40]'
                    } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
                  >
                    <div className="text-base leading-none" dir="ltr">
                      {meta.symbol}
                    </div>
                    <div className="mt-1 text-[10px] opacity-80">{c}</div>
                  </button>
                );
              })}
            </div>
            {form.editingId && (
              <p className="text-[11px] text-slate-500 mt-1">
                ارز پس از ساخت قابل تغییر نیست.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              موجودی اولیه ({CURRENCY_META[form.currency].label})
            </label>
            <FormattedNumberInput
              value={form.initialBalance}
              onValueChange={(canonical) =>
                setForm({ ...form, initialBalance: canonical })
              }
              className="w-full bg-[#222436] border border-white/10 rounded-xl p-3 text-white text-sm  outline-none focus:border-purple-500 text-left"
              dir="ltr"
              placeholder="0"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full text-white p-3 rounded-xl text-sm font-medium transition-colors ${
              form.editingId
                ? 'bg-purple-600 hover:bg-purple-500'
                : 'bg-white/10 hover:bg-white/20'
            } disabled:opacity-50`}
          >
            {isSubmitting
              ? 'در حال ثبت...'
              : form.editingId
                ? 'ثبت تغییرات'
                : 'افزودن کیف پول'}
          </button>
        </div>
      </form>

      <div className="px-6 pt-6 space-y-3">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={wallets.map((w) => w.id)} strategy={verticalListSortingStrategy}>
            {wallets.map((w) => {
          const meta = CURRENCY_META[w.currency];
          return (
            <SortableWalletRow
              key={w.id}
              wallet={w}
              metaLabel={meta}
              onEdit={() => handleEdit(w)}
              onArchive={() => handleArchive(w)}
              archiving={archivingId === w.id}
              pending={pendingWalletIds.has(w.id)}
            />
          );
            })}
          </SortableContext>
        </DndContext>
        {wallets.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-6">
            هنوز کیف پولی نساخته‌ای.
          </p>
        )}
      </div>
    </div>
  );
}

function SortableWalletRow({
  wallet,
  metaLabel,
  onEdit,
  onArchive,
  archiving,
  pending,
}: {
  wallet: Wallet;
  metaLabel: { symbol: string; decimals: number };
  onEdit: () => void;
  onArchive: () => void;
  archiving: boolean;
  pending: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: wallet.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-[#1A1B26] p-4 rounded-2xl border border-white/5 flex items-center justify-between ${isDragging ? 'opacity-70 shadow-lg ring-1 ring-purple-400/30' : ''} ${pending ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          {...attributes}
          {...listeners}
          style={{ touchAction: 'none' }}
          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-500 hover:text-slate-300 cursor-grab active:cursor-grabbing"
          aria-label="جابجایی"
        >
          <GripVertical size={16} />
        </button>
        <EntityIcon
          iconUrl={wallet.icon_url}
          fallback={<WalletIcon size={18} />}
          bgColor="rgba(168, 85, 247, 0.10)"
          color="#c084fc"
          className="w-10 h-10 shrink-0"
        />
        <div className="min-w-0">
          <p className="text-slate-200 text-sm font-medium truncate">{wallet.name}</p>
          <p className="text-slate-500 text-xs mt-0.5" dir="ltr">
            {metaLabel.symbol} {formatCurrencyAmount(wallet.initial_balance, wallet.currency)} · {wallet.currency}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onEdit}
          disabled={pending}
          className="text-blue-400/50 hover:text-blue-400 p-1.5 transition-colors"
          aria-label="ویرایش"
        >
          <Edit3 size={16} />
        </button>
        <button
          onClick={onArchive}
          disabled={archiving || pending}
          className="text-amber-400/50 hover:text-amber-400 p-1.5 transition-colors disabled:opacity-30"
          aria-label="بایگانی"
        >
          <Archive size={16} />
        </button>
      </div>
    </div>
  );
}
