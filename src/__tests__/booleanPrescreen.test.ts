import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { booleanQueryMatches } from '../utils/booleanSearch';
import { prescreenBooleanCandidates } from '../services/secApi';

/**
 * The pre-screen is only sound because a server verdict is the verdict the
 * browser would have reached. These tests pin the two halves of that claim:
 * the same matcher decides both sides, and any verdict the server could NOT
 * reach is passed back as undecided rather than as a non-match.
 */

const candidates = [
  { cik: '320193', accession: '000032019324000123', document: 'a.htm' },
  { cik: '789019', accession: '000078901924000456', document: 'b.htm' },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function respond(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValue({ ok, status, json: async () => body });
}

describe('prescreenBooleanCandidates', () => {
  it('returns verdicts and posts only identifiers — never filing text', async () => {
    respond({ ok: true, verdicts: [{ ...candidates[0], matched: true, validated: true }] });

    const result = await prescreenBooleanCandidates('"material weakness"', candidates);

    expect(result).toHaveLength(1);
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(sent.candidates).toEqual(candidates);
    expect(init.method).toBe('POST');
  });

  it('carries the remaining SEC budget and reports actual server work', async () => {
    const onWork = vi.fn();
    respond({
      ok: true,
      verdicts: [{ ...candidates[0], matched: true, validated: true }],
      summary: { upstreamAttempts: 3, cacheHits: 1, budgetExhausted: false },
    });

    await prescreenBooleanCandidates('lease', candidates, {
      maxUpstreamAttempts: 7,
      onWork,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).maxUpstreamAttempts).toBe(7);
    expect(onWork).toHaveBeenCalledWith({
      upstreamAttempts: 3,
      cacheHits: 1,
      budgetExhausted: false,
    });
  });

  it('returns null — not an empty verdict list — when the endpoint fails', async () => {
    // Critical: null means "pre-screen did not happen", so the caller keeps
    // every candidate. An empty list would read as "nothing matched".
    respond({}, false, 500);
    expect(await prescreenBooleanCandidates('lease', candidates)).toBeNull();
  });

  it('returns null when the network throws', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await prescreenBooleanCandidates('lease', candidates)).toBeNull();
  });

  it('returns null when the payload is not the shape we expect', async () => {
    respond({ ok: true, verdicts: 'nope' });
    expect(await prescreenBooleanCandidates('lease', candidates)).toBeNull();
  });

  it('gives up rather than stalling the wave it is meant to accelerate', async () => {
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      }));

    const result = await prescreenBooleanCandidates('lease', candidates, { timeoutMs: 20 });
    expect(result).toBeNull();
  });

  it('does not call the endpoint at all for an empty query or no candidates', async () => {
    expect(await prescreenBooleanCandidates('  ', candidates)).toBeNull();
    expect(await prescreenBooleanCandidates('lease', [])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('server and client reach the same verdict (pre-screen soundness)', () => {
  // Each case is text the server would evaluate and the browser would re-check.
  // If these ever diverge, the pre-screen silently drops real results — so the
  // shared matcher is asserted directly rather than assumed.
  const cases: Array<{ query: string; text: string; expected: boolean }> = [
    { query: '"material weakness"', text: 'We identified a material weakness in controls.', expected: true },
    { query: '"material weakness"', text: 'The weakness in this material is structural.', expected: false },
    { query: 'lease AND impairment', text: 'The lease was tested for impairment.', expected: true },
    { query: 'lease AND impairment', text: 'The lease renewed on schedule.', expected: false },
    { query: 'mezzanine OR "temporary equity"', text: 'Reported within temporary equity.', expected: true },
    { query: 'goodwill NOT impairment', text: 'Goodwill increased during the year.', expected: true },
    { query: 'goodwill NOT impairment', text: 'Goodwill impairment of $4m was recorded.', expected: false },
    { query: 'restatement', text: 'Prior-period restatements were required.', expected: true },
  ];

  for (const { query, text, expected } of cases) {
    it(`${query} over "${text.slice(0, 34)}…" → ${expected}`, () => {
      // One pure function, imported by both the route and the browser loop.
      expect(booleanQueryMatches(query, text)).toBe(expected);
    });
  }
});
