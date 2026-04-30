'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { supabase } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/Toast';
import {
  fetchProviderQuotes,
  mergeById,
  mergeCurrencyRates,
  mergeDailyPrices,
  mergeGlobalUsdDollarQuotes,
  persistCurrencyRate,
  persistProviderQuotes,
} from '@/features/prices/utils/provider-refresh';
import type {
  Asset,
  AuthUser,
  Category,
  CurrencyMode,
  CurrencyRate,
  DailyPrice,
  Person,
  Transaction,
  Wallet,
} from '@/shared/types/domain';

const USD_RATE_SOURCE_SLUG = 'abantether.usdt';

interface AuthValue {
  user: AuthUser | null;
  isLoadingAuth: boolean;
  logout: () => Promise<void>;
}

interface DataValue {
  categories: Category[];
  assets: Asset[];
  transactions: Transaction[];
  wallets: Wallet[];
  currencyRates: CurrencyRate[];
  persons: Person[];
  /**
   * End-of-day snapshots used by the reports feature to compute unrealized
   * P/L at a past period's end. See `DailyPrice` for the write-priority rules.
   */
  dailyPrices: DailyPrice[];
  isLoadingData: boolean;
  setCategories: Dispatch<SetStateAction<Category[]>>;
  setAssets: Dispatch<SetStateAction<Asset[]>>;
  setTransactions: Dispatch<SetStateAction<Transaction[]>>;
  setWallets: Dispatch<SetStateAction<Wallet[]>>;
  setCurrencyRates: Dispatch<SetStateAction<CurrencyRate[]>>;
  setPersons: Dispatch<SetStateAction<Person[]>>;
  setDailyPrices: Dispatch<SetStateAction<DailyPrice[]>>;
  refresh: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

interface UIValue {
  currencyMode: CurrencyMode;
  /**
   * Tomans per 1 USD — derived from `currency_rates.USD`. Falls back to a
   * sane constant only so math (divisions, conversions) never blows up
   * before the user has set a rate. Use `usdRateIsSet` to know whether
   * the value is real or a placeholder.
   */
  usdRate: number;
  usdRateIsSet: boolean;
  setCurrencyMode: Dispatch<SetStateAction<CurrencyMode>>;
  toggleCurrency: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);
const DataContext = createContext<DataValue | null>(null);
const UIContext = createContext<UIValue | null>(null);

const FALLBACK_USD_RATE = 60000;

export interface PortfolioProviderProps {
  initialUser: AuthUser | null;
  children: ReactNode;
}

export function PortfolioProvider({
  initialUser,
  children,
}: PortfolioProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [isLoadingAuth, setIsLoadingAuth] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [currencyRates, setCurrencyRates] = useState<CurrencyRate[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);
  const [dailyPrices, setDailyPrices] = useState<DailyPrice[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('TOMAN');

  const toast = useToast();
  const fetchSeq = useRef(0);

  const refreshInternal = useCallback(async (includeExternal: boolean) => {
    if (!user) return;
    const seq = ++fetchSeq.current;
    setIsLoadingData(true);
    try {
      const [catRes, astRes, txRes, walRes, rateRes, perRes, dpRes] = await Promise.all([
        supabase
          .from('categories')
          .select('*')
          .order('order_index', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
        supabase
          .from('assets')
          .select('*')
          .order('order_index', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
        supabase
          .from('transactions')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('wallets')
          .select('*')
          .is('archived_at', null)
          .order('order_index', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
        supabase.from('currency_rates').select('*'),
        supabase
          .from('persons')
          .select('*')
          .order('order_index', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true }),
        supabase
          .from('daily_prices')
          .select('*')
          .order('date_string', { ascending: false }),
      ]);

      if (seq !== fetchSeq.current) return;

      if (catRes.error) throw catRes.error;
      if (astRes.error) throw astRes.error;
      if (txRes.error) throw txRes.error;
      if (walRes.error) throw walRes.error;
      if (rateRes.error) throw rateRes.error;
      if (perRes.error) throw perRes.error;
      if (dpRes.error) throw dpRes.error;

      const nextCategories = (catRes.data as Category[]) || [];
      let nextAssets = (astRes.data as Asset[]) || [];
      const nextTransactions = (txRes.data as Transaction[]) || [];
      const nextWallets = (walRes.data as Wallet[]) || [];
      let nextCurrencyRates = (rateRes.data as CurrencyRate[]) || [];
      const nextPersons = (perRes.data as Person[]) || [];
      let nextDailyPrices = (dpRes.data as DailyPrice[]) || [];

      if (includeExternal) {
        try {
          const providerSlugs = Array.from(
            new Set(
              [USD_RATE_SOURCE_SLUG, ...nextAssets.map((asset) => asset.price_source_id)].filter(
                (slug): slug is string => !!slug
              )
            )
          );

          if (providerSlugs.length > 0) {
            const quotesRaw = await fetchProviderQuotes(providerSlugs);
            const usdQuote = quotesRaw.find((quote) => quote.slug === USD_RATE_SOURCE_SLUG);
            const effectiveUsdRate =
              usdQuote?.priceToman && usdQuote.priceToman > 0
                ? usdQuote.priceToman
                : Number(
                    nextCurrencyRates.find((rate) => rate.currency === 'USD')
                      ?.toman_per_unit ?? 0
                  );

            if (usdQuote && usdQuote.priceToman > 0) {
              const freshRates = await persistCurrencyRate(
                user.id,
                'USD',
                usdQuote.priceToman
              );
              nextCurrencyRates = mergeCurrencyRates(nextCurrencyRates, freshRates);
            }

            if (effectiveUsdRate > 0) {
              const quotes = mergeGlobalUsdDollarQuotes(
                quotesRaw,
                nextAssets,
                effectiveUsdRate
              );
              const persisted = await persistProviderQuotes({
                userId: user.id,
                assets: nextAssets,
                dailyPrices: nextDailyPrices,
                usdRate: effectiveUsdRate,
                quotes,
              });
              nextAssets = mergeById(nextAssets, persisted.assets);
              nextDailyPrices = mergeDailyPrices(
                nextDailyPrices,
                persisted.dailyPrices
              );
            }
          }
        } catch (error) {
          console.error('external price sync failed', error);
        }
      }

      setCategories(nextCategories);
      setAssets(nextAssets);
      setTransactions(nextTransactions);
      setWallets(nextWallets);
      setCurrencyRates(nextCurrencyRates);
      setPersons(nextPersons);
      setDailyPrices(nextDailyPrices);
    } catch (error) {
      if (seq !== fetchSeq.current) return;
      console.error('Error fetching data:', error);
      toast.error('خطا در دریافت اطلاعات از سرور.');
    } finally {
      if (seq === fetchSeq.current) {
        setIsLoadingData(false);
      }
    }
  }, [user, toast]);

  const refresh = useCallback(async () => {
    await refreshInternal(false);
  }, [refreshInternal]);

  const refreshAll = useCallback(async () => {
    await refreshInternal(true);
  }, [refreshInternal]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      void refresh();
    } else {
      setCategories([]);
      setAssets([]);
      setTransactions([]);
      setWallets([]);
      setCurrencyRates([]);
      setPersons([]);
      setDailyPrices([]);
    }
  }, [user, refresh]);

  const logout = useCallback(async () => {
    setIsLoadingAuth(true);
    await supabase.auth.signOut();
    setIsLoadingAuth(false);
  }, []);

  const toggleCurrency = useCallback(() => {
    setCurrencyMode((prev) => (prev === 'USD' ? 'TOMAN' : 'USD'));
  }, []);

  const authValue = useMemo<AuthValue>(
    () => ({ user, isLoadingAuth, logout }),
    [user, isLoadingAuth, logout]
  );

  const dataValue = useMemo<DataValue>(
    () => ({
      categories,
      assets,
      transactions,
      wallets,
      currencyRates,
      persons,
      dailyPrices,
      isLoadingData,
      setCategories,
      setAssets,
      setTransactions,
      setWallets,
      setCurrencyRates,
      setPersons,
      setDailyPrices,
      refresh,
      refreshAll,
    }),
    [
      categories,
      assets,
      transactions,
      wallets,
      currencyRates,
      persons,
      dailyPrices,
      isLoadingData,
      refresh,
      refreshAll,
    ]
  );

  const uiValue = useMemo<UIValue>(() => {
    const stored = currencyRates.find((r) => r.currency === 'USD');
    const storedNum = stored ? Number(stored.toman_per_unit) : 0;
    const isSet = storedNum > 0;
    return {
      currencyMode,
      usdRate: isSet ? storedNum : FALLBACK_USD_RATE,
      usdRateIsSet: isSet,
      setCurrencyMode,
      toggleCurrency,
    };
  }, [currencyMode, currencyRates, toggleCurrency]);

  return (
    <AuthContext.Provider value={authValue}>
      <UIContext.Provider value={uiValue}>
        <DataContext.Provider value={dataValue}>{children}</DataContext.Provider>
      </UIContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside PortfolioProvider');
  return ctx;
}

export function useData(): DataValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside PortfolioProvider');
  return ctx;
}

export function useUI(): UIValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside PortfolioProvider');
  return ctx;
}
