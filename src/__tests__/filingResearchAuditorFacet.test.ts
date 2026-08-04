import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  fetchOutcome: vi.fn(),
  enrichCompanies: {} as Record<string, { auditor?: string }>,
  filingEvidence: {} as Record<string, {
    auditor?: string | null;
    resolutionStatus?: string;
    auditReportDate?: string | null;
    basis?: string | null;
  }>,
}));

vi.mock('../services/secApi', () => ({
  searchEdgarFilings: mocks.search,
  fetchFilingTextOutcome: mocks.fetchOutcome,
  isEnrichedSearchEnabled: () => true,
  fetchCompanySubmissions: async () => null,
  resolveCompanyInput: async () => null,
  prescreenBooleanCandidates: async () => null,
}));
vi.mock('../services/referenceData', () => ({
  loadSicDirectoryIndex: async () => ({}),
  loadSicDirectory: async () => [],
}));

import { executeFilingResearchSearch } from '../services/filingResearch';
import { defaultSearchFilters } from '../domain/searchFilters';

function hit(serial: number, auditor?: string) {
  const cik = String(serial).padStart(10, '0');
  const accession = `${cik}-26-${String(serial).padStart(6, '0')}`;
  return {
    _id: `${accession}:filing-${serial}.htm`,
    _score: 1,
    _source: {
      display_names: [`Issuer ${serial}`],
      entity_name: `Issuer ${serial}`,
      file_date: '2026-01-01',
      file_type: '10-K',
      adsh: accession,
      ciks: [cik],
      primary_document: `filing-${serial}.htm`,
      auditor,
    },
  };
}

beforeEach(() => {
  mocks.search.mockReset();
  mocks.fetchOutcome.mockReset();
  mocks.enrichCompanies = {};
  mocks.filingEvidence = {};
  vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => ({
    ok: true,
    json: async () => init?.method === 'POST'
      ? { filings: mocks.filingEvidence }
      : { companies: mocks.enrichCompanies },
  })));
});

describe('authoritative auditor-facet retrieval', () => {
  it('starts an auditor-only Boolean search with an empty-query facet browse and opens no filing text', async () => {
    mocks.search.mockResolvedValue([hit(101, 'KPMG LLP')]);

    const results = await executeFilingResearchSearch({
      query: 'auditor:KPMG',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 1,
      useEnrichedSearch: true,
      hydrateTextSignals: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].auditor).toBe('KPMG');
    expect(mocks.search.mock.calls[0][0]).toBe('');
    expect(mocks.search.mock.calls[0][6]).toMatchObject({
      useEnrichedSearch: true,
      auditor: 'KPMG',
    });
    expect(mocks.fetchOutcome).not.toHaveBeenCalled();
  });

  it('delegates a quoted phrase while enforcing its auditor from Form AP, without duplicate document validation', async () => {
    mocks.search.mockResolvedValue([hit(102, 'KPMG LLP')]);

    const results = await executeFilingResearchSearch({
      // Both phrase tokens are morphology-invariant, so EFTS and the local
      // matcher have the same exact-phrase semantics and delegation is safe.
      query: '"net ai" AND auditor:KPMG',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 1,
      useEnrichedSearch: true,
      hydrateTextSignals: true,
    });

    expect(results).toHaveLength(1);
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search.mock.calls[0][0]).toBe('"net ai"');
    expect(mocks.fetchOutcome).not.toHaveBeenCalled();
  });

  it('rejects a candidate whose authoritative auditor conflicts with the selected firm', async () => {
    mocks.search.mockResolvedValue([hit(103, 'Deloitte & Touche LLP')]);

    const results = await executeFilingResearchSearch({
      query: 'auditor:KPMG',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 1,
      useEnrichedSearch: true,
    });

    expect(results).toEqual([]);
    expect(mocks.fetchOutcome).not.toHaveBeenCalled();
  });

  it('falls back to filing-text auditor detection only when the facet has no record', async () => {
    mocks.search.mockResolvedValue([hit(104)]);
    mocks.fetchOutcome.mockResolvedValue({
      ok: true,
      text: 'Report of Independent Registered Public Accounting Firm /s/ KPMG LLP',
      attempts: 1,
    });

    const results = await executeFilingResearchSearch({
      query: 'auditor:KPMG',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 1,
      useEnrichedSearch: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].auditor).toBe('KPMG');
    expect(mocks.fetchOutcome).toHaveBeenCalledTimes(1);
  });

  it('uses filing-date evidence for an EFTS fallback without opening the filing', async () => {
    const candidate = hit(105);
    mocks.search.mockResolvedValue([candidate]);
    mocks.filingEvidence[candidate._id] = {
      auditor: 'KPMG',
      resolutionStatus: 'resolved',
      auditReportDate: '2025-10-30',
      basis: 'latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date',
    };

    const results = await executeFilingResearchSearch({
      query: 'auditor:KPMG',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 1,
      useEnrichedSearch: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      registeredAuditor: 'KPMG',
      registeredAuditorReportDate: '2025-10-30',
      registeredAuditorResolutionStatus: 'resolved',
    });
    expect(mocks.fetchOutcome).not.toHaveBeenCalled();
  });

  it('never overwrites a historical filing with the issuer profile current auditor', async () => {
    mocks.search.mockResolvedValue([hit(106, 'KPMG LLP')]);
    mocks.enrichCompanies['106'] = { auditor: 'Deloitte' };

    const results = await executeFilingResearchSearch({
      query: 'auditor:KPMG',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 1,
      useEnrichedSearch: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].registeredAuditor).toBe('KPMG');
    expect(results[0].auditor).toBe('KPMG');
  });

  it('falls back to filing text when Form AP evidence is explicitly ambiguous', async () => {
    const candidate = hit(107);
    mocks.search.mockResolvedValue([candidate]);
    mocks.filingEvidence[candidate._id] = {
      auditor: null,
      resolutionStatus: 'ambiguous',
    };
    mocks.fetchOutcome.mockResolvedValue({
      ok: true,
      text: 'Report of Independent Registered Public Accounting Firm /s/ KPMG LLP',
      attempts: 1,
    });

    const results = await executeFilingResearchSearch({
      query: 'auditor:KPMG',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 1,
      useEnrichedSearch: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].registeredAuditor).toBeUndefined();
    expect(results[0].registeredAuditorResolutionStatus).toBe('ambiguous');
    expect(mocks.fetchOutcome).toHaveBeenCalledTimes(1);
  });

  it('keeps resolved Form AP evidence as display truth after Boolean text validation', async () => {
    mocks.search.mockResolvedValue([hit(108, 'KPMG LLP')]);
    mocks.fetchOutcome.mockResolvedValue({
      ok: true,
      text: 'The goodwill analysis was reviewed. Report signed by Deloitte & Touche LLP.',
      attempts: 1,
    });

    const results = await executeFilingResearchSearch({
      query: 'auditor:KPMG AND goodwill',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 1,
      useEnrichedSearch: true,
      hydrateTextSignals: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].registeredAuditor).toBe('KPMG');
    expect(results[0].auditor).toBe('KPMG');
    expect(mocks.fetchOutcome).toHaveBeenCalledTimes(1);
  });
});
