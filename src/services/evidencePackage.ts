/**
 * Evidence package — the record of how a memo or copilot answer was produced.
 *
 * A reviewer opening a workpaper needs more than the conclusion: which query
 * ran (and with which operators and filters), whether the candidate window
 * was complete, which filings were actually read, which section slices fed
 * the text, which model wrote any AI prose, when, and from which deployment.
 *
 * Every field is recorded from something the app observed. Where the app did
 * not observe a value — the memo tray does not know the query that surfaced a
 * citation; the AI routes may not report the model — the field says "not
 * recorded"/"not reported" and why, rather than guessing.
 *
 * Pure assembly; the only I/O is fetchAppVersion, which takes its fetch.
 */
import type { AgentEvidencePacket, AgentRun } from '../types/agent';
import type { FilingResearchResult } from './filingResearch';
import type { MemoCitation, MemoDraftRecord } from './memoTray';
import type { SearchCandidateCoverage } from './secApi';
import { looksLikeBooleanQuery, parseBooleanQuery, type BooleanSearchNode } from '../utils/booleanSearch';

export const EVIDENCE_PACKAGE_SCHEMA = 'urc.evidence-package.v1';

export interface EvidenceSource {
  cik: string;
  accessionNumber: string;
  company: string;
  form: string;
  fileDate: string;
  secUrl: string;
  /** cited: the user cited it; read: an app step fetched or validated its text; listed: returned as a result only. */
  role: 'cited' | 'read' | 'listed';
}

export interface EvidenceSectionSlice {
  accessionNumber: string;
  section: string;
  characters: number;
  origin: 'memo-citation' | 'copilot-evidence';
}

export interface EvidenceCoverage {
  status: 'complete' | 'partial' | 'not-recorded';
  examined: number | null;
  upstreamTotal: number | null;
  upstreamTotalIsFloor?: boolean;
  verifiedMatchTotal?: number | null;
  note: string;
}

export interface EvidenceAiStep {
  purpose: string;
  model: string | null;
  reasoningEffort: string | null;
  metadataSource: 'response' | 'request' | 'not-reported';
  generatedAt: string | null;
}

export type EvidenceAppVersion =
  | { status: 'reported'; sha: string | null; ref: string | null; deploymentId: string | null; environment: string | null }
  | { status: 'unavailable'; reason: string };

export interface EvidencePackage {
  schema: typeof EVIDENCE_PACKAGE_SCHEMA;
  subject: { kind: 'memo' | 'ai-answer'; title: string };
  query: { text: string | null; mode: string | null; operators: string[]; note?: string };
  filters: Array<{ label: string; value: string }>;
  coverage: EvidenceCoverage;
  sources: EvidenceSource[];
  sectionSlices: EvidenceSectionSlice[];
  aiStep: EvidenceAiStep | null;
  generatedAt: string;
  appVersion: EvidenceAppVersion;
}

/* ------------------------------------------------------------------ */
/*  Small pure readers                                                 */
/* ------------------------------------------------------------------ */

const SEC_ARCHIVE_URL = /\/Archives\/edgar\/data\/(\d+)\/(\d{10})-?(\d{2})-?(\d{6})/;

/** Accession and CIK from an SEC Archives URL, or null. */
export function parseSecArchiveUrl(url: string | undefined): { cik: string; accessionNumber: string } | null {
  const match = (url || '').match(SEC_ARCHIVE_URL);
  if (!match) return null;
  return { cik: match[1], accessionNumber: `${match[2]}-${match[3]}-${match[4]}` };
}

/** Dashed accession (0000320193-26-000001) when the input is the 18-digit form either way. */
export function normalizeAccession(accession: string): string {
  const digits = (accession || '').replace(/-/g, '').trim();
  return /^\d{18}$/.test(digits) ? `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}` : (accession || '').trim();
}

function collectOperators(node: BooleanSearchNode, into: Set<string>): void {
  switch (node.type) {
    case 'AND': case 'OR':
      into.add(node.type);
      collectOperators(node.left, into);
      collectOperators(node.right, into);
      return;
    case 'NOT':
      into.add('NOT');
      collectOperators(node.child, into);
      return;
    case 'PROX':
      into.add(`${node.ordered ? 'PRE' : 'W'}/${node.distance}`);
      collectOperators(node.left, into);
      collectOperators(node.right, into);
      return;
    case 'PHRASE': into.add('"phrase"'); return;
    case 'WILDCARD': into.add('wildcard'); return;
    case 'NUMBER': into.add(`number(${node.unit})`); return;
    case 'AUDITOR': into.add('auditor:'); return;
    default: return;
  }
}

