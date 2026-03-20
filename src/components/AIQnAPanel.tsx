import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  BellRing,
  Bot,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileSearch,
  Loader2,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppState';
import ResponsibleAIBanner from './ResponsibleAIBanner';
import { renderMarkdown } from '../utils/markdownRenderer';
import { defaultSearchFilters, type SearchFilters } from './filters/SearchFilterBar';
import type {
  AgentCitation,
  AgentContextSnapshot,
  AgentEvidencePacket,
  AgentRun,
  FilingLocator,
  PendingAlertDraft,
  ResolvedCompany,
} from '../types/agent';
import {
  buildCommentLetterCitation,
  buildFilingCitation,
  buildImportantSectionSnippets,
  buildSearchResultCitation,
  discoverPeersBySic,
  fetchFilingEvidence,
  findLatestFilingForCompany,
  resolveCompanyHint,
} from '../services/agentEvidence';
import { buildSearchTrendSummary, executeFilingResearchSearch, type FilingResearchResult, type ResearchSearchMode } from '../services/filingResearch';
import { generateAgentAnswer, generateFilingSummary, planAgentRun } from '../services/geminiApi';
import { openCleanPrintView } from '../services/filingExport';
import './AIQnA.css';

type SurfaceRoute = 'search' | 'accounting' | 'comment-letters';
type PanelTab = 'answer' | 'evidence' | 'actions';

interface AgentRuntimeState {
  resolvedCompanies: ResolvedCompany[];
  latestFiling: FilingLocator | null;
  searchResults: FilingResearchResult[];
  commentLetterResults: FilingResearchResult[];
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

function routeForSurface(surface: SurfaceRoute): string {
  switch (surface) {
    case 'accounting':
      return '/accounting';
    case 'comment-letters':
      return '/comment-letters';
    default:
      return '/search';
  }
}

function filingRouteFromResult(result: FilingResearchResult): string {
  return `/filing/${result.cik}_${result.accessionNumber}_${result.primaryDocument}`;
}

function dedupeCitations(citations: AgentCitation[]): AgentCitation[] {
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

function normalizeSearchFilters(input: unknown): SearchFilters {
  if (!input || typeof input !== 'object') {
    return { ...defaultSearchFilters };
  }

  const value = input as Partial<SearchFilters>;
  return {
    ...defaultSearchFilters,
    ...value,
    formTypes: Array.isArray(value.formTypes) ? value.formTypes : defaultSearchFilters.formTypes,
    exchange: Array.isArray(value.exchange) ? value.exchange : defaultSearchFilters.exchange,
    acceleratedStatus: Array.isArray(value.acceleratedStatus) ? value.acceleratedStatus : defaultSearchFilters.acceleratedStatus,
  };
}

function buildContextSnapshot(app: ReturnType<typeof useApp>, pathname: string): AgentContextSnapshot {
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
    conversation: app.agentRuns
      .slice(0, 6)
      .reverse()
      .filter(run => run.prompt.trim().length > 0)
      .map(run => ({
        prompt: run.prompt,
        answer: run.answer,
        startedAt: run.startedAt,
      })),
  };
}

function deriveCompanyHintFromTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '';

  const resolveMatch = trimmed.match(/^resolve\s+(.+)$/i);
  if (resolveMatch) return resolveMatch[1].trim();

  const filingMatch = trimmed.match(/\bfor\s+(.+)$/i);
  if (filingMatch) return filingMatch[1].trim();

  return '';
}

function createInitialRuntimeState(): AgentRuntimeState {
  return {
    resolvedCompanies: [],
    latestFiling: null,
    searchResults: [],
    commentLetterResults: [],
    importantSummary: '',
    draftedAlert: null,
    findings: [],
    citations: [],
    notes: [],
    compareTickers: [],
    searchQuery: '',
    searchMode: 'semantic',
    searchFilters: { ...defaultSearchFilters },
  };
}

