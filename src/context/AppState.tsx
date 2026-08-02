'use client';

import { useAuth } from '@clerk/nextjs';
import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { ChatMessage } from '../types';
import type { SearchFilters } from '../components/filters/SearchFilterBar';
import type { FilingResearchResult, ResearchSearchMode } from '../services/filingResearch';
import { BRAND } from '../config/brand';
import { buildStorageScope, scopedStorageKey, setActiveBrowserStorageScope } from '../services/storageNamespace';
import type {
  AgentActionLogEntry,
  AgentPromptRequest,
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
  viewMode: 'financials' | 'text-diff' | 'audit-matrix' | 'yoy-changes';
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
  /** Boolean engine that produced lastSeenAccessions. Absent on alerts saved
   *  before versioning; the first check under a newer engine re-baselines
   *  instead of reporting the recall difference as new filings. Optional so a
   *  rollback build ignores it safely. */
  engineVersion?: number;
}

export type ThemeMode = 'light' | 'dark';

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

  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleThemeMode: () => void;
  isSidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;

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
  agentPromptQueue: AgentPromptRequest[];
  activeAgentRunId: string | null;
  setActiveAgentRunId: (id: string | null) => void;
  enqueueAgentPrompt: (prompt: string) => string;
  removeAgentPromptRequest: (id: string) => void;
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
const THEME_STORAGE_KEY = 'urc.theme.v1';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'urc.sidebar-collapsed.v1';

