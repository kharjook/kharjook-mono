'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, ArrowRight, Plus, Trash2 } from 'lucide-react';
import { FormattedNumberInput } from '@/shared/components/FormattedNumberInput';
import { supabase } from '@/shared/lib/supabase/client';
import { latinizeDigits } from '@/shared/utils/latinize-digits';
import type {
  Asset,
  Category,
  CurrencyRate,
  Transaction,
  TransactionType,
  Wallet,
} from '@/shared/types/domain';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';
import { tomanPerUnit } from '@/shared/utils/currency-conversion';

type EndpointKind = 'wallet' | 'asset';

type FormState = {
  type: TransactionType;
  date: string;
  sourceKind: EndpointKind | null;
  sourceId: string | null;
  targetKind: EndpointKind | null;
  targetId: string | null;
  sourceAmount: string;
  targetAmount: string;
  priceToman: string;
  usdRate: string;
  categoryId: string | null;
  note: string;
};

type TypeShape = {
  source: EndpointKind[] | null; // null = no source side
  target: EndpointKind[] | null;
  needsPrice: boolean;
  needsCategory: 'income' | 'expense' | null;
};

const TYPE_SHAPES: Record<TransactionType, TypeShape> = {
  BUY: { source: ['wallet'], target: ['asset'], needsPrice: true, needsCategory: null },
  SELL: { source: ['asset'], target: ['wallet'], needsPrice: true, needsCategory: null },
  TRANSFER: {
    source: ['wallet', 'asset'],
    target: ['wallet', 'asset'],
    needsPrice: false,
    needsCategory: null,
  },
  INCOME: { source: null, target: ['wallet', 'asset'], needsPrice: false, needsCategory: 'income' },
  EXPENSE: { source: ['wallet', 'asset'], target: null, needsPrice: false, needsCategory: 'expense' },
};

const TYPE_TABS: { id: TransactionType; label: string }[] = [
  { id: 'BUY', label: 'خرید' },
  { id: 'SELL', label: 'فروش' },
  { id: 'TRANSFER', label: 'انتقال' },
  { id: 'INCOME', label: 'درآمد' },
  { id: 'EXPENSE', label: 'هزینه' },
];

export interface AddTransactionViewProps {
  assetId?: string;
  walletId?: string;
  defaultType?: TransactionType;
  transactionId?: string;
}

const todayFa = () => new Date().toLocaleDateString('fa-IR-u-nu-latn');

function endpointKindOfTx(tx: Transaction, side: 'source' | 'target'): EndpointKind | null {
  if (side === 'source') {
    if (tx.source_wallet_id) return 'wallet';
    if (tx.source_asset_id) return 'asset';
    return null;
  }
  if (tx.target_wallet_id) return 'wallet';
  if (tx.target_asset_id) return 'asset';
  return null;
}

function endpointIdOfTx(tx: Transaction, side: 'source' | 'target'): string | null {
  if (side === 'source') return tx.source_wallet_id ?? tx.source_asset_id ?? null;
  return tx.target_wallet_id ?? tx.target_asset_id ?? null;
}

function buildInitialForm(
  tx: Transaction | undefined,
  defaults: { assetId?: string; walletId?: string; defaultType?: TransactionType },
  usdRate: number
): FormState {
  if (tx) {
    return {
      type: tx.type,
      date: latinizeDigits(tx.date_string),
      sourceKind: endpointKindOfTx(tx, 'source'),
      sourceId: endpointIdOfTx(tx, 'source'),
      targetKind: endpointKindOfTx(tx, 'target'),
      targetId: endpointIdOfTx(tx, 'target'),
      sourceAmount: tx.source_amount != null ? String(tx.source_amount) : '',
      targetAmount: tx.target_amount != null ? String(tx.target_amount) : '',
      priceToman: tx.price_toman != null ? String(tx.price_toman) : '',
      usdRate: tx.usd_rate != null ? String(tx.usd_rate) : String(usdRate),
      categoryId: tx.category_id,
      note: tx.note ?? '',
    };
  }

  const type: TransactionType = defaults.defaultType ?? 'BUY';
  const f: FormState = {
    type,
    date: todayFa(),
    sourceKind: null,
    sourceId: null,
    targetKind: null,
    targetId: null,
    sourceAmount: '',
    targetAmount: '',
    priceToman: '',
    usdRate: String(usdRate),
    categoryId: null,
    note: '',
  };

  // Apply context-aware deep-link defaults.
  if (defaults.assetId) {
    if (type === 'BUY') {
      f.targetKind = 'asset';
      f.targetId = defaults.assetId;
    } else if (type === 'SELL' || type === 'EXPENSE' || type === 'TRANSFER') {
      f.sourceKind = 'asset';
      f.sourceId = defaults.assetId;
    } else if (type === 'INCOME') {
      f.targetKind = 'asset';
      f.targetId = defaults.assetId;
    }
  }
  if (defaults.walletId) {
    if (type === 'SELL' || type === 'INCOME') {
      f.targetKind = 'wallet';
      f.targetId = defaults.walletId;
    } else {
      f.sourceKind = 'wallet';
      f.sourceId = defaults.walletId;
    }
  }
  return f;
}

