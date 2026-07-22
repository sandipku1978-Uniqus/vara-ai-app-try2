/**
 * Boolean search — 20-scenario acceptance suite.
 *
 * Exercises the full Boolean/proximity engine that powers the Research
 * Workbench: parsing, text evaluation against realistic SEC filing snippets,
 * candidate-query generation, the inline auditor: field, and the malformed-query
 * diagnostics. Each numbered scenario is an independent acceptance case; the
 * afterAll prints a pass matrix so the run reads as a report.
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  parseBooleanQuery,
  booleanQueryMatches,
  extractBooleanMatchSnippet,
  buildBooleanCandidateQueries,
  describeBooleanQueryIssue,
  extractAuditorFilterToken,
  looksLikeBooleanQuery,
} from '../utils/booleanSearch';
import { canonicalizeAuditorInput, matchesAuditorSelection } from '../services/auditors';

// ── Realistic filing-text fixtures ──────────────────────────────────────────
const DOC_MW_KPMG =
  'We identified a material weakness in our internal control over financial reporting. ' +
  'KPMG LLP, our independent registered public accounting firm, expressed an adverse opinion.';
const DOC_LEASE =
  'The Company adopted ASC 842 and recognized right-of-use assets. A lease modification ' +
  'occurred during fiscal 2026, accounted for as a separate contract.';
const DOC_REV =
  'Revenue recognition follows ASC 606. The company reported strong revenue growth and ' +
  'no material weakness in its controls.';
const DOC_GOODWILL =
  'We recorded a goodwill impairment charge and a restructuring charge during the year. ' +
  'Deloitte & Touche LLP served as the Company’s auditor.';
const DOC_ASC_MOD =
  'ASC 842 modification guidance applies to every lease we hold in the portfolio.';
const DOC_PROX =
  'The audit committee met with the auditor. The material weakness was remediated within ninety days.';

const passed: string[] = [];
const record = (title: string) => passed.push(title);

afterAll(() => {
  console.log(
    `\n===== Boolean search acceptance matrix =====\n` +
      passed.map(t => `  ✓ ${t}`).join('\n') +
      `\n  ${passed.length}/20 scenarios passed\n`
  );
});

describe('Boolean search — 20 scenarios', () => {
  it('01 · single term — matches only where present', () => {
    expect(booleanQueryMatches('revenue', DOC_REV)).toBe(true);
    expect(booleanQueryMatches('revenue', DOC_LEASE)).toBe(false);
    record('01 single term');
  });

  it('02 · implicit AND — both terms present', () => {
    expect(parseBooleanQuery('material weakness').expression?.type).toBe('AND');
    expect(booleanQueryMatches('material weakness', DOC_MW_KPMG)).toBe(true);
    record('02 implicit AND (present)');
  });

  it('03 · implicit AND — one term missing rejects', () => {
    expect(booleanQueryMatches('material weakness', DOC_LEASE)).toBe(false);
    record('03 implicit AND (missing)');
  });

  it('04 · explicit AND — both vs one', () => {
    expect(booleanQueryMatches('lease AND modification', DOC_LEASE)).toBe(true);
    expect(booleanQueryMatches('lease AND goodwill', DOC_LEASE)).toBe(false);
    record('04 explicit AND');
  });

  it('05 · OR — matches when either side present', () => {
    expect(booleanQueryMatches('impairment OR restructuring', DOC_GOODWILL)).toBe(true);
    expect(booleanQueryMatches('impairment OR restructuring', DOC_REV)).toBe(false);
    record('05 OR (either side)');
  });

  it('06 · OR — rejects when neither side present', () => {
    expect(booleanQueryMatches('impairment OR restructuring', DOC_LEASE)).toBe(false);
    record('06 OR (neither)');
  });

  it('07 · NOT — excluded term absent → match', () => {
    expect(booleanQueryMatches('lease NOT goodwill', DOC_LEASE)).toBe(true);
    record('07 NOT (absent)');
  });

  it('08 · NOT — excluded term present → reject', () => {
    expect(booleanQueryMatches('lease NOT modification', DOC_LEASE)).toBe(false);
    record('08 NOT (present)');
  });

  it('09 · exact phrase — matches contiguous words', () => {
    expect(booleanQueryMatches('"material weakness"', DOC_MW_KPMG)).toBe(true);
    record('09 phrase (match)');
  });

  it('10 · exact phrase — word order enforced', () => {
    expect(booleanQueryMatches('"weakness material"', DOC_MW_KPMG)).toBe(false);
    record('10 phrase (order enforced)');
  });

  it('11 · proximity w/N — within distance', () => {
    expect(parseBooleanQuery('material w/3 weakness').expression?.type).toBe('PROX');
    expect(booleanQueryMatches('material w/3 weakness', DOC_MW_KPMG)).toBe(true);
    record('11 proximity within');
  });

  it('12 · proximity w/N — beyond distance rejects', () => {
    expect(booleanQueryMatches('material w/1 remediated', DOC_PROX)).toBe(false);
    // ...but a wider window over the same text matches
    expect(booleanQueryMatches('material w/3 remediated', DOC_PROX)).toBe(true);
    record('12 proximity beyond');
  });

  it('13 · near/N alias', () => {
    expect(booleanQueryMatches('goodwill near/3 impairment', DOC_GOODWILL)).toBe(true);
    record('13 near/N alias');
  });

  it('14 · within/N alias', () => {
    expect(booleanQueryMatches('revenue within/2 recognition', DOC_REV)).toBe(true);
    record('14 within/N alias');
  });

  it('15 · proximity with a trailing term → (a w/n b) AND c', () => {
    const parsed = parseBooleanQuery('lease w/5 modification separate');
    expect(parsed.expression?.type).toBe('AND');
    expect(parsed.expression && 'left' in parsed.expression && parsed.expression.left.type).toBe('PROX');
    expect(booleanQueryMatches('lease w/5 modification separate', DOC_LEASE)).toBe(true);
    record('15 proximity + trailing AND');
  });

  it('16 · proximity leading terms are NOT forced into a phrase (regression)', () => {
    // "lease" and "modification" never appear adjacently here; modification sits
    // next to ASC. Old greedy-merge required the phrase "lease modification".
    expect(booleanQueryMatches('lease modification w/5 asc', DOC_ASC_MOD)).toBe(true);
    record('16 proximity leading (no forced phrase)');
  });

  it('17 · grouping — (A OR B) AND C', () => {
    expect(booleanQueryMatches('(revenue OR income) AND recognition', DOC_REV)).toBe(true);
    expect(booleanQueryMatches('(revenue OR income) AND zebra', DOC_REV)).toBe(false);
    record('17 grouped (A OR B) AND C');
  });

  it('18 · precedence — A OR B AND C parses as A OR (B AND C)', () => {
    expect(parseBooleanQuery('goodwill OR lease AND zebra').expression?.type).toBe('OR');
    // OR left side satisfied on its own, even though "lease AND zebra" fails
    expect(booleanQueryMatches('goodwill OR lease AND zebra', DOC_GOODWILL)).toBe(true);
    record('18 precedence AND-before-OR');
  });

  it('19 · case-insensitive + stemming', () => {
    expect(booleanQueryMatches('MATERIAL weaknesses', DOC_MW_KPMG)).toBe(true);
    expect(booleanQueryMatches('recognized', DOC_LEASE)).toBe(true); // "recognized"
    record('19 case + stemming');
  });

  it('20 · inline auditor field — extraction + authoritative match semantics', () => {
    const { auditor, residual } = extractAuditorFilterToken('"material weakness" AND auditor:KPMG');
    expect(auditor).toBe('KPMG');
    expect(residual).toBe('"material weakness"');
    expect(looksLikeBooleanQuery('auditor:KPMG')).toBe(true);
    // Authoritative auditor-of-record decision (Form AP wins; a different firm drops)
    expect(canonicalizeAuditorInput('KPMG LLP')).toBe('KPMG');
    expect(matchesAuditorSelection('KPMG', 'KPMG')).toBe(true);
    expect(matchesAuditorSelection('EisnerAmper LLP', 'KPMG')).toBe(false);
    record('20 auditor field + authoritative match');
  });
});

// ── Supporting guarantees the 20 scenarios rely on ──────────────────────────
describe('Boolean search — diagnostics & candidate hygiene', () => {
  it('flags malformed queries instead of running them silently', () => {
    expect(describeBooleanQueryIssue('lease AND')).toMatch(/operator/i);
    expect(describeBooleanQueryIssue('(revenue AND growth')).toMatch(/parenthes/i);
    expect(describeBooleanQueryIssue('NOT goodwill')).toMatch(/negated/i);
    expect(describeBooleanQueryIssue('revenue AND (lease OR sublease)')).toBeNull();
    expect(describeBooleanQueryIssue('auditor:KPMG')).toBeNull();
  });

  it('produces an OR-union candidate and no junk stems', () => {
    const orCands = buildBooleanCandidateQueries('impairment OR restructuring');
    expect(orCands.some(c => c.includes(' OR '))).toBe(true);
    const cands = buildBooleanCandidateQueries('lease modification').join(' ');
    expect(cands).not.toMatch(/modific(ed|ing|s)?\b/);
  });

  it('reports a proximity distance in the match snippet', () => {
    const snippet = extractBooleanMatchSnippet('material w/3 weakness', DOC_MW_KPMG);
    expect(snippet).not.toBeNull();
    expect(snippet!.distance).toBeTypeOf('number');
  });
});
