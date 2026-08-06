/**
 * P1 normalizer — inline XBRL reading, section segmentation, the exhibit index
 * and the signature page.
 *
 * The normalizer is where most of the engineering risk sits: rules are cheap
 * once the CanonicalFilingModel is right, and every rule is wrong when it is
 * not. These tests pin the behaviours the rest of the engine assumes.
 */

import { describe, expect, it } from 'vitest';

import { parseInlineXbrl, parseNumericLiteral, stripTags } from '../lib/filing-ai/ixbrl';
import {
  exhibitNumberFromType,
  exhibitsFromFilingIndex,
  extractPrintedExhibitIndex,
  extractSections,
  extractSignatures,
  normalize,
} from '../lib/filing-ai/normalize';
import {
  FIXTURE_ACCESSION,
  FIXTURE_CIK,
  FIXTURE_PERIOD,
  primaryDocumentHtml,
  submissionDocuments,
} from './fixtures/filing-ai-10k';
import type { EntityReference, SubmissionHeader } from '../lib/filing-ai/types';

const entity: EntityReference = {
  cik: FIXTURE_CIK,
  legal_name: 'Meridian Industries, Inc.',
  fiscal_year_end: '1231',
  filer_status: 'large_accelerated',
  is_src: false,
  is_shell: null,
  state_of_incorporation: 'DE',
  ein: '841234567',
  sic: '3559',
  sic_description: 'Special industry machinery',
  tickers: ['MRDN'],
  exchanges: ['NYSE'],
  file_number: '001-38856',
  entity_type: 'operating',
};

function submission(documents = submissionDocuments()): SubmissionHeader {
  return {
    form_type: '10-K',
    period_of_report: FIXTURE_PERIOD,
    filer_cik: FIXTURE_CIK,
    file_number: '001-38856',
    accession: FIXTURE_ACCESSION,
    filing_date: '2026-02-20',
    is_xbrl: true,
    is_inline_xbrl: true,
    document_names: documents.map(document => document.name),
    documents,
  };
}

export function buildFixtureModel(options: Parameters<typeof primaryDocumentHtml>[0] = {}) {
  const html = primaryDocumentHtml(options);
  const documents = submissionDocuments(options);
  return normalize({
    runId: 'run_fixture',
    primary: {
      name: 'mrdn-20251231.htm',
      url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000011/mrdn-20251231.htm',
      html,
      bytes: html.length,
      sha256: 'fixture',
    },
    filingIndex: { accession: FIXTURE_ACCESSION, accessionCompact: '000123456726000011', documents },
    submission: submission(documents),
    entity,
  });
}

describe('inline XBRL literals', () => {
  it.each([
    ['1,234', 1234],
    ['(500)', -500],
    ['—', 0],
    ['0.005', 0.005],
    ['$1,000.50', 1000.5],
  ])('parses %s', (literal, expected) => {
    expect(parseNumericLiteral(literal)).toBe(expected);
  });

  it('returns undefined for a literal it cannot read, rather than inventing a value', () => {
    expect(parseNumericLiteral('see note 4')).toBeUndefined();
    expect(parseNumericLiteral('')).toBeUndefined();
  });

  it('honours the fixed-zero format', () => {
    expect(parseNumericLiteral('nil', 'ixt:fixed-zero')).toBe(0);
  });

  it('strips markup and entities from a tagged value', () => {
    expect(stripTags('<span>1,<b>234</b></span>&nbsp;')).toBe('1,234');
  });
});

describe('inline XBRL instance', () => {
  const instance = parseInlineXbrl(primaryDocumentHtml());

  it('reads facts, contexts and units', () => {
    expect(instance.hasInlineXbrl).toBe(true);
    expect(instance.facts.length).toBeGreaterThan(20);
    expect(instance.contexts.size).toBe(3);
    expect(instance.units.has('usd')).toBe(true);
  });

  it('applies scale and sign to numeric facts', () => {
    const assets = instance.facts.find(fact => fact.name === 'Assets' && fact.context_ref === 'c-instant');
    expect(assets?.value).toBe(5_200_000);
  });

  it('separates dimensional facts from consolidated ones', () => {
    // A segment's assets are not the registrant's assets. Rules that mix them
    // flag every filing they see.
    expect(instance.contexts.get('c-instant')?.dimensions).toEqual([]);
    expect(instance.contexts.get('c-segment')?.dimensions).toEqual([
      { dimension: 'us-gaap:StatementBusinessSegmentsAxis', member: 'mrd:IndustrialMember' },
    ]);
  });

  it('records a character range for every fact so a preparer can find it', () => {
    for (const fact of instance.facts) {
      expect(fact.char_end).toBeGreaterThan(fact.char_start);
    }
  });

  it('reports no inline XBRL when the document has none', () => {
    expect(parseInlineXbrl('<html><body><p>Total assets 5,200</p></body></html>').hasInlineXbrl).toBe(false);
  });
});

