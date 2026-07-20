import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('../components/tables/AskCopilotButton', () => ({ default: () => <button type="button">Ask Copilot</button> }));

import { ThreadConversation } from '../views/CommentLetters';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('comment-letter AI summary consent', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('checks cached state with GET and only POSTs after an explicit click, with retry on failure', async () => {
    let generationAttempts = 0;
    mockFetch.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/letters/summary?')) {
        if (init?.method !== 'POST') {
          return { ok: false, status: 404, json: async () => ({ error: 'No current summary' }) };
        }
        generationAttempts += 1;
        if (generationAttempts === 1) {
          return { ok: false, status: 502, json: async () => ({ error: 'Upstream timeout' }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            summary: 'Issues raised: revenue recognition',
            model: 'test-model',
            generatedAt: '2026-07-19T00:00:00.000Z',
            coverage: {
              totalLetters: 1, lettersWithText: 1, lettersRepresented: 1,
              truncatedLetters: 0, missingTextLetters: 0, omittedLetters: 0,
              method: 'Chronological full-thread synthesis',
            },
          }),
        };
      }
      if (url.includes('/api/letters?thread=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            letters: [{
              accession: 'letter-1', cik: 1, company_name: 'Example Corp', form: 'UPLOAD',
              date_filed: '2026-01-01', filename: 'edgar/data/1/letter.txt', has_text: true,
              preview: 'Staff asked about revenue recognition.',
            }],
          }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ThreadConversation threadId="thread-1" />);

    const generate = await screen.findByRole('button', { name: 'Generate AI summary' });
    expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);

    fireEvent.click(generate);
    expect(await screen.findByRole('alert')).toHaveTextContent('Upstream timeout');
    expect(generationAttempts).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry AI summary' }));
    expect(await screen.findByText('Issues raised: revenue recognition')).toBeInTheDocument();
    expect(screen.getByText(/1\/1 letters represented/)).toHaveTextContent('no letters omitted');
    expect(screen.queryByText(/rounds represented/)).not.toBeInTheDocument();
    await waitFor(() => expect(generationAttempts).toBe(2));
  });
});
