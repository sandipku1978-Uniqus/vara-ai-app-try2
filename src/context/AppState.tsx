import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { ChatMessage } from '../types';
import type { SearchFilters } from '../components/filters/SearchFilterBar';
import type { FilingResearchResult, ResearchSearchMode } from '../services/filingResearch';
import type {
  AgentActionLogEntry,
  AgentRun,
  FilingSectionReference,
  PendingAlertDraft,
  PendingCompareIntent,
  PendingSearchIntent,
} from '../types/agent';

export interface FilingContext {
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  companyName: string;
  formType: string;
  filingDate: string;
  auditor?: string;
}

export interface PageContext {
  path: string;
  label: string;
}

export interface SearchSurfaceContext {
  surface: 'research' | 'accounting' | 'comment-letters';
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
  results: FilingResearchResult[];
  updatedAt: string;
}

export interface CompareSurfaceContext {
  tickers: string[];
  sicCode: string;
  viewMode: 'financials' | 'text-diff' | 'audit-matrix';
  selectedSection: string;
  updatedAt: string;
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

  currentPageContext: PageContext;
  setCurrentPageContext: (ctx: PageContext) => void;

  currentFilingContext: FilingContext | null;
  setCurrentFilingContext: (ctx: FilingContext | null) => void;
  currentFilingSections: FilingSectionReference[];
  setCurrentFilingSections: (sections: FilingSectionReference[]) => void;

  activeSearchContext: SearchSurfaceContext | null;
  setActiveSearchContext: (ctx: SearchSurfaceContext | null) => void;

  activeCompareContext: CompareSurfaceContext | null;
  setActiveCompareContext: (ctx: CompareSurfaceContext | null) => void;

  savedAlerts: SavedAlert[];
  addSavedAlert: (alert: Omit<SavedAlert, 'id' | 'createdAt' | 'lastSeenAccessions' | 'latestNewAccessions' | 'latestResultCount'> & Partial<Pick<SavedAlert, 'lastSeenAccessions' | 'latestNewAccessions' | 'latestResultCount'>>) => void;
  updateSavedAlert: (id: string, updates: Partial<SavedAlert>) => void;
  removeSavedAlert: (id: string) => void;

  agentRuns: AgentRun[];
  activeAgentRunId: string | null;
  setActiveAgentRunId: (id: string | null) => void;
  startAgentRun: (prompt: string) => string;
  updateAgentRun: (id: string, updates: Partial<AgentRun>) => void;
  appendAgentLog: (id: string, entry: Omit<AgentActionLogEntry, 'id' | 'timestamp'>) => void;
  clearAgentRuns: () => void;

  pendingSearchIntent: PendingSearchIntent | null;
  setPendingSearchIntent: (intent: PendingSearchIntent | null) => void;

  pendingCompareIntent: PendingCompareIntent | null;
  setPendingCompareIntent: (intent: PendingCompareIntent | null) => void;

  pendingFilingSectionLabel: string | null;
  setPendingFilingSectionLabel: (label: string | null) => void;

  pendingAlertDraft: PendingAlertDraft | null;
  setPendingAlertDraft: (draft: PendingAlertDraft | null) => void;
  confirmPendingAlertDraft: () => void;
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
  const [currentPageContext, setCurrentPageContext] = useState<PageContext>({ path: '/', label: 'Home' });
  const [currentFilingContext, setCurrentFilingContext] = useState<FilingContext | null>(null);
  const [currentFilingSections, setCurrentFilingSections] = useState<FilingSectionReference[]>([]);
  const [activeSearchContext, setActiveSearchContext] = useState<SearchSurfaceContext | null>(null);
  const [activeCompareContext, setActiveCompareContext] = useState<CompareSurfaceContext | null>(null);
  const [savedAlerts, setSavedAlerts] = useState<SavedAlert[]>(() => loadStoredJson(ALERTS_STORAGE_KEY, []));
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [activeAgentRunId, setActiveAgentRunId] = useState<string | null>(null);
  const [pendingSearchIntent, setPendingSearchIntent] = useState<PendingSearchIntent | null>(null);
  const [pendingCompareIntent, setPendingCompareIntent] = useState<PendingCompareIntent | null>(null);
  const [pendingFilingSectionLabel, setPendingFilingSectionLabel] = useState<string | null>(null);
  const [pendingAlertDraft, setPendingAlertDraft] = useState<PendingAlertDraft | null>(null);

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

  const startAgentRun = (prompt: string) => {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const run: AgentRun = {
      id: runId,
      prompt,
      status: 'running',
      startedAt: new Date().toISOString(),
      actionLog: [],
      answer: '',
      evidence: null,
    };
    setAgentRuns(prev => [run, ...prev].slice(0, 20));
    setActiveAgentRunId(runId);
    return runId;
  };

  const updateAgentRun = (id: string, updates: Partial<AgentRun>) => {
    setAgentRuns(prev => prev.map(run => (run.id === id ? { ...run, ...updates } : run)));
  };

  const appendAgentLog = (id: string, entry: Omit<AgentActionLogEntry, 'id' | 'timestamp'>) => {
    setAgentRuns(prev => prev.map(run => (
      run.id === id
        ? {
            ...run,
            actionLog: [
              ...run.actionLog,
              {
                ...entry,
                id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                timestamp: new Date().toISOString(),
              },
            ],
          }
        : run
    )));
  };

  const clearAgentRuns = () => {
    setAgentRuns([]);
    setActiveAgentRunId(null);
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

  const confirmPendingAlertDraft = () => {
    if (!pendingAlertDraft) return;

    addSavedAlert({
      name: pendingAlertDraft.name,
      query: pendingAlertDraft.query,
      mode: pendingAlertDraft.mode,
      filters: pendingAlertDraft.filters,
      defaultForms: pendingAlertDraft.defaultForms,
      lastSeenAccessions: [],
      latestNewAccessions: [],
      latestResultCount: 0,
    });
    setPendingAlertDraft(null);
  };

  return (
    <AppContext.Provider value={{
      watchlist, addToWatchlist, removeFromWatchlist,
      chatHistory, addChatMessage,
      isChatOpen, setChatOpen,
      searchQuery, setSearchQuery,
      currentPageContext, setCurrentPageContext,
      currentFilingContext, setCurrentFilingContext,
      currentFilingSections, setCurrentFilingSections,
      activeSearchContext, setActiveSearchContext,
      activeCompareContext, setActiveCompareContext,
      savedAlerts, addSavedAlert, updateSavedAlert, removeSavedAlert,
      agentRuns, activeAgentRunId, setActiveAgentRunId, startAgentRun, updateAgentRun, appendAgentLog, clearAgentRuns,
      pendingSearchIntent, setPendingSearchIntent,
      pendingCompareIntent, setPendingCompareIntent,
      pendingFilingSectionLabel, setPendingFilingSectionLabel,
      pendingAlertDraft, setPendingAlertDraft, confirmPendingAlertDraft,
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
