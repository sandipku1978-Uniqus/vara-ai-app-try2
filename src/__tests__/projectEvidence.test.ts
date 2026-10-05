/**
 * The project evidence package: P6's memo package over the project's memo
 * items plus one record per saved search, alert and research tab, labelled
 * with the generation time and app version — and refused, not partial, when
 * any part could not be read.
 */
import { Packer, type Document } from 'docx';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVIDENCE_PACKAGE_SCHEMA, type EvidenceAppVersion } from '../services/evidencePackage';
import { buildStorageScope, setActiveBrowserStorageScope } from '../services/storageNamespace';
import { resetUserDataForTests, startUserDataSync } from '../services/userData';
import {
  PROJECT_EVIDENCE_SCHEMA,
  buildProjectEvidenceDocument,
  buildProjectEvidencePackage,
  collectProjectEvidence,
  projectEvidenceFileStem,
  projectEvidenceJson,
} from '../components/projects/projectEvidence';
import type { Listed } from '../components/projects/projectData';

const VERSION: EvidenceAppVersion = { status: 'reported', sha: 'abc1234', ref: 'main', deploymentId: 'dpl_1', environment: 'production' };
const NOW = new Date('2026-10-04T12:00:00.000Z');
const PERSONAL_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

const PROJECT: Listed<'projects'> = {
  id: PROJECT_ID, clientKey: 'project-a', name: 'ASU 2023-07 segments', question: 'How do peers disclose significant segment expenses?',
  position: 1, archivedAt: null, createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-09-02T09:00:00.000Z',
};
const PERSONAL: Listed<'projects'> = { id: PERSONAL_ID, clientKey: 'personal', name: 'Personal research', question: '', position: 0 };

const CITATION_PAYLOAD = {
  id: '320193:0000320193-26-000001', kind: 'filing', cik: '320193', accessionNumber: '0000320193-26-000001',
  company: 'Apple Inc.', form: '10-K', fileDate: '2026-01-30', excerpt: 'Segment expenses are presented by…',
  sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl.htm', note: 'Good example', addedAt: '2026-09-03T10:00:00.000Z',
  section: 'Note 13',
};

const MEMO: Array<Listed<'memo'>> = [
  { clientKey: CITATION_PAYLOAD.id, projectId: PROJECT_ID, itemKind: 'citation', accession: '0000320193-26-000001', cik: '320193', payload: CITATION_PAYLOAD },
  { clientKey: 'draft', projectId: PROJECT_ID, itemKind: 'draft', accession: null, cik: null, payload: { text: '# Segments\n\nPeers present [1].', generatedAt: '2026-09-04T10:00:00.000Z', citationIds: [CITATION_PAYLOAD.id] } },
];

const SAVED: Array<Listed<'saved-searches'>> = [
  { id: '44444444-4444-4444-8444-444444444444', clientKey: 'ss-1', projectId: PROJECT_ID, label: 'Segment expense', query: '"significant segment expenses" AND CODM', mode: 'boolean', filters: { formTypes: ['10-K'], dateFrom: '2025-01-01' }, createdAt: '2026-09-05T10:00:00.000Z' },
];

const ALERTS: Array<Listed<'alerts'>> = [{
  clientKey: 'alert-1', projectId: PROJECT_ID, name: 'New segment disclosures', query: 'segment w/5 expenses', mode: 'boolean', filters: {},
  defaultForms: '10-K', cadence: 'weekly', enabled: true, lastCheckedAt: '2026-10-01T08:00:00.000Z', lastHitCount: 12,
  lastSeenAccessions: [], latestNewAccessions: ['0000001-26-000002'], engineVersion: 3,
  lastCheckCoverage: { examined: 40, upstreamTotal: 120, complete: false },
}];

const TABS: Array<Listed<'research-tabs'>> = [{
  clientKey: 'research-1', projectId: PROJECT_ID, title: 'CODM tab',
  payload: {
    id: 'research-1', title: 'CODM tab', query: 'CODM', mode: 'semantic', searched: true, updatedAt: '2026-09-06T10:00:00.000Z',
    resolvedSearch: { query: 'chief operating decision maker', mode: 'semantic', filters: { formTypes: ['10-K'] } },
    coverage: { examined: 50, upstreamTotal: 50, complete: true },
    results: [
      { cik: '320193', accessionNumber: '000032019326000001', entityName: 'Apple Inc.', formType: '10-K', fileDate: '2026-01-30', filingUrl: 'https://www.sec.gov/a', matchReason: 'Matched filing text' },
      { cik: '789019', accessionNumber: '0000789019-26-000003', entityName: 'Microsoft', formType: '10-K', fileDate: '2026-02-01', filingUrl: 'https://www.sec.gov/b', matchReason: 'Metadata match' },
    ],
  },
}];

async function documentText(document: Document): Promise<string> {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
  const xml = await zip.file('word/document.xml')!.async('string');
  return Array.from(xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)).map(match => match[1]).join('');
}