/**
 * The operators a query actually used, read from the same parser the search
 * engine runs. A natural-language (non-Boolean) query reports none; a Boolean
 * query that fails to parse reports the parse error instead of a guess.
 */
export function queryOperators(query: string, mode?: string | null): string[] {
  const text = (query || '').trim();
  if (!text) return [];
  if (mode !== 'boolean' && !looksLikeBooleanQuery(text)) return [];
  const parsed = parseBooleanQuery(text);
  if (!parsed.expression) return parsed.error ? [`unparsed: ${parsed.error}`] : [];
  const operators = new Set<string>();
  collectOperators(parsed.expression, operators);
  return Array.from(operators);
}

/** Coverage as the search reported it; null coverage is "not recorded", never "complete". */
export function coverageFromSearch(coverage: SearchCandidateCoverage | null | undefined, note?: string): EvidenceCoverage {
  if (!coverage) {
    return { status: 'not-recorded', examined: null, upstreamTotal: null, note: note || 'no candidate-coverage record was captured for this output' };
  }
  return {
    status: coverage.complete ? 'complete' : 'partial',
    examined: coverage.examined,
    upstreamTotal: coverage.upstreamTotal,
    upstreamTotalIsFloor: Boolean(coverage.upstreamTotalIsFloor),
    verifiedMatchTotal: coverage.verifiedMatchTotal ?? null,
    note: coverage.complete
      ? 'every upstream candidate was validated'
      : 'partial candidate window — the result set is a verified subset, not the full corpus',
  };
}

/** Filters worth recording: every non-empty scalar or list, as label/value text. */
export function describeFilters(filters: Record<string, unknown> | null | undefined): Array<{ label: string; value: string }> {
  if (!filters) return [];
  const described: Array<{ label: string; value: string }> = [];
  for (const [label, raw] of Object.entries(filters)) {
    if (raw === null || raw === undefined || raw === '' || raw === false) continue;
    if (Array.isArray(raw)) {
      const values = raw.map(value => String(value).trim()).filter(Boolean);
      if (values.length > 0) described.push({ label, value: values.join(', ') });
      continue;
    }
    if (typeof raw === 'object') {
      const nested = JSON.stringify(raw);
      if (nested && nested !== '{}' && nested !== '[]') described.push({ label, value: nested });
      continue;
    }
    described.push({ label, value: String(raw) });
  }
  return described;
}

/**
 * Model metadata for an AI step: the route's response wins; the request we
 * sent is the fallback; otherwise "not reported". Never a hard-coded default,
 * because the deployed model is configured server-side.
 */
export function readAiStepMetadata(
  response: unknown,
  request?: unknown,
): Pick<EvidenceAiStep, 'model' | 'reasoningEffort' | 'metadataSource'> {
  const pick = (value: unknown) => {
    if (!value || typeof value !== 'object') return { model: null, reasoningEffort: null };
    const record = value as Record<string, unknown>;
    const model = typeof record.model === 'string' && record.model.trim() ? record.model.trim() : null;
    const effortRaw = record.reasoningEffort ?? record.effort;
    const reasoningEffort = typeof effortRaw === 'string' && effortRaw.trim() ? effortRaw.trim() : null;
    return { model, reasoningEffort };
  };
  const fromResponse = pick(response);
  if (fromResponse.model || fromResponse.reasoningEffort) return { ...fromResponse, metadataSource: 'response' };
  const fromRequest = pick(request);
  if (fromRequest.model || fromRequest.reasoningEffort) return { ...fromRequest, metadataSource: 'request' };
  return { model: null, reasoningEffort: null, metadataSource: 'not-reported' };
}

