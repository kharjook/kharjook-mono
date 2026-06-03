'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Plus } from 'lucide-react';
import { useToast } from '@/shared/components/Toast';
import { supabase } from '@/shared/lib/supabase/client';
import type { DailyPrice, Transaction } from '@/shared/types/domain';
import { useAuth, useData, useUI } from '@/features/portfolio/PortfolioProvider';
import { fireExpenseAlert } from '@/features/notifications/client/fire-expense-alert';
import { ConvertTransactionForm } from '@/features/transactions/components/ConvertTransactionForm';
import { TransactionFormRow } from '@/features/transactions/components/TransactionFormRow';
import {
  NotFound,
  PreviewPanel,
} from '@/features/transactions/components/AddTransactionFormPieces';
import {
  applyMatchBuyValue,
  buildConvertPayloads,
  buildInitialConvertForm,
  CONVERT_UI_MODE,
  resolveConvertPair,
  validateConvertForm,
  type ConvertFormState,
  type UiTransactionMode,
} from '@/features/transactions/utils/convert-transaction';
import {
  type AddTransactionViewProps,
  type FormState,
  UI_TABS,
  styleForUiMode,
} from '@/features/transactions/utils/transaction-form-types';
import {
  buildInitialForm,
  buildPayload,
  buildTradeSnapshots,
  validateForm,
} from '@/features/transactions/utils/transaction-form-logic';

export type { AddTransactionViewProps };