describe('project evidence package assembly', () => {
  const pkg = buildProjectEvidencePackage({
    project: PROJECT, memoItems: MEMO, savedSearches: SAVED, alerts: ALERTS, researchTabs: TABS,
    generatedAt: NOW, appVersion: VERSION, owner: 'Alice Analyst',
  });

  it('labels the package with its timestamp, app version, project and owner', () => {
    expect(pkg.schema).toBe(PROJECT_EVIDENCE_SCHEMA);
    expect(pkg.generatedAt).toBe(NOW.toISOString());
    expect(pkg.appVersion).toEqual(VERSION);
    expect(pkg.owner).toBe('Alice Analyst');
    expect(pkg.project).toEqual({ id: PROJECT_ID, name: PROJECT.name, question: PROJECT.question, createdAt: PROJECT.createdAt });
    expect(pkg.contents).toEqual({ memoItems: 2, savedSearches: 1, alerts: 1, researchTabs: 1 });
  });

  it('carries P6’s memo package over the project’s citations and draft', () => {
    expect(pkg.memo?.schema).toBe(EVIDENCE_PACKAGE_SCHEMA);
    expect(pkg.memo?.subject).toEqual({ kind: 'memo', title: PROJECT.name });
    expect(pkg.memo?.query.text).toBe(PROJECT.question);
    expect(pkg.memo?.sources).toEqual([expect.objectContaining({ accessionNumber: '0000320193-26-000001', role: 'cited' })]);
    expect(pkg.memo?.sectionSlices).toEqual([expect.objectContaining({ section: 'Note 13', origin: 'memo-citation' })]);
    expect(pkg.memo?.aiStep?.generatedAt).toBe('2026-09-04T10:00:00.000Z');
  });

  it('records each search from what was saved, never inferring coverage', () => {
    const [saved, alert, tab] = pkg.searches;
    expect(saved.subject).toEqual({ kind: 'saved-search', title: 'Segment expense', clientKey: 'ss-1' });
    expect(saved.query.operators).toEqual(expect.arrayContaining(['"phrase"', 'AND']));
    expect(saved.filters).toEqual(expect.arrayContaining([{ label: 'formTypes', value: '10-K' }, { label: 'dateFrom', value: '2025-01-01' }]));
    expect(saved.coverage.status).toBe('not-recorded');

    expect(alert.subject.kind).toBe('alert');
    expect(alert.coverage).toEqual(expect.objectContaining({ status: 'partial', examined: 40, upstreamTotal: 120 }));
    expect(alert.record).toEqual(expect.objectContaining({ lastHitCount: 12, latestNewAccessions: ['0000001-26-000002'] }));
    expect(alert.sources).toEqual([]);

    expect(tab.subject.kind).toBe('research-tab');
    expect(tab.query.text).toBe('chief operating decision maker');
    expect(tab.coverage.status).toBe('complete');
    expect(tab.sources).toEqual([
      expect.objectContaining({ accessionNumber: '0000320193-26-000001', company: 'Apple Inc.', role: 'read' }),
      expect.objectContaining({ accessionNumber: '0000789019-26-000003', role: 'listed' }),
    ]);
    expect(tab.record.resultRows).toBe(2);
  });

  it('has no memo package when the project has no memo items', () => {
    const empty = buildProjectEvidencePackage({
      project: PROJECT, memoItems: [], savedSearches: [], alerts: [], researchTabs: [], generatedAt: NOW, appVersion: VERSION, owner: null,
    });
    expect(empty.memo).toBeNull();
    expect(empty.searches).toEqual([]);
  });

  it('serializes to JSON and a Word appendix with the same labels', async () => {
    expect(JSON.parse(projectEvidenceJson(pkg)).project.name).toBe(PROJECT.name);
    expect(projectEvidenceFileStem(pkg)).toBe('URC_project_ASU_2023-07_segments_evidence_2026-10-04T12-00-00');
    const text = await documentText(buildProjectEvidenceDocument(pkg));
    expect(text).toContain('Evidence package — ASU 2023-07 segments');
    expect(text).toContain('2026-10-04T12:00:00.000Z');
    expect(text).toContain('commit abc1234');
    expect(text).toContain('Alert — New segment disclosures');
    expect(text).toContain('Research tab — CODM tab');
    expect(text).toContain('Appendix — Evidence package');
    expect(text).toContain('Not recorded — a saved search records the request, not a run');
  });
});

describe('collecting a project evidence package from the account', () => {
  const scope = buildStorageScope('user_alice', null);

  function server(failKind?: string) {
    const rows: Record<string, unknown[]> = {
      projects: [PERSONAL, PROJECT],
      memo: [...MEMO, { ...MEMO[0], clientKey: 'elsewhere', projectId: OTHER_ID }],
      'saved-searches': SAVED,
      alerts: ALERTS,
      'research-tabs': TABS,
    };
    return vi.fn(async (input: string) => {
      if (input === '/api/version') return Response.json({ sha: 'def5678', ref: 'main', deploymentId: null, environment: 'preview' });
      const kind = input.replace('/api/user/', '');
      if (kind === failKind) return Response.json({ ok: false, errorClass: 'unavailable', error: 'off' }, { status: 503 });
      return Response.json({ ok: true, items: rows[kind] || [] });
    });
  }

  beforeEach(() => {
    resetUserDataForTests();
    setActiveBrowserStorageScope(scope);
  });
  afterEach(() => {
    resetUserDataForTests();
    setActiveBrowserStorageScope(null);
  });

  it('reads every part, keeps only this project’s objects and records the reported version', async () => {
    const fetch = server();
    startUserDataSync(scope, { fetch: fetch as never });
    const outcome = await collectProjectEvidence(PROJECT, [PERSONAL, PROJECT], { owner: null, now: NOW, fetchImpl: fetch as never });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.pkg.contents.memoItems).toBe(2);
    expect(outcome.pkg.appVersion).toEqual({ status: 'reported', sha: 'def5678', ref: 'main', deploymentId: null, environment: 'preview' });
  });

  it('refuses to build a partial package when a part cannot be read', async () => {
    const fetch = server('alerts');
    startUserDataSync(scope, { fetch: fetch as never });
    const outcome = await collectProjectEvidence(PROJECT, [PERSONAL, PROJECT], { owner: null, now: NOW, fetchImpl: fetch as never });
    expect(outcome).toEqual({ ok: false, error: expect.stringContaining('the alerts could not be read') });
    expect(outcome.ok ? '' : outcome.error).toContain('HTTP 503');
  });
});
