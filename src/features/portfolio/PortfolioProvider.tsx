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
import type {
  Asset,
  AuthUser,
  Category,
  CurrencyMode,
  Transaction,
} from '@/shared/types/domain';

interface AuthValue {
  user: AuthUser | null;
  isLoadingAuth: boolean;
  logout: () => Promise<void>;
}

interface DataValue {
  categories: Category[];
  assets: Asset[];
  transactions: Transaction[];
  isLoadingData: boolean;
  setCategories: Dispatch<SetStateAction<Category[]>>;
  setAssets: Dispatch<SetStateAction<Asset[]>>;
  setTransactions: Dispatch<SetStateAction<Transaction[]>>;
  refresh: () => Promise<void>;
}

interface UIValue {
  currencyMode: CurrencyMode;
  globalUsd: number;
  setCurrencyMode: Dispatch<SetStateAction<CurrencyMode>>;
  setGlobalUsd: Dispatch<SetStateAction<number>>;
  toggleCurrency: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);
const DataContext = createContext<DataValue | null>(null);
const UIContext = createContext<UIValue | null>(null);

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
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('TOMAN');
  const [globalUsd, setGlobalUsd] = useState(60000);

  const fetchSeq = useRef(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    const seq = ++fetchSeq.current;
    setIsLoadingData(true);
    try {
      const [catRes, astRes, txRes] = await Promise.all([
        supabase
          .from('categories')
          .select('*')
          .order('created_at', { ascending: true }),
        supabase
          .from('assets')
          .select('*')
          .order('created_at', { ascending: true }),
        supabase
          .from('transactions')
          .select('*')
          .order('created_at', { ascending: false }),
      ]);

      if (seq !== fetchSeq.current) return;

      if (catRes.error) throw catRes.error;
      if (astRes.error) throw astRes.error;
      if (txRes.error) throw txRes.error;

      setCategories((catRes.data as Category[]) || []);
      setAssets((astRes.data as Asset[]) || []);
      setTransactions((txRes.data as Transaction[]) || []);
    } catch (error) {
      if (seq !== fetchSeq.current) return;
      console.error('Error fetching data:', error);
      alert('خطا در دریافت اطلاعات از سرور');
    } finally {
      if (seq === fetchSeq.current) {
        setIsLoadingData(false);
      }
    }
  }, [user]);

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
      refresh();
    } else {
      setCategories([]);
      setAssets([]);
      setTransactions([]);
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
      isLoadingData,
      setCategories,
      setAssets,
      setTransactions,
      refresh,
    }),
    [categories, assets, transactions, isLoadingData, refresh]
  );

  const uiValue = useMemo<UIValue>(
    () => ({
      currencyMode,
      globalUsd,
      setCurrencyMode,
      setGlobalUsd,
      toggleCurrency,
    }),
    [currencyMode, globalUsd, toggleCurrency]
  );

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
