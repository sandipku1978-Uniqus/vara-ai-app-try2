import { beforeEach, describe, expect, it } from 'vitest';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import { canUseInstantElasticsearchSearch, mapSearchHit } from '../services/filingResearch';
import type { EdgarSearchHit } from '../services/secApi';

describe('filingResearch', () => {
  beforeEach(() => {
    (import.meta.env as Record<string, unknown>).VITE_USE_ELASTICSEARCH = 'true';
  });

  describe('canUseInstantElasticsearchSearch', () => {
    it('uses Elasticsearch immediately for semantic searches when section filters are absent', () => {
      expect(
        canUseInstantElasticsearchSearch('temporary equity', { ...defaultSearchFilters }, 'semantic')
      ).toBe(true);
    });

    it('uses Elasticsearch immediately for boolean searches when section filters are absent', () => {
      expect(
        canUseInstantElasticsearchSearch('ASC 842 adoption W/10 lease', { ...defaultSearchFilters }, 'boolean')
      ).toBe(true);
    });

    it('keeps section-keyword searches on the filing-text validation path', () => {
      expect(
        canUseInstantElasticsearchSearch(
          'temporary equity',
          { ...defaultSearchFilters, sectionKeywords: 'balance sheet' },
          'semantic'
        )
      ).toBe(false);
    });
  });

  describe('mapSearchHit', () => {
    const makeHit = (overrides: Partial<EdgarSearchHit> = {}): EdgarSearchHit => ({
      _id: '0000320193:0000320193-23-000106:aapl-20230930.htm',
      _score: 42,
      _source: {
        display_names: ['Apple Inc (CIK 0000320193)'],
        entity_name: 'Apple Inc',
        form: '10-K',
        root_forms: ['10-K'],
        file_type: '10-K',
        file_date: '2023-11-02',
        adsh: '0000320193-23-000106',
        ciks: ['0000320193'],
        file_description: 'Annual Report',
        primary_document: 'aapl-20230930.htm',
        tickers: ['AAPL'],
        sics: ['3571'],
        sic_description: 'Electronic Computers',
        inc_states: ['DE'],
        state_of_incorporation: 'Delaware',
        biz_locations: ['Cupertino, CA'],
        exchange: 'NASDAQ',
        fiscal_year_end: '0930',
        file_num: '001-36743',
        auditor: 'Deloitte',
        accelerated_status: ['Large Accelerated Filer'],
      },
      ...overrides,
    });

    it('maps indexed auditor and filer status metadata from Elasticsearch hits', () => {
      const result = mapSearchHit(makeHit());
      expect(result.auditor).toBe('Deloitte');
      expect(result.acceleratedStatus).toBe('Large Accelerated Filer');
      expect(result.exchange).toBe('NASDAQ');
      expect(result.stateOfIncorporation).toBe('Delaware');
      expect(result.fileNumber).toBe('001-36743');
    });

    it('uses content highlights as the match snippet when Elasticsearch returns them', () => {
      const result = mapSearchHit(makeHit({
        highlight: {
          content: ['... temporary equity was presented outside permanent equity and audited by Deloitte ...'],
        },
      }));

      expect(result.matchReason).toBe('Matched filing text');
      expect(result.matchSnippet).toContain('temporary equity');
      expect(result.matchSnippet).toContain('Deloitte');
    });

    it('falls back to metadata highlights when filing text highlights are absent', () => {
      const result = mapSearchHit(makeHit({
        highlight: {
          file_description: ['Lease adoption disclosure'],
        },
      }));

      expect(result.matchReason).toBe('Matched filing metadata');
      expect(result.matchSnippet).toBe('Lease adoption disclosure');
    });
  });
});
