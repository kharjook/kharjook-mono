'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowRight,
  ChevronDown,
  Edit3,
  Folder,
  Percent,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '@/shared/lib/supabase/client';
import type { Goal, GoalScope, GoalTargetKind } from '@/shared/types/domain';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import {
  ListSheetPicker,
  type ListSheetPickerItem,
} from '@/shared/components/ListSheetPicker';
import { CategorySheetPicker } from '@/shared/components/CategorySheetPicker';
import { useToast } from '@/shared/components/Toast';
import { runOptimisticMutation } from '@/shared/utils/optimistic-mutation';
import {
  buildAssetSnapshots,
  calculateAssetGoalProgress,
  calculateGroupGoalProgress,
  totalSnapshotValueToman,
  type GoalProgress,
} from '@/features/goals/utils/goal-progress';
import { GoalProgressDisplay } from '@/features/goals/components/GoalProgressDisplay';
import { goalValueKindFromGoal } from '@/features/goals/utils/goal-progress-display';

type FormState = {
  editingId: string | null;
  scope: GoalScope;
  assetId: string;
  categoryId: string;
  targetKind: GoalTargetKind;
  targetValue: string;
};

const emptyForm: FormState = {
  editingId: null,
  scope: 'asset',
  assetId: '',
  categoryId: '',
  targetKind: 'allocation_percent',
  targetValue: '',
};

function toPositiveNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function makeGoalPayload(userId: string, form: FormState) {
  const target = toPositiveNumber(form.targetValue);
  const targetKind = form.scope === 'asset_group' ? 'allocation_percent' : form.targetKind;
  return {
    user_id: userId,
    scope: form.scope,
    asset_id: form.scope === 'asset' ? form.assetId : null,
    category_id: form.scope === 'asset_group' ? form.categoryId : null,
    target_kind: targetKind,
    target_quantity: targetKind === 'quantity' ? target : null,
    target_percent: targetKind === 'allocation_percent' ? target : null,
  };
}

