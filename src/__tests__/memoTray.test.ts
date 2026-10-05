import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCitation,
  boundExcerpt,
  buildRedlineExcerpt,
  citationId,
  clearMemoTray,
  describeCitation,
  formatCitationsText,
  formatMemoMarkdown,
  getMemoCitations,
  isCited,
  passageKey,
  releaseReference,
  removeCitation,
  upgradeLegacyCitation,
  updateCitationNote,
} from '../services/memoTray';

const ORGANON = {
  kind: 'filing' as const,
  cik: '1821825',
  accessionNumber: '0001193125-26-307767',
  company: 'Organon & Co.',
  form: '10-K/A',
  fileDate: '2025-11-10',
  excerpt: 'restatement of previously issued financial statements',
  sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1821825/000119312526307767/d88294d8k.htm',
};

describe('memo tray citation ledger', () => {
  beforeEach(() => {
    clearMemoTray();
  });

  it('adds a citation once and reports cited state', () => {
    addCitation(ORGANON);
    addCitation(ORGANON); // second cite of the same filing is a no-op
    expect(getMemoCitations()).toHaveLength(1);
    expect(isCited(ORGANON.cik, ORGANON.accessionNumber)).toBe(true);
    expect(getMemoCitations()[0].id).toBe(citationId(ORGANON.cik, ORGANON.accessionNumber));
  });

  it('updates notes and removes citations', () => {
    addCitation(ORGANON);
    const id = citationId(ORGANON.cik, ORGANON.accessionNumber);
    updateCitationNote(id, 'restatement scope — check auditor consent');
    expect(getMemoCitations()[0].note).toContain('auditor consent');
    removeCitation(id);
    expect(getMemoCitations()).toHaveLength(0);
    expect(isCited(ORGANON.cik, ORGANON.accessionNumber)).toBe(false);
  });

  it('formats numbered citations with accession and source', () => {
    addCitation(ORGANON);
    const text = formatCitationsText(getMemoCitations());
    expect(text).toMatch(/^\[1\] Organon & Co\. — Form 10-K\/A, filed 2025-11-10/);
    expect(text).toContain('0001193125-26-307767');
    expect(text).toContain('https://www.sec.gov/');
  });

  it('cites an AAER by its release number, the SEC and its date, never as a filing', () => {
    const release = {
      kind: 'release' as const,
      cik: 'SEC',
      accessionNumber: 'AAER-4604',
      company: 'In the Matter of Example Corp.',
      form: 'AAER',
      fileDate: '2026-09-30',
      excerpt: 'AAER-4604 (2026-09-30): In the Matter of Example Corp.',
      sourceUrl: 'https://www.sec.gov/enforcement-litigation/administrative-proceedings/34-100000',
    };
    addCitation(release);
    expect(releaseReference(release)).toBe('AAER-4604, SEC, 2026-09-30');
    expect(describeCitation(release)).toBe('AAER-4604, SEC, 2026-09-30 — In the Matter of Example Corp.');
    expect(formatCitationsText(getMemoCitations())).toBe(
      '[1] AAER-4604, SEC, 2026-09-30 — In the Matter of Example Corp. https://www.sec.gov/enforcement-litigation/administrative-proceedings/34-100000'
    );
    const markdown = formatMemoMarkdown(getMemoCitations());
    expect(markdown).toContain('## [1] AAER-4604, SEC, 2026-09-30 — In the Matter of Example Corp.');
    expect(markdown).not.toContain('Form AAER');
  });

  it('upgrades only legacy AAER "letters", leaving real comment letters alone', () => {
    const base = { id: 'x', note: '', addedAt: '2026-01-01T00:00:00.000Z', company: 'c', form: 'AAER', fileDate: '2026-01-01', excerpt: '', sourceUrl: 'https://www.sec.gov/' };
    expect(upgradeLegacyCitation({ ...base, kind: 'letter', cik: 'SEC', accessionNumber: 'AAER-1' }).kind).toBe('release');
    expect(upgradeLegacyCitation({ ...base, kind: 'letter', cik: '320193', accessionNumber: '0000320193-26-000001', form: 'UPLOAD' }).kind).toBe('letter');
  });

  it('markdown export carries excerpt, note, and citation list', () => {
    addCitation(ORGANON);
    updateCitationNote(citationId(ORGANON.cik, ORGANON.accessionNumber), 'follow up');
    const markdown = formatMemoMarkdown(getMemoCitations());
    expect(markdown).toContain('## [1] Organon & Co. — Form 10-K/A (2025-11-10)');
    expect(markdown).toContain('> restatement of previously issued');
    expect(markdown).toContain('Note: follow up');
    expect(markdown).toContain('[1] Organon & Co.');
  });
});

