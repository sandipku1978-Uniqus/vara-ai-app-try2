/**
 * The evidence package for a whole project: one record of how every memo
 * item and every search filed under the project was produced, as one JSON
 * file and one Word appendix, labelled with the generation timestamp and
 * the app version /api/version reported.
 *
 * The memo part is exactly P6's memo evidence package (buildMemoEvidencePackage)
 * over the project's memo items. Each search gets a record of the same shape
 * built with P6's readers (queryOperators, describeFilters, coverageFromSearch);
 * its subject kind names what was saved (saved search, alert, research tab).
 * Nothing is inferred: a saved search that never ran records no coverage, an
 * alert records what its last check observed, and a research tab records the
 * coverage and result rows it was saved with.
 *
 * Assembly is pure; collectProjectEvidence does the reads and refuses to
 * build a package when any part could not be read, so a package is never
 * silently missing a kind.
 */

import { HeadingLevel, Paragraph, TextRun } from 'docx';
import {
  EVIDENCE_PACKAGE_SCHEMA,
  buildMemoEvidencePackage,
  coverageFromSearch,
  describeFilters,
  fetchAppVersion,
  normalizeAccession,
  queryOperators,
  type EvidenceAppVersion,
  type EvidenceCoverage,
  type EvidencePackage,
  type EvidenceSource,
} from '../../services/evidencePackage';
import {
  buildDocument,
  downloadBlob,
  evidenceAppendixBlocks,
  labelledLine,
  packDocx,
  pageBreak,
  safeFileStem,
  simpleTable,
  type DocxBlock,
} from '../../services/docxShared';
import { itemsToDraft } from '../../services/userDataCodecs';
import type { SearchCandidateCoverage } from '../../services/secApi';
import type { UserMemoItem, UserProjectItem } from '../../services/userData';
import type { UserDataKind } from '../../lib/user-data-kinds';
import {
  describeLoadFailure,
  loadKind,
  personalProjectId,
  projectCitations,
  projectItems,
  type KindLoad,
  type Listed,
} from './projectData';

export const PROJECT_EVIDENCE_SCHEMA = 'urc.project-evidence-package.v1';

export type ProjectSearchKind = 'saved-search' | 'alert' | 'research-tab';

/** P6's evidence-package fields for one search; the subject names the saved object. */
export interface ProjectSearchEvidence extends Omit<EvidencePackage, 'subject'> {
  subject: { kind: ProjectSearchKind; title: string; clientKey: string };
  /** What the saved object itself recorded, verbatim. */
  record: {
    savedAt: string | null;
    lastCheckedAt?: string | null;
    lastHitCount?: number;
    latestNewAccessions?: string[];
    resultRows?: number;
    note?: string;
  };
}

export interface ProjectEvidencePackage {
  schema: typeof PROJECT_EVIDENCE_SCHEMA;
  generatedAt: string;
  appVersion: EvidenceAppVersion;
  /** Signed-in display name, or null when the session had none. */
  owner: string | null;
  project: { id: string; name: string; question: string; createdAt: string | null };
  contents: { memoItems: number; savedSearches: number; alerts: number; researchTabs: number };
  /** P6's memo evidence package over the project's memo items; null when the project has none. */
  memo: EvidencePackage | null;
  searches: ProjectSearchEvidence[];
}