/** GET /api/version, reduced to the provenance fields. A failure is recorded, not thrown. */
export async function fetchAppVersion(fetchImpl: typeof fetch = fetch): Promise<EvidenceAppVersion> {
  try {
    const response = await fetchImpl('/api/version', { headers: { Accept: 'application/json' } });
    if (!response.ok) return { status: 'unavailable', reason: `/api/version answered HTTP ${response.status}` };
    const payload = await response.json() as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
    return {
      status: 'reported',
      sha: text(payload.sha),
      ref: text(payload.ref),
      deploymentId: text(payload.deploymentId),
      environment: text(payload.environment),
    };
  } catch (error) {
    return { status: 'unavailable', reason: error instanceof Error ? error.message : '/api/version could not be reached' };
  }
}

function dedupeSources(sources: EvidenceSource[]): EvidenceSource[] {
  const rank = { cited: 0, read: 1, listed: 2 } as const;
  const byAccession = new Map<string, EvidenceSource>();
  for (const source of sources) {
    const key = source.accessionNumber || source.secUrl;
    const existing = byAccession.get(key);
    // The strongest role wins: a cited filing that was also listed is cited.
    if (!existing || rank[source.role] < rank[existing.role]) byAccession.set(key, existing ? { ...existing, ...source, role: source.role } : source);
  }
  return Array.from(byAccession.values());
}

/* ------------------------------------------------------------------ */
/*  Memo                                                               */
/* ------------------------------------------------------------------ */

export interface MemoEvidenceInput {
  title: string;
  question?: string;
  citations: MemoCitation[];
  draft: MemoDraftRecord | null;
  generatedAt: Date;
  appVersion: EvidenceAppVersion;
  /** Response/request metadata of the draft call, when the caller has it. */
  aiMetadata?: { response?: unknown; request?: unknown };
}

export function buildMemoEvidencePackage(input: MemoEvidenceInput): EvidencePackage {
  const citedIds = new Set(input.draft?.citationIds || []);
  const sources: EvidenceSource[] = input.citations.flatMap(citation => {
    const primary: EvidenceSource = {
      cik: citation.cik,
      accessionNumber: normalizeAccession(citation.accessionNumber),
      company: citation.company,
      form: citation.form,
      fileDate: citation.fileDate,
      secUrl: citation.sourceUrl,
      role: 'cited',
    };
    if (!citation.comparedTo) return [primary];
    return [primary, {
      cik: citation.cik,
      accessionNumber: normalizeAccession(citation.comparedTo.accessionNumber),
      company: citation.company,
      form: citation.comparedTo.form,
      fileDate: citation.comparedTo.fileDate,
      secUrl: citation.comparedTo.sourceUrl,
      role: 'cited',
    }];
  });

  const sectionSlices: EvidenceSectionSlice[] = input.citations
    .filter(citation => citation.section?.trim())
    .map(citation => ({
      accessionNumber: normalizeAccession(citation.accessionNumber),
      section: citation.section!.trim(),
      characters: citation.excerpt.length,
      origin: 'memo-citation' as const,
    }));

  const aiStep: EvidenceAiStep | null = input.draft
    ? {
        purpose: `AI memo draft grounded in ${citedIds.size || input.citations.length} cited excerpt${(citedIds.size || input.citations.length) === 1 ? '' : 's'}`,
        ...readAiStepMetadata(input.aiMetadata?.response, input.aiMetadata?.request),
        generatedAt: input.draft.generatedAt,
      }
    : null;

  return {
    schema: EVIDENCE_PACKAGE_SCHEMA,
    subject: { kind: 'memo', title: input.title },
    query: {
      text: input.question?.trim() || null,
      mode: input.question?.trim() ? 'research question (entered at export)' : null,
      operators: [],
      note: input.question?.trim()
        ? undefined
        : 'the memo tray collects citations across searches and pages; it does not record the query that surfaced each one',
    },
    filters: [],
    coverage: coverageFromSearch(null, 'memo citations are hand-picked evidence, not the output of one search run'),
    sources: dedupeSources(sources),
    sectionSlices,
    aiStep,
    generatedAt: input.generatedAt.toISOString(),
    appVersion: input.appVersion,
  };
}

/* ------------------------------------------------------------------ */
/*  Copilot answer                                                     */
/* ------------------------------------------------------------------ */

const SEARCH_ACTIONS = new Set(['search_filings', 'search_comment_letters']);

export interface AnswerEvidenceInput {
  run: AgentRun;
  evidence: AgentEvidencePacket | null;
  generatedAt: Date;
  appVersion: EvidenceAppVersion;
  aiMetadata?: { response?: unknown; request?: unknown };
  /** Coverage of the search the run executed, when the caller captured it. */
  coverage?: SearchCandidateCoverage | null;
}

