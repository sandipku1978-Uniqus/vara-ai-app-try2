import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCitation,
  citationId,
  clearMemoTray,
  formatCitationsText,
  formatMemoMarkdown,
  getMemoCitations,
  isCited,
  removeCitation,
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
});
