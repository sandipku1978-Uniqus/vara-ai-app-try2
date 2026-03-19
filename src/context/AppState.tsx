import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ChatMessage } from '../types';
import type { SearchFilters } from '../components/filters/SearchFilterBar';
import type { ResearchSearchMode } from '../services/filingResearch';

export interface FilingContext {
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  companyName: string;
  formType: string;
  filingDate: string;
}

export interface SavedAlert {
  id: string;
  name: string;
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
  defaultForms: string;
  createdAt: string;
  lastCheckedAt?: string;
  lastSeenAccessions: string[];
  latestNewAccessions: string[];
  latestResultCount: number;
}

interface AppContextType {
  watchlist: string[];
  addToWatchlist: (ticker: string) => void;
  removeFromWatchlist: (ticker: string) => void;

  chatHistory: ChatMessage[];
  addChatMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  isChatOpen: boolean;
  setChatOpen: (isOpen: boolean) => void;

  searchQuery: string;
  setSearchQuery: (query: string) => void;

  currentFilingContext: FilingContext | null;
  setCurrentFilingContext: (ctx: FilingContext | null) => void;

  savedAlerts: SavedAlert[];
  addSavedAlert: (alert: Omit<SavedAlert, 'id' | 'createdAt' | 'lastSeenAccessions' | 'latestNewAccessions' | 'latestResultCount'> & Partial<Pick<SavedAlert, 'lastSeenAccessions' | 'latestNewAccessions' | 'latestResultCount'>>) => void;
  updateSavedAlert: (id: string, updates: Partial<SavedAlert>) => void;
  removeSavedAlert: (id: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const WATCHLIST_STORAGE_KEY = 'vara.watchlist.v1';
const ALERTS_STORAGE_KEY = 'vara.alerts.v1';

function loadStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [watchlist, setWatchlist] = useState<string[]>(() => loadStoredJson(WATCHLIST_STORAGE_KEY, ['AAPL', 'MSFT']));
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([{
    id: 'init-msg',
    role: 'ai',
    content: "Hi! I'm **Vara AI**, your SEC compliance assistant. Ask me anything about filings, language comparisons, or specific company disclosures.",
    timestamp: new Date().toISOString()
  }]);
  const [isChatOpen, setChatOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentFilingContext, setCurrentFilingContext] = useState<FilingContext | null>(null);
  const [savedAlerts, setSavedAlerts] = useState<SavedAlert[]>(() => loadStoredJson(ALERTS_STORAGE_KEY, []));

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
    }
  }, [watchlist]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ALERTS_STORAGE_KEY, JSON.stringify(savedAlerts));
    }
  }, [savedAlerts]);

  const addToWatchlist = (ticker: string) => {
    const upper = ticker.toUpperCase().trim();
    if (upper) {
      setWatchlist(prev => (prev.includes(upper) ? prev : [...prev, upper]));
    }
  };

  const removeFromWatchlist = (ticker: string) => {
    setWatchlist(prev => prev.filter(t => t !== ticker));
  };

  const addChatMessage = (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: Math.random().toString(36).substring(7),
      timestamp: new Date().toISOString()
    };
    setChatHistory(prev => [...prev, newMsg]);
  };

  const addSavedAlert = (
    alert: Omit<SavedAlert, 'id' | 'createdAt' | 'lastSeenAccessions' | 'latestNewAccessions' | 'latestResultCount'> & Partial<Pick<SavedAlert, 'lastSeenAccessions' | 'latestNewAccessions' | 'latestResultCount'>>
  ) => {
    setSavedAlerts(prev => {
      const duplicate = prev.find(existing =>
        existing.query === alert.query &&
        existing.mode === alert.mode &&
        JSON.stringify(existing.filters) === JSON.stringify(alert.filters) &&
        existing.defaultForms === alert.defaultForms
      );

      if (duplicate) {
        return prev;
      }

      return [
        {
          ...alert,
          id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          createdAt: new Date().toISOString(),
          lastSeenAccessions: alert.lastSeenAccessions || [],
          latestNewAccessions: alert.latestNewAccessions || [],
          latestResultCount: alert.latestResultCount || 0,
        },
        ...prev,
      ];
    });
  };

  const updateSavedAlert = (id: string, updates: Partial<SavedAlert>) => {
    setSavedAlerts(prev => prev.map(alert => (alert.id === id ? { ...alert, ...updates } : alert)));
  };

  const removeSavedAlert = (id: string) => {
    setSavedAlerts(prev => prev.filter(alert => alert.id !== id));
  };

  return (
    <AppContext.Provider value={{
      watchlist, addToWatchlist, removeFromWatchlist,
      chatHistory, addChatMessage,
      isChatOpen, setChatOpen,
      searchQuery, setSearchQuery,
      currentFilingContext, setCurrentFilingContext,
      savedAlerts, addSavedAlert, updateSavedAlert, removeSavedAlert
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