function asFilings(value: unknown): FilingResearchResult[] {
  return Array.isArray(value)
    ? value.filter((item): item is FilingResearchResult => Boolean(item && typeof item === 'object' && 'accessionNumber' in item))
    : [];
}

export function buildAnswerEvidencePackage(input: AnswerEvidenceInput): EvidencePackage {
  const { run, evidence } = input;
  const searchAction = run.plan?.actions.find(action => SEARCH_ACTIONS.has(action.type));
  const filterAction = run.plan?.actions.find(action => action.type === 'apply_filters');
  const queryText = typeof searchAction?.input.query === 'string' && searchAction.input.query.trim()
    ? searchAction.input.query.trim()
    : null;
  const mode = typeof searchAction?.input.mode === 'string' ? searchAction.input.mode : null;
  const filters = {
    ...((filterAction?.input.filters && typeof filterAction.input.filters === 'object') ? filterAction.input.filters as Record<string, unknown> : {}),
    ...((searchAction?.input.filters && typeof searchAction.input.filters === 'object') ? searchAction.input.filters as Record<string, unknown> : {}),
  };

  const filings = [
    ...asFilings(evidence?.data?.filings),
    ...asFilings(evidence?.data?.commentLetters),
  ];
  const sources: EvidenceSource[] = filings.map(filing => ({
    cik: filing.cik,
    accessionNumber: normalizeAccession(filing.accessionNumber),
    company: filing.entityName,
    form: filing.formType,
    fileDate: filing.fileDate,
    secUrl: filing.filingUrl,
    // A text-validated match had its document read; a metadata hit was only listed.
    role: filing.matchReason && !/metadata/i.test(filing.matchReason) ? 'read' : 'listed',
  }));

  for (const citation of evidence?.citations || []) {
    if (citation.kind !== 'filing' && citation.kind !== 'section') continue;
    const parsed = parseSecArchiveUrl(citation.externalUrl);
    if (!parsed) continue;
    sources.push({
      cik: parsed.cik,
      accessionNumber: parsed.accessionNumber,
      company: citation.title,
      form: '',
      fileDate: '',
      secUrl: citation.externalUrl || '',
      role: 'read',
    });
  }

  const sectionSlices: EvidenceSectionSlice[] = (evidence?.citations || [])
    .filter(citation => citation.kind === 'section' && citation.excerpt)
    .map(citation => ({
      accessionNumber: parseSecArchiveUrl(citation.externalUrl)?.accessionNumber || '',
      section: citation.sectionLabel || citation.title,
      characters: (citation.excerpt || '').length,
      origin: 'copilot-evidence' as const,
    }));

  const aiStep: EvidenceAiStep | null = run.answer
    ? {
        purpose: `Copilot answer generated from the run's evidence packet (${evidence?.citations.length || 0} citation${(evidence?.citations.length || 0) === 1 ? '' : 's'})`,
        ...readAiStepMetadata(input.aiMetadata?.response, input.aiMetadata?.request),
        generatedAt: run.completedAt || null,
      }
    : null;

  const coverage = input.coverage
    ? coverageFromSearch(input.coverage)
    : coverageFromSearch(null, queryText
      ? `the copilot run did not capture candidate coverage; it returned ${filings.length} filing${filings.length === 1 ? '' : 's'}`
      : 'the copilot run did not execute a filing search');

  return {
    schema: EVIDENCE_PACKAGE_SCHEMA,
    subject: { kind: 'ai-answer', title: run.prompt },
    query: {
      text: queryText,
      mode,
      operators: queryText ? queryOperators(queryText, mode) : [],
      note: queryText ? undefined : 'the copilot plan contained no search action',
    },
    filters: describeFilters(filters),
    coverage,
    sources: dedupeSources(sources),
    sectionSlices,
    aiStep,
    generatedAt: input.generatedAt.toISOString(),
    appVersion: input.appVersion,
  };
}

/* ------------------------------------------------------------------ */
/*  Serialization                                                      */
/* ------------------------------------------------------------------ */

export function evidencePackageJson(pkg: EvidencePackage): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function evidencePackageBlob(pkg: EvidencePackage): Blob {
  return new Blob([evidencePackageJson(pkg)], { type: 'application/json' });
}
