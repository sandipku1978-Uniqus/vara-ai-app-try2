'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, usePathname } from 'next/navigation';

import { useApp } from '../context/AppState';
import type {
  AgentCitation,
  AgentEvidencePacket,
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
import { buildSearchTrendSummary, executeFilingResearchSearch, type ResearchSearchMode } from '../services/filingResearch';
import { generateAgentAnswerStreaming, generateFilingSummary, planAgentRun } from '../services/aiApi';
import { openCleanPrintView } from '../services/filingExport';
import { BRAND } from '../config/brand';
import {
  buildContextSnapshotAsync,
  buildFallbackEvidence,
  createInitialRuntimeState,
  dedupeCitations,
  deriveCompanyHintFromTitle,
  filingRouteFromResult,
  normalizeSearchFilters,
  routeForSurface,
  type PanelTab,
  type SurfaceRoute,
} from './AIQnAPanel.helpers';
import { AIQnAPanelView } from './AIQnAPanelView';
import { useResizablePanel } from './useResizablePanel';
import './AIQnA.css';

export function AIQnAPanel() {
  const app = useApp();
  const {
    isChatOpen,
    setChatOpen,
    agentRuns,
    agentPromptQueue,
    activeAgentRunId,
    setActiveAgentRunId,
    removeAgentPromptRequest,
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
  const location = usePathname();
  const navigate = useRouter();
  const [inputValue, setInputValue] = useState('');
  const [tab, setTab] = useState<PanelTab>('answer');
  const [running, setRunning] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [loadingStage, setLoadingStage] = useState('');
  const { panelWidth, handleResizeStart, handleResizeKeyDown } = useResizablePanel();
  const processingRequestIdRef = useRef<string | null>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // A pill fills the composer with a draft and focuses it, so it reads as
  // "edit, then send" rather than a message that was already sent.
  const fillComposer = useCallback((text: string) => {
    setInputValue(text);
    requestAnimationFrame(() => messageInputRef.current?.focus());
  }, []);
  const executePromptRef = useRef<((prompt: string) => Promise<void>) | null>(null);
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

  useEffect(() => {
    if (!isChatOpen) return;
    const activeElement = document.activeElement;
    restoreFocusRef.current = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : null;
    const frame = window.requestAnimationFrame(() => messageInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isChatOpen]);

  const closePanel = useCallback(() => {
    setChatOpen(false);
    const restoreTarget = restoreFocusRef.current;
    window.requestAnimationFrame(() => {
      if (restoreTarget?.isConnected) restoreTarget.focus();
    });
  }, [setChatOpen]);

  async function executePrompt(prompt: string) {
    const runId = startAgentRun(prompt);
    setRunning(true);
    setStreamingText('');
    setLoadingStage('Analyzing your question...');
    setTab('actions');
    appendAgentLog(runId, {
      type: 'system',
      title: 'Planning request',
      detail: 'Interpreting the prompt and deciding which in-app actions to run.',
      status: 'info',
    });

    try {
      const context = await buildContextSnapshotAsync(app, location);
      setLoadingStage('Planning actions...');
      const plan = await planAgentRun(prompt, context);
      updateAgentRun(runId, { plan });
      appendAgentLog(runId, {
        type: 'system',
        title: 'Plan ready',
        detail: `${plan.actions.length} action${plan.actions.length === 1 ? '' : 's'} queued.`,
        status: 'info',
      });

      const runtime = createInitialRuntimeState();
      setLoadingStage('Searching 500K+ SEC filings...');

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
            runtime.citations.push(buildFilingCitation(latestFiling, `Latest filing opened by ${BRAND.copilotName}.`));
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

            navigate.push(`/filing/${locator.cik}_${locator.accessionNumber}_${locator.primaryDocument}`);
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
            navigate.push(routeForSurface(targetPage));
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Prepared filters on ${targetPage === 'search' ? 'Research' : targetPage}.`, status: 'completed' });
            continue;
          }

          if (action.type === 'search_filings' || action.type === 'search_comment_letters') {
            const targetPage = action.type === 'search_comment_letters' ? 'comment-letters' : (String(action.input.targetPage || 'search') as SurfaceRoute);
            const query = String(action.input.query || (action.type === 'search_comment_letters' ? 'comment' : '')).trim();
            const mode = (String(action.input.mode || 'semantic') === 'boolean' ? 'boolean' : 'semantic') as ResearchSearchMode;
            const filters = normalizeSearchFilters(action.input.filters);
            const defaultForms = action.type === 'search_comment_letters' ? 'CORRESP,UPLOAD' : String(action.input.defaultForms || '10-K,10-Q,8-K,DEF 14A,20-F,S-1');

            // Comment-letter questions answer from the OWNED corpus first:
            // full-text ranked excerpts of the actual Staff/company language,
            // so the copilot quotes what was really said instead of listing
            // filing metadata. EFTS fallback below covers corpus outages.
            if (action.type === 'search_comment_letters') {
              try {
                const params = new URLSearchParams({ q: query || prompt, size: '10' });
                const response = await fetch(`/api/letters?${params.toString()}`);
                if (response.ok) {
                  const payload = await response.json();
                  const matches = (payload.matches ?? []) as Array<{
                    company_name: string; form: string; date_filed: string;
                    thread_id: string; filename: string; headline: string; cik: number;
                  }>;
                  if (matches.length > 0) {
                    runtime.lettersCorpusCount = Number(payload.total || matches.length);
                    runtime.searchQuery = query;
                    runtime.notes.push(
                      `Letter corpus: ${runtime.lettersCorpusCount} full-text matches (2005+); excerpts below are truncated fragments.`
                    );
                    for (const match of matches.slice(0, 8)) {
                      const excerpt = match.headline.replace(/<\/?b>/g, '').replace(/\s+/g, ' ').trim();
                      runtime.findings.push(
                        `${match.form === 'UPLOAD' ? 'SEC Staff letter to' : 'Response from'} ${match.company_name} (${match.date_filed}): "${excerpt}"`
                      );
                      // Filing index page, not the raw .txt — PDF letters are
                      // uuencoded inside the submission file. The accession is
                      // the .txt basename in the master.idx-style filename.
                      const letterAccession = (match.filename.split('/').pop() || '').replace(/\.txt$/i, '');
                      runtime.citations.push(
                        buildCommentLetterCitation({
                          companyName: match.company_name,
                          formType: match.form,
                          filingDate: match.date_filed,
                          route: `/comment-letters?company=${encodeURIComponent(match.company_name)}&thread=${encodeURIComponent(match.thread_id)}`,
                          externalUrl: letterAccession
                            ? `https://www.sec.gov/Archives/edgar/data/${Number(match.cik)}/${letterAccession.replace(/-/g, '')}/${letterAccession}-index.htm`
                            : `https://www.sec.gov/Archives/${match.filename}`,
                          description: excerpt.slice(0, 160) || 'SEC correspondence',
                        })
                      );
                    }
                    setPendingSearchIntent({
                      id: `intent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      surface: 'comment-letters',
                      query,
                      mode,
                      filters,
                      defaultForms,
                    });
                    navigate.push(routeForSurface('comment-letters'));
                    appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Found ${matches.length} letter excerpt${matches.length === 1 ? '' : 's'} in the corpus.`, status: 'completed' });
                    continue;
                  }
                }
              } catch {
                // corpus unreachable — fall through to the EFTS path
              }
            }

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
            navigate.push(routeForSurface(targetPage));
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
            const viewMode = String(action.input.viewMode || 'financials') as 'financials' | 'text-diff' | 'audit-matrix' | 'yoy-changes';
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
            navigate.push('/compare');
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
            const resultCount = runtime.searchResults.length;
            if (resultCount === 0) {
              appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'No result set was loaded, so there was nothing to summarize.', status: 'skipped' });
              continue;
            }
            runtime.findings.push(`Summarized the current result set of ${resultCount} filing${resultCount === 1 ? '' : 's'}.`);
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: `Summarized the ${resultCount} filing${resultCount === 1 ? '' : 's'} in the current result set — see the summary above the findings.`, status: 'completed' });
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
                rationale: String(action.reason || `Prepared by ${BRAND.copilotName} from your current research request.`),
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
            appendAgentLog(runId, { actionId: action.id, type: action.type, title: action.title, detail: 'Saving an alert is a persistent change, so it needs your confirmation — the alert stays in draft until you click “Save Alert”.', status: 'skipped' });
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
            : runtime.commentLetterResults.length > 0 || runtime.lettersCorpusCount > 0
              ? 'SEC comment-letter evidence'
              : 'Filing research evidence',
        summary: runtime.searchResults.length > 0
          ? await buildSearchTrendSummary(runtime.searchResults.slice(0, 20), runtime.searchQuery, runtime.searchFilters)
          : runtime.lettersCorpusCount > 0
            ? `Found ${runtime.lettersCorpusCount} full-text comment-letter match${runtime.lettersCorpusCount === 1 ? '' : 'es'} for "${runtime.searchQuery || prompt}" — excerpts quoted in the findings below.`
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

      let finalAnswer: string;

      if (runtime.importantSummary && runtime.searchResults.length === 0 && runtime.commentLetterResults.length === 0 && runtime.lettersCorpusCount === 0) {
        finalAnswer = runtime.importantSummary;
      } else {
        // Use streaming for answer generation — tokens appear incrementally
        setLoadingStage('Generating analysis...');
        setTab('answer');
        const streamContext = await buildContextSnapshotAsync(app, location);
        finalAnswer = await generateAgentAnswerStreaming(
          evidencePacket,
          streamContext,
          (chunk) => setStreamingText(prev => prev + chunk)
        );
      }

      updateAgentRun(runId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        answer: finalAnswer,
        evidence: evidencePacket,
      });
      setStreamingText('');
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
      setLoadingStage('');
    }
  }

  useEffect(() => {
    executePromptRef.current = executePrompt;
  });

  useEffect(() => {
    const nextRequest = agentPromptQueue[0];
    const executor = executePromptRef.current;
    if (!isChatOpen || running || !nextRequest || !executor || processingRequestIdRef.current) return;

    processingRequestIdRef.current = nextRequest.id;
    void executor(nextRequest.prompt).finally(() => {
      removeAgentPromptRequest(nextRequest.id);
      processingRequestIdRef.current = null;
    });
  }, [agentPromptQueue, isChatOpen, removeAgentPromptRequest, running]);

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!inputValue.trim() || running) return;
    const prompt = inputValue.trim();
    setInputValue('');
    await executePrompt(prompt);
  };

  if (!isChatOpen) return null;

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
      navigate.push(citation.filingRoute);
      return;
    }

    if (citation.route?.startsWith('/')) {
      navigate.push(citation.route);
      return;
    }

    if (citation.externalUrl) {
      window.open(citation.externalUrl, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <AIQnAPanelView
      panelWidth={panelWidth}
      panelBodyRef={panelBodyRef}
      messageInputRef={messageInputRef}
      agentRuns={agentRuns}
      activeRun={activeRun}
      evidence={evidence}
      tab={tab}
      running={running}
      streamingText={streamingText}
      loadingStage={loadingStage}
      inputValue={inputValue}
      pendingAlertDraft={pendingAlertDraft}
      suggestions={suggestions}
      onResizeStart={handleResizeStart}
      onResizeKeyDown={handleResizeKeyDown}
      onClearRuns={clearAgentRuns}
      onClose={closePanel}
      onSelectRun={setActiveAgentRunId}
      onTabChange={setTab}
      onConfirmAlert={confirmPendingAlertDraft}
      onDismissAlert={() => setPendingAlertDraft(null)}
      onFillComposer={fillComposer}
      onOpenCitation={handleCitationOpen}
      onInputChange={setInputValue}
      onSubmit={handleSend}
    />
  );
}