// ─── Pure transforms ─────────────────────────────────────────────────────────

function applyTypeSwitch(prev: FormState, type: TransactionType): FormState {
  if (type === prev.type) return prev;
  const next = TYPE_SHAPES[type];
  return {
    ...prev,
    type,
    sourceKind:
      prev.sourceKind && next.source?.includes(prev.sourceKind) ? prev.sourceKind : null,
    sourceId:
      prev.sourceKind && next.source?.includes(prev.sourceKind) ? prev.sourceId : null,
    targetKind:
      prev.targetKind && next.target?.includes(prev.targetKind) ? prev.targetKind : null,
    targetId:
      prev.targetKind && next.target?.includes(prev.targetKind) ? prev.targetId : null,
    categoryId: null,
  };
}

// BUY / SELL auto-derivation: priceToman + asset amount → wallet-side amount.
function recomputeMoneySide(
  next: FormState,
  wallets: Wallet[],
  currencyRates: CurrencyRate[],
  usdRate: number
): FormState {
  const wallet = next.type === 'BUY' ? walletFromForm(next, 'source', wallets)
    : next.type === 'SELL' ? walletFromForm(next, 'target', wallets)
    : null;
  if (!wallet) return next;

  const price = Number(next.priceToman);
  if (!Number.isFinite(price) || price <= 0) return next;

  // For USD wallets, the per-tx `usdRate` field overrides the stored rate
  // (so the user can capture the exact rate used in that trade). Other
  // currencies always read from the rates table.
  let rate: number;
  if (wallet.currency === 'USD') {
    const override = Number(next.usdRate);
    rate = Number.isFinite(override) && override > 0 ? override : usdRate;
  } else {
    rate = tomanPerUnit(wallet.currency, currencyRates);
  }
  if (!rate) return next;

  if (next.type === 'BUY') {
    const tgt = Number(next.targetAmount);
    if (!Number.isFinite(tgt) || tgt <= 0) return next;
    const src = (tgt * price) / rate;
    return { ...next, sourceAmount: String(src) };
  }
  // SELL
  const src = Number(next.sourceAmount);
  if (!Number.isFinite(src) || src <= 0) return next;
  const tgt = (src * price) / rate;
  return { ...next, targetAmount: String(tgt) };
}

function validateForm(form: FormState): string | null {
  if (!form.date) return 'تاریخ الزامی است.';
  const shape = TYPE_SHAPES[form.type];

  switch (form.type) {
    case 'BUY':
      if (form.sourceKind !== 'wallet' || !form.sourceId) return 'کیف پول مبدأ را انتخاب کن.';
      if (form.targetKind !== 'asset' || !form.targetId) return 'دارایی مقصد را انتخاب کن.';
      break;
    case 'SELL':
      if (form.sourceKind !== 'asset' || !form.sourceId) return 'دارایی مبدأ را انتخاب کن.';
      if (form.targetKind !== 'wallet' || !form.targetId) return 'کیف پول مقصد را انتخاب کن.';
      break;
    case 'TRANSFER':
      if (!form.sourceKind || !form.sourceId) return 'مبدأ را انتخاب کن.';
      if (!form.targetKind || !form.targetId) return 'مقصد را انتخاب کن.';
      if (form.sourceKind !== form.targetKind) {
        return 'انتقال فقط بین دو کیف پول یا بین دو دارایی ممکن است.';
      }
      if (form.sourceId === form.targetId) return 'مبدأ و مقصد نباید یکی باشند.';
      break;
    case 'INCOME':
      if (!form.targetKind || !form.targetId) return 'مقصد را انتخاب کن.';
      if (!form.categoryId) return 'دسته درآمد الزامی است.';
      break;
    case 'EXPENSE':
      if (!form.sourceKind || !form.sourceId) return 'مبدأ را انتخاب کن.';
      if (!form.categoryId) return 'دسته هزینه الزامی است.';
      break;
  }

  const needsSrc = form.type !== 'INCOME';
  const needsTgt = form.type !== 'EXPENSE';
  if (needsSrc) {
    const v = Number(form.sourceAmount);
    if (!Number.isFinite(v) || v <= 0) return 'مقدار مبدأ نامعتبر است.';
  }
  if (needsTgt) {
    const v = Number(form.targetAmount);
    if (!Number.isFinite(v) || v <= 0) return 'مقدار مقصد نامعتبر است.';
  }

  if (shape.needsPrice) {
    const p = Number(form.priceToman);
    const u = Number(form.usdRate);
    if (!Number.isFinite(p) || p <= 0) return 'قیمت واحد (تومان) نامعتبر است.';
    if (!Number.isFinite(u) || u <= 0) return 'نرخ دلار نامعتبر است.';
  }

  return null;
}

