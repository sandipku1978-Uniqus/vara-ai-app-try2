import { describe, expect, it, vi } from 'vitest';

import {
  EVIDENCE_PACKAGE_SCHEMA,
  buildAnswerEvidencePackage,
  buildMemoEvidencePackage,
  coverageFromSearch,
  describeFilters,
  evidencePackageJson,
  fetchAppVersion,
  normalizeAccession,
  parseSecArchiveUrl,
  queryOperators,
  readAiStepMetadata,
  type EvidenceAppVersion,
} from '../services/evidencePackage';
import type { MemoCitation } from '../services/memoTray';
import type { AgentEvidencePacket, AgentRun } from '../types/agent';
import type { FilingResearchResult } from '../services/filingResearch';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const VERSION: EvidenceAppVersion = { status: 'reported', sha: 'abc1234', ref: 'main', deploymentId: null, environment: 'preview' };

describe('evidence package readers', () => {
  it('reads operators from the Boolean parser, and none from natural language', () => {
    expect(queryOperators('"material weakness" AND (revenue OR leases) NOT restatement', 'boolean').sort())
      .toEqual(['"phrase"', 'AND', 'NOT', 'OR'].sort());
    expect(queryOperators('lease w/5 modification', 'boolean')).toContain('W/5');
    expect(queryOperators('impairm*', 'boolean')).toContain('wildcard');
    expect(queryOperators('which companies restated revenue', 'semantic')).toEqual([]);
    expect(queryOperators('"unbalanced', 'boolean')[0]).toMatch(/^unparsed: /);
  });

  it('reports coverage as the search did, and absent coverage as not recorded', () => {
    expect(coverageFromSearch({ examined: 40, upstreamTotal: 10000, upstreamTotalIsFloor: true, complete: false }))
      .toMatchObject({ status: 'partial', examined: 40, upstreamTotal: 10000, upstreamTotalIsFloor: true });
    expect(coverageFromSearch({ examined: 12, upstreamTotal: 12, complete: true, verifiedMatchTotal: 9 }))
      .toMatchObject({ status: 'complete', verifiedMatchTotal: 9 });
    expect(coverageFromSearch(null)).toMatchObject({ status: 'not-recorded', examined: null, upstreamTotal: null });
  });

  it('records only filters that were set', () => {
    expect(describeFilters({ formTypes: ['10-K', '10-Q'], dateFrom: '2025-01-01', dateTo: '', accountant: null, exhibits: false }))
      .toEqual([{ label: 'formTypes', value: '10-K, 10-Q' }, { label: 'dateFrom', value: '2025-01-01' }]);
  });

  it('prefers model metadata from the response, then the request, else says not reported', () => {
    expect(readAiStepMetadata({ model: 'claude-x', reasoningEffort: 'high' }, { model: 'claude-y' }))
      .toEqual({ model: 'claude-x', provider: null, reasoningEffort: 'high', metadataSource: 'response', webSources: [] });
    expect(readAiStepMetadata({ text: 'hi' }, { model: 'claude-y', effort: 'medium', provider: 'anthropic' }))
      .toEqual({ model: 'claude-y', provider: null, reasoningEffort: 'medium', metadataSource: 'request', webSources: [] });
    expect(readAiStepMetadata(undefined, undefined))
      .toEqual({ model: null, provider: null, reasoningEffort: null, metadataSource: 'not-reported', webSources: [] });
  });

  it('reads the provider and web sources from the AI route\'s answer metadata', () => {
    const meta = {
      requestedModel: 'google/gemini-3.5-pro', requestedEffort: 'high', model: 'google/gemini-3.5-pro', provider: 'google',
      reasoningEffort: 'high', usage: { input: 10, output: 5 },
      webSources: [{ url: 'https://www.fasb.org/page', title: 'FASB' }, { url: 'javascript:alert(1)', title: 'x' }, 'not-an-object'],
    };
    expect(readAiStepMetadata(meta)).toEqual({
      model: 'google/gemini-3.5-pro', provider: 'google', reasoningEffort: 'high', metadataSource: 'response',
      webSources: [{ url: 'https://www.fasb.org/page', title: 'FASB' }],
    });
  });

  it('reads the app version from /api/version and records a failure instead of throwing', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ ok: true, sha: 'deadbeef', ref: 'main', deploymentId: 'dpl', environment: 'production', secret: 'x' })));
    expect(await fetchAppVersion(ok as unknown as typeof fetch))
      .toEqual({ status: 'reported', sha: 'deadbeef', ref: 'main', deploymentId: 'dpl', environment: 'production' });
    expect(ok).toHaveBeenCalledWith('/api/version', expect.anything());

    const down = vi.fn(async () => new Response('', { status: 503 }));
    expect(await fetchAppVersion(down as unknown as typeof fetch)).toEqual({ status: 'unavailable', reason: '/api/version answered HTTP 503' });
    const offline = vi.fn(async () => { throw new Error('offline'); });
    expect(await fetchAppVersion(offline as unknown as typeof fetch)).toEqual({ status: 'unavailable', reason: 'offline' });
  });

  it('parses SEC archive URLs and normalizes accessions', () => {
    expect(parseSecArchiveUrl('https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a.htm'))
      .toEqual({ cik: '320193', accessionNumber: '0000320193-26-000001' });
    expect(parseSecArchiveUrl('/filing/abc')).toBeNull();
    expect(normalizeAccession('000032019326000001')).toBe('0000320193-26-000001');
    expect(normalizeAccession('0000320193-26-000001')).toBe('0000320193-26-000001');
  });
});

