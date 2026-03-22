import { describe, it, expect } from 'vitest';
import { parseSearchHit } from '../hooks/useEdgarSearch';
import type { EdgarSearchHit } from '../services/secApi';

describe('useEdgarSearch', () => {
  describe('parseSearchHit', () => {
    const makeHit = (overrides: Partial<EdgarSearchHit> = {}): EdgarSearchHit => ({
      _id: '0000320193-23-000106:aapl-20230930.htm',
      _score: 1,
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
      },
      ...overrides,
    });

    it('extracts entity name from display_names', () => {
      const result = parseSearchHit(makeHit());
      expect(result.entityName).toBe('Apple Inc');
    });

    it('strips CIK from entity name', () => {
      const result = parseSearchHit(makeHit());
      expect(result.entityName).not.toContain('CIK');
    });

    it('extracts file date', () => {
      const result = parseSearchHit(makeHit());
      expect(result.fileDate).toBe('2023-11-02');
    });

    it('extracts form type', () => {
      const result = parseSearchHit(makeHit());
      expect(result.formType).toBe('10-K');
    });

    it('extracts accession number', () => {
      const result = parseSearchHit(makeHit());
      expect(result.accessionNumber).toBe('0000320193-23-000106');
    });

    it('extracts CIK and strips leading zeros', () => {
      const result = parseSearchHit(makeHit());
      expect(result.cik).toBe('320193');
    });

    it('extracts primary document from _id', () => {
      const result = parseSearchHit(makeHit());
      expect(result.primaryDocument).toBe('aapl-20230930.htm');
    });

    it('extracts description', () => {
      const result = parseSearchHit(makeHit());
      expect(result.description).toBe('Annual Report');
    });

    it('handles missing display_names', () => {
      const hit = makeHit();
      hit._source.display_names = undefined;
      const result = parseSearchHit(hit);
      expect(result.entityName).toBe('Apple Inc');
    });

    it('handles missing entity_name', () => {
      const hit = makeHit();
      hit._source.display_names = undefined;
      hit._source.entity_name = undefined;
      const result = parseSearchHit(hit);
      expect(result.entityName).toBe('');
    });

    it('handles _id without colon separator', () => {
      const hit = makeHit({ _id: 'simple-id' });
      const result = parseSearchHit(hit);
      expect(result.primaryDocument).toBe('');
    });

    it('extracts document type from file_type', () => {
      const hit = makeHit();
      hit._source.file_type = 'CORRESP';
      hit._source.form = '10-K';
      const result = parseSearchHit(hit);
      expect(result.documentType).toBe('CORRESP');
    });

    it('falls back to form for missing file_type', () => {
      const hit = makeHit();
      hit._source.file_type = undefined;
      const result = parseSearchHit(hit);
      expect(result.documentType).toBe('10-K');
    });

    it('handles empty CIK array', () => {
      const hit = makeHit();
      hit._source.ciks = [];
      const result = parseSearchHit(hit);
      expect(result.cik).toBe('');
    });

    it('handles missing adsh', () => {
      const hit = makeHit();
      hit._source.adsh = undefined;
      const result = parseSearchHit(hit);
      expect(result.accessionNumber).toBe('');
    });

    it('handles missing file_date', () => {
      const hit = makeHit();
      hit._source.file_date = undefined;
      const result = parseSearchHit(hit);
      expect(result.fileDate).toBe('');
    });

    it('handles missing file_description', () => {
      const hit = makeHit();
      hit._source.file_description = undefined;
      const result = parseSearchHit(hit);
      expect(result.description).toBeTruthy(); // Falls back to documentType
    });

    it('uses root_forms when form is missing', () => {
      const hit = makeHit();
      hit._source.form = undefined;
      const result = parseSearchHit(hit);
      expect(result.formType).toBe('10-K');
    });
  });
});