function buildFallbackEvidence(run: AgentRun | null): AgentEvidencePacket | null {
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

export function AIQnAPanel() {
  const app = useApp();
  const {
    isChatOpen,
    setChatOpen,
    agentRuns,
    activeAgentRunId,
    setActiveAgentRunId,
    startAgentRun,
    updateAgentRun,
    appendAgentLog,
    clearAgentRuns,
    setPendingSearchIntent,
    setPendingCompareIntent,
    setPendingFilingSectionLabel,
    pendingAlertDraft,
    setPendingAlertDraft,
    confirmPendingAlertDraft,
  } = app;
  const location = useLocation();
  const navigate = useNavigate();
  const [inputValue, setInputValue] = useState('');
  const [tab, setTab] = useState<PanelTab>('answer');
  const [running, setRunning] = useState(false);
  const panelBodyRef = useRef<HTMLDivElement>(null);

  const activeRun = useMemo(
    () => agentRuns.find(run => run.id === activeAgentRunId) || agentRuns[0] || null,
    [agentRuns, activeAgentRunId]
  );

  useEffect(() => {
    if (activeRun && activeRun.id !== activeAgentRunId) {
      setActiveAgentRunId(activeRun.id);
    }
  }, [activeAgentRunId, activeRun, setActiveAgentRunId]);

  useEffect(() => {
    panelBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [activeRun?.id, tab]);

  if (!isChatOpen) return null;

  async function executePrompt(prompt: string) {
    const runId = startAgentRun(prompt);
    setRunning(true);
    setTab('actions');
    appendAgentLog(runId, {
      type: 'system',
      title: 'Planning request',
      detail: 'Interpreting the prompt and deciding which in-app actions to run.',
      status: 'info',
    });

    try {
      const context = buildContextSnapshot(app, location.pathname);
      const plan = await planAgentRun(prompt, context);
      updateAgentRun(runId, { plan });
      appendAgentLog(runId, {
        type: 'system',
        title: 'Plan ready',
        detail: `${plan.actions.length} action${plan.actions.length === 1 ? '' : 's'} queued.`,
        status: 'info',
      });

      const runtime = createInitialRuntimeState();

      for (const action of plan.actions) {
        try {
          if (action.type === 'resolve_company') {
            const companyHint = String(action.input.companyHint || deriveCompanyHintFromTitle(action.title) || '').trim();
            if (!companyHint) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'Skipped because no company hint was provided.', status: 'skipped' });
              continue;
            }

            const company = await resolveCompanyHint(companyHint);
            if (!company) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Could not resolve "${companyHint}" to an EDGAR issuer.`, status: 'failed' });
              runtime.notes.push(`Could not resolve company hint "${companyHint}".`);
              continue;
            }

            runtime.resolvedCompanies.push(company);
            runtime.findings.push(`Resolved ${companyHint} to ${company.ticker} (${company.title}).`);
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Resolved ${companyHint} to ${company.ticker} (${company.cik}).`, status: 'completed' });
            continue;
          }

          if (action.type === 'find_latest_filing') {
            const explicitCompanyHint = String(action.input.companyHint || deriveCompanyHintFromTitle(action.title) || '').trim();
            const company = runtime.resolvedCompanies[0] || (explicitCompanyHint ? await resolveCompanyHint(explicitCompanyHint) : null);
            const formType = String(action.input.formType || '10-K').trim();

            if (!company) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'No company could be resolved for latest-filing lookup.', status: 'failed' });
              continue;
            }

            const latestFiling = await findLatestFilingForCompany(company, formType);
            if (!latestFiling) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `No ${formType} filing was found for ${company.ticker}.`, status: 'failed' });
              runtime.notes.push(`No ${formType} filing found for ${company.ticker}.`);
              continue;
            }

            runtime.latestFiling = latestFiling;
            runtime.citations.push(buildFilingCitation(latestFiling, 'Latest filing opened by Vara Copilot.'));
            runtime.findings.push(`Found the latest ${formType} for ${latestFiling.companyName} filed on ${latestFiling.filingDate}.`);
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Located ${latestFiling.companyName} ${formType} filed ${latestFiling.filingDate}.`, status: 'completed' });
            continue;
          }

          if (action.type === 'open_filing') {
            const locator = runtime.latestFiling || (app.currentFilingContext ? { ...app.currentFilingContext, auditor: app.currentFilingContext.auditor || '' } : null);
            if (!locator) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'No filing was available to open.', status: 'failed' });
              continue;
            }

            navigate(`/filing/${locator.cik}_${locator.accessionNumber}_${locator.primaryDocument}`, {
              state: {
                companyName: locator.companyName,
                filingDate: locator.filingDate,
                formType: locator.formType,
                auditor: locator.auditor || '',
              },
            });
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Opened ${locator.companyName} ${locator.formType}.`, status: 'completed' });
            continue;
          }

          if (action.type === 'jump_to_section') {
            const sectionLabel = String(action.input.sectionLabel || '').trim();
            if (!sectionLabel) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'Skipped because no section label was provided.', status: 'skipped' });
              continue;
            }

            setPendingFilingSectionLabel(sectionLabel);
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Will jump to ${sectionLabel} when the filing view is ready.`, status: 'completed' });
            continue;
          }

          if (action.type === 'apply_filters') {
            const targetPage = String(action.input.targetPage || 'search') as SurfaceRoute;
            const query = String(action.input.query || '').trim();
            const mode = (String(action.input.mode || 'semantic') === 'boolean' ? 'boolean' : 'semantic') as ResearchSearchMode;
            const filters = normalizeSearchFilters(action.input.filters);
            const defaultForms = String(action.input.defaultForms || '');

            setPendingSearchIntent({
              id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              surface: targetPage === 'accounting' ? 'accounting' : targetPage === 'comment-letters' ? 'comment-letters' : 'research',
              query,
              mode,
              filters,
              defaultForms,
            });
            navigate(routeForSurface(targetPage));
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Prepared filters on ${targetPage === 'search' ? 'Research' : targetPage}.`, status: 'completed' });
            continue;
          }

          if (action.type === 'search_filings' || action.type === 'search_comment_letters') {
            const targetPage = action.type === 'search_comment_letters' ? 'comment-letters' : (String(action.input.targetPage || 'search') as SurfaceRoute);
            const query = String(action.input.query || (action.type === 'search_comment_letters' ? 'comment' : '')).trim();
            const mode = (String(action.input.mode || 'semantic') === 'boolean' ? 'boolean' : 'semantic') as ResearchSearchMode;
            const filters = normalizeSearchFilters(action.input.filters);
            const defaultForms = action.type === 'search_comment_letters' ? 'CORRESP,UPLOAD' : String(action.input.defaultForms || '10-K,10-Q,8-K,DEF 14A,20-F,S-1');
            const results = await executeFilingResearchSearch({
              query,
              filters,
              mode,
              defaultForms,
              limit: Number(action.input.limit || 20),
              hydrateTextSignals: action.type === 'search_filings',
            });

            if (action.type === 'search_comment_letters') {
              runtime.commentLetterResults = results;
              runtime.searchQuery = query;
              runtime.citations.push(
                ...results.slice(0, 8).map(result =>
                  buildCommentLetterCitation({
                    companyName: result.entityName,
                    formType: result.formType,
                    filingDate: result.fileDate,
                    route: filingRouteFromResult(result),
                    externalUrl: result.filingUrl,
                    description: result.description || 'SEC correspondence',
                  })
                )
              );
            } else {
              runtime.searchResults = results;
              runtime.searchQuery = query;
              runtime.searchMode = mode;
              runtime.searchFilters = filters;
              runtime.citations.push(
                ...results.slice(0, 8).map(result =>
                  buildSearchResultCitation({
                    companyName: result.entityName,
                    formType: result.formType,
                    filingDate: result.fileDate,
                    description: result.description || result.primaryDocument || 'Matched filing',
                    route: filingRouteFromResult(result),
                    externalUrl: result.filingUrl,
                  })
                )
              );
            }

            runtime.findings.push(`Found ${results.length} ${action.type === 'search_comment_letters' ? 'SEC comment-letter' : 'filing'} match${results.length === 1 ? '' : 'es'}${query ? ` for "${query}"` : ''}.`);
            setPendingSearchIntent({
              id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              surface: targetPage === 'accounting' ? 'accounting' : targetPage === 'comment-letters' ? 'comment-letters' : 'research',
              query,
              mode,
              filters,
              defaultForms,
              prefetchedResults: results,
            });
            navigate(routeForSurface(targetPage));
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Found ${results.length} result${results.length === 1 ? '' : 's'}.`, status: 'completed' });
            continue;
          }

          if (action.type === 'find_peers') {
            const hint = String(action.input.companyHint || deriveCompanyHintFromTitle(action.title) || runtime.resolvedCompanies[0]?.title || '').trim();
            const seed = runtime.resolvedCompanies[0] || (hint ? await resolveCompanyHint(hint) : null);
            if (!seed) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'No seed issuer was available for peer discovery.', status: 'failed' });
              continue;
            }

            const peerResult = await discoverPeersBySic(seed, runtime.compareTickers, 5);
            runtime.compareTickers = [seed.ticker, ...peerResult.tickers].filter(Boolean);
            runtime.findings.push(
              peerResult.tickers.length > 0
                ? `Found ${peerResult.tickers.length} SIC peer${peerResult.tickers.length === 1 ? '' : 's'} for ${seed.ticker}${peerResult.sic ? ` (SIC ${peerResult.sic})` : ''}.`
                : `No SIC peers were found for ${seed.ticker}.`
            );
            appendAgentLog(runId, {
              actionId: action.id,
              type: action.type,
              title: action.title,
              detail: peerResult.tickers.length > 0 ? `Prepared peer tickers: ${runtime.compareTickers.join(', ')}.` : `No SIC peers found for ${seed.ticker}.`,
              status: 'completed',
            });
            continue;
          }

          if (action.type === 'set_compare_cohort') {
            const requestedHints = Array.isArray(action.input.companyHints)
              ? action.input.companyHints.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
              : [];
            const requestedTickers = Array.isArray(action.input.tickers)
              ? action.input.tickers.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.toUpperCase())
              : [];
            const fromSearchResults = Boolean(action.input.fromSearchResults);

            let tickers = requestedTickers;
            if (tickers.length === 0 && requestedHints.length > 0) {
              const resolved = await Promise.all(requestedHints.map(hint => resolveCompanyHint(hint)));
              tickers = resolved.filter((item): item is ResolvedCompany => Boolean(item)).map(item => item.ticker);
            }

            if (tickers.length === 0 && fromSearchResults && runtime.searchResults.length > 0) {
              const topTickers = runtime.searchResults.flatMap(result => result.tickers.slice(0, 1)).filter(Boolean).map(ticker => ticker.toUpperCase());
              tickers = Array.from(new Set(topTickers)).slice(0, Number(action.input.maxCompanies || 5));
            }

            if (tickers.length === 0 && runtime.compareTickers.length > 0) {
              tickers = runtime.compareTickers;
            }

            if (tickers.length === 0) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'No tickers were available to build the compare cohort.', status: 'failed' });
              continue;
            }

            runtime.compareTickers = Array.from(new Set(tickers)).slice(0, 10);
            const viewMode = String(action.input.viewMode || 'financials') as 'financials' | 'text-diff' | 'audit-matrix';
            const selectedSection = String(action.input.selectedSection || 'Item 1A. Risk Factors');
            const sicCode = String(action.input.sicCode || runtime.searchFilters.sicCode || app.activeCompareContext?.sicCode || '');

            setPendingCompareIntent({
              id: `compare-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              tickers: runtime.compareTickers,
              sicCode,
              viewMode,
              selectedSection,
              message: `Prepared compare cohort: ${runtime.compareTickers.join(', ')}`,
            });
            navigate('/compare');
            runtime.findings.push(`Prepared compare cohort with ${runtime.compareTickers.join(', ')}.`);
            runtime.citations.push({
              id: `compare-${Math.random().toString(36).slice(2, 8)}`,
              kind: 'compare-cohort',
              title: 'Benchmarking cohort',
              subtitle: runtime.compareTickers.join(', '),
              route: '/compare',
              meta: sicCode ? `SIC ${sicCode}` : undefined,
            });
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Opened Benchmarking with ${runtime.compareTickers.join(', ')}.`, status: 'completed' });
            continue;
          }

          if (action.type === 'summarize_filing') {
            const locator = runtime.latestFiling || (app.currentFilingContext ? { ...app.currentFilingContext, auditor: app.currentFilingContext.auditor || '' } : null);
            if (!locator) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'No filing was available to summarize.', status: 'failed' });
              continue;
            }

            const evidence = await fetchFilingEvidence(locator);
            const explicitSection = String(action.input.sectionLabel || '').trim();
            const snippets = explicitSection
              ? buildImportantSectionSnippets(locator, evidence.html, evidence.text, evidence.sections, [explicitSection])
              : buildImportantSectionSnippets(locator, evidence.html, evidence.text, evidence.sections);

            runtime.importantSummary = await generateFilingSummary(locator, snippets, String(action.input.mode || 'default'));
            runtime.citations.push(...snippets.map(snippet => snippet.citation));
            runtime.findings.push(`Prepared a cited filing summary using ${snippets.length} section snippet${snippets.length === 1 ? '' : 's'}.`);
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Generated a filing summary for ${locator.companyName}.`, status: 'completed' });
            continue;
          }

          if (action.type === 'summarize_result_set') {
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'Queued the current evidence for summarization.', status: 'completed' });
            continue;
          }

          if (action.type === 'draft_alert') {
            const draft: PendingAlertDraft = {
              id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: String(action.input.nameHint || runtime.searchQuery || 'Custom research alert').trim(),
              query: String(action.input.query || runtime.searchQuery || '').trim(),
              mode: (String(action.input.mode || runtime.searchMode || 'semantic') === 'boolean' ? 'boolean' : 'semantic') as ResearchSearchMode,
              filters: normalizeSearchFilters(action.input.filters || runtime.searchFilters),
              defaultForms: String(action.input.defaultForms || runtime.searchFilters.formTypes.join(',') || '10-K,10-Q'),
              rationale: String(action.reason || 'Prepared by Vara Copilot from your current research request.'),
            };

            runtime.draftedAlert = draft;
            setPendingAlertDraft(draft);
            runtime.citations.push({
              id: `alert-${Math.random().toString(36).slice(2, 8)}`,
              kind: 'alert-draft',
              title: draft.name,
              subtitle: draft.defaultForms,
              meta: draft.rationale,
            });
            runtime.findings.push(`Drafted alert "${draft.name}" for review.`);
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Drafted alert "${draft.name}" for review before save.`, status: 'completed' });
            continue;
          }

          if (action.type === 'save_alert') {
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'Persistent changes require confirmation, so the alert remains in draft until you click Save.', status: 'skipped' });
            continue;
          }

          if (action.type === 'export_clean_pdf') {
            const locator = runtime.latestFiling || (app.currentFilingContext ? { ...app.currentFilingContext, auditor: app.currentFilingContext.auditor || '' } : null);
            if (!locator) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'No filing was available for clean PDF export.', status: 'failed' });
              continue;
            }

            const evidence = await fetchFilingEvidence(locator);
            const success = openCleanPrintView(
              `${locator.companyName} ${locator.formType}`,
              evidence.html,
              buildFilingCitation(locator).externalUrl || ''
            );
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: success ? 'Opened a clean print view for PDF export.' : 'Unable to open the print view in this browser session.', status: success ? 'completed' : 'failed' });
          }
        } catch (actionError) {
          console.error(`Agent action failed: ${action.type}`, actionError);
          appendAgentLog(runId, {
            actionId: action.id,
            type: action.type,
            title: action.title,
            detail: actionError instanceof Error ? actionError.message : 'The action failed unexpectedly.',
            status: 'failed',
          });
          runtime.notes.push(`Action ${action.type} failed.`);
        }
      }

      const evidencePacket: AgentEvidencePacket = {
        title: runtime.latestFiling
          ? `${runtime.latestFiling.companyName} ${runtime.latestFiling.formType}`
          : runtime.compareTickers.length > 0
            ? 'Benchmarking cohort ready'
            : runtime.commentLetterResults.length > 0
              ? 'SEC comment-letter evidence'
              : 'Filing research evidence',
        summary: runtime.searchResults.length > 0
          ? await buildSearchTrendSummary(runtime.searchResults.slice(0, 20), runtime.searchQuery, runtime.searchFilters)
          : runtime.commentLetterResults.length > 0
            ? `Found ${runtime.commentLetterResults.length} SEC comment-letter match${runtime.commentLetterResults.length === 1 ? '' : 'es'} for "${runtime.searchQuery || prompt}".`
            : runtime.importantSummary
              ? `Prepared a cited filing summary for ${runtime.latestFiling?.companyName || 'the current filing'}.`
              : runtime.compareTickers.length > 0
                ? `Prepared the benchmarking workspace with ${runtime.compareTickers.join(', ')}.`
                : 'Copilot completed the requested actions.',
        findings: runtime.findings,
        citations: dedupeCitations(runtime.citations),
        followUps: plan.followUps,
        notes: runtime.notes,
        data: {
          filings: runtime.searchResults,
          commentLetters: runtime.commentLetterResults,
          compareTickers: runtime.compareTickers,
          draftedAlert: runtime.draftedAlert,
        },
      };

      const finalAnswer =
        runtime.importantSummary && runtime.searchResults.length === 0 && runtime.commentLetterResults.length === 0
          ? runtime.importantSummary
          : await generateAgentAnswer(evidencePacket, buildContextSnapshot(app, location.pathname));

      updateAgentRun(runId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        answer: finalAnswer,
        evidence: evidencePacket,
      });
      setTab('answer');
    } catch (error) {
      console.error('Copilot run failed:', error);
      updateAgentRun(runId, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Copilot run failed.',
      });
      appendAgentLog(runId, {
        type: 'system',
        title: 'Run failed',
        detail: error instanceof Error ? error.message : 'The copilot run failed.',
        status: 'failed',
      });
      setTab('actions');
    } finally {
      setRunning(false);
    }
  }

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inputValue.trim() || running) return;
    const prompt = inputValue.trim();
    setInputValue('');
    await executePrompt(prompt);
  };

  const evidence = buildFallbackEvidence(activeRun);
  const suggestions = evidence?.followUps?.length
    ? evidence.followUps
    : [
        "Open Apple's latest 10-K and summarize the important parts for me.",
        'Compare same-auditor peers on ASR w/5 derivative.',
        'Find SEC comment letters on segment expense adoption.',
      ];

  function handleCitationOpen(citation: AgentCitation) {
    if (citation.filingRoute) {
      if (citation.sectionLabel) {
        setPendingFilingSectionLabel(citation.sectionLabel);
      }
      navigate(citation.filingRoute);
      return;
    }

    if (citation.route?.startsWith('/')) {
      navigate(citation.route);
      return;
    }

    if (citation.externalUrl) {
      window.open(citation.externalUrl, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <div className="ai-panel glass-card">
      <div className="ai-panel-header">
        <div className="ai-title">
          <Sparkles size={18} className="ai-icon" />
          <span>Vara Copilot</span>
        </div>
        <div className="ai-header-actions">
          {agentRuns.length > 0 && (
            <button className="icon-btn-small" onClick={clearAgentRuns} title="Clear run history">
              <ClipboardList size={16} />
            </button>
          )}
          <button className="icon-btn-small" onClick={() => setChatOpen(false)} title="Close copilot">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="ai-panel-body" ref={panelBodyRef}>
        <div className="copilot-hero">
          <div className="copilot-hero-icon">
            <Bot size={18} />
          </div>
          <div>
            <h3>Structured research copilot</h3>
            <p>Ask Vara to open filings, set filters, prepare peer cohorts, summarize evidence, and draft alerts for review.</p>
          </div>
        </div>

        {agentRuns.length > 1 && (
          <div className="run-history">
            {agentRuns.slice(0, 4).map(run => (
              <button
                key={run.id}
                className={`history-chip ${activeRun?.id === run.id ? 'active' : ''}`}
                onClick={() => setActiveAgentRunId(run.id)}
              >
                {run.prompt.length > 42 ? `${run.prompt.slice(0, 42)}...` : run.prompt}
              </button>
            ))}
          </div>
        )}

        {activeRun ? (
          <div className="run-card">
            <div className="run-card-header">
              <div>
                <div className="run-label">Latest request</div>
                <div className="run-prompt">{activeRun.prompt}</div>
              </div>
              <div className={`run-status ${activeRun.status}`}>
                {activeRun.status === 'running'
                  ? <Loader2 size={14} className="spinner" />
                  : activeRun.status === 'completed'
                    ? <CheckCircle2 size={14} />
                    : <AlertTriangle size={14} />}
                <span>{activeRun.status}</span>
              </div>
            </div>

            <div className="panel-tabs">
              {(['answer', 'evidence', 'actions'] as PanelTab[]).map(item => (
                <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
                  {item === 'answer' ? 'Answer' : item === 'evidence' ? 'Evidence' : 'Action Log'}
                </button>
              ))}
            </div>

            {tab === 'answer' && (
              <div className="panel-tab-content">
                {activeRun.answer ? (
                  <div className="copilot-answer md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(activeRun.answer) }} />
                ) : activeRun.status === 'running' ? (
                  <div className="loading-state">
                    <Loader2 size={16} className="spinner" />
                    <span>Running actions and assembling evidence...</span>
                  </div>
                ) : (
                  <div className="empty-state-small">This run has no answer yet.</div>
                )}

                {pendingAlertDraft && (
                  <div className="draft-alert-card">
                    <div className="draft-alert-header">
                      <BellRing size={16} />
                      <span>Draft Alert Ready</span>
                    </div>
                    <div className="draft-alert-name">{pendingAlertDraft.name}</div>
                    <div className="draft-alert-meta">{pendingAlertDraft.defaultForms} | {pendingAlertDraft.mode}</div>
                    <p>{pendingAlertDraft.rationale}</p>
                    <div className="draft-alert-actions">
                      <button className="primary-btn" onClick={confirmPendingAlertDraft}>Save Alert</button>
                      <button className="secondary-btn" onClick={() => setPendingAlertDraft(null)}>Dismiss</button>
                    </div>
                  </div>
                )}

                <div className="suggestions-block">
                  <div className="section-label">Follow-ups</div>
                  <div className="suggestion-list">
                    {suggestions.slice(0, 4).map(suggestion => (
                      <button key={suggestion} className="suggestion-pill" onClick={() => setInputValue(suggestion)}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === 'evidence' && (
              <div className="panel-tab-content">
                <div className="section-label">Evidence Summary</div>
                <p className="evidence-summary">{evidence?.summary || 'No evidence packet available yet.'}</p>

                <div className="section-label">Citations</div>
                <div className="citation-list">
                  {evidence?.citations?.length ? evidence.citations.map(citation => (
                    <button key={citation.id} className="citation-card" onClick={() => handleCitationOpen(citation)}>
                      <div className="citation-card-header">
                        <span>{citation.title}</span>
                        {(citation.route || citation.externalUrl || citation.filingRoute) ? <ExternalLink size={14} /> : <FileSearch size={14} />}
                      </div>
                      {(citation.subtitle || citation.meta) && (
                        <div className="citation-card-meta">{citation.subtitle || citation.meta}</div>
                      )}
                      {citation.excerpt && <p>{citation.excerpt.slice(0, 220)}{citation.excerpt.length > 220 ? '...' : ''}</p>}
                    </button>
                  )) : (
                    <div className="empty-state-small">No citations yet.</div>
                  )}
                </div>
              </div>
            )}

            {tab === 'actions' && (
              <div className="panel-tab-content">
                <div className="section-label">Action Log</div>
                <div className="action-log-list">
                  {activeRun.actionLog.length ? activeRun.actionLog.map(entry => (
                    <div key={entry.id} className={`action-log-item ${entry.status}`}>
                      <div className="action-log-title">{entry.title}</div>
                      <div className="action-log-detail">{entry.detail}</div>
                    </div>
                  )) : (
                    <div className="empty-state-small">No actions recorded yet.</div>
                  )}
                </div>

                {activeRun.plan && (
                  <>
                    <div className="section-label">Planned Actions</div>
                    <div className="planned-actions">
                      {activeRun.plan.actions.map(action => (
                        <div key={action.id} className="planned-action">
                          <div className="planned-action-title">{action.title}</div>
                          <div className="planned-action-reason">{action.reason || action.type}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="empty-copilot-state">
            <div className="section-label">Try one of these</div>
            <div className="suggestion-list">
              {suggestions.map(suggestion => (
                <button key={suggestion} className="suggestion-pill" onClick={() => setInputValue(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        <ResponsibleAIBanner />
      </div>

      <form className="ai-input-area" onSubmit={handleSend}>
        <input
          type="text"
          value={inputValue}
          onChange={event => setInputValue(event.target.value)}
          placeholder="Ask Vara to open filings, compare peers, find comment letters, or draft alerts..."
          disabled={running}
        />
        <button type="submit" disabled={!inputValue.trim() || running} className="send-btn">
          {running ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}