describe('section segmentation', () => {
  it('picks the body of an item over its table-of-contents entry', () => {
    const text = [
      'TABLE OF CONTENTS',
      'Item 1. Business ....... 3',
      'Item 1A. Risk Factors ....... 9',
      'Item 1. Business',
      'We manufacture precision components and operate twelve facilities worldwide.',
      'Item 1A. Risk Factors',
      'Demand in our end markets is cyclical.',
    ].join('\n');
    const { sections } = extractSections(text);
    const business = sections.find(section => section.item_ref === '1');
    expect(business?.text).toContain('precision components');
    expect(business?.text).not.toContain('....... 3');
  });

  it('records a parse limitation when it finds nothing to segment', () => {
    const { sections, unparsed } = extractSections('No headings here at all.');
    expect(sections).toEqual([]);
    expect(unparsed[0]).toMatch(/could not be located/i);
  });
});

describe('exhibits', () => {
  it.each([
    ['EX-31.1', '31.1'],
    ['EX-101.INS', '101'],
    ['EX-19', '19'],
    ['10-K', null],
    ['GRAPHIC', null],
  ])('maps document type %s to exhibit %s', (type, expected) => {
    expect(exhibitNumberFromType(type)).toBe(expected);
  });

  it('treats the EDGAR manifest as the authoritative attached set', () => {
    const exhibits = exhibitsFromFilingIndex(submissionDocuments());
    expect(exhibits.every(exhibit => exhibit.attached)).toBe(true);
    expect(exhibits.map(exhibit => exhibit.number)).toContain('31.1');
    // EX-32 is furnished, not filed.
    expect(exhibits.find(exhibit => exhibit.number === '32.1')?.filed_or_furnished).toBe('furnished');
    expect(exhibits.find(exhibit => exhibit.number === '31.1')?.filed_or_furnished).toBe('filed');
  });

  it('reads the printed index and flags rows carried by reference', () => {
    const { rows, located } = extractPrintedExhibitIndex(
      [
        'Item 15. Exhibits',
        'EXHIBIT INDEX',
        '3.1 Restated certificate of incorporation (incorporated by reference to the Form 8-K filed May 4, 2021)',
        '31.1 Certification of the principal executive officer',
      ].join('\n'),
    );
    expect(located).toBe(true);
    expect(rows.find(row => row.number === '3.1')?.incorporated_by_reference).toBe(true);
    expect(rows.find(row => row.number === '31.1')?.incorporated_by_reference).toBe(false);
  });

  it('reports the index as not located rather than as empty', () => {
    // An empty result would be read downstream as "the index is clean".
    expect(extractPrintedExhibitIndex('A filing with no exhibit index at all.').located).toBe(false);
  });
});

describe('signatures', () => {
  it('reads names, titles and dates from conformed blocks', () => {
    const { signatures, regionFound } = extractSignatures(
      [
        'SIGNATURES',
        '/s/ Dana Whitfield',
        'Chief Executive Officer',
        'February 20, 2026',
        '/s/ Priya Raman',
        'Chief Financial Officer',
        'February 20, 2026',
      ].join('\n'),
    );
    expect(regionFound).toBe(true);
    expect(signatures).toHaveLength(2);
    expect(signatures[0].name).toBe('Dana Whitfield');
    expect(signatures[0].title).toBe('Chief Executive Officer');
    expect(signatures[0].date).toBe('February 20, 2026');
  });

  it('reports the region as absent rather than returning an empty page', () => {
    expect(extractSignatures('No signature heading anywhere.').regionFound).toBe(false);
  });
});

describe('canonical filing model', () => {
  const { cfm } = buildFixtureModel();

  it('assembles sections, facts, exhibits, cover tags and signatures', () => {
    expect(cfm.sections.map(section => section.item_ref)).toEqual(
      expect.arrayContaining(['1', '1A', '1C', '3', '5', '7', '7A', '8', '9A', '9B', '10', '15']),
    );
    expect(cfm.dei_tags.DocumentType).toBe('10-K');
    expect(cfm.dei_tags.EntityRegistrantName).toBe('Meridian Industries, Inc.');
    expect(cfm.exhibits.some(exhibit => exhibit.number === '31.1' && exhibit.attached)).toBe(true);
    expect(cfm.signatures.length).toBeGreaterThanOrEqual(5);
    expect(cfm.facts.length).toBeGreaterThan(20);
  });

  it('carries the printed index row for an exhibit incorporated by reference', () => {
    const articles = cfm.exhibits.find(exhibit => exhibit.number === '3.1');
    expect(articles?.attached).toBe(false);
    expect(articles?.resolved).toBe(true);
  });

  it('records a parse limitation when the document carries no inline XBRL', () => {
    const { cfm: stripped } = buildFixtureModel({ stripInlineXbrl: true });
    expect(stripped.unparsed_regions.join(' ')).toMatch(/inline XBRL/i);
  });
});
