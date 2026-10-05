'use client';

/**
 * Accounting issue page — one disclosure issue (revenue recognition, leases,
 * material weakness, …) with everything a reviewer reaches for, in five
 * panels. Each panel names its source and how much of it was read, so a
 * reader can tell live filing evidence from the curated reference list from
 * the internal knowledge base:
 *
 *   Precedents               SEC filings, run through the filing-research search
 *   Staff comments           the owned SEC comment-letter corpus (/api/letters)
 *   Authoritative references Codification links, the FASB ASU index (/api/asu), SEC/PCAOB references
 *   Uniqus guidance          the reviewed framework knowledge base, plus grounded Ask-AI
 *   Peer comparison          Benchmarking with this topic preselected
 */

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Building2, ExternalLink, Loader2, Mail, Scale, Sparkles, Users } from 'lucide-react';
import {
  ACCOUNTING_ISSUES,
  FASB_CODIFICATION_URL,
  accountingIssueHref,
  ascTopicUrl,
  benchmarkingIssueHref,
  findAccountingIssue,
  issueAscReference,
  type AccountingIssue,
} from '../config/accountingTopics';
import { defaultSearchFilters, type SearchFilters } from '../domain/searchFilters';
import { executeFilingResearchSearch, type FilingResearchResult } from '../services/filingResearch';
import { buildResearchRouteParams } from '../services/researchSessions';
import { buildResultsHeadline } from '../services/searchCoverage';
import SearchIntegrityNotice, { useSearchIntegrity } from '../components/research/SearchIntegrityNotice';
import {
  asuCitationSearchHref,
  asuCitationsInText,
  asuRowHref,
  fetchAsuIndex,
  formatAsuIssued,
  type AsuIndex,
} from '../services/asuIndex';
import { DEFAULT_FRAMEWORK_KB_ENTRIES, selectFrameworkExcerpts } from '../lib/framework-excerpts';
import { aiAscLookup, type AscGuidanceResult } from '../services/aiApi';
import { linkifyCitationMarkers, parseCitationMarkers } from '../lib/citation-markers';
import { renderMarkdown } from '../utils/markdownRenderer';
import ResponsibleAIBanner from '../components/ResponsibleAIBanner';
import './AccountingHub.css';
import './AccountingIssuePage.css';

const PRECEDENT_LIMIT = 10;
const PRECEDENT_FORMS = '10-K';
const PRECEDENT_YEARS = 2;
const LETTER_LIMIT = 8;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The filters the precedent panel runs and the workbench link reopens. */
export function precedentFilters(issue: AccountingIssue, now: Date = new Date()): SearchFilters {
  const from = new Date(now);
  from.setUTCFullYear(from.getUTCFullYear() - PRECEDENT_YEARS);
  return {
    ...defaultSearchFilters,
    formTypes: [PRECEDENT_FORMS],
    dateFrom: isoDate(from),
    dateTo: isoDate(now),
    ...issue.precedent.filters,
  };
}

function IssuePanel({
  id,
  icon,
  title,
  source,
  coverage,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  source: ReactNode;
  coverage: ReactNode;
  children: ReactNode;
}) {
  const headingId = `issue-panel-${id}`;
  return (
    <section className="issue-panel glass-card" aria-labelledby={headingId} data-panel={id}>
      <header className="issue-panel-header">
        <h2 id={headingId}>{icon}{title}</h2>
        <p className="issue-panel-source"><span className="issue-panel-label">Source</span> {source}</p>
        <p className="issue-panel-coverage" role="status"><span className="issue-panel-label">Coverage</span> {coverage}</p>
      </header>
      <div className="issue-panel-body">{children}</div>
    </section>
  );
}

function AsuCitationLinks({ text }: { text: string }) {
  const numbers = asuCitationsInText(text);
  if (numbers.length === 0) return null;
  return (
    <span className="issue-asu-citations">
      {numbers.map(number => (
        <Link key={number} href={asuRowHref(number)} className="issue-chip">ASU {number}</Link>
      ))}
    </span>
  );
}

// ── (a) Precedents ──────────────────────────────────────────────────────────

