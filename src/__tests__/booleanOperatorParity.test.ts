import { describe, it, expect } from 'vitest';
import {
  booleanQueryMatches,
  compileBooleanQuery,
  looksLikeBooleanQuery,
  planBooleanBranches,
} from '../utils/booleanSearch';

/**
 * Benchmark P1-B1/B2: ordered proximity (P/n, PRE/n) and single-word
 * wildcards (* any run, ? exactly one character). Wildcards validate against
 * filing text but can never anchor EDGAR retrieval — EFTS has no wildcard
 * support — so the planner excludes them and a wildcard-only query is
 * rejected with guidance rather than run as a silent miss.
 */

const TEXT =
  'The convertible senior notes were issued in March. Senior notes convertible into common stock were separately registered. ' +
  'The cryptocurrency segment reported cryptographic key custody revenue. Three women serve on the board; each woman chairs a committee.';

describe('P/n ordered proximity', () => {
  it('matches only when the first operand precedes the second', () => {
    expect(booleanQueryMatches('convertible P/3 notes', TEXT)).toBe(true);
    // "registered P/3 convertible" — registered never precedes convertible
    // within 3 words anywhere in TEXT.
    expect(booleanQueryMatches('registered P/3 convertible', TEXT)).toBe(false);
  });

  it('is stricter than W/n on the same text', () => {
    const reversedOnly = 'notes convertible into stock';
    expect(booleanQueryMatches('convertible W/2 notes', reversedOnly)).toBe(true);
    expect(booleanQueryMatches('convertible P/2 notes', reversedOnly)).toBe(false);
  });

  it('enforces the distance (n = intervening words, same as W/n)', () => {
    // "unsecured subordinated" = two intervening words.
    expect(booleanQueryMatches('convertible P/1 notes', 'convertible unsecured subordinated notes')).toBe(false);
    expect(booleanQueryMatches('convertible P/2 notes', 'convertible unsecured subordinated notes')).toBe(true);
  });

  it('accepts PRE/n as an alias and lowercase forms', () => {
    expect(booleanQueryMatches('convertible PRE/3 notes', TEXT)).toBe(true);
    expect(booleanQueryMatches('convertible p/3 notes', TEXT)).toBe(true);
  });
});

describe('wildcard terms', () => {
  it('* spans any run of characters within one word', () => {
    expect(booleanQueryMatches('crypto* AND revenue', TEXT)).toBe(true);
    expect(booleanQueryMatches('cryptog* AND revenue', TEXT)).toBe(true);
    expect(booleanQueryMatches('cryptox* AND revenue', TEXT)).toBe(false);
  });

  it('? matches exactly one character', () => {
    expect(booleanQueryMatches('wom?n AND board', TEXT)).toBe(true); // woman and women
    expect(booleanQueryMatches('wom??n AND board', TEXT)).toBe(false);
  });

  it('patterns are anchored to whole tokens — no substring bleed', () => {
    expect(booleanQueryMatches('risk* AND senior', 'the senior brisk walker')).toBe(false);
  });

  it('never anchors retrieval; the concrete companion term does', () => {
    expect(planBooleanBranches('crypto* AND blockchain').branches).toEqual(['blockchain']);
    const compiled = compileBooleanQuery('crypto* AND blockchain');
    expect(compiled.ok).toBe(true);
    if (compiled.ok) expect(compiled.branches).toEqual(['blockchain']);
  });

  it('rejects a wildcard-only query with guidance instead of a silent miss', () => {
    const compiled = compileBooleanQuery('crypto*');
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.code).toBe('wildcard-only');
      expect(compiled.message).toContain('combine with a concrete term');
    }
  });

  it('rejects a pattern with fewer than two literal characters', () => {
    const compiled = compileBooleanQuery('a* AND lease');
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) expect(compiled.message).toContain('at least two literal characters');
  });

  it('composes with proximity', () => {
    expect(booleanQueryMatches('crypto* W/4 custody', TEXT)).toBe(true);
    expect(booleanQueryMatches('crypto* P/2 segment', TEXT)).toBe(true);
    // No crypto* token appears AFTER "custody" anywhere in TEXT, so the
    // ordered form must fail even though the unordered form succeeds.
    expect(booleanQueryMatches('custody W/4 crypto*', TEXT)).toBe(true);
    expect(booleanQueryMatches('custody P/4 crypto*', TEXT)).toBe(false);
  });
});

describe('mode auto-switch signals', () => {
  it('treats P/n and word-wildcards as high-confidence Boolean signals', () => {
    expect(looksLikeBooleanQuery('convertible p/3 notes')).toBe(true);
    expect(looksLikeBooleanQuery('crypto* custody')).toBe(true);
    expect(looksLikeBooleanQuery('wom?n directors')).toBe(true);
  });

  it('never flips mode on a sentence-ending question mark', () => {
    expect(looksLikeBooleanQuery('what changed in segment reporting?')).toBe(false);
  });
});
