import type { useApp } from '../context/AppState';
import { defaultSearchFilters, type SearchFilters } from '../domain/searchFilters';
import { summarizeConversation } from '../services/aiApi';
import type { FilingResearchResult, ResearchSearchMode } from '../services/filingResearch';
import type {
  AgentCitation,
  AgentContextSnapshot,
  AgentEvidencePacket,
  AgentRun,
  FilingLocator,
  PendingAlertDraft,
  ResolvedCompany,
} from '../types/agent';

export type SurfaceRoute = 'search' | 'accounting' | 'comment-letters';
export type PanelTab = 'answer' | 'evidence' | 'actions';

export interface AgentRuntimeState {
  resolvedCompanies: ResolvedCompany[];
  latestFiling: FilingLocator | null;
  searchResults: FilingResearchResult[];
  commentLetterResults: FilingResearchResult[];
  /** Matches found in the owned letter corpus (full-text lane) — excerpts
   * land directly in findings, so this only tracks the count for summaries. */
  lettersCorpusCount: number;
  importantSummary: string;
  draftedAlert: PendingAlertDraft | null;
  findings: string[];
  citations: AgentCitation[];
  notes: string[];
  compareTickers: string[];
  searchQuery: string;
  searchMode: ResearchSearchMode;
  searchFilters: SearchFilters;
}

function createDefaultSearchFilters(): SearchFilters {
  return {
    ...defaultSearchFilters,
    formTypes: [...defaultSearchFilters.formTypes],
    exchange: [...defaultSearchFilters.exchange],
    acceleratedStatus: [...defaultSearchFilters.acceleratedStatus],
  };
}

export function routeForSurface(surface: SurfaceRoute): string {
  switch (surface) {
    case 'accounting':
      return '/accounting';
    case 'comment-letters':
      return '/comment-letters';
    default:
      return '/search';
  }
}

export function filingRouteFromResult(result: FilingResearchResult): string {
  return `/filing/${result.cik}_${result.accessionNumber}_${result.primaryDocument}`;
}

export function dedupeCitations(citations: AgentCitation[]): AgentCitation[] {
  const seen = new Set<string>();
  return citations.filter(citation => {
    const key = [
      citation.kind,
      citation.title,
      citation.sectionLabel || '',
      citation.route || '',
      citation.externalUrl || '',
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeSearchFilters(input: unknown): SearchFilters {
  if (!input || typeof input !== 'object') {
    return createDefaultSearchFilters();
  }

  const value = input as Partial<SearchFilters>;
  return {
    ...createDefaultSearchFilters(),
    ...value,
    formTypes: Array.isArray(value.formTypes) ? [...value.formTypes] : [...defaultSearchFilters.formTypes],
    exchange: Array.isArray(value.exchange) ? [...value.exchange] : [...defaultSearchFilters.exchange],
    acceleratedStatus: Array.isArray(value.acceleratedStatus) ? [...value.acceleratedStatus] : [...defaultSearchFilters.acceleratedStatus],
  };
}

// Conversation summaries are stable for the same completed-run IDs, so reuse
// them as the user continues the current session.
const conversationSummaryCache = new Map<string, string>();

export async function buildContextSnapshotAsync(
  app: ReturnType<typeof useApp>,
  pathname: string,
): Promise<AgentContextSnapshot> {
  const completedRuns = app.agentRuns
    .filter(run => run.prompt.trim().length > 0 && run.answer.trim().length > 0);

  let conversation: Array<{ prompt: string; answer: string; startedAt: string }>;

  if (completedRuns.length > 8) {
    // Summarize older turns, keep last 3 verbatim (Plan Section 6.1).
    const olderTurns = completedRuns.slice(3).reverse();
    const recentTurns = completedRuns.slice(0, 3).reverse();

    const cacheKey = olderTurns.map(run => run.id).join(':');
    let summary = conversationSummaryCache.get(cacheKey);
    if (!summary) {
      try {
        summary = await summarizeConversation(
          olderTurns.map(run => ({ prompt: run.prompt, answer: run.answer })),
        );
        conversationSummaryCache.set(cacheKey, summary);
      } catch {
        summary = '';
      }
    }

    conversation = [
      ...(summary ? [{ prompt: '[Conversation summary]', answer: summary, startedAt: olderTurns[0]?.startedAt || '' }] : []),
      ...recentTurns.map(run => ({ prompt: run.prompt, answer: run.answer, startedAt: run.startedAt })),
    ];
  } else {
    conversation = completedRuns
      .slice(0, 6)
      .reverse()
      .map(run => ({ prompt: run.prompt, answer: run.answer, startedAt: run.startedAt }));
  }

  return {
    pagePath: app.currentPageContext.path || pathname,
    pageLabel: app.currentPageContext.label || 'Workspace',
    filing: app.currentFilingContext
      ? {
          ...app.currentFilingContext,
          sections: app.currentFilingSections,
        }
      : null,
    search: app.activeSearchContext
      ? {
          surface: app.activeSearchContext.surface,
          query: app.activeSearchContext.query,
          mode: app.activeSearchContext.mode,
          filters: app.activeSearchContext.filters,
          resultCount: app.activeSearchContext.results.length,
          topResults: app.activeSearchContext.results.slice(0, 8),
        }
      : null,
    compare: app.activeCompareContext
      ? {
          tickers: app.activeCompareContext.tickers,
          sicCode: app.activeCompareContext.sicCode,
          viewMode: app.activeCompareContext.viewMode,
          selectedSection: app.activeCompareContext.selectedSection,
        }
      : null,
    conversation,
  };
}

export function deriveCompanyHintFromTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '';

  const resolveMatch = trimmed.match(/^resolve\s+(.+)$/i);
  if (resolveMatch) return resolveMatch[1].trim();

  const filingMatch = trimmed.match(/\bfor\s+(.+)$/i);
  if (filingMatch) return filingMatch[1].trim();

  return '';
}

export function createInitialRuntimeState(): AgentRuntimeState {
  return {
    resolvedCompanies: [],
    latestFiling: null,
    searchResults: [],
    commentLetterResults: [],
    lettersCorpusCount: 0,
    importantSummary: '',
    draftedAlert: null,
    findings: [],
    citations: [],
    notes: [],
    compareTickers: [],
    searchQuery: '',
    searchMode: 'semantic',
    searchFilters: createDefaultSearchFilters(),
  };
}

export function buildFallbackEvidence(run: AgentRun | null): AgentEvidencePacket | null {
  if (!run) return null;
  if (run.evidence) return run.evidence;

  return {
    title: 'Copilot Result',
    summary: run.answer || 'The copilot completed a run, but no structured evidence packet was generated.',
    findings: [],
    citations: [],
    followUps: [],
    notes: [],
  };
}
