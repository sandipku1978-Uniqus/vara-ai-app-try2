import { describe, it, expect } from 'vitest';
import { buildCoverageRows, buildIssuerRows, buildResultRows } from '../services/resultExport';
import type { FilingResearchResult } from '../services/filingResearch';

/**
 * Benchmark P3-D1: Excel list + extracted company list. The workbook must
 * carry the same honesty as the results pane — a partial validated window
 * detached into a workpaper must say so on its Coverage sheet.
 */

function row(over: Partial<FilingResearchResult>): FilingResearchResult {
  return {
    fileDate: '2026-01-02',
    formType: '10-K',
    entityName: 'Issuer A',
    tickers: ['AAA'],
    cik: '111',
    accessionNumber: '0001-26-000001',
    matchSectionPath: 'Item 1A · Risk Factors',
    matchReason: 'Matched filing text',
    auditor: 'KPMG',
    sicDescription: 'Electronic Computers',
    matchSnippet: 'a snippet',
    filingUrl: 'https://www.sec.gov/x',
    ...over,
  } as FilingResearchResult;
}

describe('result rows', () => {
  it('carries provenance columns: section, match basis, excerpt, link', () => {
    const rows = buildResultRows([row({})]);
    expect(rows[0]).toContain('Section');
    expect(rows[0]).toContain('Match basis');
    expect(rows[1]).toContain('Item 1A · Risk Factors');
    expect(rows[1]).toContain('Matched filing text');
    expect(rows[1]).toContain('https://www.sec.gov/x');
  });

  it('prefers the Form AP auditor of record over the text-detected firm', () => {
    const rows = buildResultRows([row({ auditor: 'EY', registeredAuditor: 'KPMG LLP' })]);
    expect(rows[1]).toContain('KPMG LLP');
    expect(rows[1]).not.toContain('EY');
  });
});

describe('issuer extraction', () => {
  it('dedupes by CIK, unions tickers, counts filings, sorts by count', () => {
    const rows = buildIssuerRows([
      row({}),
      row({ accessionNumber: '0001-26-000002', tickers: ['AAA', 'AAA-B'] }),
      row({ entityName: 'Issuer B', cik: '222', tickers: ['BBB'] }),
    ]);
    expect(rows[1]).toEqual(['Issuer A', 'AAA, AAA-B', '111', 2]);
    expect(rows[2]).toEqual(['Issuer B', 'BBB', '222', 1]);
  });
});

describe('coverage sheet honesty', () => {
  it('records the corpus floor and names a partial window as partial', () => {
    const rows = buildCoverageRows(
      {
        query: '"material weakness"',
        mode: 'boolean',
        coverage: { examined: 497, upstreamTotal: 10_000, complete: false, upstreamTotalIsFloor: true },
        filterSummary: ['Forms: 10-K, 10-K/A'],
      },
      403
    );
    const flat = rows.map(r => r.join(' | ')).join('\n');
    expect(flat).toContain('10,000+');
    expect(flat).toContain('verified subset, not the full corpus');
    expect(flat).toContain('Validated filings in this export | 403');
    expect(flat).toContain('Forms: 10-K, 10-K/A');
  });

  it('states completeness only when coverage was complete', () => {
    const rows = buildCoverageRows(
      { query: 'x', mode: 'boolean', coverage: { examined: 12, upstreamTotal: 12, complete: true }, filterSummary: [] },
      12
    );
    expect(rows.map(r => r.join(' ')).join('\n')).toContain('Complete — every upstream candidate was validated');
  });
});
