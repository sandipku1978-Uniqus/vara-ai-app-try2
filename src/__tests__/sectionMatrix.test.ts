import { describe, it, expect } from 'vitest';
import {
  SECTION_MATRIX_FORMS,
  SECTION_MATRIX_ROWS,
  buildSectionMatrixCells,
  buildSectionMatrixCsvRows,
  deriveSectionPresence,
  describeCellState,
  describeFilingTextFailure,
  initialVerification,
  mapWithConcurrency,
  pickSectionMatrixFiling,
  sectionMatrixCellLabels,
  sectionMatrixScope,
  summarizeVerification,
  verificationFromOutcome,
  type CompanyVerification,
  type SectionMatrixFilingIndex,
  type SectionMatrixSource,
} from '../utils/sectionMatrix';

/**
 * The Section Matrix was fabricated: every section read as present whenever
 * the company had any filing of the form, and the grid exported as workpaper
 * evidence. These pin the replacement's honesty rules — a mark only ever
 * comes from text that was read, every other state is explicit, and the
 * export names the document behind each cell.
 */

const TEN_K = [
  'TABLE OF CONTENTS',
  'Item 1. Business 3',
  'Item 1A. Risk Factors 9',
  'PART I',
  'Item 1. Business',
  'The company designs and sells widgets across three segments. See Item 1C for our security program.',
  'Item 1A. Risk Factors',
  'Our operations depend on suppliers and on currency movements.',
  'Item 1B. Unresolved Staff Comments',
  'None.',
  'Item 2. Properties',
  'The company leases offices in Austin.',
  'PART II',
  'Item 9A. Controls and Procedures',
  'Management concluded internal control over financial reporting was effective.',
].join('\n');

const TEN_Q = [
  'PART I',
  'Item 1. Financial Statements',
  'The condensed consolidated balance sheets present cash of $12.5 million.',
  'Item 2. Management’s Discussion and Analysis of Financial Condition',
  'Revenue increased due to volume growth.',
  'PART II',
  'Item 1. Legal Proceedings',
  'A supplier dispute is pending in Delaware.',
  'Item 2. Unregistered Sales of Equity Securities',
  'The company repurchased shares under its program.',
].join('\n');

const PROSPECTUS = [
  'PROSPECTUS SUMMARY',
  'We operate a marketplace platform. For a discussion of risks, see Risk Factors.',
  'RISK FACTORS',
  'Investing in our common stock involves substantial risk.',
  'USE OF PROCEEDS',
  'We intend to use the net proceeds for working capital and general corporate purposes.',
].join('\n');

function filingIndex(forms: string[], cik = '320193'): SectionMatrixFilingIndex {
  return {
    cik,
    filings: {
      recent: {
        form: forms,
        accessionNumber: forms.map((_, index) => `0000320193-26-00000${index + 1}`),
        primaryDocument: forms.map((form, index) => `${form.toLowerCase().replace(/[^a-z0-9]/g, '')}-${index + 1}.htm`),
        filingDate: forms.map((_, index) => `2026-0${index + 1}-15`),
        reportDate: forms.map(() => '2025-12-31'),
      },
    },
  };
}

const SOURCE: SectionMatrixSource = {
  cik: '320193',
  form: '10-K',
  accession: '0000320193-26-000002',
  primaryDocument: 'aapl-10k.htm',
  filingDate: '2026-02-20',
  reportDate: '2025-12-31',
};

describe('matrix rows and slicer scopes', () => {
  it('offers only rows the shared slicer can verify — no Signatures, no bare S-1 prose headings', () => {
    for (const form of SECTION_MATRIX_FORMS) {
      for (const row of SECTION_MATRIX_ROWS[form]) {
        expect(sectionMatrixScope(form, row), `${form}: ${row}`).not.toBeNull();
      }
      expect(SECTION_MATRIX_ROWS[form]).not.toContain('Signatures');
    }
    expect(SECTION_MATRIX_ROWS['S-1']).not.toContain('Part I — Business');
    expect(SECTION_MATRIX_ROWS['S-1']).not.toContain('Part I — Management');
  });

  it('resolves item-numbered rows per form, with 10-Q parts', () => {
    expect(sectionMatrixScope('10-K', 'Item 1A. Risk Factors')).toEqual({ kind: 'item', item: '1a', options: {}, label: 'Item 1A. Risk Factors' });
    expect(sectionMatrixScope('10-Q', 'Part II, Item 1A. Risk Factors')).toEqual({ kind: 'item', item: '1a', options: { part: 2 }, label: 'Part II, Item 1A. Risk Factors' });
    expect(sectionMatrixScope('10-Q', 'Part I, Item 2. MD&A')).toEqual({ kind: 'item', item: '2', options: { part: 1 }, label: 'Part I, Item 2. MD&A' });
    expect(sectionMatrixScope('20-F', 'Item 17. Financial Statements')).toEqual({ kind: 'item', item: '17', options: {}, label: 'Item 17. Financial Statements' });
    expect(sectionMatrixScope('S-1', 'Part I — Risk Factors')).toEqual({ kind: 'heading', headings: ['risk factors'], label: 'Part I — Risk Factors' });
  });

  it('returns null for a row it has no slicer for, never a guess', () => {
    expect(sectionMatrixScope('10-K', 'Signatures')).toBeNull();
    expect(sectionMatrixScope('10-Q', 'Item 1A. Risk Factors')).toBeNull();
    expect(sectionMatrixScope('S-1', 'Part I — Business')).toBeNull();
  });
});

