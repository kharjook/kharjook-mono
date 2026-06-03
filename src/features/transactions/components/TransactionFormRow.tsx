'use client';

import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  Calendar,
  ChevronLeft,
  Trash2,
} from 'lucide-react';
import { IOSDatePicker } from '@/shared/components/IOSDatePicker';
import type { Asset, Category, Person, Transaction, Wallet } from '@/shared/types/domain';
import type { CurrencyRate } from '@/shared/types/domain';
import {
  EndpointSheetPicker,
  type EndpointKind,
} from '@/features/transactions/components/EndpointSheetPicker';
import { CategorySheetPicker } from '@/shared/components/CategorySheetPicker';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import {
  addDays,
  formatJalaali,
  formatJalaaliHuman,
  parseJalaali,
  todayJalaali,
} from '@/shared/utils/jalali';
import {
  PRIMARY_SIDE,
  TYPE_SHAPES,
  TYPE_STYLES,
  pricingContextOf,
  type FormState,
} from '@/features/transactions/utils/transaction-form-types';
import {
  canonicalNumber,
  recomputeMoneySide,
  recomputeTransferTarget,
  sourceBalance,
  walletRateForTransfer,
} from '@/features/transactions/utils/transaction-form-logic';
import {
  CollapsedRow,
  CrossCurrencyTargetField,
  DateChip,
  DerivedAmountLine,
  DirectionCard,
  PriceFields,
  PrimaryAmountField,
  CategoryField,
} from '@/features/transactions/components/AddTransactionFormPieces';

