import { describe, it, expect, vi } from 'vitest';
import {
  annualFilings,
  availableFiscalYears,
  blockTitlesConcept,
  locateFootnote,
  noteTables,
  pickFilingForPeriod,
  tablesWithinText,
  type AnnualFiling,
  type FootnoteFilingIndex,
} from '../services/footnoteComparison';
import { findSectionConcept } from '../utils/sectionTaxonomy';

/**
 * Footnote comparison: aligned by period of report, the note found the most
 * exact way available, its tables extracted, and a status that never claims
 * "not disclosed" without having read the filing.
 */

function index(rows: Array<[form: string, reportDate: string, filingDate: string]>, cik = '320193'): FootnoteFilingIndex {
  return {
    cik,
    filings: {
      recent: {
        form: rows.map(row => row[0]),
        reportDate: rows.map(row => row[1]),
        filingDate: rows.map(row => row[2]),
        accessionNumber: rows.map((_, i) => `0000${cik}-26-00000${i}`),
        primaryDocument: rows.map((_, i) => `annual${i}.htm`),
      },
    },
  };
}

describe('alignment by fiscal period', () => {
  // Apple: September year end, 10-K filed late October.
  const apple = index([['10-K', '2025-09-27', '2025-10-31'], ['10-K', '2024-09-28', '2024-11-01']]);
  // Walmart-style January year end: FY2025 ends 2025-01-31, filed March 2025.
  const walmart = index([['10-K', '2025-01-31', '2025-03-14'], ['10-K', '2024-01-31', '2024-03-15']], '104169');
  // A December filer whose FY2024 10-K was filed in February 2025.
  const december = index([['10-K/A', '2024-12-31', '2025-04-30'], ['10-K', '2024-12-31', '2025-02-20'], ['20-F', '2023-12-31', '2024-02-08']], '1639920');

  it('places each company by the year of its period of report, never the filing date', () => {
    expect(pickFilingForPeriod(apple, 2025)?.reportDate).toBe('2025-09-27');
    expect(pickFilingForPeriod(walmart, 2025)?.reportDate).toBe('2025-01-31');
    // Filed in 2025, but it reports fiscal 2024.
    expect(pickFilingForPeriod(december, 2025)).toBeNull();
    expect(pickFilingForPeriod(december, 2024)?.reportDate).toBe('2024-12-31');
  });

  it('reads the original over a same-period amendment (a 10-K/A rarely carries the notes)', () => {
    expect(pickFilingForPeriod(december, 2024)?.form).toBe('10-K');
    expect(annualFilings(december).map(filing => filing.form)).toEqual(['10-K', '20-F']);
  });

  it('offers every fiscal year any peer reported, newest first', () => {
    expect(availableFiscalYears([apple, walmart, december])).toEqual([2025, 2024, 2023]);
  });

  it('leaves out a filing with no period of report instead of placing it by filing date', () => {
    expect(annualFilings(index([['10-K', '', '2025-02-20']]))).toEqual([]);
  });
});

describe('which tagged block titles the note', () => {
  const leases = findSectionConcept('leases')!.headings;
  const revenue = findSectionConcept('revenue-recognition')!.headings;

  it('accepts the note itself and rejects tables, details, policies and incidental names', () => {
    expect(blockTitlesConcept('LEASES', leases)).toBe(true);
    expect(blockTitlesConcept('Leases (Notes)', leases)).toBe(true);
    expect(blockTitlesConcept('Leases and Right-of-Use Assets', leases)).toBe(true);
    expect(blockTitlesConcept('Leases (Tables)', leases)).toBe(false);
    expect(blockTitlesConcept('Leases - Maturities (Details)', leases)).toBe(false);
    expect(blockTitlesConcept('Summary of Significant Accounting Policies (Policies)', leases)).toBe(false);
    expect(blockTitlesConcept('UNEARNED REVENUE', revenue)).toBe(false);
    expect(blockTitlesConcept('Revenue', revenue)).toBe(true);
  });
});

describe('note tables', () => {
  const NOTE_HTML = `<html><body>
    <p>Note 8 – Leases</p>
    <p>The Company recognizes a right-of-use asset and an operating lease liability.</p>
    <p>Lease liability maturities</p>
    <table><tr><td>Fiscal year</td><td>Operating leases</td></tr><tr><td>2026</td><td>$ 1,234</td></tr><tr><td>Total</td><td>$ 5,678</td></tr></table>
    <p>Note 9 – Debt</p>
    <table><tr><td>Term debt maturity schedule by year</td><td>Amount outstanding</td></tr><tr><td>2026</td><td>$ 10,000</td></tr></table>
  </body></html>`;

  it('drops an R-file’s wrapper table and keeps the note’s own', () => {
    const wrapped = `<table class="report"><tr><th>Leases</th></tr><tr><td>${'Lease narrative. '.repeat(120)}<table><tr><td>2026</td><td>$ 1,234</td></tr><tr><td>Total</td><td>$ 5,678</td></tr></table></td></tr></table>`;
    const tables = noteTables(wrapped);
    expect(tables).toHaveLength(1);
    expect(tables[0].rows[0]).toEqual(['2026', '$ 1,234']);
  });

  it('attributes a document table to the note only when its text sits inside the located note', () => {
    const noteText = 'Note 8 – Leases\nThe Company recognizes a right-of-use asset and an operating lease liability.\nLease liability maturities\nFiscal year Operating leases\n2026 $ 1,234\nTotal $ 5,678';
    const tables = tablesWithinText(NOTE_HTML, noteText);
    expect(tables).toHaveLength(1);
    expect(tables[0].title).toBe('Lease liability maturities');
  });
});

