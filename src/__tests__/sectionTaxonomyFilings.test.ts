import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  conceptsForForm,
  extractResolvedSection,
  extractResolvedSectionOriginal,
  locateSection,
  resolveSectionScope,
  type SectionLocateOutcome,
} from '../utils/sectionTaxonomy';
import { normalizedTokenOffsets } from '../utils/normalizedOffsets';
import { normalizeForMatch } from '../utils/booleanSearch';

/**
 * Taxonomy resolution on REAL filings. Each fixture is the shared extractor's
 * text of an actual EDGAR document, trimmed to its heading lines plus the
 * opening of each section (the first line of every fixture names the
 * accession). The headings, tables of contents, running page headers and
 * note numbering are the filer's own — the structure the slicers must cope
 * with in production.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'filings');
const read = (name: string) => readFileSync(path.join(FIXTURES, `${name}.txt`), 'utf8');

const TEN_K = read('aapl-10k');        // Apple 10-K, FY ended 2025-09-27
const TEN_Q = read('msft-10q');        // Microsoft 10-Q, quarter ended 2026-03-31
const TWENTY_F = read('spot-20f');     // Spotify 20-F, FY2025 (IFRS)
const S_ONE = read('rddt-s1');         // Reddit S-1, 2024 IPO
const PROXY_AAPL = read('aapl-def14a'); // Apple DEF 14A, 2026 meeting
const PROXY_MSFT = read('msft-def14a'); // Microsoft DEF 14A, 2025 meeting

function found(outcome: SectionLocateOutcome): Extract<SectionLocateOutcome, { status: 'found' }> {
  if (outcome.status !== 'found') throw new Error(`expected found, got ${outcome.reason} (${outcome.cause}): ${outcome.detail}`);
  return outcome;
}

describe('fixtures are real, trimmed, and small', () => {
  it.each(['aapl-10k', 'msft-10q', 'spot-20f', 'rddt-s1', 'aapl-def14a', 'msft-def14a'])('%s is under 80 KB and names its source', name => {
    const text = read(name);
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(80 * 1024);
    expect(text.split('\n')[0]).toMatch(/^\[Fixture: .+ accession \d{10}-\d{2}-\d{6}/);
  });
});

describe('10-K (Apple): Items, notes, CAMs and subsections each land on the right slice', () => {
  it('slices Items with the Item slicer', () => {
    expect(found(locateSection(TEN_K, 'risk-factors', '10-K')).text).toMatch(/^item 1a risk factors/);
    expect(found(locateSection(TEN_K, 'mdna', '10-K')).text).toMatch(/^item 7 management s discussion/);
    expect(found(locateSection(TEN_K, 'cybersecurity', '10-K')).text).toMatch(/^item 1c cybersecurity/);
  });

  it('reads Risk Factors to Item 1B, across its own subheadings', () => {
    const riskFactors = found(locateSection(TEN_K, 'risk-factors', '10-K')).text;
    expect(riskFactors).toContain('macroeconomic and industry risks');
    expect(riskFactors).not.toContain('unresolved staff comments');
  });

  it('finds each numbered note under its own heading, and ends it at the next note', () => {
    const cases: Array<[string, string]> = [
      ['significant-accounting-policies', 'Note 1 – Summary of Significant Accounting Policies'],
      ['revenue-recognition', 'Note 2 – Revenue'],
      ['income-taxes', 'Note 7 – Income Taxes'],
      ['leases', 'Note 8 – Leases'],
      ['stock-compensation', 'Note 11 – Share-Based Compensation'],
      ['segment-reporting', 'Note 13 – Segment Information and Geographic Data'],
    ];
    for (const [key, heading] of cases) {
      const outcome = found(locateSection(TEN_K, key, '10-K'));
      expect(outcome.heading, key).toBe(heading);
      // No note runs into the next one.
      expect(outcome.rawText!.slice(heading.length), key).not.toMatch(/\nNote \d+ – /);
    }
  });

  it('prefers the numbered note over the same word as a policy subheading in Note 1', () => {
    // Note 1 carries a "Revenue" subheading; Note 2 is the revenue note.
    expect(found(locateSection(TEN_K, 'revenue-recognition', '10-K')).heading).toBe('Note 2 – Revenue');
  });

  it('ends the last note before the auditor’s report', () => {
    const segments = found(locateSection(TEN_K, 'segment-reporting', '10-K')).rawText!;
    expect(segments).not.toMatch(/Report of Independent Registered Public Accounting Firm/i);
  });

  it('reads critical audit matters from the auditor’s report and stops at the signature', () => {
    const cams = found(locateSection(TEN_K, 'critical-audit-matters', '10-K'));
    expect(cams.heading).toBe('Critical Audit Matter');
    expect(cams.rawText).not.toMatch(/\/s\/ Ernst/);
  });

  it('finds Human Capital inside Item 1 and stops at Item 1A', () => {
    const humanCapital = found(locateSection(TEN_K, 'human-capital', '10-K'));
    expect(humanCapital.heading).toBe('Human Capital');
    expect(humanCapital.rawText).not.toMatch(/Item 1A\. Risk Factors/);
  });

  it('says "not disclosed" for what the filing does not carry', () => {
    const goingConcern = locateSection(TEN_K, 'going-concern', '10-K');
    expect(goingConcern).toMatchObject({ status: 'not-found', reason: 'not-disclosed', cause: 'heading-absent' });
    expect(locateSection(TEN_K, 'non-gaap', '10-K')).toMatchObject({ status: 'not-found', reason: 'not-disclosed' });
  });

  it('says "could not extract" when the filing mentions the topic but no heading bounds it', () => {
    // Apple's 10-K discusses estimates (MD&A "Critical Accounting Estimates")
    // but has no estimates heading inside its notes.
    expect(locateSection(TEN_K, 'use-of-estimates', '10-K')).toMatchObject({
      status: 'not-found', reason: 'could-not-extract', cause: 'mentioned-without-heading',
    });
  });

  it('maps the proxy-incorporated Items 10, 13 and 14', () => {
    expect(found(locateSection(TEN_K, 'audit-fees', '10-K')).text).toMatch(/^item 14 principal accountant fees/);
    expect(found(locateSection(TEN_K, 'related-party-transactions', '10-K')).text).toMatch(/^item 13 certain relationships/);
    expect(found(locateSection(TEN_K, 'board-committees', '10-K')).text).toMatch(/^item 10 directors/);
  });
});

describe('10-Q (Microsoft): running "PART I / Item 1" page headers on every page', () => {
  it('finds Part II Risk Factors and Part I MD&A despite the running headers', () => {
    // The old part rule took the LAST "Part I" marker — a page header deep in
    // MD&A — and every one of these read as absent.
    expect(found(locateSection(TEN_Q, 'risk-factors', '10-Q')).text).toMatch(/^item 1a/);
    const mdna = found(locateSection(TEN_Q, 'mdna', '10-Q')).text;
    expect(mdna).toContain('management s discussion and analysis of financial condition');
    expect(found(locateSection(TEN_Q, 'controls', '10-Q')).text).toMatch(/^item 4 controls and procedures/);
  });

  it('reads condensed notes by number ("NOTE 12 — LEASES")', () => {
    expect(found(locateSection(TEN_Q, 'leases', '10-Q')).heading).toBe('NOTE 12 — LEASES');
    expect(found(locateSection(TEN_Q, 'income-taxes', '10-Q')).heading).toBe('NOTE 10 — INCOME TAXES');
    expect(found(locateSection(TEN_Q, 'significant-accounting-policies', '10-Q')).heading).toBe('NOTE 1 — ACCOUNTING POLICIES');
  });

  it('finds the non-GAAP section in MD&A', () => {
    expect(found(locateSection(TEN_Q, 'non-gaap', '10-Q')).heading).toBe('NON-GAAP FINANCIAL MEASURES');
  });

  it('does not offer sections a 10-Q has no place for', () => {
    expect(locateSection(TEN_Q, 'business', '10-Q')).toMatchObject({ status: 'not-found', reason: 'not-applicable', cause: 'unmapped-form' });
    expect(locateSection(TEN_Q, 'critical-audit-matters', '10-Q')).toMatchObject({ reason: 'not-applicable' });
    expect(conceptsForForm('10-Q').map(c => c.key)).not.toContain('cdna');
  });
});

describe('20-F (Spotify): IFRS notes and lettered items', () => {
  it('reads "8. Income tax" style IFRS note numbering', () => {
    expect(found(locateSection(TWENTY_F, 'income-taxes', '20-F')).heading).toBe('8. Income tax');
    expect(found(locateSection(TWENTY_F, 'significant-accounting-policies', '20-F')).heading).toBe('2. Summary of material accounting policies');
    expect(found(locateSection(TWENTY_F, 'use-of-estimates', '20-F')).heading).toBe('3. Critical accounting estimates and judgments');
    expect(found(locateSection(TWENTY_F, 'leases', '20-F')).heading).toBe('10. Leases');
  });

  it('reaches Item 16K Cybersecurity and Item 16C fees through the heading slicer', () => {
    expect(found(locateSection(TWENTY_F, 'cybersecurity', '20-F')).heading).toBe('Item 16K. Cybersecurity');
    expect(found(locateSection(TWENTY_F, 'audit-fees', '20-F')).heading).toBe('Item 16C. Principal Accountant Fees and Services');
  });

  it('keeps item-mapped concepts on their FPI items', () => {
    expect(found(locateSection(TWENTY_F, 'controls', '20-F')).text).toMatch(/^item 15 controls and procedures/);
    expect(found(locateSection(TWENTY_F, 'related-party-transactions', '20-F')).text).toMatch(/^item 7 major shareholders and related party/);
  });

  it('finds the non-IFRS measures section', () => {
    expect(found(locateSection(TWENTY_F, 'non-gaap', '20-F')).heading).toBe('Non-IFRS Financial Measures');
  });
});

describe('S-1 (Reddit): prospectus headings, notes, and the gaps filled', () => {
  it('slices Business by its whole-line heading and stops at MANAGEMENT', () => {
    const business = found(locateSection(S_ONE, 'business', 'S-1'));
    expect(business.heading).toBe('BUSINESS');
    expect(business.rawText).not.toMatch(/\nMANAGEMENT\n/);
  });

  it('reads the audited notes in the prospectus', () => {
    expect(found(locateSection(S_ONE, 'leases', 'S-1')).heading).toBe('7. Operating Leases');
    expect(found(locateSection(S_ONE, 'business-combinations', 'S-1')).heading).toBe('8. Acquisitions');
    expect(found(locateSection(S_ONE, 'stock-compensation', 'S-1')).heading).toBe('14. Stock-Based Compensation');
  });

  it('finds executive compensation tables, and says CD&A is not there (an EGC omits it)', () => {
    expect(found(locateSection(S_ONE, 'summary-compensation-table', 'S-1')).heading).toBe('Summary Compensation Table');
    expect(found(locateSection(S_ONE, 'director-compensation', 'S-1')).heading).toBe('Director Compensation');
    expect(locateSection(S_ONE, 'cdna', 'S-1')).toMatchObject({ status: 'not-found' });
    expect(locateSection(S_ONE, 'critical-audit-matters', 'S-1')).toMatchObject({ status: 'not-found', reason: 'not-disclosed' });
  });

  it('resolves Controls on an S-1 now, instead of refusing it', () => {
    expect(resolveSectionScope('controls', 'S-1')).toMatchObject({ kind: 'block', label: 'Controls and Procedures' });
  });
});

describe('DEF 14A (Apple, Microsoft): the proxy sections', () => {
  const proxyCases: Array<[string, string, string]> = [
    ['aapl', 'cdna', 'Compensation Discussion and Analysis'],
    ['aapl', 'summary-compensation-table', 'Summary Compensation Table—2025, 2024, and 2023'],
    ['aapl', 'pay-versus-performance', 'Pay versus Performance'],
    ['aapl', 'audit-fees', 'Fees Paid to Auditors'],
    ['aapl', 'related-party-transactions', 'Related Party Policy and Transactions'],
    ['aapl', 'board-committees', 'Board and Committee Structure'],
    ['aapl', 'say-on-pay', 'Advisory Vote to Approve Executive Compensation'],
    ['msft', 'cdna', 'Compensation Discussion and Analysis'],
    ['msft', 'summary-compensation-table', 'Summary Compensation Table'],
    ['msft', 'pay-versus-performance', 'Pay Versus Performance'],
    ['msft', 'director-compensation', 'Director Compensation'],
    ['msft', 'audit-fees', 'Audit Fees'],
    ['msft', 'related-party-transactions', 'Certain Relationships and Related Transactions'],
    ['msft', 'board-committees', 'Board Committees'],
  ];
  it.each(proxyCases)('%s: %s under “%s”', (filer, key, heading) => {
    const text = filer === 'aapl' ? PROXY_AAPL : PROXY_MSFT;
    expect(found(locateSection(text, key, 'DEF 14A')).heading).toBe(heading);
  });

  it('reads Microsoft’s say-on-pay proposal from its "Proposal 2:" heading', () => {
    expect(found(locateSection(PROXY_MSFT, 'say-on-pay', 'DEF 14A')).heading).toMatch(/^Proposal 2: Advisory Vote to Approve/);
  });

  it('does not end CD&A at its own "Executive Compensation Policies…" or "Say on Pay" subsections', () => {
    const cdna = found(locateSection(PROXY_AAPL, 'cdna', 'DEF 14A')).rawText!;
    expect(cdna).toContain('Say on Pay Advisory Vote Results');
    expect(cdna).toContain('Executive Compensation Policies and Practices');
  });

  it('ends the audit-fee section at the next proposal', () => {
    const fees = found(locateSection(PROXY_AAPL, 'audit-fees', 'DEF 14A')).rawText!;
    expect(fees).not.toMatch(/Proposal No\. 3/);
  });

  it('offers only proxy concepts on a proxy, and no proxy concepts on an 8-K', () => {
    expect(conceptsForForm('DEF 14A').every(concept => concept.group === 'proxy')).toBe(true);
    expect(conceptsForForm('8-K').map(concept => concept.key)).toEqual(['non-gaap']);
  });
});

describe('not disclosed vs could not extract', () => {
  it('no text is "could not extract", never "not disclosed"', () => {
    expect(locateSection('', 'leases', '10-K')).toMatchObject({ reason: 'could-not-extract', cause: 'no-text' });
    expect(locateSection(null, 'risk-factors', '10-K')).toMatchObject({ reason: 'could-not-extract', cause: 'no-text' });
  });

  it('a document without notes cannot say a note is absent', () => {
    // A 10-K whose financial statements are filed as an exhibit (EX-13).
    const body = 'Item 7. Management’s Discussion and Analysis\nRevenue grew. Income taxes rose.\nItem 8. Financial Statements\nIncorporated by reference to Exhibit 13.';
    expect(locateSection(body, 'income-taxes', '10-K')).toMatchObject({ reason: 'could-not-extract', cause: 'no-notes-region' });
  });

  it('a missing Part II marker is the slicer losing its bearings, not an absent section', () => {
    expect(locateSection('PART I\nItem 1. Financial Statements\nnumbers', 'risk-factors', '10-Q'))
      .toMatchObject({ reason: 'could-not-extract', cause: 'part-missing' });
  });

  it('an unknown scope and an unmapped form are "not applicable"', () => {
    expect(locateSection(TEN_K, 'climate', '10-K')).toMatchObject({ reason: 'not-applicable', cause: 'unknown-scope' });
    expect(locateSection(TEN_K, 'cdna', '10-K')).toMatchObject({ reason: 'not-applicable', cause: 'unmapped-form' });
  });
});

describe('original-case slices (for reading and Word export)', () => {
  it('maps the normalized tokens back to the filing text exactly', () => {
    for (const text of [TEN_K, TEN_Q, TWENTY_F, S_ONE, PROXY_AAPL]) {
      const offsets = normalizedTokenOffsets(text);
      expect(offsets).not.toBeNull();
      expect(offsets!.normalized).toBe(normalizeForMatch(text));
    }
  });

  it('returns the same section in the filing’s own case and punctuation', () => {
    const resolved = resolveSectionScope('risk factors', '10-K')!;
    const original = extractResolvedSectionOriginal(TEN_K, resolved);
    expect(original.startsWith('Item 1A. Risk Factors')).toBe(true);
    // Same boundaries as the normalized slice the matcher uses.
    expect(normalizeForMatch(original)).toBe(extractResolvedSection(TEN_K, resolved));
  });

  it('works for prospectus-heading and part-scoped item slices too', () => {
    const s1 = resolveSectionScope('legal proceedings', 'S-1')!;
    expect(normalizeForMatch(extractResolvedSectionOriginal(S_ONE, s1))).toBe(extractResolvedSection(S_ONE, s1));
    const q = resolveSectionScope('mdna', '10-Q')!;
    const mdna = extractResolvedSectionOriginal(TEN_Q, q);
    expect(mdna).toContain('MANAGEMENT’S DISCUSSION AND ANALYSIS');
    expect(normalizeForMatch(mdna)).toBe(extractResolvedSection(TEN_Q, q));
  });

  it('is empty when the section is not found', () => {
    expect(extractResolvedSectionOriginal(TEN_K, resolveSectionScope('non-gaap', '10-K')!)).toBe('');
  });
});
