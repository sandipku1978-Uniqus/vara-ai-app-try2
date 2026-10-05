import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  locateConcepts,
  periodLabel,
  pickComparablePeriods,
  yoyCell,
  yoyCells,
  type YoYFilingIndex,
} from '../utils/yoyChanges';
import { buildMarkedDiff } from '../utils/sectionDiff';
import { conceptsForForm, locateSection } from '../utils/sectionTaxonomy';

/**
 * The YoY matrix's rows come from the taxonomy, its periods from the period
 * of report, and a cell never measures a slicer miss as a change.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'filings');
const TEN_K = readFileSync(path.join(FIXTURES, 'aapl-10k.txt'), 'utf8');
const PROXY = readFileSync(path.join(FIXTURES, 'msft-def14a.txt'), 'utf8');

function index(rows: Array<[form: string, reportDate: string, filingDate: string]>): YoYFilingIndex {
  return {
    cik: '320193',
    filings: {
      recent: {
        form: rows.map(row => row[0]),
        reportDate: rows.map(row => row[1]),
        filingDate: rows.map(row => row[2]),
        accessionNumber: rows.map((_, i) => `0000320193-26-00000${i}`),
        primaryDocument: rows.map((_, i) => `doc${i}.htm`),
      },
    },
  };
}

describe('pickComparablePeriods', () => {
  it('orders by period of report, one filing per period, the amendment winning its own period', () => {
    const periods = pickComparablePeriods(index([
      ['10-K/A', '2025-09-27', '2026-01-15'],
      ['10-Q', '2025-12-27', '2026-01-30'],
      ['10-K', '2025-09-27', '2025-10-31'],
      ['10-K', '2024-09-28', '2024-11-01'],
      ['10-K', '2023-09-30', '2023-11-03'],
    ]), '10-K', 6);
    expect(periods.map(period => [period.form, period.reportDate])).toEqual([
      ['10-K/A', '2025-09-27'], ['10-K', '2024-09-28'], ['10-K', '2023-09-30'],
    ]);
  });

  it('compares definitive proxies by meeting date and ignores preliminary and additional materials', () => {
    const periods = pickComparablePeriods(index([
      ['DEFA14A', '2026-02-24', '2026-01-20'],
      ['DEF 14A', '2026-02-24', '2026-01-08'],
      ['PRE 14A', '2026-02-24', '2025-12-20'],
      ['DEF 14A', '2025-02-25', '2025-01-10'],
    ]), 'DEF 14A');
    expect(periods.map(period => period.accession)).toEqual(['0000320193-26-000001', '0000320193-26-000003']);
    expect(periodLabel(periods[0], 'DEF 14A')).toBe('2026 proxy');
  });

  it('labels annual periods by the fiscal year of the period of report, not the filing year', () => {
    const [period] = pickComparablePeriods(index([['20-F', '2025-12-31', '2026-02-10']]), '20-F', 1);
    expect(periodLabel(period, '20-F')).toBe('FY2025');
  });
});

describe('yoyCell', () => {
  const found = (text: string) => locateSection(`Notes to Financial Statements\nNote 1 – Leases\n${text}`, 'leases', '10-K');

  it('measures a change only between two slices that were read', () => {
    const cell = yoyCell(
      found('The Company recognizes a right-of-use asset and an operating lease liability.'),
      found('The Company recognizes a right-of-use asset and an operating lease liability. New finance leases began.'),
    );
    expect(cell.kind).toBe('change');
    if (cell.kind === 'change') expect(['minor', 'moderate', 'major']).toContain(cell.change.bucket);
  });

  it('reports "could not extract" rather than a fake new or removed section', () => {
    const missing = locateSection('', 'leases', '10-K');
    const cell = yoyCell(missing, found('The Company recognizes a right-of-use asset.'));
    expect(cell).toMatchObject({ kind: 'could-not-extract', detail: expect.stringMatching(/^Prior period: /) });
  });

  it('reports "not disclosed" when neither period has the section', () => {
    const none = locateSection('Notes to Financial Statements\nNote 1 – Revenue\nRevenue.', 'going-concern', '10-K');
    expect(yoyCell(none, none)).toEqual({ kind: 'not-disclosed', detail: 'Not disclosed in either period.' });
  });

  it('a section that appears in the current period only is "new"', () => {
    const none = locateSection('Notes to Financial Statements\nNote 1 – Revenue\nRevenue.', 'going-concern', '10-K');
    const now = locateSection('Notes to Financial Statements\nNote 1 – Going Concern\nThere is substantial doubt about our ability to continue as a going concern.', 'going-concern', '10-K');
    const cell = yoyCell(none, now);
    expect(cell.kind === 'change' && cell.change.bucket).toBe('new');
  });
});

describe('rows from the taxonomy, on real filings', () => {
  it('builds a cell for every 10-K concept, Items through Notes', () => {
    const located = locateConcepts(TEN_K, '10-K');
    const cells = yoyCells('10-K', located, located);
    expect(Object.keys(cells)).toEqual(conceptsForForm('10-K').map(concept => concept.key));
    // Same filing both sides: every located concept is unchanged.
    expect(cells['risk-factors']).toMatchObject({ kind: 'change', change: { bucket: 'unchanged' } });
    expect(cells.leases).toMatchObject({ kind: 'change', change: { bucket: 'unchanged' } });
    expect(cells['going-concern']).toMatchObject({ kind: 'not-disclosed' });
    expect(cells['use-of-estimates']).toMatchObject({ kind: 'could-not-extract' });
  });

  it('builds proxy rows for a DEF 14A', () => {
    const located = locateConcepts(PROXY, 'DEF 14A');
    expect(Object.keys(located)).toEqual(conceptsForForm('DEF 14A').map(concept => concept.key));
    expect(located.cdna.status).toBe('found');
  });
});

describe('buildMarkedDiff (the explanation’s input)', () => {
  const prior = 'we lease our offices and stores under operating leases with terms of one to ten years the company has no finance leases';
  const current = 'we lease our offices and stores under operating leases with terms of one to fifteen years the company entered into finance leases for data centers';

  it('marks exactly the changed tokens, with context', () => {
    const diff = buildMarkedDiff(prior, current);
    expect(diff.text).toContain('[-ten-]');
    expect(diff.text).toContain('[+fifteen+]');
    expect(diff.text).toContain('[+entered into+]');
    expect(diff.text).toContain('terms of one to');
    expect(diff.truncated).toBe(false);
  });

  it('is empty for identical text', () => {
    expect(buildMarkedDiff(prior, prior)).toMatchObject({ text: '', runsTotal: 0, truncated: false });
  });

  it('says when it had to drop changed passages to fit', () => {
    const many = Array.from({ length: 60 }, (_, i) => `paragraph ${i} ${'stable words '.repeat(40)}`).join(' ');
    const edited = many.replace(/paragraph (\d+)/g, 'section $1');
    const diff = buildMarkedDiff(many, edited, 2000);
    expect(diff.truncated).toBe(true);
    expect(diff.runsIncluded).toBeLessThan(diff.runsTotal);
    expect(diff.text.length).toBeLessThanOrEqual(2000);
  });
});