export interface ProjectEvidenceInput {
  project: Listed<'projects'>;
  memoItems: Array<Listed<'memo'>>;
  savedSearches: Array<Listed<'saved-searches'>>;
  alerts: Array<Listed<'alerts'>>;
  researchTabs: Array<Listed<'research-tabs'>>;
  generatedAt: Date;
  appVersion: EvidenceAppVersion;
  owner: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** A stored coverage object in the executor's shape, or null when it is not one. */
export function readStoredCoverage(value: unknown): SearchCandidateCoverage | null {
  if (!isRecord(value)) return null;
  const count = (entry: unknown) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0;
  if (!count(value.examined) || !count(value.upstreamTotal) || typeof value.complete !== 'boolean') return null;
  return value as unknown as SearchCandidateCoverage;
}

function searchBase(
  query: string,
  mode: string,
  filters: unknown,
  coverage: EvidenceCoverage,
  generatedAt: Date,
  appVersion: EvidenceAppVersion,
): Omit<ProjectSearchEvidence, 'subject' | 'record'> {
  return {
    schema: EVIDENCE_PACKAGE_SCHEMA,
    query: {
      text: query.trim() || null,
      mode,
      operators: queryOperators(query, mode),
      note: query.trim() ? undefined : 'filters-only search (no query text)',
    },
    filters: describeFilters(isRecord(filters) ? filters : null),
    coverage,
    sources: [],
    sectionSlices: [],
    aiStep: null,
    generatedAt: generatedAt.toISOString(),
    appVersion,
  };
}

export function savedSearchEvidence(item: Listed<'saved-searches'>, generatedAt: Date, appVersion: EvidenceAppVersion): ProjectSearchEvidence {
  return {
    ...searchBase(item.query, item.mode, item.filters, coverageFromSearch(null, 'a saved search records the request, not a run; re-run it to observe coverage'), generatedAt, appVersion),
    subject: { kind: 'saved-search', title: item.label || item.query || 'Saved search', clientKey: item.clientKey },
    record: { savedAt: item.updatedAt || item.createdAt || null },
  };
}

export function alertEvidence(item: Listed<'alerts'>, generatedAt: Date, appVersion: EvidenceAppVersion): ProjectSearchEvidence {
  const stored = readStoredCoverage(item.lastCheckCoverage);
  const coverage = item.lastCheckedAt
    ? coverageFromSearch(stored, 'the last check did not record candidate coverage')
    : coverageFromSearch(null, 'the alert has not been checked yet');
  return {
    ...searchBase(item.query, item.mode, item.filters, coverage, generatedAt, appVersion),
    subject: { kind: 'alert', title: item.name || item.query || 'Alert', clientKey: item.clientKey },
    record: {
      savedAt: item.updatedAt || item.createdAt || null,
      lastCheckedAt: item.lastCheckedAt,
      lastHitCount: item.lastHitCount,
      latestNewAccessions: [...(item.latestNewAccessions || [])],
      note: 'the alert stores accession numbers only; open its search to see the filings',
    },
  };
}

function tabSources(results: unknown): EvidenceSource[] {
  if (!Array.isArray(results)) return [];
  const seen = new Set<string>();
  const sources: EvidenceSource[] = [];
  for (const row of results) {
    if (!isRecord(row) || typeof row.accessionNumber !== 'string' || !row.accessionNumber) continue;
    const accessionNumber = normalizeAccession(row.accessionNumber);
    if (seen.has(accessionNumber)) continue;
    seen.add(accessionNumber);
    const matchReason = typeof row.matchReason === 'string' ? row.matchReason : '';
    sources.push({
      cik: typeof row.cik === 'string' ? row.cik : '',
      accessionNumber,
      company: typeof row.entityName === 'string' ? row.entityName : '',
      form: typeof row.formType === 'string' ? row.formType : '',
      fileDate: typeof row.fileDate === 'string' ? row.fileDate : '',
      secUrl: typeof row.filingUrl === 'string' ? row.filingUrl : '',
      // Same rule as the copilot package: a text-validated match had its
      // document read; a metadata hit was only listed.
      role: matchReason && !/metadata/i.test(matchReason) ? 'read' : 'listed',
    });
  }
  return sources;
}

export function researchTabEvidence(item: Listed<'research-tabs'>, generatedAt: Date, appVersion: EvidenceAppVersion): ProjectSearchEvidence {
  const payload = isRecord(item.payload) ? item.payload : {};
  const resolved = isRecord(payload.resolvedSearch) ? payload.resolvedSearch : null;
  const query = typeof resolved?.query === 'string' ? resolved.query : typeof payload.query === 'string' ? payload.query : '';
  const modeSource = resolved?.mode ?? payload.mode;
  const mode = modeSource === 'boolean' ? 'boolean' : 'semantic';
  const filters = resolved?.filters ?? payload.filters;
  const results = Array.isArray(payload.results) ? payload.results : [];
  const searched = payload.searched === true;
  const coverage = searched
    ? coverageFromSearch(readStoredCoverage(payload.coverage), 'the tab was saved without a candidate-coverage record')
    : coverageFromSearch(null, 'the tab had not run its search when it was saved');
  const truncated = typeof payload.errorMsg === 'string' && /too large to save/i.test(payload.errorMsg);
  return {
    ...searchBase(query, mode, filters, coverage, generatedAt, appVersion),
    sources: tabSources(results),
    subject: { kind: 'research-tab', title: item.title || query || 'Research tab', clientKey: item.clientKey },
    record: {
      savedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : item.updatedAt || null,
      resultRows: results.length,
      note: truncated
        ? 'the tab’s result rows were too large to save with the account, so no filings are listed for it'
        : undefined,
    },
  };
}

export function buildProjectEvidencePackage(input: ProjectEvidenceInput): ProjectEvidencePackage {
  const { project, generatedAt, appVersion } = input;
  const citations = projectCitations(input.memoItems);
  const draft = itemsToDraft(input.memoItems as UserMemoItem[]);
  const memo = citations.length > 0 || draft
    ? buildMemoEvidencePackage({
      title: project.name,
      question: project.question,
      citations,
      draft,
      generatedAt,
      appVersion,
    })
    : null;
  const searches = [
    ...input.savedSearches.map(item => savedSearchEvidence(item, generatedAt, appVersion)),
    ...input.alerts.map(item => alertEvidence(item, generatedAt, appVersion)),
    ...input.researchTabs.map(item => researchTabEvidence(item, generatedAt, appVersion)),
  ];
  return {
    schema: PROJECT_EVIDENCE_SCHEMA,
    generatedAt: generatedAt.toISOString(),
    appVersion,
    owner: input.owner,
    project: {
      id: project.id || '',
      name: project.name,
      question: project.question || '',
      createdAt: project.createdAt || null,
    },
    contents: {
      memoItems: input.memoItems.length,
      savedSearches: input.savedSearches.length,
      alerts: input.alerts.length,
      researchTabs: input.researchTabs.length,
    },
    memo,
    searches,
  };
}

// ── Collection ───────────────────────────────────────────────────────────────

export type CollectOutcome = { ok: true; pkg: ProjectEvidencePackage } | { ok: false; error: string };

/** Read every part from the account, then assemble. Any failed read refuses the package. */
export async function collectProjectEvidence(
  project: Listed<'projects'>,
  projects: UserProjectItem[],
  options: { owner: string | null; now?: Date; fetchImpl?: typeof fetch },
): Promise<CollectOutcome> {
  if (!project.id) return { ok: false, error: 'This project has not reached your account yet.' };
  const [memo, savedSearches, alerts, researchTabs] = await Promise.all([
    loadKind('memo'), loadKind('saved-searches'), loadKind('alerts'), loadKind('research-tabs'),
  ]);
  const parts = [['memo items', memo], ['saved searches', savedSearches], ['alerts', alerts], ['research tabs', researchTabs]] as const;
  for (const [label, load] of parts) {
    if (load.status === 'failed') {
      return { ok: false, error: `The evidence package was not built because the ${label} could not be read. ${describeLoadFailure(load)}` };
    }
  }
  const personalId = personalProjectId(projects);
  const projectId = project.id;
  const mine = <K extends UserDataKind>(load: KindLoad<K>): Listed<K>[] => (
    load.status === 'ready'
      ? projectItems(load.items as Array<Listed<K> & { projectId?: string | null }>, projectId, personalId)
      : []
  );
  const appVersion = await fetchAppVersion(options.fetchImpl);
  return {
    ok: true,
    pkg: buildProjectEvidencePackage({
      project,
      memoItems: mine(memo),
      savedSearches: mine(savedSearches),
      alerts: mine(alerts),
      researchTabs: mine(researchTabs),
      generatedAt: options.now ?? new Date(),
      appVersion,
      owner: options.owner,
    }),
  };
}

// ── Serialization ────────────────────────────────────────────────────────────

export function projectEvidenceJson(pkg: ProjectEvidencePackage): string {
  return `${JSON.stringify(pkg, null, 2)}\n`;
}

export function describeAppVersion(version: EvidenceAppVersion): string {
  if (version.status === 'unavailable') return `Unavailable — ${version.reason}`;
  return [
    version.sha ? `commit ${version.sha}` : 'commit not reported',
    version.ref ? `ref ${version.ref}` : '',
    version.deploymentId ? `deployment ${version.deploymentId}` : '',
    version.environment ? `environment ${version.environment}` : '',
  ].filter(Boolean).join(', ');
}

function describeCoverage(coverage: EvidenceCoverage): string {
  if (coverage.status === 'not-recorded') return `Not recorded — ${coverage.note}`;
  const upstream = coverage.upstreamTotal === null
    ? 'an unreported number of'
    : `${coverage.upstreamTotalIsFloor ? 'at least ' : ''}${coverage.upstreamTotal.toLocaleString()}`;
  return `${coverage.status === 'complete' ? 'Complete' : 'Partial'}: examined ${coverage.examined?.toLocaleString() ?? 'an unreported number'} of ${upstream} upstream candidates — ${coverage.note}.`;
}

const SEARCH_KIND_LABEL: Record<ProjectSearchKind, string> = {
  'saved-search': 'Saved search',
  alert: 'Alert',
  'research-tab': 'Research tab',
};

function searchBlocks(search: ProjectSearchEvidence): DocxBlock[] {
  const blocks: DocxBlock[] = [
    new Paragraph({ text: `${SEARCH_KIND_LABEL[search.subject.kind]} — ${search.subject.title}`, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } }),
    labelledLine('Query', search.query.text ? `${search.query.text} (${search.query.mode})` : `None — ${search.query.note || 'no query text'}`),
    labelledLine('Operators', search.query.operators.length > 0 ? search.query.operators.join(', ') : 'None'),
    labelledLine('Filters', search.filters.length > 0 ? search.filters.map(filter => `${filter.label}: ${filter.value}`).join('; ') : 'None recorded'),
    labelledLine('Coverage', describeCoverage(search.coverage)),
    labelledLine('Saved', search.record.savedAt || 'not recorded'),
  ];
  if (search.subject.kind === 'alert') {
    blocks.push(labelledLine('Last check', search.record.lastCheckedAt
      ? `${search.record.lastCheckedAt}: ${search.record.lastHitCount ?? 0} results, ${search.record.latestNewAccessions?.length ?? 0} new since the check before`
      : 'Not checked yet'));
  }
  if (search.subject.kind === 'research-tab') {
    blocks.push(labelledLine('Result rows saved', String(search.record.resultRows ?? 0)));
  }
  if (search.record.note) blocks.push(labelledLine('Note', search.record.note));
  if (search.sources.length > 0) {
    blocks.push(simpleTable(
      ['Company', 'Form', 'Filed', 'Accession', 'Role', 'SEC URL'],
      search.sources.map(source => [
        source.company || '—',
        source.form || '—',
        source.fileDate || '—',
        source.accessionNumber || '—',
        source.role,
        source.secUrl ? { text: source.secUrl, url: source.secUrl } : '—',
      ]),
    ));
  }
  return blocks;
}