export function AddTransactionView({
  assetId,
  walletId,
  targetAssetId,
  sourceAmount,
  targetAmount,
  personId,
  personSide,
  settleAmount,
  defaultType,
  defaultUiMode,
  transactionId,
}: AddTransactionViewProps) {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();
  const {
    assets,
    wallets,
    persons,
    categories,
    transactions,
    currencyRates,
    dailyPrices,
    setTransactions,
    setDailyPrices,
  } = useData();
  const { usdRate } = useUI();

  const txToEdit = useMemo(
    () => (transactionId ? transactions.find((t) => t.id === transactionId) : undefined),
    [transactionId, transactions]
  );

  const convertPair = useMemo(
    () => (txToEdit ? resolveConvertPair(txToEdit, transactions) : null),
    [txToEdit, transactions]
  );

  const initialUiMode: UiTransactionMode =
    defaultUiMode ??
    (convertPair ? CONVERT_UI_MODE : defaultType ?? 'BUY');

  const [uiMode, setUiMode] = useState<UiTransactionMode>(initialUiMode);
  const prefillDefaults = {
    assetId,
    walletId,
    defaultType,
    personId,
    personSide,
    settleAmount,
  };

  const [rows, setRows] = useState<FormState[]>(() => [
    buildInitialForm(txToEdit, prefillDefaults, usdRate),
  ]);
  const [convertForm, setConvertForm] = useState<ConvertFormState>(() =>
    buildInitialConvertForm(
      { assetId, targetAssetId, sourceAmount, targetAmount },
      assets,
      usdRate,
      convertPair ?? undefined
    )
  );
  // Collapsed state lives out-of-band: it's pure UI and we don't want to bloat
  // FormState (which is serialized into the DB payload).
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (txToEdit) {
      if (convertPair) {
        setUiMode(CONVERT_UI_MODE);
        setConvertForm(buildInitialConvertForm({}, assets, usdRate, convertPair));
      } else {
        setUiMode(txToEdit.type);
        setRows([buildInitialForm(txToEdit, {}, usdRate)]);
      }
      setCollapsed({});
    } else if (defaultUiMode === CONVERT_UI_MODE) {
      setUiMode(CONVERT_UI_MODE);
      setConvertForm(
        buildInitialConvertForm(
          { assetId, targetAssetId, sourceAmount, targetAmount },
          assets,
          usdRate
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txToEdit?.id, convertPair?.sell.id, defaultUiMode]);

  if (!user) return null;
  if (transactionId && !txToEdit) {
    return <NotFound message="تراکنش پیدا نشد." onBack={() => router.back()} />;
  }

  const isEdit = !!txToEdit;
  const isConvertMode = uiMode === CONVERT_UI_MODE;
  const isConvertEdit = isEdit && !!convertPair;
  const sharedType = rows[0]?.type ?? 'BUY';
  const sharedStyle = styleForUiMode(uiMode);

  const switchUiMode = (mode: UiTransactionMode) => {
    if (isEdit) return;
    if (mode === uiMode) return;
    setUiMode(mode);
    if (mode === CONVERT_UI_MODE) {
      setConvertForm(
        buildInitialConvertForm({ assetId, targetAssetId, sourceAmount, targetAmount }, assets, usdRate)
      );
    } else {
      setRows([
        buildInitialForm(undefined, { ...prefillDefaults, defaultType: mode }, usdRate),
      ]);
    }
  };

  const updateRow = (idx: number, updater: (prev: FormState) => FormState) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? updater(r) : r)));
  };

  const addRow = () => {
    setRows((prev) => {
      const base = buildInitialForm(undefined, { defaultType: sharedType }, usdRate);
      const last = prev[prev.length - 1];
      const next = last
        ? {
            ...base,
            date: last.date,
            sourceKind: last.sourceKind,
            sourceId: last.sourceId,
          }
        : base;
      return [...prev, next];
    });
  };

  const removeRow = (idx: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
    setCollapsed((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const toggleCollapsed = (idx: number) => {
    setCollapsed((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  /**
   * Best-effort snapshot of BUY/SELL trades into `daily_prices`.
   *
   * Source-priority contract:
   *   manual > trade > auto   (higher NEVER gets overwritten by lower)
   *
   * We implement it client-side with a check-then-upsert:
   *   1. Build candidate rows from the txs we just saved.
   *   2. Drop any whose (asset_id, date_string) already has a MANUAL row.
   *   3. Within this batch, dedupe to one row per (asset_id, date_string),
   *      keeping the LAST occurrence (matches the user's typing order, and
   *      for a single-tx edit there's nothing to dedupe).
   *   4. Regular upsert — overwriting any prior trade/auto row for the
   *      same key is the correct behavior for edits.
   *
   * Race with a concurrent manual save between step 2 and step 4 is
   * tolerated: this is a single-user mobile app, interactions are serial.
   *
   * Failures are logged but NEVER abort the primary save. The live
   * `assets.price_*` cache is not involved here.
   */
  const persistTradeSnapshots = async (txs: Transaction[]) => {
    const candidates = buildTradeSnapshots(txs, user.id);
    if (candidates.length === 0) return;

    const manualKeys = new Set(
      dailyPrices
        .filter((p) => p.source === 'manual')
        .map((p) => `${p.asset_id}|${p.date_string}`)
    );

    const byKey = new Map<
      string,
      Omit<DailyPrice, 'created_at' | 'updated_at'>
    >();
    for (const row of candidates) {
      const key = `${row.asset_id}|${row.date_string}`;
      if (manualKeys.has(key)) continue;
      byKey.set(key, row); // last wins
    }
    const rows = [...byKey.values()];
    if (rows.length === 0) return;

    const { data, error } = await supabase
      .from('daily_prices')
      .upsert(rows, { onConflict: 'user_id,asset_id,date_string' })
      .select();
    if (error) {
      console.error('daily_prices trade snapshot failed', error);
      return;
    }
    const fresh = (data as DailyPrice[]) || [];
    if (fresh.length === 0) return;
    setDailyPrices((prev) => {
      const key = (p: DailyPrice) =>
        `${p.user_id}|${p.asset_id}|${p.date_string}`;
      const map = new Map(prev.map((p) => [key(p), p]));
      for (const p of fresh) map.set(key(p), p);
      return Array.from(map.values());
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isConvertMode) {
      const err = validateConvertForm(convertForm, transactions, wallets);
      if (err) {
        toast.error(err);
        return;
      }
      setIsSubmitting(true);
      try {
        const effective = applyMatchBuyValue(convertForm);
        const operationId = effective.operationId ?? crypto.randomUUID();
        const [sellPayload, buyPayload] = buildConvertPayloads(
          effective,
          user.id,
          wallets,
          currencyRates,
          usdRate,
          operationId
        );

        if (isConvertEdit && effective.sellTransactionId && effective.buyTransactionId) {
          const [sellRes, buyRes] = await Promise.all([
            supabase
              .from('transactions')
              .update(sellPayload)
              .eq('id', effective.sellTransactionId)
              .select()
              .single(),
            supabase
              .from('transactions')
              .update(buyPayload)
              .eq('id', effective.buyTransactionId)
              .select()
              .single(),
          ]);
          if (sellRes.error) throw sellRes.error;
          if (buyRes.error) throw buyRes.error;
          const updated = [sellRes.data, buyRes.data] as Transaction[];
          setTransactions((prev) =>
            prev.map((t) => updated.find((row) => row.id === t.id) ?? t)
          );
          await persistTradeSnapshots(updated);
          toast.success('تبدیل به‌روزرسانی شد.');
        } else {
          const { data, error } = await supabase
            .from('transactions')
            .insert([sellPayload, buyPayload])
            .select();
          if (error) throw error;
          const inserted = (data ?? []) as Transaction[];
          setTransactions((prev) => [...inserted.slice().reverse(), ...prev]);
          await persistTradeSnapshots(inserted);
          toast.success('تبدیل ثبت شد.');
        }
        router.back();
      } catch (err2) {
        console.error(err2);
        toast.error('خطا در ثبت تبدیل.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const err = validateForm(rows[i], wallets);
      if (err) {
        const msg = rows.length > 1 ? `تراکنش #${i + 1}: ${err}` : err;
        toast.error(msg);
        // Expand the offender and bring it on-screen.
        setCollapsed((prev) => ({ ...prev, [i]: false }));
        window.requestAnimationFrame(() => {
          rowRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      if (isEdit && txToEdit) {
        const payload = buildPayload(
          rows[0],
          user.id,
          wallets,
          currencyRates,
          usdRate
        );
        const { data, error } = await supabase
          .from('transactions')
          .update(payload)
          .eq('id', txToEdit.id)
          .select()
          .single();
        if (error) throw error;
        const updated = data as Transaction;
        setTransactions((prev) =>
          prev.map((t) => (t.id === txToEdit.id ? updated : t))
        );
        // Snapshot (trade) this edit too — never overwrites manual on conflict.
        await persistTradeSnapshots([updated]);
        toast.success('تراکنش به‌روزرسانی شد.');
        router.back();
      } else {
        const payloads = rows.map((r) =>
          buildPayload(r, user.id, wallets, currencyRates, usdRate)
        );
        const { data, error } = await supabase
          .from('transactions')
          .insert(payloads)
          .select();
        if (error) throw error;
        const inserted = (data ?? []) as Transaction[];
        setTransactions((prev) => [...inserted.slice().reverse(), ...prev]);
        // Best-effort: snapshot trades in parallel with the success toast.
        await persistTradeSnapshots(inserted);
        fireExpenseAlert(
          inserted.filter((tx) => tx.type === 'EXPENSE').map((tx) => tx.id)
        );
        toast.success(
          inserted.length > 1
            ? `${inserted.length} تراکنش ثبت شد.`
            : 'تراکنش ثبت شد.',
        );
        router.back();
      }
    } catch (err2) {
      console.error(err2);
      toast.error('خطا در ثبت تراکنش.');
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
            ? isConvertEdit
              ? 'ویرایش تبدیل'
              : 'ویرایش تراکنش'
            : isConvertMode
              ? 'تبدیل دارایی'
              : rows.length > 1
                ? `ثبت ${rows.length} تراکنش`
                : 'ثبت تراکنش جدید'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        {/* Type tabs */}
        <div className="grid grid-cols-6 gap-1 bg-[#1A1B26] p-1 rounded-xl">
          {UI_TABS.map((t) => {
            const s = styleForUiMode(t);
            const active = uiMode === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => switchUiMode(t)}
                disabled={isEdit && t !== uiMode}
                className={`py-2 text-[10px] sm:text-xs font-bold rounded-lg transition-all ${
                  active
                    ? `${s.accentBg} text-white shadow-md`
                    : 'text-slate-400 hover:text-slate-200 disabled:opacity-30'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {isEdit && (
          <p className="text-[11px] text-slate-500 -mt-2">
            {isConvertEdit
              ? 'تبدیل پس از ثبت به‌صورت فروش + خرید ویرایش می‌شود.'
              : 'نوع تراکنش پس از ثبت قابل تغییر نیست.'}
          </p>
        )}

        {isConvertMode ? (
          <ConvertTransactionForm
            form={convertForm}
            onChange={(updater) => setConvertForm((prev) => updater(prev))}
            assets={assets}
            wallets={wallets}
            transactions={transactions}
          />
        ) : (
          <>
        {/* Rows */}
        <div className="space-y-4">
          {rows.map((form, idx) => (
            <div
              key={idx}
              ref={(el) => {
                rowRefs.current[idx] = el;
              }}
            >
              <TransactionFormRow
                form={form}
                rowIndex={idx}
                totalRows={rows.length}
                isCollapsed={!!collapsed[idx]}
                canRemove={!isEdit && rows.length > 1}
                onChange={(updater) => updateRow(idx, updater)}
                onRemove={() => removeRow(idx)}
                onToggleCollapsed={() => toggleCollapsed(idx)}
                wallets={wallets}
                assets={assets}
                persons={persons}
                categories={categories}
                transactions={transactions}
                currencyRates={currencyRates}
                usdRate={usdRate}
              />
            </div>
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

        {/* Live preview */}
        <PreviewPanel
          rows={rows}
          wallets={wallets}
          assets={assets}
          persons={persons}
          categories={categories}
          style={sharedStyle}
        />
          </>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full ${sharedStyle.accentBtnBg} text-white p-4 rounded-xl font-bold ${sharedStyle.accentBtnShadow} transition-all disabled:opacity-50`}
        >
          {isSubmitting
            ? 'در حال ارسال...'
            : isEdit
              ? isConvertEdit
                ? 'ثبت تغییرات تبدیل'
                : 'ثبت تغییرات'
              : isConvertMode
                ? 'ثبت تبدیل'
                : rows.length > 1
                  ? `ثبت ${rows.length} تراکنش`
                  : 'ثبت تراکنش'}
        </button>
      </form>
    </div>
  );
}
