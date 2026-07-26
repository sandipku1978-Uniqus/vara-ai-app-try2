import { describe, it, expect } from 'vitest';
import {
  buildReferenceSearchTerms,
  parseAccountingReference,
  referenceBooleanExpression,
  textCitesReference,
} from '../utils/accountingReference';

/**
 * Benchmark P1-B4: "find every filing citing ASC 842 / ASU 2023-07". The
 * filter's value is normalization — filings cite the same standard in several
 * house styles, and a filter that only matched one spelling would silently
 * under-report.
 */

describe('parseAccountingReference', () => {
  it('canonicalizes ASC spellings', () => {
    for (const input of ['ASC 842', 'asc 842', 'asc842'.replace('asc', 'asc '), 'Topic 842', '842', 'ASC 842-10', 'ASC Topic 842']) {
      expect(parseAccountingReference(input), input).toEqual({ kind: 'asc', identifier: '842', label: 'ASC 842' });
    }
  });

  it('canonicalizes ASU spellings and pads the update number', () => {
    for (const input of ['ASU 2023-07', 'asu no. 2023-07', '2023-07', 'Accounting Standards Update 2023-07']) {
      expect(parseAccountingReference(input), input).toEqual({ kind: 'asu', identifier: '2023-07', label: 'ASU 2023-07' });
    }
    expect(parseAccountingReference('ASU 2016-2')).toEqual({ kind: 'asu', identifier: '2016-02', label: 'ASU 2016-02' });
  });

  it('rejects input that is not a standard reference', () => {
    for (const input of ['', 'lease', '84', '8422', 'IFRS 16', 'ASC', '20-23']) {
      expect(parseAccountingReference(input), input).toBeNull();
    }
  });
});

describe('citation matching across house styles', () => {
  const ASC_842 = parseAccountingReference('ASC 842')!;
  const ASU_2023_07 = parseAccountingReference('ASU 2023-07')!;

  it('accepts every common ASC citation form', () => {
    for (const text of [
      'adopted ASC 842, Leases, effective January 1',
      'under ASC Topic 842 the company recognises right-of-use assets',
      'the guidance in Topic 842 requires lessees to record',
      'in accordance with ASC 842-10-25 the lease was classified',
    ]) {
      expect(textCitesReference(ASC_842, text), text).toBe(true);
    }
  });

  it('accepts every common ASU citation form', () => {
    for (const text of [
      'early adopted ASU 2023-07, Segment Reporting',
      'ASU No. 2023-07 expands reportable segment disclosures',
      'Accounting Standards Update No. 2023-07 is effective for fiscal years',
    ]) {
      expect(textCitesReference(ASU_2023_07, text), text).toBe(true);
    }
  });

  it('never matches a different topic or a bare number in prose', () => {
    expect(textCitesReference(ASC_842, 'adopted ASC 606 for revenue recognition')).toBe(false);
    expect(textCitesReference(ASC_842, 'the company leased 842 vehicles during the year')).toBe(false);
    expect(textCitesReference(ASU_2023_07, 'ASU 2023-09 improves income tax disclosures')).toBe(false);
  });

  it('exposes quoted retrieval terms and a runnable Boolean expression', () => {
    expect(buildReferenceSearchTerms(ASC_842)).toEqual(['"ASC 842"', '"ASC Topic 842"', '"Topic 842"']);
    expect(referenceBooleanExpression(ASU_2023_07)).toContain('"ASU No. 2023-07"');
    expect(textCitesReference(ASU_2023_07, 'the FASB issued ASU Topic 2023-07, Segment Reporting')).toBe(true);
  });
});