/** The Word appendix: project header, every search record, then P6's memo appendix. */
export function buildProjectEvidenceDocument(pkg: ProjectEvidencePackage) {
  const title = `Evidence package — ${pkg.project.name}`;
  const children: DocxBlock[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
    new Paragraph({
      children: [new TextRun({ text: 'How the research filed under this project was produced. Every value was recorded by the app; values it could not observe are marked as not recorded rather than inferred. The same record is delivered as JSON beside this document.', italics: true })],
      spacing: { after: 160 },
    }),
    labelledLine('Project', pkg.project.name),
    labelledLine('Question', pkg.project.question.trim() || 'Not recorded'),
    labelledLine('Project created', pkg.project.createdAt || 'not recorded'),
    labelledLine('Generated', pkg.generatedAt),
    labelledLine('App version', describeAppVersion(pkg.appVersion)),
    labelledLine('Owner', pkg.owner || 'Not recorded (no signed-in display name)'),
    labelledLine('Contents', `${pkg.contents.memoItems} memo item${pkg.contents.memoItems === 1 ? '' : 's'}, ${pkg.contents.savedSearches} saved search${pkg.contents.savedSearches === 1 ? '' : 'es'}, ${pkg.contents.alerts} alert${pkg.contents.alerts === 1 ? '' : 's'}, ${pkg.contents.researchTabs} research tab${pkg.contents.researchTabs === 1 ? '' : 's'}`),
    labelledLine('Schema', `${pkg.schema} (memo and search records: ${EVIDENCE_PACKAGE_SCHEMA})`),
  ];
  children.push(pageBreak());
  children.push(new Paragraph({ text: 'Searches', heading: HeadingLevel.HEADING_1, spacing: { after: 160 } }));
  if (pkg.searches.length === 0) children.push(new Paragraph({ text: 'No saved searches, alerts or research tabs are filed under this project.' }));
  for (const search of pkg.searches) children.push(...searchBlocks(search));
  if (pkg.memo) {
    children.push(...evidenceAppendixBlocks(pkg.memo));
  } else {
    children.push(new Paragraph({ text: 'Memo', heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 120 } }));
    children.push(new Paragraph({ text: 'No memo items are filed under this project.' }));
  }
  return buildDocument(children, title);
}

export function projectEvidenceFileStem(pkg: ProjectEvidencePackage): string {
  return `URC_project_${safeFileStem(pkg.project.name, 'project')}_evidence_${pkg.generatedAt.replace(/[:.]/g, '-').slice(0, 19)}`;
}

/** Client-only: download the JSON record and the Word appendix. */
export async function downloadProjectEvidence(pkg: ProjectEvidencePackage): Promise<void> {
  const stem = projectEvidenceFileStem(pkg);
  downloadBlob(new Blob([projectEvidenceJson(pkg)], { type: 'application/json' }), `${stem}.json`);
  downloadBlob(await packDocx(buildProjectEvidenceDocument(pkg)), `${stem}.docx`);
}