const CITATIONS: MemoCitation[] = [
  {
    id: 'a', kind: 'filing', cik: '320193', accessionNumber: '000032019326000001', company: 'Apple Inc.', form: '10-K',
    fileDate: '2026-01-30', excerpt: 'Prior and current text.', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a.htm',
    note: '', addedAt: '2026-10-01T00:00:00.000Z', section: 'Risk Factors — redline',
    comparedTo: { accessionNumber: '0000320193-25-000001', form: '10-K', fileDate: '2025-01-30', sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019325000001/a.htm' },
  },
];

describe('memo evidence package', () => {
  it('records cited filings (both sides of a redline), section slices, and no AI step without a draft', () => {
    const pkg = buildMemoEvidencePackage({ title: 'Memo', question: '', citations: CITATIONS, draft: null, generatedAt: NOW, appVersion: VERSION });
    expect(pkg.schema).toBe(EVIDENCE_PACKAGE_SCHEMA);
    expect(pkg.subject).toEqual({ kind: 'memo', title: 'Memo' });
    expect(pkg.sources.map(source => source.accessionNumber)).toEqual(['0000320193-26-000001', '0000320193-25-000001']);
    expect(pkg.sources.every(source => source.role === 'cited')).toBe(true);
    expect(pkg.sectionSlices).toEqual([{ accessionNumber: '0000320193-26-000001', section: 'Risk Factors — redline', characters: 23, origin: 'memo-citation' }]);
    expect(pkg.aiStep).toBeNull();
    expect(pkg.query.text).toBeNull();
    expect(pkg.query.note).toMatch(/does not record the query/);
    expect(pkg.coverage.status).toBe('not-recorded');
    expect(pkg.generatedAt).toBe('2026-10-04T12:00:00.000Z');
    expect(pkg.appVersion).toEqual(VERSION);
  });

  it('records the AI draft step and the question entered at export', () => {
    const pkg = buildMemoEvidencePackage({
      title: 'Memo',
      question: 'How did risk disclosure change?',
      citations: CITATIONS,
      draft: { text: '# Memo', generatedAt: '2026-10-03T00:00:00.000Z', citationIds: ['a'] },
      generatedAt: NOW,
      appVersion: VERSION,
      aiMetadata: { response: { model: 'claude-x', reasoningEffort: 'low' } },
    });
    expect(pkg.query.text).toBe('How did risk disclosure change?');
    expect(pkg.aiStep).toMatchObject({ model: 'claude-x', reasoningEffort: 'low', metadataSource: 'response', generatedAt: '2026-10-03T00:00:00.000Z' });
    expect(JSON.parse(evidencePackageJson(pkg))).toEqual(pkg);
  });

  it('records the model and effort the draft was saved with, instead of "not reported"', () => {
    const pkg = buildMemoEvidencePackage({
      title: 'Memo',
      citations: CITATIONS,
      draft: {
        text: '# Memo', generatedAt: '2026-10-03T00:00:00.000Z', citationIds: ['a'],
        aiMetadata: {
          requestedModel: 'openai/gpt-5.6', requestedEffort: 'high', model: 'openai/gpt-5.6', provider: 'openai',
          reasoningEffort: 'high', webSources: [], usage: { input: 1200, output: 300 },
        },
      },
      generatedAt: NOW,
      appVersion: VERSION,
    });
    expect(pkg.aiStep).toMatchObject({ model: 'openai/gpt-5.6', provider: 'openai', reasoningEffort: 'high', metadataSource: 'response' });

    const older = buildMemoEvidencePackage({
      title: 'Memo', citations: CITATIONS, generatedAt: NOW, appVersion: VERSION,
      draft: { text: '# Memo', generatedAt: '2026-10-03T00:00:00.000Z', citationIds: ['a'] },
    });
    expect(older.aiStep).toMatchObject({ model: null, provider: null, reasoningEffort: null, metadataSource: 'not-reported' });
  });
});

describe('copilot answer evidence package', () => {
  const filing = (accession: string, matchReason: string): FilingResearchResult => ({
    id: accession, entityName: 'Apple Inc.', fileDate: '2026-01-30', formType: '10-K', documentType: '10-K', cik: '320193',
    accessionNumber: accession, primaryDocument: 'a.htm', filingPrimaryDocument: 'a.htm', description: '', matchSnippet: '',
    matchReason, score: 1, relevanceScore: 1, filingUrl: `https://www.sec.gov/Archives/edgar/data/320193/${accession.replace(/-/g, '')}/a.htm`,
    companyName: 'Apple Inc.', tickers: ['AAPL'], sic: '', sicDescription: '', exchange: '', stateOfIncorporation: '',
    fiscalYearEnd: '', headquarters: '', fileNumber: '', auditor: '', acceleratedStatus: '',
  });

  const run: AgentRun = {
    id: 'r', prompt: 'Find material weakness disclosures', status: 'completed', startedAt: '2026-10-04T11:00:00.000Z',
    completedAt: '2026-10-04T11:01:00.000Z', answer: 'Answer text.', actionLog: [], evidence: null,
    plan: {
      goal: 'g', rationale: 'r', confidence: 'high', followUps: [],
      actions: [
        { id: '1', type: 'apply_filters', title: 'Filters', input: { filters: { dateFrom: '2025-01-01' } } },
        { id: '2', type: 'search_filings', title: 'Search', input: { query: '"material weakness" AND revenue', mode: 'boolean', filters: { formTypes: ['10-K'] } } },
      ],
    },
  };
  const evidence: AgentEvidencePacket = {
    title: 'Filing research evidence', summary: 's', findings: [], followUps: [], notes: [],
    citations: [{
      id: 'c', kind: 'section', title: 'Apple 10-K — Controls', sectionLabel: 'Item 9A', excerpt: 'A material weakness existed.',
      externalUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a.htm',
    }],
    data: { filings: [filing('0000320193-26-000001', 'Boolean text match'), filing('0000320193-25-000009', 'Metadata match')] },
  };

  it('takes query, operators and filters from the run plan, and roles from what was read', () => {
    const pkg = buildAnswerEvidencePackage({ run, evidence, generatedAt: NOW, appVersion: VERSION });
    expect(pkg.subject).toEqual({ kind: 'ai-answer', title: 'Find material weakness disclosures' });
    expect(pkg.query).toMatchObject({ text: '"material weakness" AND revenue', mode: 'boolean' });
    expect(pkg.query.operators).toEqual(expect.arrayContaining(['AND', '"phrase"']));
    expect(pkg.filters).toEqual([{ label: 'dateFrom', value: '2025-01-01' }, { label: 'formTypes', value: '10-K' }]);
    expect(pkg.sources.find(source => source.accessionNumber === '0000320193-26-000001')?.role).toBe('read');
    expect(pkg.sources.find(source => source.accessionNumber === '0000320193-25-000009')?.role).toBe('listed');
    expect(pkg.sectionSlices).toEqual([{ accessionNumber: '0000320193-26-000001', section: 'Item 9A', characters: 28, origin: 'copilot-evidence' }]);
    expect(pkg.aiStep).toMatchObject({ metadataSource: 'not-reported', model: null, generatedAt: '2026-10-04T11:01:00.000Z' });
    expect(pkg.coverage).toMatchObject({ status: 'not-recorded' });
    expect(pkg.coverage.note).toMatch(/returned 2 filings/);
  });

  it('records the model, effort and web sources the run kept, apart from filing sources', () => {
    const pkg = buildAnswerEvidencePackage({
      run: {
        ...run,
        aiMetadata: {
          requestedModel: 'anthropic/claude-sonnet-5.5', requestedEffort: 'medium', model: 'anthropic/claude-sonnet-5.5',
          provider: 'anthropic', reasoningEffort: 'medium', webSources: [{ url: 'https://www.sec.gov/news/press-release/2026-1', title: 'SEC press release' }],
        },
      },
      evidence,
      generatedAt: NOW,
      appVersion: VERSION,
    });
    expect(pkg.aiStep).toMatchObject({
      model: 'anthropic/claude-sonnet-5.5', provider: 'anthropic', reasoningEffort: 'medium', metadataSource: 'response',
      webSources: [{ url: 'https://www.sec.gov/news/press-release/2026-1', title: 'SEC press release' }],
    });
    expect(pkg.sources.some(source => source.secUrl.includes('press-release'))).toBe(false);
  });

  it('uses captured coverage when the caller has it, and says when no search ran', () => {
    const withCoverage = buildAnswerEvidencePackage({
      run, evidence, generatedAt: NOW, appVersion: VERSION,
      coverage: { examined: 30, upstreamTotal: 30, complete: true },
    });
    expect(withCoverage.coverage).toMatchObject({ status: 'complete', examined: 30 });

    const noSearch = buildAnswerEvidencePackage({ run: { ...run, plan: undefined }, evidence: null, generatedAt: NOW, appVersion: { status: 'unavailable', reason: 'offline' } });
    expect(noSearch.query).toMatchObject({ text: null, operators: [] });
    expect(noSearch.coverage.note).toMatch(/did not execute a filing search/);
    expect(noSearch.appVersion).toEqual({ status: 'unavailable', reason: 'offline' });
  });
});
