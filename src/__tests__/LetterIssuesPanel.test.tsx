import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LetterIssuesPanel from '../components/research/LetterIssuesPanel';
import { buildEpisodeIssues } from '../services/commentIssues';
import { EPISODES, loadEpisode } from './fixtures/letters/loadEpisode';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const letters = EPISODES['apple-10k-fy2023'].letters.map(letter => ({
  accession: letter.accession,
  cik: 320193,
  company_name: 'Apple Inc.',
  form: letter.form,
  date_filed: letter.date_filed,
  has_text: true,
}));

describe('LetterIssuesPanel', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/letters/issues?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ episode: buildEpisodeIssues(loadEpisode('apple-10k-fy2023')), generatedAt: '2026-10-04T00:00:00.000Z' }),
        };
      }
      if (url.startsWith('/api/letters?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            total: 42,
            totalIsFloor: false,
            matches: [
              { accession: '0000000000-24-002512', cik: 320193, company_name: 'Apple Inc.', date_filed: '2024-03-06', thread_id: 't-self', headline: 'self' },
              { accession: '0000000000-23-000001', cik: 789019, company_name: 'Other Co', date_filed: '2023-05-01', thread_id: '789019:t', headline: 'similar <b>Item 303(b)</b> comment' },
            ],
          }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  });

  it('loads only when opened, then lists comments by round with status, response and cite control', async () => {
    render(<LetterIssuesPanel threadId="320193:review" company="Apple Inc." letters={letters} />);
    expect(mockFetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Comments and responses/ }));
    expect(await screen.findByText(/Round 1 · Staff letter 2024-03-06 · 2 comments/)).toBeInTheDocument();
    expect(screen.getByText(/Round 3 · Staff letter 2024-05-16 · review complete/)).toBeInTheDocument();
    expect(screen.getByText(/4 of 4 comments paired with a response/)).toBeInTheDocument();

    const round1 = screen.getByRole('region', { name: 'Staff letter of 2024-03-06' });
    const comment1 = within(round1).getByRole('button', { name: /Comment 1/ });
    expect(comment1).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(comment1);
    expect(comment1).toHaveAttribute('aria-expanded', 'true');
    expect(within(round1).getByText(/^You disclose that services net sales increased/)).toBeInTheDocument();
    expect(within(round1).getByText(/^The Company respectfully advises the Staff that, when preparing/)).toBeInTheDocument();
    expect(within(round1).getByText(/states the review is complete/)).toBeInTheDocument();
    expect(within(round1).getByRole('button', { name: /Cite Apple Inc\. CORRESP filed 2024-03-20, Response to SEC comment 1/ })).toBeEnabled();

    fireEvent.click(within(round1).getByRole('button', { name: 'Similar comments' }));
    expect(await within(round1).findByText('Other Co')).toBeInTheDocument();
    expect(within(round1).getByText(/a keyword match, not a semantic one/)).toBeInTheDocument();
    // The comment's own letter is not offered as similar to itself.
    expect(within(round1).queryByText('self')).not.toBeInTheDocument();
    const searchUrl = String(mockFetch.mock.calls.find(([url]) => String(url).startsWith('/api/letters?'))?.[0]);
    expect(new URL(searchUrl, 'http://localhost').searchParams.get('form')).toBe('UPLOAD');
  });

  it('reports a failed split without claiming the episode has no issues', async () => {
    mockFetch.mockImplementation(async () => ({ ok: false, status: 502, json: async () => ({ error: 'Issue split failed' }) }));
    render(<LetterIssuesPanel threadId="320193:review" company="Apple Inc." letters={letters} />);
    fireEvent.click(screen.getByRole('button', { name: /Comments and responses/ }));
    expect(await screen.findByText(/Issue split failed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
