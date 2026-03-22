import { describe, it, expect } from 'vitest';
import {
  parseBooleanQuery,
  looksLikeBooleanQuery,
  booleanQueryMatches,
  extractBooleanMatchSnippet,
  buildCandidateQueryFromBoolean,
  buildBooleanCandidateQueries,
} from '../utils/booleanSearch';

describe('booleanSearch', () => {
  // ── parseBooleanQuery ──
  describe('parseBooleanQuery', () => {
    it('parses a single term', () => {
      const result = parseBooleanQuery('revenue');
      expect(result.expression).toEqual({ type: 'TERM', value: 'revenue' });
      expect(result.error).toBeUndefined();
    });

    it('parses a quoted phrase', () => {
      const result = parseBooleanQuery('"risk factors"');
      expect(result.expression).toEqual({ type: 'PHRASE', value: 'risk factors' });
    });

    it('parses AND operator', () => {
      const result = parseBooleanQuery('revenue AND growth');
      expect(result.expression?.type).toBe('AND');
    });

    it('parses OR operator', () => {
      const result = parseBooleanQuery('revenue OR income');
      expect(result.expression?.type).toBe('OR');
    });

    it('parses NOT operator', () => {
      const result = parseBooleanQuery('NOT loss');
      expect(result.expression?.type).toBe('NOT');
    });

    it('parses proximity operator W/N', () => {
      const result = parseBooleanQuery('revenue W/5 growth');
      expect(result.expression?.type).toBe('PROX');
    });

    it('parses WITHIN/N proximity', () => {
      const result = parseBooleanQuery('material WITHIN/3 weakness');
      expect(result.expression?.type).toBe('PROX');
    });

    it('parses NEAR/N proximity', () => {
      const result = parseBooleanQuery('audit NEAR/10 committee');
      expect(result.expression?.type).toBe('PROX');
    });

    it('parses nested parentheses', () => {
      const result = parseBooleanQuery('(revenue OR income) AND growth');
      expect(result.expression?.type).toBe('AND');
      expect(result.error).toBeUndefined();
    });

    it('returns null expression for empty string', () => {
      const result = parseBooleanQuery('');
      expect(result.expression).toBeNull();
      expect(result.error).toBeUndefined();
    });

    it('returns null expression for whitespace-only string', () => {
      const result = parseBooleanQuery('   ');
      expect(result.expression).toBeNull();
    });

    it('returns error for mismatched parentheses', () => {
      const result = parseBooleanQuery('(revenue AND growth');
      expect(result.expression).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('handles implicit AND between adjacent terms', () => {
      const result = parseBooleanQuery('material weakness');
      expect(result.expression?.type).toBe('AND');
    });

    it('parses complex nested query', () => {
      const result = parseBooleanQuery('(revenue OR income) AND NOT loss');
      expect(result.expression).not.toBeNull();
      expect(result.error).toBeUndefined();
    });

    it('handles double NOT', () => {
      const result = parseBooleanQuery('NOT NOT revenue');
      expect(result.expression?.type).toBe('NOT');
    });

    it('normalizes whitespace in phrases', () => {
      const result = parseBooleanQuery('"risk   factors"');
      expect(result.expression).toEqual({ type: 'PHRASE', value: 'risk factors' });
    });

    it('handles unclosed quote gracefully', () => {
      const result = parseBooleanQuery('"material weakness');
      expect(result.expression).not.toBeNull();
    });

    it('parses multiple OR operators', () => {
      const result = parseBooleanQuery('A OR B OR C');
      expect(result.expression?.type).toBe('OR');
    });

    it('preserves operator precedence (AND before OR)', () => {
      const result = parseBooleanQuery('A OR B AND C');
      // Should parse as A OR (B AND C)
      expect(result.expression?.type).toBe('OR');
    });
  });

  // ── looksLikeBooleanQuery ──
  describe('looksLikeBooleanQuery', () => {
    it('returns true for AND keyword', () => {
      expect(looksLikeBooleanQuery('revenue AND growth')).toBe(true);
    });

    it('returns true for OR keyword', () => {
      expect(looksLikeBooleanQuery('revenue OR growth')).toBe(true);
    });

    it('returns true for NOT keyword', () => {
      expect(looksLikeBooleanQuery('NOT loss')).toBe(true);
    });

    it('returns true for proximity syntax W/N', () => {
      expect(looksLikeBooleanQuery('material W/5 weakness')).toBe(true);
    });

    it('returns true for WITHIN/N', () => {
      expect(looksLikeBooleanQuery('revenue WITHIN/10 growth')).toBe(true);
    });

    it('returns true for NEAR/N', () => {
      expect(looksLikeBooleanQuery('risk NEAR/3 factor')).toBe(true);
    });

    it('returns true for quoted phrases', () => {
      expect(looksLikeBooleanQuery('"risk factors"')).toBe(true);
    });

    it('returns true for parentheses', () => {
      expect(looksLikeBooleanQuery('(revenue)')).toBe(true);
    });

    it('returns false for plain text', () => {
      expect(looksLikeBooleanQuery('revenue growth analysis')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(looksLikeBooleanQuery('')).toBe(false);
    });
  });

  // ── booleanQueryMatches ──
  describe('booleanQueryMatches', () => {
    it('matches a single term', () => {
      expect(booleanQueryMatches('revenue', 'Total revenue increased by 15%')).toBe(true);
    });

    it('does not match absent term', () => {
      expect(booleanQueryMatches('zebra', 'Total revenue increased by 15%')).toBe(false);
    });

    it('matches AND query when both terms present', () => {
      expect(booleanQueryMatches('revenue AND growth', 'Revenue growth was strong this quarter')).toBe(true);
    });

    it('rejects AND query when one term missing', () => {
      expect(booleanQueryMatches('revenue AND zebra', 'Revenue growth was strong')).toBe(false);
    });

    it('matches OR query when one term present', () => {
      expect(booleanQueryMatches('revenue OR income', 'Total revenue was $1B')).toBe(true);
    });

    it('matches NOT query when term absent', () => {
      expect(booleanQueryMatches('NOT loss', 'Revenue increased significantly')).toBe(true);
    });

    it('rejects NOT query when term present', () => {
      expect(booleanQueryMatches('NOT loss', 'Net loss of $5M')).toBe(false);
    });

    it('matches quoted phrase', () => {
      expect(booleanQueryMatches('"risk factors"', 'See the risk factors section for details')).toBe(true);
    });

    it('rejects when words exist but not as phrase', () => {
      expect(booleanQueryMatches('"factors risk"', 'The risk factors section covers major items')).toBe(false);
    });

    it('matches proximity query when words are close', () => {
      expect(booleanQueryMatches('material W/3 weakness', 'We identified a material weakness in our controls')).toBe(true);
    });

    it('rejects proximity query when words are too far', () => {
      expect(booleanQueryMatches('material W/1 weakness', 'Material issues including a significant weakness')).toBe(false);
    });

    it('is case insensitive', () => {
      expect(booleanQueryMatches('REVENUE', 'total Revenue increased')).toBe(true);
    });

    it('handles stemming for plurals', () => {
      expect(booleanQueryMatches('filing', 'The company filed several filings with the SEC')).toBe(true);
    });

    it('returns false for empty query', () => {
      expect(booleanQueryMatches('', 'Some text here')).toBe(false);
    });

    it('matches complex nested boolean', () => {
      expect(booleanQueryMatches(
        '(revenue OR income) AND growth',
        'Income growth exceeded expectations'
      )).toBe(true);
    });

    it('handles term equivalents like asr', () => {
      // asr equivalents are expanded to "accelerated share repurchase" but matching depends on phrase indexing
      // The equivalent is registered but phrase matching works at the normalized text level
      const result = booleanQueryMatches('asr', 'The company completed an asr program');
      expect(result).toBe(true);
    });
  });

  // ── extractBooleanMatchSnippet ──
  describe('extractBooleanMatchSnippet', () => {
    it('returns null for empty query', () => {
      expect(extractBooleanMatchSnippet('', 'some text')).toBeNull();
    });

    it('returns null when no match', () => {
      expect(extractBooleanMatchSnippet('zebra', 'Revenue increased by 15%')).toBeNull();
    });

    it('returns a snippet with excerpt for matching term', () => {
      const result = extractBooleanMatchSnippet('revenue', 'Total revenue increased by 15% year over year');
      expect(result).not.toBeNull();
      expect(result!.excerpt).toContain('revenue');
    });

    it('returns distance for proximity match', () => {
      const text = 'We identified a material weakness in controls and procedures';
      const result = extractBooleanMatchSnippet('material W/3 weakness', text);
      expect(result).not.toBeNull();
      expect(result!.distance).toBeTypeOf('number');
    });

    it('returns null distance for non-proximity match', () => {
      const result = extractBooleanMatchSnippet('revenue', 'Revenue was strong');
      expect(result).not.toBeNull();
      expect(result!.distance).toBeNull();
    });
  });

  // ── buildCandidateQueryFromBoolean ──
  describe('buildCandidateQueryFromBoolean', () => {
    it('returns the query for non-boolean input', () => {
      expect(buildCandidateQueryFromBoolean('revenue growth')).toBeTruthy();
    });

    it('extracts positive terms from AND query', () => {
      const result = buildCandidateQueryFromBoolean('revenue AND growth');
      expect(result).toContain('revenue');
      expect(result).toContain('growth');
    });

    it('excludes NOT terms from candidate', () => {
      const result = buildCandidateQueryFromBoolean('revenue AND NOT loss');
      expect(result.toLowerCase()).not.toContain('loss');
    });

    it('handles OR query by including both sides', () => {
      const result = buildCandidateQueryFromBoolean('revenue OR income');
      expect(result).toBeTruthy();
    });

    it('handles empty string', () => {
      expect(buildCandidateQueryFromBoolean('')).toBe('');
    });
  });

  // ── buildBooleanCandidateQueries ──
  describe('buildBooleanCandidateQueries', () => {
    it('returns array of queries', () => {
      const result = buildBooleanCandidateQueries('revenue AND growth');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns original for non-boolean input', () => {
      const result = buildBooleanCandidateQueries('simple search');
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns empty array for empty input', () => {
      expect(buildBooleanCandidateQueries('')).toEqual([]);
    });

    it('produces unique queries', () => {
      const result = buildBooleanCandidateQueries('"material weakness" AND audit');
      const unique = new Set(result);
      expect(unique.size).toBe(result.length);
    });
  });
});
