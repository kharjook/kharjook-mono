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
import {
  applyConversionRatesToQuotes,
  buildConversionConfigMap,
} from '@/features/prices/utils/conversion-rate';
import {
  catalogToApiSources,
  ensureDefaultPriceSources,
  recordsToCatalog,
} from '@/features/prices/utils/price-source-catalog';
import type {
  Asset,
  AuthUser,
  Category,
  CurrencyMode,
  CurrencyRate,
  DailyPrice,
  Goal,
  Person,
  PriceSourceRecord,
  PriceSourceSetting,
  Transaction,
  Wallet,
} from '@/shared/types/domain';
import type { PriceSource } from '@/features/prices/constants/price-sources';

const USD_RATE_SOURCE_SLUG = 'abantether.usdt';
const TRANSACTIONS_PAGE_SIZE = 200;

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
  goals: Goal[];
  priceSourceSettings: PriceSourceSetting[];
  /** User's price source catalog — drives auto-fetch slugs/keys/labels. */
  priceSources: PriceSourceRecord[];
  priceSourceCatalog: PriceSource[];
  isLoadingData: boolean;
  /** False while background pages of transactions are still loading. */
  transactionsFullyLoaded: boolean;
  setCategories: Dispatch<SetStateAction<Category[]>>;
  setAssets: Dispatch<SetStateAction<Asset[]>>;
  setTransactions: Dispatch<SetStateAction<Transaction[]>>;
  setWallets: Dispatch<SetStateAction<Wallet[]>>;
  setCurrencyRates: Dispatch<SetStateAction<CurrencyRate[]>>;
  setPersons: Dispatch<SetStateAction<Person[]>>;
  setDailyPrices: Dispatch<SetStateAction<DailyPrice[]>>;
  setGoals: Dispatch<SetStateAction<Goal[]>>;
  setPriceSourceSettings: Dispatch<SetStateAction<PriceSourceSetting[]>>;
  setPriceSources: Dispatch<SetStateAction<PriceSourceRecord[]>>;
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
  const [goals, setGoals] = useState<Goal[]>([]);
  const [priceSourceSettings, setPriceSourceSettings] = useState<PriceSourceSetting[]>([]);
  const [priceSources, setPriceSources] = useState<PriceSourceRecord[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [transactionsFullyLoaded, setTransactionsFullyLoaded] = useState(true);

  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('TOMAN');

  const toast = useToast();
  const fetchSeq = useRef(0);

  const refreshInternal = useCallback(async (includeExternal: boolean) => {
    if (!user) return;
    const seq = ++fetchSeq.current;
    setIsLoadingData(true);
    try {
      const [catRes, astRes, txRes, walRes, rateRes, perRes, dpRes, goalRes, pssRes, psRes] = await Promise.all([
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
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(0, TRANSACTIONS_PAGE_SIZE - 1),
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
        supabase
          .from('goals')
          .select('*')
          .order('created_at', { ascending: true }),
        supabase.from('price_source_settings').select('*'),
        supabase
          .from('price_sources')
          .select('*')
          .order('is_builtin', { ascending: false })
          .order('slug', { ascending: true }),
      ]);

      if (seq !== fetchSeq.current) return;

      if (catRes.error) throw catRes.error;
      if (astRes.error) throw astRes.error;
      if (txRes.error) throw txRes.error;
      if (walRes.error) throw walRes.error;
      if (rateRes.error) throw rateRes.error;
      if (perRes.error) throw perRes.error;
      if (dpRes.error) throw dpRes.error;
      if (goalRes.error) throw goalRes.error;
      if (pssRes.error) throw pssRes.error;
      if (psRes.error) throw psRes.error;

      const nextCategories = (catRes.data as Category[]) || [];
      let nextAssets = (astRes.data as Asset[]) || [];
      const nextTransactions = (txRes.data as Transaction[]) || [];
      const transactionTotalCount = txRes.count ?? nextTransactions.length;
      const nextWallets = (walRes.data as Wallet[]) || [];
      let nextCurrencyRates = (rateRes.data as CurrencyRate[]) || [];
      const nextPersons = (perRes.data as Person[]) || [];
      let nextDailyPrices = (dpRes.data as DailyPrice[]) || [];
      const nextGoals = (goalRes.data as Goal[]) || [];
      let nextPriceSourceSettings = (pssRes.data as PriceSourceSetting[]) || [];
      let nextPriceSources = (psRes.data as PriceSourceRecord[]) || [];

      if (nextPriceSources.length === 0) {
        const seeded = await ensureDefaultPriceSources(user.id);
        if (seeded.length > 0) {
          nextPriceSources = seeded;
          const { data: freshSettings } = await supabase
            .from('price_source_settings')
            .select('*');
          if (freshSettings) {
            nextPriceSourceSettings = freshSettings as PriceSourceSetting[];
          }
        }
      }

      const priceSourceCatalog = recordsToCatalog(nextPriceSources);
      const conversionConfigs = buildConversionConfigMap(nextPriceSourceSettings);

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
            const quotesRaw = await fetchProviderQuotes(
              providerSlugs,
              catalogToApiSources(priceSourceCatalog)
            );
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
              const quotes = applyConversionRatesToQuotes(
                mergeGlobalUsdDollarQuotes(quotesRaw, nextAssets, effectiveUsdRate),
                conversionConfigs,
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
      setGoals(nextGoals);
      setPriceSourceSettings(nextPriceSourceSettings);
      setPriceSources(nextPriceSources);

      const needsMoreTransactions = transactionTotalCount > TRANSACTIONS_PAGE_SIZE;
      setTransactionsFullyLoaded(!needsMoreTransactions);

      if (needsMoreTransactions) {
        void (async () => {
          let offset = TRANSACTIONS_PAGE_SIZE;
          let merged = [...nextTransactions];
          while (offset < transactionTotalCount) {
            const { data: page, error: pageError } = await supabase
              .from('transactions')
              .select('*')
              .order('created_at', { ascending: false })
              .range(offset, offset + TRANSACTIONS_PAGE_SIZE - 1);
            if (pageError || !page?.length) break;
            merged = [...merged, ...(page as Transaction[])];
            offset += TRANSACTIONS_PAGE_SIZE;
            if (seq === fetchSeq.current) {
              setTransactions(merged);
            }
            if (page.length < TRANSACTIONS_PAGE_SIZE) break;
          }
          if (seq === fetchSeq.current) {
            setTransactionsFullyLoaded(true);
          }
        })();
      }
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
      const nextUser = session?.user ?? null;
      // Tab-focus token refresh can emit auth events with a new user object
      // reference but the same identity. Ignore those to avoid re-fetching
      // all initial data unnecessarily.
      setUser((prev) => {
        if (prev?.id === nextUser?.id) return prev;
        return nextUser;
      });
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
      setGoals([]);
      setPriceSourceSettings([]);
      setPriceSources([]);
      setTransactionsFullyLoaded(true);
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

  const priceSourceCatalog = useMemo(
    () => recordsToCatalog(priceSources),
    [priceSources]
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
      goals,
      priceSourceSettings,
      priceSources,
      priceSourceCatalog,
      isLoadingData,
      transactionsFullyLoaded,
      setCategories,
      setAssets,
      setTransactions,
      setWallets,
      setCurrencyRates,
      setPersons,
      setDailyPrices,
      setGoals,
      setPriceSourceSettings,
      setPriceSources,
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
      goals,
      priceSourceSettings,
      priceSources,
      priceSourceCatalog,
      isLoadingData,
      transactionsFullyLoaded,
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