function loadStoredJson<T>(key: string | null, fallback: T): T {
  if (typeof window === 'undefined' || !key) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';

  const storedMode = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedMode === 'light' || storedMode === 'dark') {
    return storedMode;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function loadSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { isLoaded: identityLoaded, userId, orgId } = useAuth();
  const storageScope = identityLoaded ? buildStorageScope(userId, orgId) : null;
  setActiveBrowserStorageScope(storageScope);
  // Written to the DOM so automated journeys can wait for identity hydration
  // before interacting: when Clerk finishes loading, this scope flips from
  // null and per-identity state re-hydrates — interactions made before that
  // flip are visibly reset, which reads as data loss in tests and to fast
  // users alike.
  useEffect(() => {
    document.documentElement.dataset.urcIdentityScope = storageScope ?? '';
  }, [storageScope]);

  const watchlistStorageKey = scopedStorageKey(WATCHLIST_STORAGE_KEY, storageScope);
  const alertsStorageKey = scopedStorageKey(ALERTS_STORAGE_KEY, storageScope);
  const [hydratedStorageScope, setHydratedStorageScope] = useState<string | null>(storageScope);
  const [watchlist, setWatchlist] = useState<string[]>(() => loadStoredJson(watchlistStorageKey, ['AAPL', 'MSFT']));
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([{
    id: 'init-msg',
    role: 'ai',
    content: `Hi! I'm **${BRAND.productName}**, your SEC compliance assistant. Ask me anything about filings, language comparisons, or specific company disclosures.`,
    timestamp: new Date().toISOString()
  }]);
  const [isChatOpen, setChatOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>(loadThemeMode);
  const [isSidebarCollapsed, setSidebarCollapsed] = useState<boolean>(loadSidebarCollapsed);
  const [currentPageContext, setCurrentPageContext] = useState<PageContext>({ path: '/', label: 'Home' });
  const [currentFilingContext, setCurrentFilingContext] = useState<FilingContext | null>(null);
  const [currentFilingSections, setCurrentFilingSections] = useState<FilingSectionReference[]>([]);
  const [activeSearchContext, setActiveSearchContext] = useState<SearchSurfaceContext | null>(null);
  const [activeCompareContext, setActiveCompareContext] = useState<CompareSurfaceContext | null>(null);
  const [savedAlerts, setSavedAlerts] = useState<SavedAlert[]>(() => loadStoredJson(alertsStorageKey, []));
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [agentPromptQueue, setAgentPromptQueue] = useState<AgentPromptRequest[]>([]);
  const [activeAgentRunId, setActiveAgentRunId] = useState<string | null>(null);
  const [pendingSearchIntent, setPendingSearchIntent] = useState<PendingSearchIntent | null>(null);
  const [pendingCompareIntent, setPendingCompareIntent] = useState<PendingCompareIntent | null>(null);
  const [pendingFilingSectionLabel, setPendingFilingSectionLabel] = useState<string | null>(null);
  const [pendingAlertDraft, setPendingAlertDraft] = useState<PendingAlertDraft | null>(null);

  useEffect(() => {
    if (!storageScope) {
      setHydratedStorageScope(null);
      return;
    }

    setWatchlist(loadStoredJson(scopedStorageKey(WATCHLIST_STORAGE_KEY, storageScope), ['AAPL', 'MSFT']));
    setSavedAlerts(loadStoredJson(scopedStorageKey(ALERTS_STORAGE_KEY, storageScope), []));
    setChatHistory([{
      id: 'init-msg',
      role: 'ai',
      content: `Hi! I'm **${BRAND.productName}**, your SEC compliance assistant. Ask me anything about filings, language comparisons, or specific company disclosures.`,
      timestamp: new Date().toISOString(),
    }]);
    setSearchQuery('');
    setCurrentFilingContext(null);
    setCurrentFilingSections([]);
    setActiveSearchContext(null);
    setActiveCompareContext(null);
    setAgentRuns([]);
    setAgentPromptQueue([]);
    setActiveAgentRunId(null);
    setPendingSearchIntent(null);
    setPendingCompareIntent(null);
    setPendingFilingSectionLabel(null);
    setPendingAlertDraft(null);
    setHydratedStorageScope(storageScope);
  }, [storageScope]);

  useEffect(() => {
    if (typeof window !== 'undefined' && watchlistStorageKey && hydratedStorageScope === storageScope) {
      window.localStorage.setItem(watchlistStorageKey, JSON.stringify(watchlist));
    }
  }, [hydratedStorageScope, storageScope, watchlist, watchlistStorageKey]);

  useEffect(() => {
    if (typeof window !== 'undefined' && alertsStorageKey && hydratedStorageScope === storageScope) {
      window.localStorage.setItem(alertsStorageKey, JSON.stringify(savedAlerts));
    }
  }, [alertsStorageKey, hydratedStorageScope, savedAlerts, storageScope]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = themeMode;
      document.documentElement.style.colorScheme = themeMode;
    }
  }, [themeMode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed));
    }
  }, [isSidebarCollapsed]);

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

  const enqueueAgentPrompt = (prompt: string) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return '';

    const request: AgentPromptRequest = {
      id: `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt: normalizedPrompt,
      requestedAt: new Date().toISOString(),
    };
    setAgentPromptQueue(prev => [...prev, request].slice(-10));
    return request.id;
  };

  const removeAgentPromptRequest = (id: string) => {
    setAgentPromptQueue(prev => prev.filter(request => request.id !== id));
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

  const toggleThemeMode = () => {
    setThemeMode(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed(prev => !prev);
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
      themeMode, setThemeMode, toggleThemeMode,
      isSidebarCollapsed, setSidebarCollapsed, toggleSidebarCollapsed,
      currentPageContext, setCurrentPageContext,
      currentFilingContext, setCurrentFilingContext,
      currentFilingSections, setCurrentFilingSections,
      activeSearchContext, setActiveSearchContext,
      activeCompareContext, setActiveCompareContext,
      savedAlerts, addSavedAlert, updateSavedAlert, removeSavedAlert,
      agentRuns, agentPromptQueue, activeAgentRunId, setActiveAgentRunId,
      enqueueAgentPrompt, removeAgentPromptRequest,
      startAgentRun, updateAgentRun, appendAgentLog, clearAgentRuns,
      pendingSearchIntent, setPendingSearchIntent,
      pendingCompareIntent, setPendingCompareIntent,
      pendingFilingSectionLabel, setPendingFilingSectionLabel,
      pendingAlertDraft, setPendingAlertDraft, confirmPendingAlertDraft,
    }}>
      {(storageScope === null && hydratedStorageScope === null)
        || (storageScope !== null && hydratedStorageScope === storageScope)
        ? <Fragment key={storageScope || 'identity-loading'}>{children}</Fragment>
        : null}
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
