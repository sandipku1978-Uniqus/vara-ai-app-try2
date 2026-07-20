import { describe, expect, it } from 'vitest';
import {
  matchesDocumentTypePrefixes,
  partitionParentAndExhibitForms,
} from '../services/filingResearch';
import { EARNINGS_SCOPE_DESCRIPTION, EARNINGS_SCOPE_LABEL, EARNINGS_SCOPE_LIMITATION } from '../config/earnings';

describe('specialist exhibit and earnings document contracts', () => {
  const filingFixture = {
    formType: '8-K',
    documentType: 'EX-99.1',
  };

  it('labels the earnings surface as an EX-99.1 document corpus, not all 8-K events', () => {
    expect(EARNINGS_SCOPE_LABEL).toBe('Earnings Release Exhibits');
    expect(EARNINGS_SCOPE_DESCRIPTION).toContain('EX-99.1');
    expect(EARNINGS_SCOPE_LIMITATION).toContain('does not cover every material event');
  });

  it('matches the actual exhibit document type instead of the parent filing form', () => {
    expect(matchesDocumentTypePrefixes(filingFixture.documentType, ['EX-99.1'])).toBe(true);
    expect(matchesDocumentTypePrefixes(filingFixture.formType, ['EX-99.1'])).toBe(false);
  });

  it('treats an exhibit family selection as a prefix with a segment boundary', () => {
    expect(matchesDocumentTypePrefixes('EX-10.17', ['EX-10'])).toBe(true);
    expect(matchesDocumentTypePrefixes('EX-101', ['EX-10'])).toBe(false);
    expect(matchesDocumentTypePrefixes('EX-2.1', ['EX-2.1'])).toBe(true);
  });

  it('separates earnings exhibit filters from parent EDGAR form filters', () => {
    expect(partitionParentAndExhibitForms(['6-K', 'EX-99.1'], ['8-K', '8-K/A', '6-K'])).toEqual({
      parentForms: ['6-K'],
      exhibitTypes: ['EX-99.1'],
    });
    expect(partitionParentAndExhibitForms(['EX-99.1'], ['8-K', '8-K/A', '6-K'])).toEqual({
      parentForms: ['8-K', '8-K/A', '6-K'],
      exhibitTypes: ['EX-99.1'],
    });
  });
});
