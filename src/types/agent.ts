import type { SearchFilters } from '../components/filters/SearchFilterBar';
import type { FilingResearchResult, ResearchSearchMode } from '../services/filingResearch';

export type AgentToolName =
  | 'resolve_company'
  | 'find_latest_filing'
  | 'open_filing'
  | 'jump_to_section'
  | 'search_filings'
  | 'search_comment_letters'
  | 'find_peers'
  | 'apply_filters'
  | 'set_compare_cohort'
  | 'summarize_filing'
  | 'summarize_result_set'
  | 'draft_alert'
  | 'save_alert'
  | 'export_clean_pdf';

export type AgentRunStatus = 'idle' | 'running' | 'completed' | 'failed';
export type AgentActionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type AgentConfidence = 'high' | 'medium' | 'low';

export interface FilingSectionReference {
  label: string;
  elementId: string | null;
  anchorName: string | null;
}

export interface AgentCitation {
  id: string;
  kind: 'filing' | 'section' | 'comment-letter' | 'search-result' | 'compare-cohort' | 'alert-draft';
  title: string;
  subtitle?: string;
  meta?: string;
  excerpt?: string;
  route?: string;
  externalUrl?: string;
  filingRoute?: string;
  sectionLabel?: string;
}

export interface AgentAction {
  id: string;
  type: AgentToolName;
  title: string;
  reason?: string;
  input: Record<string, unknown>;
}

export interface AgentPlan {
  goal: string;
  rationale: string;
  confidence: AgentConfidence;
  actions: AgentAction[];
  followUps: string[];
}

export interface AgentActionLogEntry {
  id: string;
  actionId?: string;
  type: AgentToolName | 'system';
  title: string;
  detail: string;
  status: AgentActionStatus | 'info';
  timestamp: string;
}

export interface AgentEvidencePacket {
  title: string;
  summary: string;
  findings: string[];
  citations: AgentCitation[];
  followUps: string[];
  notes: string[];
  data?: Record<string, unknown>;
}

export interface AgentRun {
  id: string;
  prompt: string;
  status: AgentRunStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  plan?: AgentPlan;
  actionLog: AgentActionLogEntry[];
  answer: string;
  evidence: AgentEvidencePacket | null;
}

export interface AgentContextSnapshot {
  pagePath: string;
  pageLabel: string;
  filing: {
    cik: string;
    accessionNumber: string;
    primaryDocument: string;
    companyName: string;
    formType: string;
    filingDate: string;
    auditor?: string;
    sections: FilingSectionReference[];
  } | null;
  search: {
    surface: 'research' | 'accounting' | 'comment-letters';
    query: string;
    mode: ResearchSearchMode;
    filters: SearchFilters;
    resultCount: number;
    topResults: FilingResearchResult[];
  } | null;
  compare: {
    tickers: string[];
    sicCode: string;
    viewMode: 'financials' | 'text-diff' | 'audit-matrix';
    selectedSection: string;
  } | null;
}

export interface PendingSearchIntent {
  id: string;
  surface: 'research' | 'accounting' | 'comment-letters';
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
  defaultForms?: string;
  prefetchedResults?: FilingResearchResult[];
}

export interface PendingCompareIntent {
  id: string;
  tickers: string[];
  sicCode?: string;
  viewMode?: 'financials' | 'text-diff' | 'audit-matrix';
  selectedSection?: string;
  message?: string;
}

export interface PendingAlertDraft {
  id: string;
  name: string;
  query: string;
  mode: ResearchSearchMode;
  filters: SearchFilters;
  defaultForms: string;
  rationale: string;
}

export interface ResolvedCompany {
  cik: string;
  ticker: string;
  title: string;
}

export interface FilingLocator {
  cik: string;
  accessionNumber: string;
  filingDate: string;
  formType: string;
  primaryDocument: string;
  companyName: string;
  ticker?: string;
  auditor?: string;
}

export interface FilingSectionSnippet {
  label: string;
  excerpt: string;
  citation: AgentCitation;
}