export function TransactionFormRow({
  form,
  rowIndex,
  totalRows,
  isCollapsed,
  canRemove,
  onChange,
  onRemove,
  onToggleCollapsed,
  wallets,
  assets,
  persons,
  categories,
  transactions,
  currencyRates,
  usdRate,
}: {
  form: FormState;
  rowIndex: number;
  totalRows: number;
  isCollapsed: boolean;
  canRemove: boolean;
  onChange: (updater: (prev: FormState) => FormState) => void;
  onRemove: () => void;
  onToggleCollapsed: () => void;
  wallets: Wallet[];
  assets: Asset[];
  persons: Person[];
  categories: Category[];
  transactions: Transaction[];
  currencyRates: CurrencyRate[];
  usdRate: number;
}) {
  const shape = TYPE_SHAPES[form.type];
  const style = TYPE_STYLES[form.type];
  const pricing = pricingContextOf(form, wallets);
  const isBulk = totalRows > 1;

  const [pickerOpen, setPickerOpen] = useState<null | 'source' | 'target'>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);

  const sourceWallet = form.sourceKind === 'wallet' ? wallets.find((w) => w.id === form.sourceId) : undefined;
  const sourceAsset  = form.sourceKind === 'asset'  ? assets.find((a)  => a.id === form.sourceId) : undefined;
  const targetWallet = form.targetKind === 'wallet' ? wallets.find((w) => w.id === form.targetId) : undefined;
  const targetAsset  = form.targetKind === 'asset'  ? assets.find((a)  => a.id === form.targetId) : undefined;
  const targetPerson = form.targetKind === 'person' ? persons.find((p) => p.id === form.targetId) : undefined;

  // For non-IRT wallet income/expense, prefill unit price from the wallet
  // currency rate once if it's empty. This prevents accidental USD-based math
  // when the user expects TRY/EUR conversion from saved rates.
  useEffect(() => {
    if (form.type !== 'INCOME' && form.type !== 'EXPENSE') return;
    const wallet = form.type === 'INCOME' ? targetWallet : sourceWallet;
    if (!wallet || wallet.currency === 'IRT') return;
    const current = Number(form.priceToman);
    if (Number.isFinite(current) && current > 0) return;
    const rate = walletRateForTransfer(wallet, currencyRates, usdRate, form.usdRate);
    if (!(rate > 0)) return;
    onChange((prev) => {
      const existing = Number(prev.priceToman);
      if (Number.isFinite(existing) && existing > 0) return prev;
      return { ...prev, priceToman: canonicalNumber(rate) };
    });
  }, [
    currencyRates,
    form.priceToman,
    form.sourceKind,
    form.sourceId,
    form.targetKind,
    form.targetId,
    form.type,
    form.usdRate,
    onChange,
    sourceWallet,
    targetWallet,
    usdRate,
  ]);

  const srcBalance = sourceBalance(form, wallets, transactions, persons);
  const srcAmountNum = Number(form.sourceAmount);
  const isInsufficient =
    form.type !== 'INCOME' &&
    form.sourceKind !== 'person' &&
    srcBalance != null &&
    Number.isFinite(srcAmountNum) &&
    srcAmountNum > srcBalance;

  // Mutators --------------------------------------------------------------

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    onChange((prev) => {
      const next = { ...prev, [key]: value };
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
      if (
        next.type === 'TRANSFER' &&
        (key === 'sourceAmount' ||
          key === 'sourceId' ||
          key === 'targetId' ||
          key === 'sourceKind' ||
          key === 'targetKind' ||
          key === 'priceToman' ||
          key === 'usdRate')
      ) {
        return recomputeTransferTarget(next, wallets, assets, currencyRates, usdRate);
      }
      return next;
    });
  };

  const selectEndpoint = (side: 'source' | 'target') =>
    (kind: EndpointKind, id: string) => {
      onChange((prev) => {
        const next: FormState = side === 'source'
          ? { ...prev, sourceKind: kind, sourceId: id }
          : { ...prev, targetKind: kind, targetId: id };
        if (next.type === 'BUY' || next.type === 'SELL') {
          return recomputeMoneySide(next, wallets, currencyRates, usdRate);
        }
        if (next.type === 'TRANSFER') {
          return recomputeTransferTarget(next, wallets, assets, currencyRates, usdRate);
        }
        return next;
      });
    };

  // Primary-side amount setter. For TRANSFER same-currency, we mirror target.
  const setPrimaryAmount = (v: string) => {
    const primary = PRIMARY_SIDE[form.type];
    onChange((prev) => {
      const next: FormState = primary === 'source'
        ? { ...prev, sourceAmount: v }
        : { ...prev, targetAmount: v };

      if (next.type === 'BUY' || next.type === 'SELL') {
        return recomputeMoneySide(next, wallets, currencyRates, usdRate);
      }
      if (next.type === 'TRANSFER') {
        return recomputeTransferTarget(next, wallets, assets, currencyRates, usdRate);
      }
      return next;
    });
  };

  // Secondary editable input — only used for cross-currency TRANSFER.
  const setTargetAmountRaw = (v: string) => {
    onChange((prev) => ({ ...prev, targetAmount: v }));
  };

  const applySourcePercent = (pct: number) => {
    if (srcBalance == null || srcBalance <= 0) return;
    const amt = (srcBalance * pct) / 100;
    // Chips always target the source; only useful when source IS primary.
    if (PRIMARY_SIDE[form.type] !== 'source') return;
    setPrimaryAmount(canonicalNumber(amt));
  };

  // View helpers ----------------------------------------------------------

  const jalaali = parseJalaali(form.date);
  const dateLabel = jalaali ? formatJalaaliHuman(jalaali) : form.date || 'انتخاب تاریخ';
  const today = todayJalaali();
  const yesterday = addDays(today, -1);
  const isToday = jalaali && jalaali.jy === today.jy && jalaali.jm === today.jm && jalaali.jd === today.jd;
  const isYesterday =
    jalaali && jalaali.jy === yesterday.jy && jalaali.jm === yesterday.jm && jalaali.jd === yesterday.jd;

  const primarySide = PRIMARY_SIDE[form.type];
  const optionalSource = form.type === 'BUY';
  const optionalTarget = form.type === 'SELL';
  const canShowQuickChips =
    primarySide === 'source' &&
    form.sourceKind !== null &&
    form.sourceId !== null &&
    srcBalance != null &&
    srcBalance > 0;

  // Collapsed summary -----------------------------------------------------

  if (isBulk && isCollapsed) {
    return (
      <CollapsedRow
        form={form}
        rowIndex={rowIndex}
        style={style}
        canRemove={canRemove}
        onToggle={onToggleCollapsed}
        onRemove={onRemove}
        wallets={wallets}
        assets={assets}
        persons={persons}
        categories={categories}
      />
    );
  }

  // Expanded view ---------------------------------------------------------

  const clearOptionalSource = () => {
    onChange((prev) => ({ ...prev, sourceKind: null, sourceId: null, sourceAmount: '' }));
  };

  const clearOptionalTarget = () => {
    onChange((prev) => ({ ...prev, targetKind: null, targetId: null, targetAmount: '' }));
  };

  return (
    <>
      <div
        className={`rounded-2xl border ${style.accentBorder} bg-linear-to-b ${style.accentGradient} p-4 space-y-5`}
      >
        {isBulk && (
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold ${style.accentText}`}>
              تراکنش #{rowIndex + 1}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onToggleCollapsed}
                className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-slate-400 transition-colors"
                aria-label="جمع‌کردن"
              >
                <ChevronLeft size={14} />
              </button>
              {canRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  className="p-1.5 bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 rounded-lg text-slate-400 transition-colors"
                  aria-label="حذف"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Direction cards */}
        <div className="space-y-2">
          {shape.source && (
            <DirectionCard
              label="مبدأ"
              kind={form.sourceKind}
              wallet={sourceWallet}
              asset={sourceAsset}
              person={
                form.sourceKind === 'person'
                  ? persons.find((p) => p.id === form.sourceId)
                  : undefined
              }
              balance={srcBalance}
              insufficient={isInsufficient}
              optional={optionalSource}
              onTap={() => setPickerOpen('source')}
            />
          )}

          {optionalSource && (form.sourceKind || form.sourceId) && (
            <div className="-mt-1 flex justify-end">
              <button
                type="button"
                onClick={clearOptionalSource}
                className="text-[11px] text-slate-500 hover:text-white transition"
              >
                بدون ثبت مبدأ
              </button>
            </div>
          )}

          {shape.source && shape.target && (
            <div className="flex justify-center py-0.5">
              <div className={`p-1.5 rounded-full bg-white/5 ${style.accentText}`}>
                <ArrowDown size={14} />
              </div>
            </div>
          )}

          {shape.target && (
            <DirectionCard
              label="مقصد"
              kind={form.targetKind}
              wallet={targetWallet}
              asset={targetAsset}
              person={
                form.targetKind === 'person'
                  ? persons.find((p) => p.id === form.targetId)
                  : undefined
              }
              balance={
                form.targetKind === 'wallet' && targetWallet
                  ? calculateWalletStats(targetWallet, transactions).balance
                  : form.targetKind === 'person' && form.targetId
                    ? sourceBalance(
                        {
                          ...form,
                          sourceKind: 'person',
                          sourceId: form.targetId,
                        },
                        wallets,
                        transactions,
                        persons
                      )
                  : null
              }
              insufficient={false}
              optional={optionalTarget}
              onTap={() => setPickerOpen('target')}
            />
          )}

          {optionalTarget && (form.targetKind || form.targetId) && (
            <div className="-mt-1 flex justify-end">
              <button
                type="button"
                onClick={clearOptionalTarget}
                className="text-[11px] text-slate-500 hover:text-white transition"
              >
                بدون ثبت مقصد
              </button>
            </div>
          )}
        </div>

        {/* Date */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">تاریخ</label>
          <button
            type="button"
            onClick={() => setDateOpen(true)}
            className="w-full flex items-center gap-3 bg-[#1A1B26] border border-white/10 hover:border-white/20 rounded-xl p-3 text-right transition"
          >
            <Calendar size={16} className={style.accentText} />
            <span className="text-sm text-slate-100 flex-1">{dateLabel}</span>
          </button>
          <div className="mt-2 flex gap-2">
            <DateChip
              label="امروز"
              active={!!isToday}
              onClick={() => updateField('date', formatJalaali(today))}
            />
            <DateChip
              label="دیروز"
              active={!!isYesterday}
              onClick={() => updateField('date', formatJalaali(yesterday))}
            />
          </div>
        </div>

        {/* Primary amount input */}
        <PrimaryAmountField
          form={form}
          primarySide={primarySide}
          sourceWallet={sourceWallet}
          targetWallet={targetWallet}
          sourceAsset={sourceAsset}
          targetAsset={targetAsset}
          isInsufficient={isInsufficient}
          onChange={setPrimaryAmount}
        />

        {/* Source balance info + quick chips */}
        {canShowQuickChips && (
          <div className="flex flex-wrap items-center gap-2 -mt-2">
            <span className="text-[11px] text-slate-500">درصدی از موجودی:</span>
            {[25, 50, 75, 100].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => applySourcePercent(p)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-lg bg-white/5 hover:bg-white/10 ${style.accentText} transition`}
              >
                {p === 100 ? 'همه' : `${p}٪`}
              </button>
            ))}
          </div>
        )}

        {/* Price fields (BUY/SELL; INCOME/EXPENSE when priced; TRANSFER
            wallet→asset: USD rate only, asset→wallet: sell price + USD rate). */}
        {pricing.needsPrice && (
          <PriceFields
            priceLabel={pricing.priceLabel}
            priceToman={form.priceToman}
            usdRate={form.usdRate}
            onPriceToman={(v) => updateField('priceToman', v)}
            onUsdRate={(v) => updateField('usdRate', v)}
            showTomanPrice={pricing.showTomanPrice !== false}
            showUsdRate={pricing.needsUsdRate}
          />
        )}

        {/* Derived (auto-computed) amount — read-only */}
        {((form.type === 'BUY' && sourceWallet) || (form.type === 'SELL' && targetWallet)) && (
          <DerivedAmountLine
            form={form}
            sourceWallet={sourceWallet}
            targetWallet={targetWallet}
          />
        )}

        {/* Secondary editable amount — shown when target cannot be auto-derived. */}
        {form.type === 'TRANSFER' &&
          !(
            // Auto-derived routes:
            // - same-currency wallet↔wallet mirrors source amount
            // - wallet→asset derives units from money+price
            // - asset→wallet derives money from qty+price
            (sourceWallet &&
              targetWallet &&
              sourceWallet.currency === targetWallet.currency) ||
            (sourceWallet && targetAsset) ||
            (sourceAsset && targetWallet)
          ) && (
            <CrossCurrencyTargetField
              value={form.targetAmount}
              targetWallet={targetWallet}
              targetAsset={targetAsset}
              targetPerson={targetPerson}
              onChange={setTargetAmountRaw}
            />
          )}

        {/* Category */}
        {shape.needsCategory && (
          <CategoryField
            kind={shape.needsCategory}
            categories={categories}
            value={form.categoryId}
            onOpen={() => setCategoryOpen(true)}
          />
        )}

        {/* Note */}
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            توضیحات (اختیاری)
          </label>
          <textarea
            value={form.note}
            onChange={(e) => updateField('note', e.target.value)}
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl p-3 text-white text-sm focus:border-purple-500 outline-none min-h-[60px]"
            maxLength={500}
          />
        </div>

        {/* Transfer cross-currency warning */}
        {form.type === 'TRANSFER' &&
          sourceWallet &&
          targetWallet &&
          sourceWallet.currency !== targetWallet.currency && (
            <div className="flex items-center gap-2 text-[11px] text-amber-400/80 -mt-2">
              <ArrowLeftRight size={12} />
              انتقال بین دو ارز متفاوت — هر دو مقدار را به‌صورت دستی وارد کن.
            </div>
          )}
      </div>

      {/* Endpoint picker sheet */}
      <EndpointSheetPicker
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        title={pickerOpen === 'source' ? 'انتخاب مبدأ' : 'انتخاب مقصد'}
        allow={
          pickerOpen === 'source'
            ? (shape.source ?? [])
            : (shape.target ?? [])
        }
        excludeIds={
          pickerOpen === 'source'
            ? (form.sourceKind === form.targetKind ? [form.targetId ?? ''] : [])
            : (form.sourceKind === form.targetKind ? [form.sourceId ?? ''] : [])
        }
        wallets={wallets}
        assets={assets}
        persons={persons}
        transactions={transactions}
        onSelect={(kind, id) => {
          if (pickerOpen) selectEndpoint(pickerOpen)(kind, id);
        }}
      />

      {/* iOS date picker */}
      <IOSDatePicker
        open={dateOpen}
        onClose={() => setDateOpen(false)}
        value={form.date}
        onChange={(v) => updateField('date', v)}
      />

      {/* Category picker sheet */}
      {shape.needsCategory && (
        <CategorySheetPicker
          open={categoryOpen}
          onClose={() => setCategoryOpen(false)}
          title={shape.needsCategory === 'income' ? 'انتخاب دسته درآمد' : 'انتخاب دسته هزینه'}
          kind={shape.needsCategory}
          categories={categories}
          value={form.categoryId}
          onSelect={(id) => updateField('categoryId', id)}
        />
      )}
    </>
  );
}