function PrecedentsPanel({ issue }: { issue: AccountingIssue }) {
  const filters = useMemo(() => precedentFilters(issue), [issue]);
  const integrity = useSearchIntegrity();
  // The callbacks object is rebuilt whenever coverage changes; its two
  // functions are stable, so the search depends on them, not on the object.
  const { reset } = integrity;
  const { onDegraded, onCoverage } = integrity.callbacks;
  const [results, setResults] = useState<FilingResearchResult[]>([]);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    reset();
    setState('loading');
    setResults([]);
    executeFilingResearchSearch({
      query: issue.precedent.query,
      filters,
      mode: issue.precedent.mode,
      defaultForms: PRECEDENT_FORMS,
      limit: PRECEDENT_LIMIT,
      hydrateTextSignals: true,
      signal: controller.signal,
      onDegraded,
      onCoverage,
    })
      .then(matches => {
        if (controller.signal.aborted) return;
        setResults(matches);
        setState('done');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState('error');
      });
    return () => controller.abort();
  }, [issue, filters, reset, onDegraded, onCoverage]);

  const workbenchHref = `/search?${buildResearchRouteParams(issue.precedent.query, issue.precedent.mode, filters).toString()}`;
  const headline = state === 'done' ? buildResultsHeadline(results.length, integrity.coverage, PRECEDENT_LIMIT) : null;

  return (
    <IssuePanel
      id="precedents"
      icon={<Building2 size={16} aria-hidden="true" />}
      title="Precedents"
      source={(
        <>
          SEC EDGAR filings, matched by the Research Workbench search and validated against filing text. Search: “{issue.precedent.title}” ({issue.precedent.origin === 'research-library' ? 'Research library entry' : 'issue-page search'}) — <code>{issue.precedent.query}</code>
          {issue.precedent.filters?.ascReference ? <> · cites {issue.precedent.filters.ascReference}</> : null}
          {issue.precedent.filters?.sectionScope ? <> · inside Item {issue.precedent.filters.sectionScope}</> : null}
        </>
      )}
      coverage={(
        <>
          {PRECEDENT_FORMS} filings dated {filters.dateFrom} to {filters.dateTo}
          {headline ? <> · {headline}</> : state === 'loading' ? ' · searching…' : ' · search did not complete'}
        </>
      )}
    >
      <SearchIntegrityNotice integrity={integrity} resultCount={results.length} />
      {state === 'loading' && (
        <p className="issue-muted"><Loader2 size={14} className="spinner" aria-hidden="true" /> Searching filings…</p>
      )}
      {state === 'error' && (
        <p role="alert" className="issue-error">The precedent search failed. This is not an authoritative zero; open it in the Research Workbench to retry.</p>
      )}
      {state === 'done' && results.length === 0 && (
        <p className="issue-muted">
          {integrity.coverage && !integrity.coverage.complete
            ? 'No verified filings within the partial candidate window. This is not an authoritative zero.'
            : 'No filings matched this search in the window above.'}
        </p>
      )}
      {results.length > 0 && (
        <ol className="issue-list">
          {results.map(result => {
            const evidence = [result.matchReason, result.matchSnippet].filter(Boolean).join(' — ');
            return (
              <li key={result.id} className="issue-list-item">
                <div className="issue-list-title">
                  <Link href={`/filing/${result.cik}_${result.accessionNumber}_${result.primaryDocument}`}>{result.entityName}</Link>
                  <span className="issue-meta">{result.formType} · filed {result.fileDate}{result.matchSectionPath ? ` · ${result.matchSectionPath}` : ''}</span>
                </div>
                {evidence && <p className="issue-snippet">{evidence}</p>}
                <AsuCitationLinks text={`${result.matchSnippet || ''} ${result.matchReason || ''}`} />
              </li>
            );
          })}
        </ol>
      )}
      <p className="issue-panel-actions">
        <Link href={workbenchHref} className="secondary-btn">Open this search in the Research Workbench</Link>
      </p>
    </IssuePanel>
  );
}

// ── (b) Staff comments ──────────────────────────────────────────────────────

interface LetterMatch {
  accession: string;
  company_name: string;
  form: string;
  date_filed: string;
  thread_id: string;
  headline: string;
}

