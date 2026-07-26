import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock('../services/secApi', () => ({
  resolveCompanyInput: mocks.resolve,
  searchEdgarFilings: async () => [],
  fetchFilingText: async () => '',
  fetchFilingTextOutcome: async () => ({ ok: false, kind: 'upstream', retryable: true }),
  isEnrichedSearchEnabled: () => false,
  fetchCompanySubmissions: async () => null,
  prescreenBooleanCandidates: async () => null,
}));
vi.mock('../services/referenceData', () => ({
  loadSicDirectoryIndex: async () => ({}),
  loadSicDirectory: async () => [],
}));

import { resolveEntityScope } from '../services/filingResearch';

/** The SEC directory really does list a company whose name begins "Material". */
const MATERIAL_CORP = { cik: '2136360', ticker: 'MTRL', title: 'Material Resource Acquisition Corp.' };
const APPLE = { cik: '320193', ticker: 'AAPL', title: 'Apple Inc.' };
const SUN = { cik: '9', ticker: 'SUN', title: 'Sun Pharma' };

const norm = (value: string | undefined) =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Stands in for matchCompanyEntry: a ticker match, or the input being a
 * leading prefix of the registrant name. Prefix — not "contains" — is what
 * makes `"material` resolve to Material Resource Acquisition Corp. while the
 * full phrase `"material weakness"` does not.
 */
function directory(entries: Array<typeof APPLE>) {
  return async (text?: string) => {
    const query = norm(text);
    if (!query) return null;
    return entries.find(entry =>
      entry.ticker.toLowerCase() === query || norm(entry.title).startsWith(query)
    ) ?? null;
  };
}

beforeEach(() => mocks.resolve.mockReset());

describe('resolveEntityScope leaves quoted phrases alone', () => {
  it('does not harvest an issuer out of "material weakness"', async () => {
    // The reported failure: the phrase split into `"material` / `weakness"`,
    // the first resolved to MTRL, and the search ran the fragment `weakness"`
    // inside that one shell company — 1 result for a phrase matching ~510k
    // filings in Intelligize.
    mocks.resolve.mockImplementation(directory([MATERIAL_CORP]));

    const scope = await resolveEntityScope('"material weakness"');

    expect(scope.entityName).toBe('');
    expect(scope.cik).toBe('');
    expect(scope.query).toBe('"material weakness"');
  });

  it('still scopes to an issuer named before the quote', async () => {
    mocks.resolve.mockImplementation(directory([APPLE, MATERIAL_CORP]));

    const scope = await resolveEntityScope('Apple "material weakness"');

    expect(scope.entityName).toBe('Apple Inc.');
    expect(scope.cik).toBe('320193');
    expect(scope.query).toBe('"material weakness"');
  });

  it('never lets a multi-word lead reach across the opening quote', async () => {
    // "sun pharma" would resolve, but only tokens before the quote are on offer.
    mocks.resolve.mockImplementation(directory([SUN]));

    const scope = await resolveEntityScope('"sun pharma advanced" restatement');
    expect(scope.entityName).toBe('');
    expect(scope.query).toBe('"sun pharma advanced" restatement');
  });

  it('leaves unquoted entity extraction working', async () => {
    mocks.resolve.mockImplementation(directory([APPLE]));

    const scope = await resolveEntityScope('Apple revenue recognition');
    expect(scope.entityName).toBe('Apple Inc.');
    expect(scope.query).toBe('revenue recognition');
  });

  it('still resolves when the whole quoted string IS the company', async () => {
    mocks.resolve.mockImplementation(directory([APPLE]));

    const scope = await resolveEntityScope('"Apple Inc."');
    expect(scope.entityName).toBe('Apple Inc.');
    expect(scope.query).toBe('');
  });
});
