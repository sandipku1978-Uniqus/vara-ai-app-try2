import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCompleteSecCompanyDirectory } from '../../tests/e2e/sec-company-directory-fixture';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const DIRECTORY = buildCompleteSecCompanyDirectory([
  { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  { cik_str: 1679788, ticker: 'COIN', title: 'Coinbase Global, Inc.' },
  { cik_str: 1418121, ticker: 'APLE', title: 'Apple Hospitality REIT, Inc.' },
]);

describe('resolveCompanyEntity', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => DIRECTORY });
  });

  it('resolves a bare company name to the market-cap-ordered first match', async () => {
    const { resolveCompanyEntity } = await import('../services/secApi');
    const entity = await resolveCompanyEntity('apple');
    expect(entity?.title).toBe('Apple Inc.'); // not Apple Hospitality REIT
  });

  it('resolves tickers case-insensitively', async () => {
    const { resolveCompanyEntity } = await import('../services/secApi');
    expect((await resolveCompanyEntity('coin'))?.title).toBe('Coinbase Global, Inc.');
  });

  it('does not treat topic queries as entities', async () => {
    const { resolveCompanyEntity } = await import('../services/secApi');
    expect(await resolveCompanyEntity('apple revenue recognition')).toBeNull();
    expect(await resolveCompanyEntity('goodwill impairment triggering events again')).toBeNull();
    expect(await resolveCompanyEntity('')).toBeNull();
  });

  it('requires at least 4 chars for name-prefix matches', async () => {
    const { resolveCompanyEntity } = await import('../services/secApi');
    expect(await resolveCompanyEntity('app')).toBeNull();
  });
});
