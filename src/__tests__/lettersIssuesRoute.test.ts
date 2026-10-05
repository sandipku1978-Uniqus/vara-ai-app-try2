import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEpisode } from './fixtures/letters/loadEpisode';
import { computeEpisodeIssues, issueRowsFromEpisode } from '../services/commentLetterIssueStore';

const state = vi.hoisted(() => ({
  letters: [] as Array<Record<string, unknown>>,
  stored: [] as Array<Record<string, unknown>>,
  storedError: null as null | { message: string },
  upserts: [] as unknown[],
  deletes: 0,
  writer: true,
}));

function selectChain(resolve: () => { data: unknown; error: unknown }) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => Promise.resolve(resolve()),
  };
  return chain;
}

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn().mockResolvedValue({
    identity: { userId: 'test-user', orgId: null, cacheScope: 'test-user:personal' },
  }),
}));

vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitResponse: vi.fn(() => Response.json({ error: 'rate limited' }, { status: 429 })),
}));

vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => ({
    from: (table: string) => table === 'urc_comment_letters'
      ? selectChain(() => ({ data: state.letters, error: null }))
      : selectChain(() => ({ data: state.storedError ? null : state.stored, error: state.storedError })),
  }),
  getCacheWriterSupabase: () => state.writer ? {
    from: () => {
      const deleteChain = {
        eq: () => deleteChain,
        not: () => deleteChain,
        then: (resolve: (value: { error: null }) => void) => { state.deletes += 1; resolve({ error: null }); },
      };
      return {
        delete: () => deleteChain,
        upsert: (rows: unknown) => { state.upserts.push(rows); return Promise.resolve({ error: null }); },
      };
    },
  } : null,
}));

import { GET } from '../app/api/letters/issues/route';

const THREAD = '320193:review-apple';

function appleRows() {
  return loadEpisode('apple-10k-fy2023').map(letter => ({
    accession: letter.accession,
    cik: 320193,
    form: letter.form,
    date_filed: letter.date_filed,
    company_name: 'Apple Inc.',
    content: letter.content,
  }));
}

beforeEach(() => {
  state.letters = appleRows();
  state.stored = [];
  state.storedError = null;
  state.upserts = [];
  state.deletes = 0;
  state.writer = true;
});

describe('GET /api/letters/issues', () => {
  it('splits the episode, stores one row per Staff letter, and returns the issues', async () => {
    const response = await GET(new Request(`http://localhost/api/letters/issues?thread=${THREAD}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ thread: THREAD, company: 'Apple Inc.', stored: true });
    expect(body.episode.coverage).toMatchObject({ staffLetters: 3, issues: 4, issuesWithResponse: 4 });
    expect(state.deletes).toBe(1);
    const rows = state.upserts[0] as Array<Record<string, unknown>>;
    expect(rows.map(row => [row.staff_accession, row.round, row.letter_kind])).toEqual([
      ['0000000000-24-002512', 1, 'comments'],
      ['0000000000-24-003505', 2, 'comments'],
      ['0000000000-24-005673', 3, 'review-complete'],
    ]);
    expect(rows.every(row => /^[0-9a-f]{64}$/.test(String(row.episode_fingerprint)))).toBe(true);
  });

  it('serves stored rows while the letters and their text are unchanged', async () => {
    const letters = loadEpisode('apple-10k-fy2023');
    const { episode, fingerprint } = computeEpisodeIssues(letters);
    state.stored = issueRowsFromEpisode(THREAD, episode, fingerprint, '2026-10-01T00:00:00.000Z') as unknown as Array<Record<string, unknown>>;

    const body = await (await GET(new Request(`http://localhost/api/letters/issues?thread=${THREAD}`))).json();

    expect(body).toMatchObject({ stored: true, generatedAt: '2026-10-01T00:00:00.000Z' });
    expect(body.episode.letters[0].issues[0].response.accession).toBe('0000320193-24-000042');
    expect(state.upserts).toHaveLength(0);
  });

  it('regenerates when a letter joins the episode or its text changes', async () => {
    const before = loadEpisode('apple-10k-fy2023').slice(0, 2);
    const { episode, fingerprint } = computeEpisodeIssues(before);
    state.stored = issueRowsFromEpisode(THREAD, episode, fingerprint, '2026-10-01T00:00:00.000Z') as unknown as Array<Record<string, unknown>>;

    const body = await (await GET(new Request(`http://localhost/api/letters/issues?thread=${THREAD}`))).json();

    expect(body.generatedAt).not.toBe('2026-10-01T00:00:00.000Z');
    expect(body.episode.closedBy).toEqual({ accession: '0000000000-24-005673', date_filed: '2024-05-16' });
    expect(state.upserts).toHaveLength(1);
  });

  it('still answers when storage is unavailable, and says it was not stored', async () => {
    state.writer = false;
    state.storedError = { message: 'relation "urc_letter_issues" does not exist' };
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const body = await (await GET(new Request(`http://localhost/api/letters/issues?thread=${THREAD}`))).json();
      expect(body.stored).toBe(false);
      expect(body.episode.coverage.issues).toBe(4);
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('rejects a malformed thread, reports an unknown one, and refuses an oversized episode', async () => {
    expect((await GET(new Request('http://localhost/api/letters/issues?thread=bad%20id'))).status).toBe(400);
    state.letters = [];
    expect((await GET(new Request(`http://localhost/api/letters/issues?thread=${THREAD}`))).status).toBe(404);
    state.letters = Array.from({ length: 101 }, (_, index) => ({ ...appleRows()[0], accession: `x-${index}` }));
    const oversized = await GET(new Request(`http://localhost/api/letters/issues?thread=${THREAD}`));
    expect(oversized.status).toBe(422);
    expect(state.upserts).toHaveLength(0);
  });
});