describe('pickSectionMatrixFiling', () => {
  it('reads the newest original filing of the form, not an amendment ahead of it', () => {
    const source = pickSectionMatrixFiling(filingIndex(['10-K/A', '8-K', '10-K', '10-K']), '10-K');
    expect(source).toMatchObject({ form: '10-K', accession: '0000320193-26-000003', primaryDocument: '10k-3.htm', cik: '320193' });
  });

  it('falls back to the amendment only when no original exists', () => {
    expect(pickSectionMatrixFiling(filingIndex(['8-K', '10-K/A']), '10-K')).toMatchObject({ form: '10-K/A', accession: '0000320193-26-000002' });
  });

  it('reports no filing rather than borrowing another form', () => {
    expect(pickSectionMatrixFiling(filingIndex(['8-K', 'DEF 14A', '10-Q']), '10-K')).toBeNull();
    expect(pickSectionMatrixFiling(filingIndex(['424B4', 'F-1']), 'S-1')).toBeNull();
  });

  it('keeps S-1 to the registration statement itself and lets transition forms join their family', () => {
    expect(pickSectionMatrixFiling(filingIndex(['424B4', 'S-1/A', 'S-1']), 'S-1')).toMatchObject({ form: 'S-1', accession: '0000320193-26-000003' });
    expect(pickSectionMatrixFiling(filingIndex(['10-QT']), '10-Q')).toMatchObject({ form: '10-QT' });
  });
});

describe('deriveSectionPresence', () => {
  it('marks a section present only when the slicer finds its heading, with the matched words', () => {
    const presence = deriveSectionPresence('10-K', SECTION_MATRIX_ROWS['10-K'], TEN_K);
    expect(presence['Item 1A. Risk Factors']).toMatchObject({ state: 'present' });
    expect(presence['Item 1A. Risk Factors'].excerpt).toMatch(/^item 1a risk factors/);
    expect(presence['Item 1B. Unresolved Staff Comments'].state).toBe('present');
    expect(presence['Item 9A. Controls and Procedures'].state).toBe('present');
    expect(presence['Item 7. Management\'s Discussion & Analysis'].state).toBe('absent');
  });

  it('does not count a cross-reference as the section', () => {
    // "See Item 1C" is the only mention of 1C in the filing.
    const presence = deriveSectionPresence('10-K', ['Item 1C. Cybersecurity'], TEN_K);
    expect(presence['Item 1C. Cybersecurity']).toEqual({ state: 'absent' });
  });

  it('scopes 10-Q rows to their part', () => {
    const presence = deriveSectionPresence('10-Q', SECTION_MATRIX_ROWS['10-Q'], TEN_Q);
    expect(presence['Part I, Item 2. MD&A'].excerpt).toContain('revenue increased');
    expect(presence['Part II, Item 2. Unregistered Sales'].excerpt).toContain('repurchased shares');
    expect(presence['Part II, Item 1A. Risk Factors'].state).toBe('absent');
  });

  it('slices registration statements by prospectus heading', () => {
    const presence = deriveSectionPresence('S-1', SECTION_MATRIX_ROWS['S-1'], PROSPECTUS);
    expect(presence['Part I — Risk Factors'].excerpt).toContain('substantial risk');
    expect(presence['Part I — Use of Proceeds'].state).toBe('present');
    expect(presence['Part I — Dividend Policy'].state).toBe('absent');
  });

  it('finds nothing in empty text', () => {
    const presence = deriveSectionPresence('10-K', ['Item 1. Business'], '');
    expect(presence['Item 1. Business']).toEqual({ state: 'absent' });
  });
});