export function ManageGoalsView() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const { assets, categories, transactions, goals, setGoals } = useData();
  const { currencyMode, usdRate } = useUI();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [pendingGoalIds, setPendingGoalIds] = useState<Set<string>>(new Set());

  const assetItems = useMemo<ListSheetPickerItem[]>(
    () =>
      assets.map((asset) => ({
        id: asset.id,
        label: asset.name,
        sublabel: asset.unit,
        leading: <Activity size={14} />,
      })),
    [assets]
  );

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const categoryById = useMemo(
    () => new Map(categories.filter((c) => c.kind === 'asset').map((c) => [c.id, c])),
    [categories]
  );

  const snapshots = useMemo(
    () => buildAssetSnapshots(assets, transactions, currencyMode, usdRate),
    [assets, transactions, currencyMode, usdRate]
  );
  const totalValueToman = useMemo(() => totalSnapshotValueToman(snapshots), [snapshots]);

  const sortedGoals = useMemo(() => {
    return [...goals].sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === 'asset_group' ? -1 : 1;
      return (a.created_at ?? '').localeCompare(b.created_at ?? '');
    });
  }, [goals]);

  const userId = user?.id ?? '';
  const selectedAsset = form.assetId ? assetById.get(form.assetId) ?? null : null;
  const selectedCategory = form.categoryId ? categoryById.get(form.categoryId) ?? null : null;
  const effectiveTargetKind =
    form.scope === 'asset_group' ? 'allocation_percent' : form.targetKind;
  const targetNumber = toPositiveNumber(form.targetValue);
  const percentInvalid =
    effectiveTargetKind === 'allocation_percent' && (targetNumber <= 0 || targetNumber > 100);
  const quantityInvalid = effectiveTargetKind === 'quantity' && targetNumber <= 0;
  const targetInvalid = percentInvalid || quantityInvalid;
  const targetMissing = form.scope === 'asset' ? !form.assetId : !form.categoryId;
  const budgetValidation = useMemo(() => {
    const nextGoals = goals.filter((goal) => goal.id !== form.editingId);
    const shouldIncludeDraft =
      !!userId &&
      !targetMissing &&
      !targetInvalid &&
      effectiveTargetKind === 'allocation_percent';
    if (shouldIncludeDraft) {
      nextGoals.push({
        id: form.editingId ?? '__draft__',
        user_id: userId,
        scope: form.scope,
        asset_id: form.scope === 'asset' ? form.assetId : null,
        category_id: form.scope === 'asset_group' ? form.categoryId : null,
        target_kind: 'allocation_percent',
        target_quantity: null,
        target_percent: targetNumber,
        created_at: undefined,
        updated_at: undefined,
      });
    }

    const parentGoals = nextGoals.filter(
      (goal) => goal.scope === 'asset_group' && goal.target_kind === 'allocation_percent'
    );
    const childGoals = nextGoals.filter(
      (goal) => goal.scope === 'asset' && goal.target_kind === 'allocation_percent'
    );

    const parentSum = parentGoals.reduce(
      (sum, goal) => sum + Number(goal.target_percent ?? 0),
      0
    );
    const childSum = childGoals.reduce(
      (sum, goal) => sum + Number(goal.target_percent ?? 0),
      0
    );

    const childSumByCategory = new Map<string, number>();
    childGoals.forEach((goal) => {
      const categoryId = goal.asset_id ? assetById.get(goal.asset_id)?.category_id : null;
      if (!categoryId) return;
      childSumByCategory.set(
        categoryId,
        (childSumByCategory.get(categoryId) ?? 0) + Number(goal.target_percent ?? 0)
      );
    });

    const parentByCategory = new Map<string, number>();
    parentGoals.forEach((goal) => {
      if (!goal.category_id) return;
      parentByCategory.set(goal.category_id, Number(goal.target_percent ?? 0));
    });

    const issues: string[] = [];
    if (parentSum > 100.0001) {
      issues.push(
        `جمع درصد هدف‌های گروهی ${parentSum.toFixed(1)}% است و نباید از 100% بیشتر شود.`
      );
    }
    if (childSum > 100.0001) {
      issues.push(
        `جمع درصد هدف‌های دارایی ${childSum.toFixed(1)}% است و نباید از 100% بیشتر شود.`
      );
    }
    childSumByCategory.forEach((sum, categoryId) => {
      const parentTarget = parentByCategory.get(categoryId);
      if (parentTarget == null) return;
      if (sum > parentTarget + 0.0001) {
        const categoryName = categoryById.get(categoryId)?.name ?? 'گروه';
        issues.push(
          `در گروه «${categoryName}»، مجموع درصد فرزندها ${sum.toFixed(1)}% از هدف گروه (${parentTarget.toFixed(1)}%) بیشتر است.`
        );
      }
    });

    return {
      blocking: issues.length > 0,
      issues,
      parentSum,
      childSum,
      categoryRows: Array.from(
        new Set([...childSumByCategory.keys(), ...parentByCategory.keys()])
      )
        .map((categoryId) => {
          const parentTarget = parentByCategory.get(categoryId) ?? null;
          const childrenSum = childSumByCategory.get(categoryId) ?? 0;
          const categoryName = categoryById.get(categoryId)?.name ?? 'گروه';
          return {
            categoryId,
            categoryName,
            parentTarget,
            childrenSum,
            remainingToParent:
              parentTarget == null ? null : Math.max(0, parentTarget - childrenSum),
          };
        })
        .sort((a, b) => {
          const aTarget = a.parentTarget ?? -1;
          const bTarget = b.parentTarget ?? -1;
          return bTarget - aTarget;
        }),
    };
  }, [
    goals,
    form,
    targetMissing,
    targetInvalid,
    effectiveTargetKind,
    targetNumber,
    userId,
    assetById,
    categoryById,
  ]);

  const canSubmit =
    !isSubmitting &&
    !targetMissing &&
    !targetInvalid &&
    !budgetValidation.blocking;

  const switchScope = (scope: GoalScope) => {
    setForm({
      ...emptyForm,
      scope,
      targetKind: scope === 'asset_group' ? 'allocation_percent' : 'allocation_percent',
    });
  };

  const resetForm = () => setForm(emptyForm);

  const duplicateGoal = () => {
    const targetKind = effectiveTargetKind;
    return goals.find((goal) => {
      if (goal.id === form.editingId) return false;
      if (goal.scope !== form.scope || goal.target_kind !== targetKind) return false;
      if (form.scope === 'asset') return goal.asset_id === form.assetId;
      return goal.category_id === form.categoryId;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!canSubmit) return;
    if (budgetValidation.blocking) {
      toast.error(budgetValidation.issues[0] ?? 'ترکیب هدف‌ها معتبر نیست.');
      return;
    }
    if (duplicateGoal()) {
      toast.error('برای این مورد قبلا هدفی با همین نوع ثبت شده است.');
      return;
    }

    const execute = async () => {
      const payload = makeGoalPayload(user.id, form);
      if (form.editingId) {
        const editingId = form.editingId;
        const snapshot = goals;
        await runOptimisticMutation({
          snapshot,
          applyOptimistic: () => {
            setPendingGoalIds((prev) => new Set(prev).add(editingId));
            setGoals((prev) =>
              prev.map((goal) => (goal.id === editingId ? { ...goal, ...payload } : goal))
            );
          },
          rollback: (prev) => {
            setPendingGoalIds((p) => {
              const next = new Set(p);
              next.delete(editingId);
              return next;
            });
            setGoals(prev);
          },
          commit: async () => {
            const { data, error } = await supabase
              .from('goals')
              .update(payload)
              .eq('id', editingId)
              .select()
              .single();
            if (error) throw error;
            return data as Goal;
          },
          onSuccess: (saved) => {
            setPendingGoalIds((p) => {
              const next = new Set(p);
              next.delete(editingId);
              return next;
            });
            setGoals((prev) => prev.map((goal) => (goal.id === editingId ? saved : goal)));
          },
        });
      } else {
        const tempId = `temp-goal-${crypto.randomUUID()}`;
        const snapshot = goals;
        const optimisticGoal: Goal = {
          id: tempId,
          ...payload,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        await runOptimisticMutation({
          snapshot,
          applyOptimistic: () => {
            setPendingGoalIds((prev) => new Set(prev).add(tempId));
            setGoals((prev) => [...prev, optimisticGoal]);
          },
          rollback: (prev) => {
            setPendingGoalIds((p) => {
              const next = new Set(p);
              next.delete(tempId);
              return next;
            });
            setGoals(prev);
          },
          commit: async () => {
            const { data, error } = await supabase
              .from('goals')
              .insert([payload])
              .select()
              .single();
            if (error) throw error;
            return data as Goal;
          },
          onSuccess: (saved) => {
            setPendingGoalIds((p) => {
              const next = new Set(p);
              next.delete(tempId);
              return next;
            });
            setGoals((prev) => prev.map((goal) => (goal.id === tempId ? saved : goal)));
          },
        });
      }
      resetForm();
    };

    setIsSubmitting(true);
    try {
      await execute();
    } catch (error) {
      console.error(error);
      toast.error('ذخیره هدف ناموفق بود.', {
        action: { label: 'تلاش مجدد', onClick: () => void execute() },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (goal: Goal) => {
    setForm({
      editingId: goal.id,
      scope: goal.scope,
      assetId: goal.asset_id ?? '',
      categoryId: goal.category_id ?? '',
      targetKind: goal.target_kind,
      targetValue: String(goal.target_quantity ?? goal.target_percent ?? ''),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (goal: Goal) => {
    if (!user) return;
    if (!window.confirm('این هدف حذف شود؟')) return;
    const execute = async () => {
      const snapshot = goals;
      await runOptimisticMutation({
        snapshot,
        applyOptimistic: () => {
          setPendingGoalIds((prev) => new Set(prev).add(goal.id));
          setGoals((prev) => prev.filter((row) => row.id !== goal.id));
        },
        rollback: (prev) => {
          setPendingGoalIds((p) => {
            const next = new Set(p);
            next.delete(goal.id);
            return next;
          });
          setGoals(prev);
        },
        commit: async () => {
          const { error } = await supabase.from('goals').delete().eq('id', goal.id);
          if (error) throw error;
        },
        onSuccess: () => {
          setPendingGoalIds((p) => {
            const next = new Set(p);
            next.delete(goal.id);
            return next;
          });
        },
      });
      if (form.editingId === goal.id) resetForm();
    };

    try {
      await execute();
    } catch {
      toast.error('حذف هدف ناموفق بود.', {
        action: { label: 'تلاش مجدد', onClick: () => void execute() },
      });
    }
  };

  if (!user) return null;

  return (
    <div className="bg-[#0F1015] min-h-full pb-10 animate-in slide-in-from-right-8 duration-300">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-20">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
          aria-label="بازگشت"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">هدف‌ها</h2>
      </div>

      <div className="p-6 space-y-6">
        <form
          onSubmit={handleSubmit}
          className="bg-[#1A1B26] border border-white/5 rounded-3xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-purple-300">
              <Target size={18} />
              <span className="font-semibold">
                {form.editingId ? 'ویرایش هدف' : 'هدف جدید'}
              </span>
            </div>
            {form.editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1"
              >
                <X size={14} />
                لغو
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#0F1015] p-1">
            <button
              type="button"
              onClick={() => switchScope('asset')}
              className={`rounded-xl py-2 text-sm transition ${
                form.scope === 'asset'
                  ? 'bg-purple-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              دارایی
            </button>
            <button
              type="button"
              onClick={() => switchScope('asset_group')}
              className={`rounded-xl py-2 text-sm transition ${
                form.scope === 'asset_group'
                  ? 'bg-purple-500 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              گروه دارایی
            </button>
          </div>

          {form.scope === 'asset' ? (
            <PickerButton
              label="دارایی"
              value={selectedAsset?.name ?? 'انتخاب دارایی'}
              empty={!selectedAsset}
              icon={<Activity size={16} />}
              onClick={() => setAssetPickerOpen(true)}
            />
          ) : (
            <PickerButton
              label="گروه دارایی"
              value={selectedCategory?.name ?? 'انتخاب گروه'}
              empty={!selectedCategory}
              icon={<Folder size={16} />}
              onClick={() => setCategoryPickerOpen(true)}
            />
          )}

          {form.scope === 'asset' && (
            <div className="grid grid-cols-2 gap-2">
              <TargetKindButton
                selected={form.targetKind === 'allocation_percent'}
                icon={<Percent size={15} />}
                label="درصد از سبد"
                onClick={() =>
                  setForm((prev) => ({ ...prev, targetKind: 'allocation_percent' }))
                }
              />
              <TargetKindButton
                selected={form.targetKind === 'quantity'}
                icon={<Activity size={15} />}
                label="تعداد/مقدار"
                onClick={() => setForm((prev) => ({ ...prev, targetKind: 'quantity' }))}
              />
            </div>
          )}

          <label className="block space-y-2">
            <span className="text-xs text-slate-400">
              {effectiveTargetKind === 'quantity' ? 'هدف مقداری' : 'هدف درصدی'}
            </span>
            <div className="relative">
              <FormattedNumberInput
                value={form.targetValue}
                onValueChange={(value) => setForm((prev) => ({ ...prev, targetValue: value }))}
                placeholder={effectiveTargetKind === 'quantity' ? 'مثلا 2.5' : 'مثلا 25'}
                className="w-full bg-[#0F1015] border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:border-purple-500 outline-none"
              />
              {effectiveTargetKind === 'allocation_percent' && (
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  %
                </span>
              )}
            </div>
            {percentInvalid && (
              <span className="text-[11px] text-rose-300">درصد باید بین ۰ و ۱۰۰ باشد.</span>
            )}
          </label>

          {budgetValidation.issues.length > 0 && (
            <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 space-y-1">
              {budgetValidation.issues.map((issue) => (
                <p key={issue} className="text-[11px] text-rose-200">
                  {issue}
                </p>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-[#0F1015] p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-300">خلاصه بودجه درصدی</p>
              <p className="text-[10px] text-slate-500">محاسبه زنده با پیش‌نمایش فرم فعلی</p>
            </div>

            <BudgetProgressRow
              label="مجموع هدف‌های گروهی"
              used={budgetValidation.parentSum}
              total={100}
              tone={budgetValidation.parentSum > 100 ? 'danger' : 'normal'}
            />
            <BudgetProgressRow
              label="مجموع هدف‌های دارایی"
              used={budgetValidation.childSum}
              total={100}
              tone={budgetValidation.childSum > 100 ? 'danger' : 'normal'}
            />

            {budgetValidation.categoryRows.length > 0 && (
              <div className="space-y-2 pt-1">
                <p className="text-[11px] text-slate-400">نسبت فرزندها به والد هر گروه</p>
                {budgetValidation.categoryRows.slice(0, 6).map((row) => (
                  <div key={row.categoryId} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 truncate">{row.categoryName}</span>
                      {row.parentTarget == null ? (
                        <span className="text-amber-300">والد ندارد</span>
                      ) : (
                        <span
                          dir="ltr"
                          className={
                            row.childrenSum > row.parentTarget
                              ? 'text-rose-300'
                              : 'text-slate-400'
                          }
                        >
                          {row.childrenSum.toFixed(1)} / {row.parentTarget.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {row.parentTarget != null && (
                      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            row.childrenSum > row.parentTarget
                              ? 'bg-rose-400'
                              : 'bg-linear-to-r from-purple-500 to-cyan-400'
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              row.parentTarget > 0
                                ? (row.childrenSum / row.parentTarget) * 100
                                : 0
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:hover:bg-purple-600 text-white rounded-xl py-3 font-semibold transition"
          >
            {isSubmitting ? 'در حال ذخیره...' : form.editingId ? 'ذخیره تغییرات' : 'افزودن هدف'}
          </button>
        </form>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-300">هدف‌های فعال</h3>
            <span className="text-xs text-slate-500">{goals.length.toLocaleString('fa-IR')}</span>
          </div>

          {sortedGoals.length === 0 ? (
            <div className="text-center text-slate-500 text-sm py-8 bg-[#1A1B26] border border-white/5 rounded-2xl">
              هنوز هدفی ثبت نشده است.
            </div>
          ) : (
            <div className="space-y-3">
              {sortedGoals.map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  assetName={goal.asset_id ? assetById.get(goal.asset_id)?.name : undefined}
                  assetUnit={goal.asset_id ? assetById.get(goal.asset_id)?.unit : undefined}
                  categoryName={
                    goal.category_id ? categoryById.get(goal.category_id)?.name : undefined
                  }
                  pending={pendingGoalIds.has(goal.id)}
                  progress={
                    goal.scope === 'asset'
                      ? calculateAssetGoalProgress(goal, snapshots, totalValueToman)
                      : calculateGroupGoalProgress(goal, snapshots, totalValueToman)
                  }
                  onEdit={() => handleEdit(goal)}
                  onDelete={() => void handleDelete(goal)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <ListSheetPicker
        open={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        title="انتخاب دارایی"
        items={assetItems}
        value={form.assetId || null}
        onSelect={(id) => setForm((prev) => ({ ...prev, assetId: id ?? '' }))}
      />
      <CategorySheetPicker
        open={categoryPickerOpen}
        onClose={() => setCategoryPickerOpen(false)}
        title="انتخاب گروه دارایی"
        kind="asset"
        categories={categories}
        value={form.categoryId || null}
        onSelect={(id) => setForm((prev) => ({ ...prev, categoryId: id ?? '' }))}
      />
    </div>
  );
}

function BudgetProgressRow({
  label,
  used,
  total,
  tone,
}: {
  label: string;
  used: number;
  total: number;
  tone: 'normal' | 'danger';
}) {
  const remaining = Math.max(0, total - used);
  const width = Math.min(100, total > 0 ? (used / total) * 100 : 0);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span dir="ltr" className={tone === 'danger' ? 'text-rose-300' : 'text-slate-300'}>
          {used.toFixed(1)}% used / {remaining.toFixed(1)}% free
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className={`h-full rounded-full ${
            tone === 'danger' ? 'bg-rose-400' : 'bg-linear-to-r from-purple-500 to-cyan-400'
          }`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function PickerButton({
  label,
  value,
  empty,
  icon,
  onClick,
}: {
  label: string;
  value: string;
  empty: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-[#0F1015] border border-white/10 rounded-xl px-4 py-3 flex items-center gap-3 text-right hover:border-purple-500/40 transition"
    >
      <span className="text-slate-500">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[11px] text-slate-500">{label}</span>
        <span className={`block text-sm truncate ${empty ? 'text-slate-500' : 'text-white'}`}>
          {value}
        </span>
      </span>
      <ChevronDown size={16} className="text-slate-600" />
    </button>
  );
}

function TargetKindButton({
  selected,
  icon,
  label,
  onClick,
}: {
  selected: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border p-3 text-sm flex items-center justify-center gap-2 transition ${
        selected
          ? 'bg-purple-500/10 border-purple-500/40 text-purple-200'
          : 'bg-[#0F1015] border-white/10 text-slate-400 hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function GoalRow({
  goal,
  assetName,
  assetUnit,
  categoryName,
  pending,
  progress,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  assetName?: string;
  assetUnit?: string;
  categoryName?: string;
  pending: boolean;
  progress: GoalProgress | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const name = goal.scope === 'asset' ? (assetName ?? 'دارایی حذف‌شده') : (categoryName ?? 'گروه حذف‌شده');
  const kind = goalValueKindFromGoal(goal.target_kind);

  return (
    <div
      className={`bg-[#1A1B26] border border-white/5 rounded-2xl p-4 space-y-3 ${
        pending ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-300 flex items-center justify-center shrink-0">
              {goal.scope === 'asset' ? <Activity size={15} /> : <Folder size={15} />}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white truncate">{name}</p>
              <p className="text-[11px] text-slate-500">
                {goal.target_kind === 'quantity' ? 'هدف مقداری' : 'هدف درصدی'}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="w-8 h-8 rounded-lg bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center"
            aria-label="ویرایش هدف"
          >
            <Edit3 size={14} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 flex items-center justify-center"
            aria-label="حذف هدف"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <GoalProgressDisplay
        label=""
        kind={kind}
        unit={assetUnit ?? ''}
        progress={progress}
        showIcon={false}
      />
    </div>
  );
}