/** ts_headline marks hits with <b>; render them as <mark> without injecting HTML. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(<b>[\s\S]*?<\/b>)/g);
  return (
    <>
      {parts.map((part, index) => {
        const hit = part.match(/^<b>([\s\S]*)<\/b>$/);
        return hit ? <mark key={index}>{hit[1]}</mark> : <span key={index}>{part.replace(/<\/?b>/g, '')}</span>;
      })}
    </>
  );
}

function StaffCommentsPanel({ issue }: { issue: AccountingIssue }) {
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [matches, setMatches] = useState<LetterMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [totalIsFloor, setTotalIsFloor] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');
    const params = new URLSearchParams({ q: issue.letterQuery, size: String(LETTER_LIMIT) });
    fetch(`/api/letters?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as { matches?: LetterMatch[]; total?: number; totalIsFloor?: boolean };
        if (controller.signal.aborted) return;
        setMatches(Array.isArray(payload.matches) ? payload.matches : []);
        setTotal(Number(payload.total) || 0);
        setTotalIsFloor(Boolean(payload.totalIsFloor));
        setState('done');
      })
      .catch(() => {
        if (!controller.signal.aborted) setState('error');
      });
    return () => controller.abort();
  }, [issue]);

  const totalLabel = `${total.toLocaleString()}${totalIsFloor ? '+' : ''}`;

  return (
    <IssuePanel
      id="staff-comments"
      icon={<Mail size={16} aria-hidden="true" />}
      title="Staff comments"
      source={<>SEC comment-letter corpus (staff UPLOAD letters and company CORRESP responses), full-text search for <code>{issue.letterQuery}</code></>}
      coverage={state === 'done'
        ? <>Showing {matches.length} of {totalLabel} matching letters, most relevant first</>
        : state === 'loading' ? 'Searching letters…' : 'The letter search did not complete'}
    >
      {state === 'error' && (
        <p role="alert" className="issue-error">The comment-letter search failed. This is not an authoritative zero.</p>
      )}
      {state === 'done' && matches.length === 0 && <p className="issue-muted">No letters in the corpus match this phrase.</p>}
      {matches.length > 0 && (
        <ol className="issue-list">
          {matches.map(match => (
            <li key={match.accession} className="issue-list-item">
              <div className="issue-list-title">
                <Link href={`/comment-letters?${new URLSearchParams({ thread: match.thread_id }).toString()}`}>{match.company_name}</Link>
                <span className="issue-meta">{match.form === 'UPLOAD' ? 'SEC staff letter' : match.form === 'CORRESP' ? 'Company response' : match.form} · {match.date_filed}</span>
              </div>
              {match.headline && <p className="issue-snippet"><Highlighted text={match.headline} /></p>}
            </li>
          ))}
        </ol>
      )}
      <p className="issue-panel-actions">
        <Link href="/comment-letters" className="secondary-btn">Search all comment letters</Link>
      </p>
    </IssuePanel>
  );
}

// ── (c) Authoritative references ────────────────────────────────────────────

function AuthoritativeReferencesPanel({ issue }: { issue: AccountingIssue }) {
  const ascReference = issueAscReference(issue);
  const ascQuery = ascReference?.replace(/^ASC\s*/i, '') ?? null;
  const [index, setIndex] = useState<AsuIndex | null>(null);
  const [state, setState] = useState<'loading' | 'done' | 'error' | 'none'>(ascQuery ? 'loading' : 'none');

  useEffect(() => {
    if (!ascQuery) {
      setState('none');
      return;
    }
    let cancelled = false;
    setState('loading');
    fetchAsuIndex({ topic: ascQuery })
      .then(result => {
        if (cancelled) return;
        setIndex(result);
        setState('done');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => { cancelled = true; };
  }, [ascQuery]);

  const coverage = index?.coverage;
  const readDates = coverage
    ? [...new Set(coverage.pages.filter(page => page.readAt).map(page => page.readAt!.slice(0, 10)))].join(', ')
    : '';
  const asuCoverage = state === 'none'
    ? 'This issue is not a Codification topic, so no ASUs are matched to it.'
    : state === 'loading'
      ? 'Reading the ASU index…'
      : state === 'error'
        ? 'The ASU index could not be loaded.'
        : coverage
          ? `${index!.entries.length} ASU${index!.entries.length === 1 ? '' : 's'} name ${ascReference} in their titles, of ${coverage.count} indexed (${coverage.source === 'live' ? 'read live from fasb.org' : coverage.source === 'partial' ? 'partly from the saved fasb.org copy' : 'from the saved fasb.org copy'}${readDates ? `, read ${readDates}` : ''}${coverage.fromCache ? ', cached' : ''})`
          : '';

  return (
    <IssuePanel
      id="authoritative-references"
      icon={<Scale size={16} aria-hidden="true" />}
      title="Authoritative references"
      source={<>FASB Codification (licensed — links open asc.fasb.org) · FASB Accounting Standards Updates listings on fasb.org · curated SEC staff, SEC rule, and PCAOB references</>}
      coverage={asuCoverage}
    >
      <h3 className="issue-subhead">Codification</h3>
      {issue.codificationTopics.length > 0 ? (
        <ul className="issue-link-list">
          {issue.codificationTopics.map(topic => (
            <li key={topic}>
              <a href={ascTopicUrl(topic)} target="_blank" rel="noopener noreferrer">ASC {topic}{issue.asc && issue.asc !== `ASC ${topic}` ? ` (${issue.asc})` : ''} <ExternalLink size={12} aria-hidden="true" /></a>
              <span className="issue-meta"> FASB Accounting Standards Codification — text is not reproduced here</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="issue-muted">This issue is governed outside the Codification; see the references below. <a href={FASB_CODIFICATION_URL} target="_blank" rel="noopener noreferrer">Open the FASB Codification</a></p>
      )}

      <h3 className="issue-subhead">Accounting Standards Updates</h3>
      {state === 'error' && <p role="alert" className="issue-error">The ASU index could not be loaded. Retry, or open <Link href="/accounting?tab=asu">the ASU index</Link>.</p>}
      {state === 'loading' && <p className="issue-muted"><Loader2 size={14} className="spinner" aria-hidden="true" /> Loading ASUs…</p>}
      {state === 'done' && index && index.entries.length === 0 && <p className="issue-muted">No indexed ASU names {ascReference} in its title.</p>}
      {state === 'done' && index && index.entries.length > 0 && (
        <ol className="issue-list">
          {index.entries.map(entry => (
            <li key={entry.number} className="issue-list-item">
              <div className="issue-list-title">
                <Link href={asuRowHref(entry.number)}>{entry.status === 'proposed' ? `Proposed ${entry.number}` : `ASU ${entry.number}`}</Link>
                <span className="issue-meta">
                  {entry.status === 'proposed'
                    ? `Exposure draft · comments due ${entry.commentDeadline ?? 'date not listed'}`
                    : `Issued ${formatAsuIssued(entry)}`}
                </span>
              </div>
              <p className="issue-snippet">{entry.title}</p>
              {entry.effectiveDates && (
                <details className="issue-details">
                  <summary>Effective dates (FASB)</summary>
                  <p className="issue-effective">{entry.effectiveDates}</p>
                </details>
              )}
              <span className="issue-actions-inline">
                {entry.pdfUrl && <a href={entry.pdfUrl} target="_blank" rel="noopener noreferrer">PDF on fasb.org <ExternalLink size={12} aria-hidden="true" /></a>}
                {entry.status === 'issued' && <Link href={asuCitationSearchHref(entry.number)}>Filings citing ASU {entry.number} (10-K, last 2 years)</Link>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {coverage && coverage.notes.length > 0 && (
        <ul className="issue-notes">
          {coverage.notes.filter(note => /saved|not available|read \d+ of/.test(note)).map(note => <li key={note}>{note}</li>)}
        </ul>
      )}

      <h3 className="issue-subhead">SEC staff, SEC rule, and PCAOB references</h3>
      {issue.references.length > 0 ? (
        <ul className="issue-link-list">
          {issue.references.map(reference => (
            <li key={reference.id}>
              <a href={reference.url} target="_blank" rel="noopener noreferrer">{reference.id} — {reference.title} <ExternalLink size={12} aria-hidden="true" /></a>
              <span className="issue-meta"> {reference.publisher}{reference.issued ? `, ${reference.issued}` : ''}. {reference.relevance}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="issue-muted">No SAB or other SEC/PCAOB reference is curated for this issue.</p>
      )}
    </IssuePanel>
  );
}

// ── (d) Uniqus guidance ─────────────────────────────────────────────────────

function UniqusGuidancePanel({ issue }: { issue: AccountingIssue }) {
  const ascReference = issueAscReference(issue);
  const topicNumber = ascReference?.match(/(\d{3})/)?.[1] ?? null;
  const selection = useMemo(
    () => (ascReference ? selectFrameworkExcerpts(ascReference, topicNumber) : { coverage: 'none' as const, excerpts: [], matchedTopics: [] }),
    [ascReference, topicNumber],
  );
  const kbIds = DEFAULT_FRAMEWORK_KB_ENTRIES.map(entry => entry.id).join(', ');

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AscGuidanceResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');
  const answerRef = useRef<HTMLDivElement>(null);

  const ask = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setAsking(true);
    setAskError('');
    setAnswer(null);
    try {
      const result = await aiAscLookup(trimmed, topicNumber);
      if (!result.text.trim()) throw new Error('empty');
      setAnswer(result);
    } catch {
      setAskError('Guidance could not be generated. Nothing was saved; retry when the AI service is available.');
    } finally {
      setAsking(false);
    }
  }, [question, topicNumber]);

  const rendering = useMemo(() => {
    if (!answer) return null;
    const grounded = answer.grounding.coverage === 'grounded';
    const excerpts = grounded ? answer.grounding.excerpts : [];
    const markers = parseCitationMarkers(answer.text, excerpts.length);
    const html = grounded
      ? linkifyCitationMarkers(renderMarkdown(answer.text), excerpts.length, `issue-${issue.id}-excerpt`)
      : renderMarkdown(answer.text);
    return { grounded, excerpts, html, markers };
  }, [answer, issue.id]);

  return (
    <IssuePanel
      id="uniqus-guidance"
      icon={<BookOpen size={16} aria-hidden="true" />}
      title="Uniqus guidance"
      source={<>Reviewed internal guidance — the Uniqus framework knowledge base (IFRS and Ind AS cross-framework notes; not Codification text). Ask-AI answers are grounded in these excerpts when they cover the question.</>}
      coverage={ascReference
        ? selection.excerpts.length > 0
          ? <>{selection.excerpts.length} knowledge-base {selection.excerpts.length === 1 ? 'entry maps' : 'entries map'} to {ascReference}, of {DEFAULT_FRAMEWORK_KB_ENTRIES.length} entries ({kbIds})</>
          : <>No knowledge-base entry maps to {ascReference}; the knowledge base holds {DEFAULT_FRAMEWORK_KB_ENTRIES.length} entries ({kbIds})</>
        : <>This issue has no Codification topic to map; the knowledge base holds {DEFAULT_FRAMEWORK_KB_ENTRIES.length} entries ({kbIds})</>}
    >
      {selection.excerpts.length > 0 && (
        <ol className="issue-list">
          {selection.excerpts.map(excerpt => (
            <li key={`${excerpt.framework}-${excerpt.id}`} className="issue-list-item">
              <div className="issue-list-title">
                <strong>{excerpt.id} — {excerpt.title}</strong>
                <span className="issue-meta">{excerpt.framework} knowledge base · equivalent reference {excerpt.reference} · reviewed internal guidance</span>
              </div>
              <p className="issue-effective">{excerpt.text}</p>
            </li>
          ))}
        </ol>
      )}

      <form className="ai-input-form issue-ask" onSubmit={event => void ask(event)}>
        <label className="sr-only" htmlFor={`issue-ask-${issue.id}`}>Question about {issue.label}</label>
        <input
          id={`issue-ask-${issue.id}`}
          className="ai-input"
          value={question}
          onChange={event => setQuestion(event.target.value)}
          placeholder={`Ask about ${issue.label.toLowerCase()}${topicNumber ? ` (scoped to ASC ${topicNumber})` : ''}`}
          disabled={asking}
        />
        <button type="submit" className="primary-btn" disabled={asking || !question.trim()}>
          {asking ? <Loader2 size={14} className="spinner" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />} Ask
        </button>
      </form>
      {askError && <p role="alert" className="issue-error">{askError}</p>}
      {rendering && (
        <div ref={answerRef} className="issue-answer" data-grounding={rendering.grounded ? 'framework-kb' : 'model-recall'}>
          <p role="note" className={`ai-grounding-note ${rendering.grounded ? 'ai-grounding-note--grounded' : 'ai-grounding-note--recall'}`}>
            {rendering.grounded
              ? 'Grounded in the Uniqus knowledge base: each [n] cites an excerpt listed below. The excerpts are cross-framework notes, not Codification text — confirm references in the FASB Codification.'
              : 'Model recall, not a grounded answer: no knowledge-base excerpt covers this question, so any citation in it is unverified. Confirm references in the FASB Codification.'}
          </p>
          {rendering.grounded && !rendering.markers.hasMarkers && (
            <p role="status" className="ai-citation-warning">This reply cites none of the provided excerpts; treat every statement in it as unverified.</p>
          )}
          <div className="md-content" dangerouslySetInnerHTML={{ __html: rendering.html }} />
          {rendering.grounded && (
            <ol className="ai-excerpt-list">
              {rendering.excerpts.map(excerpt => (
                <li key={excerpt.n} id={`issue-${issue.id}-excerpt-${excerpt.n}`} className="ai-excerpt">
                  <strong>[{excerpt.n}] {excerpt.id} — {excerpt.title}</strong>
                  <span className="issue-meta"> {excerpt.framework} knowledge base · {rendering.markers.cited.includes(excerpt.n) ? 'cited' : 'provided, not cited'}</span>
                </li>
              ))}
            </ol>
          )}
          <ResponsibleAIBanner />
        </div>
      )}
    </IssuePanel>
  );
}

// ── (e) Peer comparison ─────────────────────────────────────────────────────

function PeerComparisonPanel({ issue }: { issue: AccountingIssue }) {
  return (
    <IssuePanel
      id="peer-comparison"
      icon={<Users size={16} aria-hidden="true" />}
      title="Peer comparison"
      source={<>Benchmarking topic comparison: reads each chosen peer’s filing and locates its {issue.label.toLowerCase()} passage — a matching heading first, otherwise the densest run of the topic’s terms — and says which it used.</>}
      coverage={<>Runs on the peers you choose in Benchmarking; nothing is precomputed on this page.</>}
    >
      <p className="issue-panel-actions">
        <Link href={benchmarkingIssueHref(issue.id)} className="primary-btn">Compare peers on {issue.label.toLowerCase()}</Link>
      </p>
    </IssuePanel>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function AccountingIssuePage({ issueId }: { issueId: string }) {
  const issue = findAccountingIssue(issueId);
  if (!issue) {
    return (
      <div className="accounting-issue-page">
        <p role="alert">“{issueId}” is not an accounting issue page. <Link href="/accounting">Back to Accounting Standards</Link></p>
      </div>
    );
  }

  return (
    <div className="accounting-issue-page">
      <nav className="issue-breadcrumb" aria-label="Breadcrumb">
        <Link href="/accounting"><ArrowLeft size={14} aria-hidden="true" /> Accounting Standards</Link>
      </nav>
      <header className="hub-header">
        <h1>{issue.label}</h1>
        <p>{issue.asc ? `${issue.asc} · ` : ''}Precedents, staff comments, authoritative references, internal guidance, and peer comparison for one issue — each panel names its source and coverage.</p>
      </header>
      <nav className="issue-switcher" aria-label="Other accounting issues">
        {ACCOUNTING_ISSUES.map(candidate => (
          <Link
            key={candidate.id}
            href={accountingIssueHref(candidate.id)}
            className={`issue-chip${candidate.id === issue.id ? ' issue-chip--current' : ''}`}
            aria-current={candidate.id === issue.id ? 'page' : undefined}
          >
            {candidate.label}
          </Link>
        ))}
      </nav>
      <div className="issue-panels">
        <PrecedentsPanel issue={issue} />
        <StaffCommentsPanel issue={issue} />
        <AuthoritativeReferencesPanel issue={issue} />
        <UniqusGuidancePanel issue={issue} />
        <PeerComparisonPanel issue={issue} />
      </div>
    </div>
  );
}