function buildPayload(form: FormState, userId: string): Record<string, unknown> {
  // usd_rate is ONLY meaningful on BUY/SELL because calculate-asset-stats
  // derives PnL from the legacy `asset_id/amount/price_toman/usd_rate`
  // columns. Stamping it on other types would fill the DB with values that
  // no calculation consumes (and that would be the wrong denomination
  // anyway — transfers need the source currency's rate, not USD's). When
  // the stats layer is rewritten later, rate snapshotting gets redesigned
  // properly at the schema level.
  const base: Record<string, unknown> = {
    user_id: userId,
    type: form.type,
    date_string: form.date,
    note: form.note || null,
    source_wallet_id: null,
    source_asset_id: null,
    target_wallet_id: null,
    target_asset_id: null,
    source_amount: null,
    target_amount: null,
    category_id: null,
    asset_id: null,
    amount: null,
    price_toman: null,
    usd_rate: null,
  };

  const setSource = () => {
    if (form.sourceKind === 'wallet') base.source_wallet_id = form.sourceId;
    else if (form.sourceKind === 'asset') base.source_asset_id = form.sourceId;
    base.source_amount = Number(form.sourceAmount);
  };
  const setTarget = () => {
    if (form.targetKind === 'wallet') base.target_wallet_id = form.targetId;
    else if (form.targetKind === 'asset') base.target_asset_id = form.targetId;
    base.target_amount = Number(form.targetAmount);
  };

  switch (form.type) {
    case 'BUY':
      setSource();
      setTarget();
      base.price_toman = Number(form.priceToman);
      base.usd_rate = Number(form.usdRate);
      // Legacy mirror so calculate-asset-stats keeps working.
      base.asset_id = form.targetId;
      base.amount = Number(form.targetAmount);
      break;
    case 'SELL':
      setSource();
      setTarget();
      base.price_toman = Number(form.priceToman);
      base.usd_rate = Number(form.usdRate);
      base.asset_id = form.sourceId;
      base.amount = Number(form.sourceAmount);
      break;
    case 'TRANSFER':
      setSource();
      setTarget();
      break;
    case 'INCOME':
      setTarget();
      base.category_id = form.categoryId;
      break;
    case 'EXPENSE':
      setSource();
      base.category_id = form.categoryId;
      break;
  }
  return base;
}

