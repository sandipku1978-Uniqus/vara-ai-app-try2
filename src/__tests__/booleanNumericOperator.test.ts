import { describe, it, expect } from 'vitest';
import {
  booleanQueryMatches,
  buildBooleanCandidateQueries,
  compileBooleanQuery,
  extractBooleanMatchSnippet,
  looksLikeBooleanQuery,
  planBooleanBranches,
} from '../utils/booleanSearch';

/**
 * The # numeric operators (benchmark P0-A3): # matches any number, $# (£# ¥#
 * €#) a currency amount, %# a percentage. Composed with W/n they answer the
 * "quantified disclosure" query class — "goodwill impairment" W/10 $# is every
 * filing that puts a dollar figure beside the phrase.
 */

const QUANTIFIED =
  'During the year the company recorded a goodwill impairment charge of $206.6 million related to the reporting unit.';
const UNQUANTIFIED =
  'Management concluded there was no goodwill impairment for any reporting unit in the current period.';
const PERCENT_TEXT =
  'The effective tax rate was 21.3% for the year, compared with the statutory rate.';

describe('# numeric operators', () => {
  it('matches a currency amount near the phrase, and rejects the unquantified filing', () => {
    expect(booleanQueryMatches('"goodwill impairment" W/10 $#', QUANTIFIED)).toBe(true);
    expect(booleanQueryMatches('"goodwill impairment" W/10 $#', UNQUANTIFIED)).toBe(false);
  });

  it('matches percentages with %# and any number with #', () => {
    expect(booleanQueryMatches('"effective tax rate" W/5 %#', PERCENT_TEXT)).toBe(true);
    expect(booleanQueryMatches('"effective tax rate" W/5 $#', PERCENT_TEXT)).toBe(false);
    expect(booleanQueryMatches('"goodwill impairment" W/10 #', QUANTIFIED)).toBe(true);
  });

  it('does not mistake plain numbers for currency', () => {
    expect(booleanQueryMatches('"reporting unit" W/10 $#', UNQUANTIFIED)).toBe(false);
    // Years are numbers: bare # near a phrase can hit them; $# must not.
    expect(booleanQueryMatches('statutory W/8 $#', PERCENT_TEXT)).toBe(false);
  });

  it('survives thousands separators and decimals as single values', () => {
    const text = 'an impairment of $1,234.5 million was recognised';
    expect(booleanQueryMatches('impairment W/4 $#', text)).toBe(true);
  });

  it('produces a proximity snippet containing the matched amount', () => {
    const snippet = extractBooleanMatchSnippet('"goodwill impairment" W/10 $#', QUANTIFIED);
    expect(snippet?.excerpt).toContain('$206.6');
    expect(snippet?.distance).not.toBeNull();
  });

  it('anchors retrieval on the phrase, never on the numeric operand', () => {
    const phraseRecallLane = '((goodwill OR goodwills) AND (impairment OR impairments))';
    const compiled = compileBooleanQuery('"goodwill impairment" W/10 $#');
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.branches).toEqual([phraseRecallLane]);
    expect(planBooleanBranches('"goodwill impairment" W/10 $#').branches).toEqual([phraseRecallLane]);
    expect(buildBooleanCandidateQueries('"goodwill impairment" W/10 $#').every(q => !q.includes('#'))).toBe(true);
  });

  it('rejects a numeric-only query with a specific message instead of the NOT-only copy', () => {
    const compiled = compileBooleanQuery('$#');
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.code).toBe('numeric-only');
      expect(compiled.message).toContain('anchor it to a term or phrase');
    }
  });

  it('is a high-confidence Boolean mode signal', () => {
    expect(looksLikeBooleanQuery('"goodwill impairment" w/10 $#')).toBe(true);
    expect(looksLikeBooleanQuery('impairment %#')).toBe(true);
    // A # attached to a word is not the operator (e.g. "item #4" prose).
    expect(looksLikeBooleanQuery('note #4 impairment')).toBe(false);
  });
});

describe('number-aware tokenization stays symmetric', () => {
  it('keeps matching decorated numbers with undecorated query terms', () => {
    // Before v3, "$206.6" split at the symbols; a query for 206.6 matched via
    // the fragments. Decoration-stripped comparison preserves that behaviour.
    expect(booleanQueryMatches('206.6', QUANTIFIED)).toBe(true);
    expect(booleanQueryMatches('21.3', PERCENT_TEXT)).toBe(true);
  });

  it('still treats symbols as boundaries outside numbers', () => {
    expect(booleanQueryMatches('"US GAAP"', 'prepared under U.S. GAAP for the year')).toBe(true);
    expect(booleanQueryMatches('"net income"', 'the planet income statement')).toBe(false);
  });

  it('equates thousands-separated and plain forms', () => {
    expect(booleanQueryMatches('1234.5', 'an impairment of $1,234.5 million')).toBe(true);
  });
});
