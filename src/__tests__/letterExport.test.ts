import { describe, expect, it } from 'vitest';
import { Packer } from 'docx';
import { buildEpisodeIssues } from '../services/commentIssues';
import {
  buildEpisodeDocx,
  buildSearchResultsDocx,
  episodeBlocks,
  episodeCsv,
  exportFilename,
  searchBlocks,
  searchResultsCsv,
  secLetterIndexUrl,
  type EpisodeExportInput,
  type SearchExportInput,
} from '../services/letterExport';
import { EPISODES, loadEpisode } from './fixtures/letters/loadEpisode';

function appleInput(): EpisodeExportInput {
  const letters = loadEpisode('apple-10k-fy2023');
  return {
    threadId: '320193:review-abc',
    company: 'Apple Inc.',
    cik: 320193,
    letters: EPISODES['apple-10k-fy2023'].letters.map(letter => ({
      accession: letter.accession,
      cik: 320193,
      company_name: 'Apple Inc.',
      form: letter.form,
      date_filed: letter.date_filed,
      has_text: true,
    })),
    episode: buildEpisodeIssues(letters),
    generatedAt: '2026-10-04T12:00:00.000Z',
  };
}

function searchInput(overrides: Partial<SearchExportInput> = {}): SearchExportInput {
  return {
    query: 'segment reporting',
    ordering: 'relevance',
    filters: ['Filed on or after 2024-01-01.'],
    total: 10_000,
    totalIsFloor: true,
    matches: [{
      accession: '0000000000-24-002512',
      cik: 320193,
      company_name: 'Apple Inc.',
      form: 'UPLOAD',
      date_filed: '2024-03-06',
      thread_id: '320193:review-abc',
      headline: 'disclosures pursuant to <b>ASC</b> 280-10-50-40',
    }],
    generatedAt: '2026-10-04T12:00:00.000Z',
    poolDepth: 1000,
    ...overrides,
  };
}

describe('episode export', () => {
  it('lists every letter and every issue with its response, status basis and SEC links', () => {
    const csv = episodeCsv(appleInput());
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('SEC comment-letter review,Apple Inc.');
    expect(csv).toContain('Letters');
    expect(csv).toContain(`2024-03-06,SEC Staff letter,0000000000-24-002512,yes,${secLetterIndexUrl(320193, '0000000000-24-002512')}`);
    expect(csv).toContain('Round,Comment,Staff letter filed');
    // Four comments across two rounds; the completion letter carries none.
    const issueRows = lines.filter(line => /^[12],[12],/.test(line));
    expect(issueRows).toHaveLength(4);
    expect(csv).toContain('Resolved');
    expect(csv).toContain('The Company respectfully advises the Staff');
    expect(csv).toContain('0000320193-24-000042');
  });

  it('says so when the issue split was unavailable rather than exporting an empty issue list as fact', () => {
    const input = { ...appleInput(), episode: null, issuesNote: 'The issue split could not be loaded (502).' };
    expect(episodeCsv(input)).toContain('The issue split could not be loaded (502).');
    expect(episodeCsv(input)).not.toContain('Round,Comment');
    const blocks = episodeBlocks(input);
    expect(blocks.at(-1)).toEqual({ kind: 'paragraph', text: 'The issue split could not be loaded (502).' });
  });

  it('builds a Word document', async () => {
    const buffer = await Packer.toBuffer(buildEpisodeDocx(appleInput()));
    expect(buffer.length).toBeGreaterThan(2_000);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const blocks = episodeBlocks(appleInput());
    expect(blocks[0]).toEqual({ kind: 'title', text: 'SEC comment-letter review: Apple Inc.' });
    expect(blocks.some(block => block.kind === 'heading' && block.text.startsWith('Round 3 · Staff letter 2024-05-16 · review complete'))).toBe(true);
    expect(blocks.some(block => block.kind === 'meta' && block.label === 'Coverage' && block.text.includes('4 of 4 comments paired'))).toBe(true);
  });
});

describe('search result export', () => {
  it('states the rows are the loaded page of a floor total, with ordering and filters', () => {
    const csv = searchResultsCsv(searchInput());
    expect(csv).toContain('Query,segment reporting');
    expect(csv).toContain('Relevance within the 1000 most recent matches');
    expect(csv).toContain('Filter,Filed on or after 2024-01-01.');
    expect(csv).toContain('1 of 10,000+ matching letters (rows loaded on screen; not the full result set)');
    expect(csv).toContain('disclosures pursuant to ASC 280-10-50-40');
    expect(csv).not.toContain('<b>');
  });

  it('labels a filter-only export and a complete one honestly', () => {
    const blocks = searchBlocks(searchInput({ query: '', ordering: 'newest', total: 1, totalIsFloor: false }));
    expect(blocks).toContainEqual({ kind: 'meta', label: 'Query', text: '(no text — filters only)' });
    expect(blocks).toContainEqual({ kind: 'meta', label: 'Order', text: 'Newest first' });
    expect(blocks).toContainEqual({ kind: 'meta', label: 'Rows', text: '1 of 1 matching letters.' });
  });

  it('neutralises spreadsheet formulas in exported cells', () => {
    const csv = searchResultsCsv(searchInput({ query: '=HYPERLINK("http://x")' }));
    expect(csv).toContain(`Query,"'=HYPERLINK(""http://x"")"`);
  });

  it('builds a Word document and a safe filename', async () => {
    const buffer = await Packer.toBuffer(buildSearchResultsDocx(searchInput()));
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    expect(exportFilename('comment letters: "segment"/ASC 280', 'csv', new Date('2026-10-04T00:00:00Z')))
      .toBe('URC_comment_letters_segment_ASC_280_2026-10-04.csv');
  });
});