describe('citation scopes: sections, passages, and redlines', () => {
  const SECTION = 'Item 1A. Risk Factors';
  const QUOTE_A = 'The company records a contingent liability when loss is probable and estimable.';
  const QUOTE_B = 'Deferred revenue is recognized when control transfers to the customer.';
  const PRIOR = { form: '10-K', fileDate: '2024-11-08', accessionNumber: '0001193125-24-000001' };

  beforeEach(() => {
    clearMemoTray();
  });

  it('fingerprints a passage independent of whitespace and distinctly from other passages', () => {
    expect(passageKey(QUOTE_A)).toBe(passageKey(`  The company   records a contingent liability\nwhen loss is probable and estimable. `));
    expect(passageKey(QUOTE_A)).not.toBe(passageKey(QUOTE_B));
    expect(passageKey(QUOTE_A)).not.toBe(passageKey(`${QUOTE_A} `.repeat(2)));
    expect(citationId('1', '2', 'S', 'k')).toBe('1:2#S~k');
    expect(citationId('1', '2', 'S')).toBe('1:2#S');
    expect(citationId('1', '2')).toBe('1:2');
  });

  it('keeps the section and each quoted passage of that section as separate citations', () => {
    addCitation({ ...ORGANON, section: SECTION, excerpt: '' });
    addCitation({ ...ORGANON, section: SECTION, excerpt: QUOTE_A, passageKey: passageKey(QUOTE_A) });
    addCitation({ ...ORGANON, section: SECTION, excerpt: QUOTE_B, passageKey: passageKey(QUOTE_B) });
    addCitation({ ...ORGANON, section: SECTION, excerpt: QUOTE_B, passageKey: passageKey(QUOTE_B) }); // same passage twice: no-op
    expect(getMemoCitations()).toHaveLength(3);
    expect(isCited(ORGANON.cik, ORGANON.accessionNumber, SECTION)).toBe(true);
    expect(isCited(ORGANON.cik, ORGANON.accessionNumber, SECTION, passageKey(QUOTE_B))).toBe(true);
    expect(isCited(ORGANON.cik, ORGANON.accessionNumber, SECTION, passageKey('a passage never cited'))).toBe(false);
    removeCitation(citationId(ORGANON.cik, ORGANON.accessionNumber, SECTION, passageKey(QUOTE_A)));
    expect(getMemoCitations().map(item => item.excerpt)).toEqual(['', QUOTE_B]);
  });

  it('describes a citation by issuer, form, date, and section for accessible names', () => {
    expect(describeCitation(ORGANON)).toBe('Organon & Co. 10-K/A filed 2025-11-10');
    expect(describeCitation({ ...ORGANON, section: SECTION })).toBe(`Organon & Co. 10-K/A filed 2025-11-10, ${SECTION}`);
    expect(describeCitation({ company: '', form: '', fileDate: '' })).toBe('this filing');
  });

  it('quotes both filings in a redline excerpt and states an absent side instead of leaving it blank', () => {
    expect(buildRedlineExcerpt({ previous: 'Old  wording here.', current: 'New wording here.' }, PRIOR)).toBe(
      'Prior filing (Form 10-K, filed 2024-11-08, accession 0001193125-24-000001): “Old wording here.”\n' +
      'Current filing: “New wording here.”'
    );
    expect(buildRedlineExcerpt({ previous: '', current: 'Only now.' }, PRIOR)).toContain(
      'accession 0001193125-24-000001): no matching disclosure block.'
    );
    expect(buildRedlineExcerpt({ previous: 'Only before.', current: '' }, PRIOR)).toContain('Current filing: no matching disclosure block.');
    expect(buildRedlineExcerpt({ previous: 'word '.repeat(400), current: '' }, PRIOR)).toContain('[…truncated to 1500 characters]');
  });

  it('bounds long excerpts explicitly and keeps paragraph breaks', () => {
    expect(boundExcerpt('a  b \n\n\n c\td')).toBe('a b\nc d');
    expect(boundExcerpt('x'.repeat(20), 10)).toBe('xxxxxxxxxx […truncated to 10 characters]');
    expect(boundExcerpt('short enough', 20)).toBe('short enough');
  });

  it('carries the section and the compared filing into text and markdown exports', () => {
    addCitation({
      ...ORGANON,
      section: 'Redline vs 10-K filed 2024-11-08 — modified block 1',
      excerpt: 'Prior filing (…): “old”\nCurrent filing: “new”',
      passageKey: 'k1',
      comparedTo: { ...PRIOR, sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1821825/000119312524000001/prior.htm' },
    });
    expect(formatCitationsText(getMemoCitations())).toBe(
      '[1] Organon & Co. — Form 10-K/A, filed 2025-11-10, Redline vs 10-K filed 2024-11-08 — modified block 1 ' +
      '(accession 0001193125-26-307767), compared with Form 10-K filed 2024-11-08 (accession 0001193125-24-000001). ' +
      'https://www.sec.gov/Archives/edgar/data/1821825/000119312526307767/d88294d8k.htm | ' +
      'prior: https://www.sec.gov/Archives/edgar/data/1821825/000119312524000001/prior.htm'
    );
    const markdown = formatMemoMarkdown(getMemoCitations());
    expect(markdown).toContain('## [1] Organon & Co. — Form 10-K/A (2025-11-10) — Redline vs 10-K filed 2024-11-08 — modified block 1');
    expect(markdown).toContain(
      'Compared with: Form 10-K filed 2024-11-08 (accession 0001193125-24-000001) — https://www.sec.gov/Archives/edgar/data/1821825/000119312524000001/prior.htm'
    );
    expect(markdown).toContain('> Prior filing (…): “old”\n> Current filing: “new”');
  });
});

describe('memo draft persistence', () => {
  it('stores the draft with its citation ids and clears cleanly', async () => {
    const { setMemoDraft, getMemoDraft, clearMemoDraft } = await import('../services/memoTray');
    setMemoDraft('# Research memo — test', ['1821825:0001193125-26-307767']);
    const record = getMemoDraft();
    expect(record?.text).toContain('Research memo');
    expect(record?.citationIds).toEqual(['1821825:0001193125-26-307767']);
    expect(record?.generatedAt).toBeTruthy();
    clearMemoDraft();
    expect(getMemoDraft()).toBeNull();
  });

  it('keeps the model, provider and effort the draft call reported', async () => {
    const { setMemoDraft, getMemoDraft, clearMemoDraft } = await import('../services/memoTray');
    const aiMetadata = {
      requestedModel: 'anthropic/claude-opus-5.5', requestedEffort: 'medium' as const, model: 'anthropic/claude-opus-5.5',
      provider: 'anthropic', reasoningEffort: 'medium' as const, webSources: [], usage: { input: 900, output: 410 },
    };
    setMemoDraft('# Research memo — test', ['a'], aiMetadata);
    expect(getMemoDraft()?.aiMetadata).toEqual(aiMetadata);
    setMemoDraft('# Research memo — unreported', ['a'], null);
    expect(getMemoDraft()).not.toHaveProperty('aiMetadata');
    clearMemoDraft();
  });
});
