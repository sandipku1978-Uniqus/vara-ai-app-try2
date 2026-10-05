import { describe, it, expect } from 'vitest';
import { deriveSectionPath, extractItemSection, itemSectionRange } from '../utils/sectionPath';
import { locateHeadingBlock, type BlockSpec } from '../utils/sectionBlocks';
import { normalizedTokenOffsets, originalSpan } from '../utils/normalizedOffsets';

/**
 * The slicer rules the section taxonomy depends on, each pinned with the
 * shape of the real filing that broke it.
 */

describe('Item slicer: cross-references that carry the title', () => {
  // Apple's 10-K Item 1A ends with this exact sentence; read as a heading it
  // cut Risk Factors to one paragraph.
  const APPLE_SHAPE = [
    'Item 1A. Risk Factors',
    'Supply chain concentration is a risk.',
    'This section should be read in conjunction with Part II, Item 7, “Management’s Discussion and Analysis of Financial Condition and Results of Operations” and the notes.',
    'Currency movements are a further risk.',
    'Item 1B. Unresolved Staff Comments',
    'None.',
    'Item 7. Management’s Discussion and Analysis of Financial Condition and Results of Operations',
    'Revenue grew.',
  ].join('\n');

  it('skips "with Part II, Item 7, “…”" and "Part I, Item 1A of this Form 10-K"', () => {
    const slice = extractItemSection(APPLE_SHAPE, '1a');
    expect(slice).toContain('currency movements are a further risk');
    expect(slice).not.toContain('unresolved staff comments');
    const withOf = 'Item 1. Business\nSee the discussion in Part I, Item 1A of this Form 10-K under the heading.\nWe sell widgets.\nItem 2. Properties\nOffices.';
    expect(extractItemSection(withOf, '1')).toContain('we sell widgets');
  });

  it('keeps breadcrumbs honest with the same rule', () => {
    const text = `${APPLE_SHAPE}\nItem 9A. Controls and Procedures\nThe controls were effective.`;
    expect(deriveSectionPath(text, 'currency movements are a further risk')).toBe('Item 1A · Risk Factors');
  });
});

describe('Item slicer: running part headers', () => {
  // Microsoft's 10-Q prints "PART I / Item 2" at the top of every MD&A page
  // and cites "(Part II, Item 1A of this Form 10-Q)" mid-MD&A.
  const MSFT_SHAPE = [
    'PART I Item 1. Financial Statements 3 Item 2. MD&A 30 PART II Item 1A. Risk Factors 49',
    'PART I',
    'Item 1',
    'ITEM 1. FINANCIAL STATEMENTS',
    'Balance sheets.',
    'PART I',
    'Item 2',
    'ITEM 2. MANAGEMENT’S DISCUSSION AND ANALYSIS',
    'Revenue grew, as discussed in Risk Factors (Part II, Item 1A of this Form 10-Q).',
    'PART I',
    'Item 2',
    'Operating income increased.',
    'PART II',
    'Item 1A',
    'ITEM 1A. RISK FACTORS',
    'Competition is intense.',
    'PART II',
    'Item 1A',
    'Cyberattacks could harm us.',
    'PART II',
    'Item 6',
    'ITEM 6. EXHIBITS',
  ].join('\n');

  it('finds the part body as the longest run of its markers, not the last marker', () => {
    const mdna = extractItemSection(MSFT_SHAPE, '2', { part: 1 });
    expect(mdna).toContain('revenue grew');
    expect(mdna).toContain('operating income increased');
    const risk = extractItemSection(MSFT_SHAPE, '1a', { part: 2 });
    expect(risk).toContain('competition is intense');
    expect(risk).toContain('cyberattacks could harm us');
  });

  it('exposes the slice as offsets into the normalized text', () => {
    const range = itemSectionRange(MSFT_SHAPE, '1a', { part: 2 })!;
    expect(range.normalizedText.slice(range.start, range.end)).toBe(extractItemSection(MSFT_SHAPE, '1a', { part: 2 }));
  });
});