describe('verificationFromOutcome', () => {
  const rows = ['Item 1A. Risk Factors', 'Item 1C. Cybersecurity'];

  it('is the only path to verified, and it requires text', () => {
    const record = verificationFromOutcome('10-K', rows, SOURCE, { ok: true, text: TEN_K });
    expect(record.status).toBe('verified');
    if (record.status === 'verified') {
      expect(record.sections['Item 1A. Risk Factors'].state).toBe('present');
      expect(record.sections['Item 1C. Cybersecurity'].state).toBe('absent');
      expect(record.source).toBe(SOURCE);
    }
  });

  it('turns a rate limit into a retryable failure, never a column of absent', () => {
    const record = verificationFromOutcome('10-K', rows, SOURCE, { ok: false, kind: 'rate-limit', status: 429, retryable: true });
    expect(record).toEqual({ status: 'failed', source: SOURCE, reason: 'rate limited — retry', retryable: true });
  });

  it('treats an empty body as a failure to read, not as a filing without sections', () => {
    const record = verificationFromOutcome('10-K', rows, SOURCE, { ok: true, text: '   ' });
    expect(record).toMatchObject({ status: 'failed', retryable: true, reason: 'filing text was empty — retry' });
  });

  it('keeps terminal failures terminal', () => {
    const record = verificationFromOutcome('10-K', rows, SOURCE, { ok: false, kind: 'not-found', status: 404, retryable: false });
    expect(record).toMatchObject({ status: 'failed', retryable: false, reason: 'document not found on EDGAR' });
  });
});

describe('describeFilingTextFailure', () => {
  it('names each failure kind briefly and says when a retry can help', () => {
    expect(describeFilingTextFailure({ ok: false, kind: 'rate-limit', status: 429, retryable: true })).toBe('rate limited — retry');
    expect(describeFilingTextFailure({ ok: false, kind: 'timeout', retryable: true })).toBe('timed out — retry');
    expect(describeFilingTextFailure({ ok: false, kind: 'unsupported', status: 415, retryable: false })).toBe('document format not supported');
    expect(describeFilingTextFailure({ ok: false, kind: 'cancelled', retryable: false })).toBe('read cancelled');
    expect(describeFilingTextFailure({ ok: false, kind: 'upstream', status: 502, retryable: true })).toBe('SEC fetch failed (HTTP 502) — retry');
    expect(describeFilingTextFailure({ ok: false, kind: 'upstream', status: 400, retryable: false })).toBe('SEC fetch failed (HTTP 400)');
  });
});

describe('initialVerification', () => {
  it('starts a company at not-checked, no-filing, or an unloaded index — never at present', () => {
    expect(initialVerification(filingIndex(['10-K']), '10-K')).toMatchObject({ status: 'not-checked', source: { form: '10-K' } });
    expect(initialVerification(filingIndex(['8-K']), '10-K')).toEqual({ status: 'no-filing' });
    expect(initialVerification(undefined, '10-K')).toEqual({ status: 'failed', reason: 'company filing index not loaded', retryable: false });
  });
});

