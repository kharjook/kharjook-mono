'use client';

import { useMemo, useState } from 'react';
import {
  Coins,
  Search,
  UserRound,
  Wallet as WalletIcon,
} from 'lucide-react';
import { BottomSheet } from '@/shared/components/BottomSheet';
import { EntityIcon } from '@/shared/components/EntityIcon';
import type {
  Asset,
  Person,
  Transaction,
  Wallet,
} from '@/shared/types/domain';
import { CURRENCY_META } from '@/features/wallets/constants/currency-meta';
import { calculateWalletStats } from '@/shared/utils/calculate-wallet-balance';
import { formatCurrencyAmount } from '@/shared/utils/format-currency';
import { assetDecimals, formatAssetAmount } from '@/shared/utils/format-asset-amount';

export type EndpointKind = 'wallet' | 'asset' | 'person';

export interface EndpointSheetPickerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Which endpoint kinds this side accepts. */
  allow: EndpointKind[];
  /** IDs to hide (e.g. opposite side of a transfer). */
  excludeIds?: string[];
  wallets: Wallet[];
  assets: Asset[];
  persons: Person[];
  transactions: Transaction[];
  onSelect: (kind: EndpointKind, id: string) => void;
}

export function EndpointSheetPicker({
  open,
  onClose,
  title,
  allow,
  excludeIds = [],
  wallets,
  assets,
  persons,
  transactions,
  onSelect,
}: EndpointSheetPickerProps) {
  const [query, setQuery] = useState('');

  const exclude = useMemo(() => new Set(excludeIds.filter(Boolean)), [excludeIds]);

  const filteredWallets = useMemo(() => {
    if (!allow.includes('wallet')) return [];
    const q = query.trim().toLowerCase();
    return wallets
      .filter((w) => !exclude.has(w.id))
      .filter((w) =>
        q === ''
          ? true
          : w.name.toLowerCase().includes(q) ||
            w.currency.toLowerCase().includes(q)
      );
  }, [wallets, allow, exclude, query]);

  const assetHoldings = useMemo(() => {
    if (!allow.includes('asset')) return new Map<string, number>();
    // Lightweight fold — we don't need PnL here, just current holdings.
    // Must support both legacy BUY/SELL rows and polymorphic asset-side
    // INCOME/EXPENSE rows.
    const map = new Map<string, number>();
    for (const tx of transactions) {
      const isAcquire = tx.type === 'BUY' || tx.type === 'INCOME';
      const isDispose = tx.type === 'SELL' || tx.type === 'EXPENSE';
      if (!isAcquire && !isDispose) continue;

      const assetId = isAcquire
        ? tx.target_asset_id ?? tx.asset_id
        : tx.source_asset_id ?? tx.asset_id;
      if (!assetId) continue;

      const rawAmount = tx.amount ?? (isAcquire ? tx.target_amount : tx.source_amount);
      const amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const next = (map.get(assetId) ?? 0) + (isAcquire ? amount : -amount);
      map.set(assetId, next);
    }
    return map;
  }, [transactions, allow]);

  const filteredAssets = useMemo(() => {
    if (!allow.includes('asset')) return [];
    const q = query.trim().toLowerCase();
    return assets
      .filter((a) => !exclude.has(a.id))
      .filter((a) =>
        q === ''
          ? true
          : a.name.toLowerCase().includes(q) || a.unit.toLowerCase().includes(q)
      );
  }, [assets, allow, exclude, query]);

  const personBalances = useMemo(() => {
    if (!allow.includes('person')) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.target_person_id) {
        map.set(
          tx.target_person_id,
          (map.get(tx.target_person_id) ?? 0) + (Number(tx.target_amount) || 0)
        );
      }
      if (tx.source_person_id) {
        map.set(
          tx.source_person_id,
          (map.get(tx.source_person_id) ?? 0) - (Number(tx.source_amount) || 0)
        );
      }
    }
    return map;
  }, [transactions, allow]);

  const filteredPersons = useMemo(() => {
    if (!allow.includes('person')) return [];
    const q = query.trim().toLowerCase();
    return persons
      .filter((person) => !exclude.has(person.id))
      .filter((person) =>
        q === '' ? true : person.name.toLowerCase().includes(q)
      );
  }, [persons, allow, exclude, query]);

  const handleSelect = (kind: EndpointKind, id: string) => {
    onSelect(kind, id);
    onClose();
    setQuery('');
  };

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        onClose();
        setQuery('');
      }}
      title={title}
      header={
        <div className="relative">
          <Search
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو..."
            className="w-full bg-[#1A1B26] border border-white/10 rounded-xl py-2.5 pr-9 pl-3 text-sm text-white placeholder:text-slate-500 focus:border-purple-500 outline-none"
            autoFocus
          />
        </div>
      }
    >
      <div className="space-y-5">
        {allow.includes('wallet') && (
          <Section
            label="کیف پول‌ها"
            empty={filteredWallets.length === 0 ? 'کیف پولی یافت نشد.' : null}
          >
            {filteredWallets.map((w) => {
              const stats = calculateWalletStats(w, transactions);
              const meta = CURRENCY_META[w.currency];
              return (
                <PickerRow
                  key={w.id}
                  onClick={() => handleSelect('wallet', w.id)}
                  iconUrl={w.icon_url}
                  fallback={<WalletIcon size={18} />}
                  iconBg="rgba(168, 85, 247, 0.12)"
                  iconColor="#c084fc"
                  title={w.name}
                  subtitle={`${meta.symbol} ${w.currency}`}
                  right={
                    <span
                      className="text-xs  text-slate-300"
                      dir="ltr"
                    >
                      {formatCurrencyAmount(stats.balance, w.currency)}
                    </span>
                  }
                />
              );
            })}
          </Section>
        )}

        {allow.includes('asset') && (
          <Section
            label="دارایی‌ها"
            empty={filteredAssets.length === 0 ? 'دارایی‌ای یافت نشد.' : null}
          >
            {filteredAssets.map((a) => {
              const holding = assetHoldings.get(a.id) ?? 0;
              return (
                <PickerRow
                  key={a.id}
                  onClick={() => handleSelect('asset', a.id)}
                  iconUrl={a.icon_url}
                  fallback={<Coins size={18} />}
                  iconBg="rgba(251, 191, 36, 0.12)"
                  iconColor="#fbbf24"
                  title={a.name}
                  subtitle={a.unit}
                  right={
                    <span
                      className="text-xs  text-slate-300"
                      dir="ltr"
                    >
                      {holding > 0
                        ? formatAssetAmount(holding, assetDecimals(a))
                        : '—'}
                    </span>
                  }
                />
              );
            })}
          </Section>
        )}

        {allow.includes('person') && (
          <Section
            label="اشخاص"
            empty={filteredPersons.length === 0 ? 'شخصی یافت نشد.' : null}
          >
            {filteredPersons.map((person) => {
              const balance = personBalances.get(person.id) ?? 0;
              const status =
                balance > 0 ? 'بدهکار' : balance < 0 ? 'بستانکار' : 'تسویه';
              const tone =
                balance > 0
                  ? 'text-amber-300'
                  : balance < 0
                    ? 'text-cyan-300'
                    : 'text-slate-500';
              return (
                <PickerRow
                  key={person.id}
                  onClick={() => handleSelect('person', person.id)}
                  iconUrl={null}
                  fallback={<UserRound size={18} />}
                  iconBg="rgba(56, 189, 248, 0.12)"
                  iconColor="#7dd3fc"
                  title={person.name}
                  subtitle={`وضعیت: ${status}`}
                  right={
                    <span className={`text-xs ${tone}`} dir="ltr">
                      {Math.abs(balance).toLocaleString('en-US', {
                        maximumFractionDigits: 6,
                      })}
                    </span>
                  }
                />
              );
            })}
          </Section>
        )}
      </div>
    </BottomSheet>
  );
}

function Section({
  label,
  empty,
  children,
}: {
  label: string;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-2">
        {label}
      </p>
      {empty ? (
        <p className="text-xs text-slate-500 py-4 text-center">{empty}</p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </div>
  );
}

function PickerRow({
  onClick,
  iconUrl,
  fallback,
  iconBg,
  iconColor,
  title,
  subtitle,
  right,
}: {
  onClick: () => void;
  iconUrl: string | null | undefined;
  fallback: React.ReactNode;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-[#1A1B26] border border-white/5 hover:bg-[#222436] active:scale-[0.99] transition rounded-xl p-3 text-right"
    >
      <EntityIcon
        iconUrl={iconUrl}
        fallback={fallback}
        bgColor={iconBg}
        color={iconColor}
        className="w-10 h-10 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-100 truncate">{title}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      {right && <div className="shrink-0 pl-1">{right}</div>}
    </button>
  );
}