describe('heading-block slicer', () => {
  const NOTES: BlockSpec = {
    headings: ['leases', 'operating leases'],
    boundaries: ['income taxes', 'revenue'],
    region: 'notes',
    confirmTerms: ['lease liability', 'right-of-use asset', 'operating lease'],
  };

  const FILING = [
    'TABLE OF CONTENTS',
    'Leases 45',
    'Item 7. Management’s Discussion and Analysis',
    'Leases',
    'MD&A commentary on store leases and occupancy cost.',
    'Item 8. Financial Statements and Supplementary Data',
    'Notes to Consolidated Financial Statements',
    'Note 1 – Summary of Significant Accounting Policies',
    'Leases',
    'The Company recognizes a right-of-use asset and an operating lease liability for each lease.',
    'Income Taxes',
    'Deferred taxes are provided on temporary differences.',
    'Note 2 – Revenue',
    'Revenue is recognized when control transfers.',
    'Note 3 – Leases',
    'The Company leases retail stores. Lease liability maturities follow.',
    'Income Taxes',
    'Lease payments are deductible.',
    'Note 3 – Leases (continued)',
    'Variable lease costs were immaterial.',
    'Note 4 – Income Taxes',
    'The effective tax rate was 16%.',
    'Report of Independent Registered Public Accounting Firm',
    'Item 9A. Controls and Procedures',
  ].join('\n');

  it('prefers the numbered note, runs through its own subheadings and "(continued)" headers, ends at the next note', () => {
    const result = locateHeadingBlock(FILING, NOTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slice = FILING.slice(result.match.start, result.match.end);
    expect(result.match.heading).toBe('Note 3 – Leases');
    expect(slice).toContain('Lease payments are deductible.');
    expect(slice).toContain('Variable lease costs were immaterial.');
    expect(slice).not.toContain('effective tax rate');
  });

  it('never starts at a table-of-contents entry or outside the notes', () => {
    const noNumberedNote = FILING.replace(/Note 3 – Leases( \(continued\))?/g, 'Note X');
    const result = locateHeadingBlock(noNumberedNote, NOTES);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The policy subheading in Note 1, ended by the next policy heading —
    // not the TOC line, not the MD&A subheading.
    const slice = noNumberedNote.slice(result.match.start, result.match.end);
    expect(slice).toContain('right-of-use asset');
    expect(slice).not.toContain('Deferred taxes');
    expect(slice).not.toContain('MD&A commentary');
  });

  it('rejects a weak heading whose body does not use the topic’s vocabulary', () => {
    const tableOnly = [
      'Notes to Consolidated Financial Statements',
      'Note 1 – Segment Information',
      'Leases',
      'Americas 1,200 1,100',
      'Note 2 – Debt',
      'Term debt.',
    ].join('\n');
    expect(locateHeadingBlock(tableOnly, NOTES)).toEqual({ ok: false, cause: 'mentioned-without-heading' });
  });

  it('says why when nothing is found', () => {
    expect(locateHeadingBlock('Item 1. Business\nWe sell widgets.', NOTES)).toEqual({ ok: false, cause: 'no-notes-region' });
    const notesWithoutLeases = 'Notes to Financial Statements\nNote 1 – Revenue\nRevenue is recognized.';
    expect(locateHeadingBlock(notesWithoutLeases, NOTES)).toEqual({ ok: false, cause: 'heading-absent' });
  });

  it('ignores running page headers as boundaries', () => {
    const spec: BlockSpec = { headings: ['compensation discussion and analysis'], boundaries: ['executive compensation$', 'summary compensation table'] };
    const pages = Array.from({ length: 5 }, (_, page) => `Executive Compensation\nPage ${page} of the CD&A explains pay decisions.`).join('\n');
    const proxy = `Compensation Discussion and Analysis\n${pages}\nSummary Compensation Table\nSalary 1,000`;
    const result = locateHeadingBlock(proxy, spec);
    expect(result.ok && proxy.slice(result.match.start, result.match.end)).toContain('Page 4 of the CD&A');
  });

  it('treats a "$" alias as exact-only', () => {
    const spec: BlockSpec = { headings: ['business'], boundaries: ['management$'] };
    const prospectus = 'BUSINESS\nWe run a platform.\nManagement Team\nOur founders lead.\nMANAGEMENT\nDirectors follow.';
    const result = locateHeadingBlock(prospectus, spec);
    const slice = result.ok ? prospectus.slice(result.match.start, result.match.end) : '';
    expect(slice).toContain('Our founders lead.');
    expect(slice).not.toContain('Directors follow.');
  });

  it('ends a proxy section at the next proposal, even a bare "Proposal No. 3" line', () => {
    const spec: BlockSpec = { headings: ['fees paid to auditors'], boundaries: [] };
    const proxy = 'Fees Paid to Auditors\nAudit fees were $10 million.\nProposal No. 3\nAdvisory Vote to Approve Executive Compensation';
    const result = locateHeadingBlock(proxy, spec);
    expect(result.ok && proxy.slice(result.match.start, result.match.end)).not.toContain('Advisory Vote');
  });

  it('caps a runaway slice and says so', () => {
    const spec: BlockSpec = { headings: ['human capital'], boundaries: [], maxChars: 100 };
    const text = `Human Capital\n${'We employ people. '.repeat(20)}`;
    const result = locateHeadingBlock(text, spec);
    expect(result.ok && result.match.truncated).toBe(true);
  });
});

describe('normalized offsets', () => {
  it('maps U.S., thousands separators and curly quotes back to the original span', () => {
    const text = 'The U.S. segment earned $1,234.5 million — “Item 1A.” Risk Factors follow.';
    const offsets = normalizedTokenOffsets(text)!;
    expect(offsets.normalized).toBe('the us segment earned $1234.5 million item 1a risk factors follow');
    const start = offsets.normalized.indexOf('us segment');
    const span = originalSpan(offsets, start, start + 'us segment earned $1234.5'.length)!;
    expect(text.slice(span.start, span.end)).toBe('U.S. segment earned $1,234.5');
  });
});