export function AddTransactionView({
  assetId,
  walletId,
  defaultType,
  transactionId,
}: AddTransactionViewProps) {
  const router = useRouter();
  const { user } = useAuth();
  const {
    assets,
    wallets,
    categories,
    transactions,
    currencyRates,
    setTransactions,
  } = useData();
  const { usdRate } = useUI();

  const txToEdit = useMemo(
    () => (transactionId ? transactions.find((t) => t.id === transactionId) : undefined),
    [transactionId, transactions]
  );

  const [rows, setRows] = useState<FormState[]>(() => [
    buildInitialForm(txToEdit, { assetId, walletId, defaultType }, usdRate),
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If the route resolves a tx after the first render (data loads async), seed
  // the form once. Edit mode is always a single row.
  useEffect(() => {
    if (txToEdit) {
      setRows([buildInitialForm(txToEdit, {}, usdRate)]);
    }
    // We deliberately only re-seed when the row identity changes, not on every
    // global rate tick — otherwise typing would reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txToEdit?.id]);

  if (!user) return null;
  if (transactionId && !txToEdit) {
    return <NotFound message="تراکنش پیدا نشد." onBack={() => router.back()} />;
  }

  const isEdit = !!txToEdit;
  const sharedType = rows[0].type;

  const switchType = (type: TransactionType) => {
    if (isEdit) return; // Type immutable on edit.
    if (type === sharedType) return;
    setRows((prev) => prev.map((r) => applyTypeSwitch(r, type)));
  };

  const updateRow = (idx: number, updater: (prev: FormState) => FormState) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? updater(r) : r)));
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      // New rows inherit the current shared type + a fresh usdRate snapshot.
      // No deep-link defaults; those only apply to the first row.
      buildInitialForm(undefined, { defaultType: sharedType }, usdRate),
    ]);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate all rows up-front; pin-point which one failed.
    for (let i = 0; i < rows.length; i++) {
      const err = validateForm(rows[i]);
      if (err) {
        alert(rows.length > 1 ? `تراکنش #${i + 1}: ${err}` : err);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (isEdit && txToEdit) {
        const payload = buildPayload(rows[0], user.id);
        const { data, error } = await supabase
          .from('transactions')
          .update(payload)
          .eq('id', txToEdit.id)
          .select()
          .single();
        if (error) throw error;
        setTransactions((prev) =>
          prev.map((t) => (t.id === txToEdit.id ? (data as Transaction) : t))
        );
      } else {
        const payloads = rows.map((r) => buildPayload(r, user.id));
        const { data, error } = await supabase
          .from('transactions')
          .insert(payloads)
          .select();
        if (error) throw error;
        const inserted = (data ?? []) as Transaction[];
        setTransactions((prev) => [...inserted.slice().reverse(), ...prev]);
      }
      router.back();
    } catch (err2) {
      console.error(err2);
      alert('خطا در ثبت تراکنش');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-[#0F1015] min-h-full pb-10 animate-in slide-in-from-bottom-8 duration-300 relative z-50">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5 z-10">
        <button
          type="button"
          onClick={() => router.back()}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">
          {isEdit
            ? 'ویرایش تراکنش'
            : rows.length > 1
              ? `ثبت ${rows.length} تراکنش`
              : 'ثبت تراکنش جدید'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        <div className="grid grid-cols-5 gap-1 bg-[#1A1B26] p-1 rounded-xl">
          {TYPE_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchType(t.id)}
              disabled={isEdit && t.id !== sharedType}
              className={`py-2 text-xs font-bold rounded-lg transition-all ${
                sharedType === t.id
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200 disabled:opacity-30'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {isEdit && (
          <p className="text-[11px] text-slate-500 -mt-2">
            نوع تراکنش پس از ثبت قابل تغییر نیست.
          </p>
        )}

        <div className="space-y-6">
          {rows.map((form, idx) => (
            <TransactionFormRow
              key={idx}
              form={form}
              rowIndex={idx}
              totalRows={rows.length}
              canRemove={!isEdit && rows.length > 1}
              onChange={(updater) => updateRow(idx, updater)}
              onRemove={() => removeRow(idx)}
              wallets={wallets}
              assets={assets}
              categories={categories}
              currencyRates={currencyRates}
              usdRate={usdRate}
            />
          ))}
        </div>

        {!isEdit && (
          <button
            type="button"
            onClick={addRow}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 border border-dashed border-white/10 text-slate-300 p-3 rounded-xl text-sm font-bold transition-all"
          >
            <Plus size={16} />
            افزودن تراکنش دیگر
          </button>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-xl font-bold shadow-[0_4px_20px_rgba(147,51,234,0.3)] transition-all mt-4 disabled:opacity-50"
        >
          {isSubmitting
            ? 'در حال ارسال...'
            : isEdit
              ? 'ثبت تغییرات'
              : rows.length > 1
                ? `ثبت ${rows.length} تراکنش`
                : 'ثبت تراکنش'}
        </button>
      </form>
    </div>
  );
}

// ─── Row subcomponent ────────────────────────────────────────────────────────

function TransactionFormRow({
  form,
  rowIndex,
  totalRows,
  canRemove,
  onChange,
  onRemove,
  wallets,
  assets,
  categories,
  currencyRates,
  usdRate,
}: {
  form: FormState;
  rowIndex: number;
  totalRows: number;
  canRemove: boolean;
  onChange: (updater: (prev: FormState) => FormState) => void;
  onRemove: () => void;
  wallets: Wallet[];
  assets: Asset[];
  categories: Category[];
  currencyRates: CurrencyRate[];
  usdRate: number;
}) {
  const shape = TYPE_SHAPES[form.type];
  const isBulk = totalRows > 1;

  const sourceWallet = form.sourceKind === 'wallet'
    ? wallets.find((w) => w.id === form.sourceId)
    : undefined;
  const sourceAsset = form.sourceKind === 'asset'
    ? assets.find((a) => a.id === form.sourceId)
    : undefined;
  const targetWallet = form.targetKind === 'wallet'
    ? wallets.find((w) => w.id === form.targetId)
    : undefined;
  const targetAsset = form.targetKind === 'asset'
    ? assets.find((a) => a.id === form.targetId)
    : undefined;

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    onChange((prev) => {
      const next = { ...prev, [key]: value };
      // Auto-derive money side on BUY/SELL whenever inputs that drive it change.
      if (
        (next.type === 'BUY' || next.type === 'SELL') &&
        (key === 'targetAmount' ||
          key === 'sourceAmount' ||
          key === 'priceToman' ||
          key === 'usdRate' ||
          key === 'sourceId' ||
          key === 'targetId' ||
          key === 'sourceKind' ||
          key === 'targetKind')
      ) {
        return recomputeMoneySide(next, wallets, currencyRates, usdRate);
      }
      return next;
    });
  };

  // For TRANSFER between same-currency wallets, mirror amounts unless user has
  // already diverged them.
  const onTransferSourceAmountChange = (canonical: string) => {
    onChange((prev) => {
      const next = { ...prev, sourceAmount: canonical };
      if (
        prev.type === 'TRANSFER' &&
        prev.sourceKind === 'wallet' &&
        prev.targetKind === 'wallet' &&
        sourceWallet &&
        targetWallet &&
        sourceWallet.currency === targetWallet.currency
      ) {
        next.targetAmount = canonical;
      }
      return next;
    });
  };

  return (
    <div
      className={
        isBulk
          ? 'rounded-2xl border border-white/5 bg-[#13141C] p-4 space-y-5'
          : 'space-y-5'
      }
    >
      {isBulk && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-400">
            تراکنش #{rowIndex + 1}
          </span>
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="p-1.5 bg-white/5 hover:bg-red-500/20 hover:text-red-400 rounded-lg text-slate-400 transition-colors"
              aria-label="حذف این تراکنش"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      )}

      <FieldDate
        value={form.date}
        onChange={(v) => updateField('date', v)}
      />

      {/* Source picker */}
      {shape.source && (
        <EndpointPicker
          label="مبدأ"
          allow={shape.source}
          kind={form.sourceKind}
          id={form.sourceId}
          wallets={wallets}
          assets={assets}
          excludeId={form.sourceKind === form.targetKind ? form.targetId : null}
          onChange={(kind, id) => {
            onChange((prev) => {
              const next = { ...prev, sourceKind: kind, sourceId: id };
              if (next.type === 'BUY' || next.type === 'SELL') {
                return recomputeMoneySide(next, wallets, currencyRates, usdRate);
              }
              return next;
            });
          }}
        />
      )}

      {/* Target picker */}
      {shape.target && (
        <EndpointPicker
          label="مقصد"
          allow={shape.target}
          kind={form.targetKind}
          id={form.targetId}
          wallets={wallets}
          assets={assets}
          excludeId={form.sourceKind === form.targetKind ? form.sourceId : null}
          onChange={(kind, id) => {
            onChange((prev) => {
              const next = { ...prev, targetKind: kind, targetId: id };
              if (next.type === 'BUY' || next.type === 'SELL') {
                return recomputeMoneySide(next, wallets, currencyRates, usdRate);
              }
              return next;
            });
          }}
        />
      )}

      {/* Amounts */}
      <AmountFields
        form={form}
        shape={shape}
        sourceWallet={sourceWallet}
        targetWallet={targetWallet}
        sourceAsset={sourceAsset}
        targetAsset={targetAsset}
        onSourceAmount={(v) =>
          form.type === 'TRANSFER'
            ? onTransferSourceAmountChange(v)
            : updateField('sourceAmount', v)
        }
        onTargetAmount={(v) => updateField('targetAmount', v)}
      />

      {shape.needsPrice && (
        <PriceFields
          priceToman={form.priceToman}
          usdRate={form.usdRate}
          onPriceToman={(v) => updateField('priceToman', v)}
          onUsdRate={(v) => updateField('usdRate', v)}
        />
      )}

      {shape.needsCategory && (
        <CategoryPicker
          kind={shape.needsCategory}
          categories={categories}
          value={form.categoryId}
          onChange={(v) => updateField('categoryId', v)}
        />
      )}

      <div>
        <label className="block text-xs text-slate-400 mb-1">
          توضیحات (اختیاری)
        </label>
        <textarea
          value={form.note}
          onChange={(e) => updateField('note', e.target.value)}
          className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none min-h-[80px]"
          maxLength={500}
        />
      </div>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function NotFound({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="bg-[#0F1015] min-h-full">
      <div className="sticky top-0 bg-[#161722]/90 backdrop-blur-md px-6 py-4 flex items-center gap-4 border-b border-white/5">
        <button
          type="button"
          onClick={onBack}
          className="p-2 -mr-2 bg-white/5 rounded-full text-slate-300 hover:bg-white/10"
        >
          <ArrowRight size={20} />
        </button>
        <h2 className="text-lg font-bold text-white flex-1">تراکنش</h2>
      </div>
      <div className="p-6 text-center text-slate-500 text-sm">{message}</div>
    </div>
  );
}

function FieldDate({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">تاریخ</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none text-center"
        dir="ltr"
        required
      />
    </div>
  );
}

function EndpointPicker({
  label,
  allow,
  kind,
  id,
  wallets,
  assets,
  excludeId,
  onChange,
}: {
  label: string;
  allow: EndpointKind[];
  kind: EndpointKind | null;
  id: string | null;
  wallets: Wallet[];
  assets: Asset[];
  excludeId: string | null;
  onChange: (kind: EndpointKind | null, id: string | null) => void;
}) {
  // Encode value as `${kind}:${id}` so a single <select> can span both groups.
  const value = kind && id ? `${kind}:${id}` : '';

  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return onChange(null, null);
          const [k, rest] = v.split(':');
          onChange(k as EndpointKind, rest ?? null);
        }}
        className="w-full appearance-none bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none"
        required
      >
        <option value="">— انتخاب کنید —</option>
        {allow.includes('wallet') && wallets.length > 0 && (
          <optgroup label="کیف پول‌ها">
            {wallets
              .filter((w) => w.id !== excludeId)
              .map((w) => (
                <option key={w.id} value={`wallet:${w.id}`}>
                  {w.name} · {CURRENCY_META[w.currency].symbol} {w.currency}
                </option>
              ))}
          </optgroup>
        )}
        {allow.includes('asset') && assets.length > 0 && (
          <optgroup label="دارایی‌ها">
            {assets
              .filter((a) => a.id !== excludeId)
              .map((a) => (
                <option key={a.id} value={`asset:${a.id}`}>
                  {a.name} ({a.unit})
                </option>
              ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

function AmountFields({
  form,
  shape,
  sourceWallet,
  targetWallet,
  sourceAsset,
  targetAsset,
  onSourceAmount,
  onTargetAmount,
}: {
  form: FormState;
  shape: TypeShape;
  sourceWallet?: Wallet;
  targetWallet?: Wallet;
  sourceAsset?: Asset;
  targetAsset?: Asset;
  onSourceAmount: (v: string) => void;
  onTargetAmount: (v: string) => void;
}) {
  const sourceUnitLabel = sourceWallet
    ? CURRENCY_META[sourceWallet.currency].label
    : sourceAsset
      ? sourceAsset.unit
      : '';
  const targetUnitLabel = targetWallet
    ? CURRENCY_META[targetWallet.currency].label
    : targetAsset
      ? targetAsset.unit
      : '';

  const showSource = shape.source !== null;
  const showTarget = shape.target !== null;

  // For BUY: target (asset units) is the user-driven field; source is derived.
  // For SELL: source (asset units) is user-driven; target is derived.
  // We label derived fields softly so the user knows they can override.

  return (
    <div className={`grid ${showSource && showTarget ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
      {showSource && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            مقدار مبدأ {sourceUnitLabel ? `(${sourceUnitLabel})` : ''}
            {form.type === 'BUY' && (
              <span className="text-[10px] text-slate-600 mr-1">— محاسبه‌شده</span>
            )}
          </label>
          <FormattedNumberInput
            value={form.sourceAmount}
            onValueChange={onSourceAmount}
            className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm font-mono focus:border-purple-500 outline-none text-left"
            dir="ltr"
            required
          />
        </div>
      )}
      {showTarget && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            مقدار مقصد {targetUnitLabel ? `(${targetUnitLabel})` : ''}
            {form.type === 'SELL' && (
              <span className="text-[10px] text-slate-600 mr-1">— محاسبه‌شده</span>
            )}
          </label>
          <FormattedNumberInput
            value={form.targetAmount}
            onValueChange={onTargetAmount}
            className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm font-mono focus:border-purple-500 outline-none text-left"
            dir="ltr"
            required
          />
        </div>
      )}
      {form.type === 'TRANSFER' &&
        sourceWallet &&
        targetWallet &&
        sourceWallet.currency !== targetWallet.currency && (
          <div className="col-span-2 -mt-2 flex items-center gap-2 text-[11px] text-amber-400/80">
            <ArrowLeftRight size={12} />
            انتقال بین دو ارز متفاوت — هر دو مقدار را به‌صورت دستی وارد کن.
          </div>
        )}
    </div>
  );
}

function PriceFields({
  priceToman,
  usdRate,
  onPriceToman,
  onUsdRate,
}: {
  priceToman: string;
  usdRate: string;
  onPriceToman: (v: string) => void;
  onUsdRate: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">
          قیمت واحد (تومان)
        </label>
        <FormattedNumberInput
          value={priceToman}
          onValueChange={onPriceToman}
          className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm font-mono focus:border-purple-500 outline-none text-left"
          dir="ltr"
          required
        />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">
          نرخ دلار در لحظه (تومان)
        </label>
        <FormattedNumberInput
          value={usdRate}
          onValueChange={onUsdRate}
          className="w-full bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm font-mono focus:border-purple-500 outline-none text-left"
          dir="ltr"
          required
        />
      </div>
    </div>
  );
}

function CategoryPicker({
  kind,
  categories,
  value,
  onChange,
}: {
  kind: 'income' | 'expense';
  categories: Category[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  // Flatten the tree depth-first so the <select> shows the full hierarchy
  // with indentation. Native <select> doesn't support nested <optgroup>.
  const options = useMemo(() => {
    const scoped = categories.filter((c) => c.kind === kind);
    const byParent = new Map<string | null, Category[]>();
    for (const c of scoped) {
      const key = c.parent_id ?? null;
      const arr = byParent.get(key) ?? [];
      arr.push(c);
      byParent.set(key, arr);
    }
    const scopedIds = new Set(scoped.map((c) => c.id));

    const out: { id: string; label: string }[] = [];
    const visit = (parentId: string | null, depth: number) => {
      const nodes = byParent.get(parentId) ?? [];
      for (const n of nodes) {
        out.push({
          id: n.id,
          label: `${'— '.repeat(depth)}${n.name}`,
        });
        visit(n.id, depth + 1);
      }
    };
    visit(null, 0);

    // Orphans: parent_id points at a row not in scope (e.g. deleted). Surface
    // them so the user can still select and later re-parent them.
    for (const c of scoped) {
      if (c.parent_id && !scopedIds.has(c.parent_id) && !out.find((o) => o.id === c.id)) {
        out.push({ id: c.id, label: c.name });
      }
    }

    return out;
  }, [categories, kind]);

  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">
        {kind === 'income' ? 'دسته درآمد' : 'دسته هزینه'}
      </label>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full appearance-none bg-[#1A1B26] border border-white/5 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none"
        required
      >
        <option value="">— انتخاب کنید —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function walletFromForm(
  form: FormState,
  side: 'source' | 'target',
  wallets: Wallet[]
): Wallet | null {
  const kind = side === 'source' ? form.sourceKind : form.targetKind;
  const id = side === 'source' ? form.sourceId : form.targetId;
  if (kind !== 'wallet' || !id) return null;
  return wallets.find((w) => w.id === id) ?? null;
}