describe('locateFootnote', () => {
  const FILING: AnnualFiling = {
    form: '10-K', accession: '0000320193-25-000079', primaryDocument: 'aapl-20250927.htm', filingDate: '2025-10-31', reportDate: '2025-09-27',
  };
  const SUMMARY = '<FilingSummary><MyReports><Report><ShortName>Leases</ShortName><HtmlFileName>R12.htm</HtmlFileName></Report><Report><ShortName>Leases (Tables)</ShortName><HtmlFileName>R40.htm</HtmlFileName></Report></MyReports></FilingSummary>';
  const BLOCK = `<html><body><table class="report"><tr><th>Leases</th></tr><tr><td><p>The Company has lease arrangements for certain equipment and facilities, including corporate, data center, manufacturing and retail space. ${'These leases typically have original terms not exceeding 10 years and generally contain multiyear renewal options. '.repeat(3)}</p><table><tr><td>Operating lease right-of-use assets</td><td>$ 10,234</td></tr><tr><td>Total lease liabilities</td><td>$ 12,345</td></tr></table></td></tr></table></body></html>`;

  it('reads the registrant’s tagged note block first, with its tables', async () => {
    const load = vi.fn(async (path: string) => {
      if (path.endsWith('FilingSummary.xml')) return SUMMARY;
      if (path.endsWith('R12.htm')) return BLOCK;
      throw new Error(`unexpected ${path}`);
    });
    const result = await locateFootnote({ conceptKey: 'leases', cik: '320193', filing: FILING, load });
    expect(result).toMatchObject({ status: 'disclosed', via: 'xbrl-block', heading: 'Leases', sourceFile: 'R12.htm' });
    expect(result.text).toContain('lease arrangements');
    expect(result.tables[0].rows).toContainEqual(['Total lease liabilities', '$ 12,345']);
    expect(load).not.toHaveBeenCalledWith(expect.stringContaining('R40.htm'));
  });

  it('falls back to the note slicer over the primary document when nothing is tagged', async () => {
    const primary = `<html><body>
      <p>Item 8. Financial Statements and Supplementary Data</p>
      <p>Notes to Consolidated Financial Statements</p>
      <p>Note 7 – Income Taxes</p>
      <p>The provision for income taxes reflects a valuation allowance and an effective tax rate of 16%.</p>
      <table><tr><td>Deferred tax assets components</td><td>Amount in millions</td></tr><tr><td>Capitalized R&amp;D</td><td>$ 15,000</td></tr></table>
      <p>Note 8 – Leases</p><p>Lease text.</p>
      <p>Item 9. Changes in and Disagreements with Accountants</p></body></html>`;
    const load = vi.fn(async (path: string) => {
      if (path.endsWith('FilingSummary.xml')) throw new Error('404');
      return primary;
    });
    const result = await locateFootnote({ conceptKey: 'income-taxes', cik: '320193', filing: FILING, load });
    expect(result).toMatchObject({ status: 'disclosed', via: 'text', heading: 'Note 7 – Income Taxes' });
    expect(result.text).not.toContain('Lease text');
    expect(result.tables).toHaveLength(1);
    expect(load).toHaveBeenCalledWith('Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm');
  });

  it('says "not disclosed" only after reading the filing, and "could not extract" when it could not be read', async () => {
    const primary = '<html><body><p>Notes to Consolidated Financial Statements</p><p>Note 1 – Revenue</p><p>Revenue is recognized.</p></body></html>';
    const read = await locateFootnote({
      conceptKey: 'going-concern', cik: '320193', filing: FILING,
      load: async path => (path.endsWith('.xml') ? '' : primary),
    });
    expect(read.status).toBe('not-disclosed');

    const unreadable = await locateFootnote({
      conceptKey: 'going-concern', cik: '320193', filing: FILING,
      load: async () => { throw new Error('429'); },
    });
    expect(unreadable).toMatchObject({ status: 'could-not-extract', detail: expect.stringMatching(/could not be read/) });
  });

  it('reports a company without a report for the period as such', async () => {
    const result = await locateFootnote({ conceptKey: 'leases', cik: '320193', filing: null, load: async () => '' });
    expect(result.status).toBe('no-filing');
  });
});