describe('buildSectionMatrixCells and summary', () => {
  const rows = ['Item 1A. Risk Factors', 'Item 1C. Cybersecurity'];
  const records: Record<string, CompanyVerification> = {
    AAPL: verificationFromOutcome('10-K', rows, SOURCE, { ok: true, text: TEN_K }),
    MSFT: { status: 'checking', source: { ...SOURCE, cik: '789019', accession: '0000789019-26-000002', primaryDocument: 'msft-10k.htm' } },
    NVDA: { status: 'no-filing' },
    GOOGL: { status: 'failed', source: { ...SOURCE, cik: '1652044' }, reason: 'rate limited — retry', retryable: true },
    META: { status: 'not-checked', source: { ...SOURCE, cik: '1326801' } },
    ZZZZ: { status: 'failed', reason: 'company filing index not loaded', retryable: false },
  };
  const tickers = Object.keys(records);
  const cells = buildSectionMatrixCells(rows, tickers, ticker => records[ticker]);

  it('gives every cell an explicit state carried from its company record', () => {
    expect(cells['Item 1A. Risk Factors'].AAPL).toMatchObject({ state: 'present', source: SOURCE });
    expect(cells['Item 1C. Cybersecurity'].AAPL).toMatchObject({ state: 'absent', source: SOURCE });
    expect(cells['Item 1A. Risk Factors'].MSFT).toMatchObject({ state: 'not-checked', checking: true });
    expect(cells['Item 1A. Risk Factors'].NVDA).toEqual({ state: 'no-filing' });
    expect(cells['Item 1C. Cybersecurity'].GOOGL).toMatchObject({ state: 'failed', reason: 'rate limited — retry' });
    expect(cells['Item 1A. Risk Factors'].META).toMatchObject({ state: 'not-checked', source: { cik: '1326801' } });
    expect(cells['Item 1A. Risk Factors'].META.checking).toBeUndefined();
    expect(cells['Item 1A. Risk Factors'].ZZZZ).toMatchObject({ state: 'failed', reason: 'company filing index not loaded' });
    expect(cells['Item 1A. Risk Factors'].ZZZZ.source).toBeUndefined();
  });

  it('never marks a company whose record is missing', () => {
    const grid = buildSectionMatrixCells(rows, ['AAPL', 'NEW'], ticker => records[ticker]);
    expect(grid['Item 1A. Risk Factors'].NEW).toEqual({ state: 'not-checked' });
  });

  it('counts the run for the progress line', () => {
    expect(summarizeVerification(tickers.map(ticker => records[ticker]))).toEqual({
      withFiling: 4, read: 1, failed: 1, retryable: 1, checking: 1, unread: 1, noFiling: 1, unavailable: 1,
    });
  });

  it('exports the state and the source accession for every cell', () => {
    const csv = buildSectionMatrixCsvRows(rows, ['AAPL', 'NVDA', 'GOOGL', 'META'], cells);
    expect(csv[0]).toEqual(['Section', 'AAPL', 'AAPL source', 'NVDA', 'NVDA source', 'GOOGL', 'GOOGL source', 'META', 'META source']);
    expect(csv[1]).toEqual([
      'Item 1A. Risk Factors',
      'present', '10-K 0000320193-26-000002 aapl-10k.htm',
      'no filing', '',
      'failed: rate limited — retry', '10-K 0000320193-26-000002 aapl-10k.htm',
      'not checked', '10-K 0000320193-26-000002 aapl-10k.htm',
    ]);
    expect(csv[2][1]).toBe('absent');
    expect(describeCellState(undefined)).toBe('not checked');
  });

  it('labels each state distinctly and names the document behind a verdict', () => {
    const labels = tickers.map(ticker => sectionMatrixCellLabels('Item 1A. Risk Factors', ticker, '10-K', cells['Item 1A. Risk Factors'][ticker]));
    expect(new Set(labels.map(item => item.label)).size).toBe(labels.length);
    expect(labels[0].label).toBe("Item 1A. Risk Factors: found in AAPL's 10-K 0000320193-26-000002");
    expect(labels[0].title).toContain('Matched (normalized text): “item 1a risk factors');
    expect(labels[1].label).toBe("Item 1A. Risk Factors: checking MSFT's 10-K 0000789019-26-000002");
    expect(labels[2].label).toBe('Item 1A. Risk Factors: no 10-K filing on record for NVDA');
    expect(labels[3].label).toBe('Item 1A. Risk Factors: could not be checked for GOOGL — rate limited — retry');
    expect(labels[4].label).toBe('Item 1A. Risk Factors: not checked for META — 10-K 0000320193-26-000002 not read yet');
    expect(labels[5].label).toBe('Item 1A. Risk Factors: could not be checked for ZZZZ — company filing index not loaded');
    expect(sectionMatrixCellLabels('Item 1C. Cybersecurity', 'AAPL', '10-K', cells['Item 1C. Cybersecurity'].AAPL).label)
      .toBe("Item 1C. Cybersecurity: not found in AAPL's 10-K 0000320193-26-000002");
  });
});

describe('mapWithConcurrency', () => {
  it('keeps at most the limit in flight, starts the next as one finishes, and preserves order', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    const run = mapWithConcurrency([1, 2, 3, 4, 5], 2, item => new Promise<number>(resolve => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      release.push(() => { inFlight -= 1; resolve(item * 10); });
    }));

    expect(release).toHaveLength(2);
    release.shift()!();
    await settle();
    expect(release).toHaveLength(2);
    while (release.length > 0) {
      release.shift()!();
      await settle();
    }

    expect(await run).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });

  it('handles an empty list and a limit above the item count', async () => {
    expect(await mapWithConcurrency([], 2, async item => item)).toEqual([]);
    expect(await mapWithConcurrency(['a'], 8, async item => item.toUpperCase())).toEqual(['A']);
  });
});
