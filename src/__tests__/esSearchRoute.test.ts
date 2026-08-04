import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

const dbMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));
const concurrencyMock = vi.hoisted(() => vi.fn());
const releaseConcurrencyMock = vi.hoisted(() => vi.fn());
let completionSpy: MockInstance;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => dbMock),
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn().mockResolvedValue({
    identity: { userId: 'test-user', orgId: null, cacheScope: 'test-user:personal' },
  }),
}));

vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  acquireResourceConcurrency: concurrencyMock,
  releaseAiConcurrency: releaseConcurrencyMock,
  rateLimitResponse: vi.fn((result: { reason?: string }) => Response.json(
    { error: result.reason || 'rate limited' },
    { status: 429 }
  )),
}));

// The production code applies the shared SEC request-start pacer. These route
// tests verify pagination and enrichment contracts, so keep their 100-request
// boundary case deterministic without weakening the runtime gate.
vi.mock('../lib/sec-request-pacer', () => ({
  SEC_REQUEST_START_INTERVAL_MS: 125,
  SecRequestPacerUnavailableError: class SecRequestPacerUnavailableError extends Error {},
  paceSecRequestStart: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from '../app/api/es-search/route';

function eftsPage(url: string) {
  const params = new URL(url).searchParams;
  const from = Number(params.get('from') || 0);
  const size = Math.min(Number(params.get('size') || 10), 100);
  const total = 250;
  const hits = Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, index) => {
    const position = from + index;
    return {
      _id: `filing-${position}`,
      _score: 1,
      _source: {
        ciks: ['0000320193'],
        adsh: `0000320193-23-${String(position).padStart(6, '0')}`,
        form: '10-K',
        file_date: '2023-11-02',
        // 3571 is deliberately secondary: SEARCH-03 must not inspect only [0].
        sics: ['2834', '3571'],
      },
    };
  });
  return { hits: { total: { value: total, relation: 'eq' }, hits } };
}

describe('/api/es-search paging and coverage contract', () => {
  beforeEach(() => {
    completionSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    process.env.URC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.URC_SUPABASE_SERVICE_KEY = 'test-key';
    dbMock.rpc.mockReset().mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === 'urc_resolve_filing_auditors') {
        return {
          data: ((args.p_filings as Array<{ key: string; cik: string; file_date: string }>) ?? []).map(filing => ({
            request_key: filing.key,
            cik: Number(filing.cik),
            file_date: filing.file_date,
            auditor: null,
            auditor_resolution_status: 'no_prior_form_ap_report',
          })),
          error: null,
        };
      }
      return { data: [], error: null };
    });
    concurrencyMock.mockReset().mockResolvedValue({
      allowed: true,
      lease: { token: 'test', keys: [], local: true, released: false },
    });
    releaseConcurrencyMock.mockReset().mockResolvedValue(undefined);
    dbMock.from.mockImplementation(() => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) =>
      new Response(JSON.stringify(eftsPage(String(input))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    ));
  });

  afterEach(() => {
    completionSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('serves the second 100-row page without treating the server clamp as EOF', async () => {
    const response = await GET(new Request('http://localhost/api/es-search?q=controls&from=100&size=100'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(100);
    expect(body.hits.hits[0]._id).toBe('filing-100');
    expect(body.hits.hits[99]._id).toBe('filing-199');
    expect(body.hits.total).toEqual({ value: 250, relation: 'eq' });
  });

  it('retains the honest facet total when a deep page has no row to carry total_count', async () => {
    dbMock.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{ total_count: 137, accession: 'first', filename: 'first.htm' }],
        error: null,
      });

    const response = await GET(new Request(
      'http://localhost/api/es-search?q=&forms=10-K&auditor=KPMG&from=200&size=20'
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toEqual([]);
    expect(body.hits.total).toEqual({ value: 137, relation: 'eq' });
    expect(dbMock.rpc).toHaveBeenNthCalledWith(2, 'urc_search_filings', expect.objectContaining({
      p_forms: ['10-K'],
      p_auditor: 'KPMG',
      p_limit: 1,
      p_offset: 0,
    }));
  });

  it('still reports zero when both the requested facet page and total probe are empty', async () => {
    dbMock.rpc
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const response = await GET(new Request(
      'http://localhost/api/es-search?q=&forms=10-K&from=200&size=20'
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.total).toEqual({ value: 0, relation: 'eq' });
    expect(body.hits.hits).toEqual([]);
  });

  it('normalizes repeated entity whitespace before safely removing a corporate suffix', async () => {
    dbMock.rpc.mockResolvedValueOnce({ data: [], error: null });
    const params = new URLSearchParams({
      entityName: `BlackRock,${' '.repeat(250)}Inc.`,
      size: '20',
    });

    const response = await GET(new Request(`http://localhost/api/es-search?${params}`));

    expect(response.status).toBe(200);
    expect(dbMock.rpc).toHaveBeenCalledWith('urc_search_filings', expect.objectContaining({
      p_entity: 'BlackRock',
    }));
  });

  it('matches a secondary SIC across the complete upstream candidate set', async () => {
    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&size=20'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(20);
    expect(body.hits.hits[0]._source.sics).toContain('3571');
    expect(body.hits.total).toEqual({ value: 250, relation: 'eq' });
    expect(body.meta.candidateCoverage).toEqual({
      examined: 250,
      upstreamTotal: 250,
      complete: true,
      upstreamTotalIsFloor: false,
    });
  });

  it('aggregates SIC and ticker evidence across every co-filer without inventing a singular label', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [{
          _id: 'multi-cik-filing',
          _source: {
            ciks: ['0000320193', '0000789019'],
            file_date: '2024-03-01',
            form: '8-K',
          },
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    dbMock.from.mockImplementation(() => ({
      select: () => ({
        in: async () => ({
          data: [
            { cik: 320193, sic: '3571', sic_description: 'Electronic Computers', tickers: ['AAPL'] },
            { cik: 789019, sic: '7372', sic_description: 'Prepackaged Software', tickers: ['MSFT'] },
          ],
          error: null,
        }),
      }),
    }));

    const response = await GET(new Request(
      'http://localhost/api/es-search?q=controls&sicCode=7372&size=10'
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(1);
    expect(body.hits.hits[0]._source).toMatchObject({
      sic: '',
      sics: ['3571', '7372'],
      sic_description: '',
      tickers: ['AAPL', 'MSFT'],
    });
  });

  it('chunks large company metadata lookups and records every bounded database call', async () => {
    const total = 301;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      const size = Number(params.get('size') || 10);
      const hits = Array.from({ length: Math.min(size, total - from) }, (_, index) => {
        const cik = from + index + 1;
        return {
          _id: `company-chunk-${cik}`,
          _source: {
            ciks: [String(cik).padStart(10, '0')],
            file_date: '2024-03-01',
            form: '10-K',
          },
        };
      });
      return new Response(JSON.stringify({
        hits: { total: { value: total, relation: 'eq' }, hits },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const companyChunks: number[][] = [];
    dbMock.from.mockImplementation(() => ({
      select: () => ({
        in: async (_column: string, ciks: number[]) => {
          companyChunks.push(ciks);
          return {
            data: ciks.map(cik => ({
              cik,
              sic: '3571',
              sic_description: 'Electronic Computers',
              tickers: [`T${cik}`],
            })),
            error: null,
          };
        },
      }),
    }));

    const response = await GET(new Request(
      'http://localhost/api/es-search?q=controls&sicCode=3571&size=10'
    ));
    const body = await response.json();
    const completion = JSON.parse(String(completionSpy.mock.calls[0][0]));

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(10);
    expect(companyChunks.map(chunk => chunk.length)).toEqual([150, 150, 1]);
    expect(companyChunks.every(chunk => chunk.length <= 150)).toBe(true);
    expect(completion).toMatchObject({
      databaseCallCount: 4,
      companyEnrichmentCount: 301,
      candidateCount: 301,
    });
  });

  it('fails closed when any required company metadata chunk fails', async () => {
    const total = 151;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      const size = Number(params.get('size') || 10);
      const hits = Array.from({ length: Math.min(size, total - from) }, (_, index) => {
        const cik = from + index + 1;
        return {
          _id: `failed-company-chunk-${cik}`,
          _source: {
            ciks: [String(cik).padStart(10, '0')],
            file_date: '2024-03-01',
            form: '10-K',
          },
        };
      });
      return new Response(JSON.stringify({
        hits: { total: { value: total, relation: 'eq' }, hits },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    let companyRead = 0;
    dbMock.from.mockImplementation(() => ({
      select: () => ({
        in: async (_column: string, ciks: number[]) => {
          companyRead += 1;
          return companyRead === 2
            ? { data: null, error: { code: '57014', message: 'statement timeout' } }
            : {
                data: ciks.map(cik => ({
                  cik,
                  sic: '3571',
                  sic_description: 'Electronic Computers',
                  tickers: [],
                })),
                error: null,
              };
        },
      }),
    }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const response = await GET(new Request(
        'http://localhost/api/es-search?q=controls&sicCode=3571&size=10'
      ));
      const body = await response.json();

      expect(response.status).toBe(504);
      expect(body).toMatchObject({
        ok: false,
        errorClass: 'statement-timeout',
        correlationId: expect.any(String),
        meta: { efts: { requests: 2, requestBudget: 100 } },
      });
      expect(body).not.toHaveProperty('hits');
      expect(companyRead).toBe(2);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('attributes the same issuer to the Form AP firm effective on each filing date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hits: {
        total: { value: 2, relation: 'eq' },
        hits: [
          { _id: 'old', _source: { ciks: ['0000320193'], file_date: '2020-03-01', form: '10-K' } },
          { _id: 'new', _source: { ciks: ['0000320193'], file_date: '2024-03-01', form: '10-K' } },
        ],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    dbMock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name !== 'urc_resolve_filing_auditors') return { data: [], error: null };
      return {
        data: (args.p_filings as Array<{ key: string; file_date: string }>).map(filing => ({
          request_key: filing.key,
          auditor: filing.file_date < '2022-01-01' ? 'KPMG' : 'Deloitte',
          auditor_report_date: filing.file_date < '2022-01-01' ? '2019-02-20' : '2022-02-20',
          auditor_resolution_status: 'resolved',
          auditor_basis: 'latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date',
        })),
        error: null,
      };
    });

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&size=10'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits.map((entry: { _source: { auditor: string } }) => entry._source.auditor))
      .toEqual(['KPMG', 'Deloitte']);
    expect(body.hits.hits[0]._source.auditor_report_date).toBe('2019-02-20');
    expect(dbMock.rpc).toHaveBeenCalledWith('urc_resolve_filing_auditors', {
      p_filings: expect.arrayContaining([
        expect.objectContaining({ cik: '320193', file_date: '2020-03-01' }),
        expect.objectContaining({ cik: '320193', file_date: '2024-03-01' }),
      ]),
    });
  });

  it('does not turn ambiguous Form AP candidates into an authoritative auditor match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [{
          _id: 'ambiguous',
          _source: { ciks: ['0000320193'], file_date: '2024-03-01', form: '10-K' },
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    dbMock.rpc.mockResolvedValueOnce({
      data: [{
        request_key: '0:0',
        auditor: null,
        auditor_candidates: ['KPMG', 'Deloitte'],
        auditor_resolution_status: 'ambiguous',
      }],
      error: null,
    });

    const response = await GET(new Request(
      'http://localhost/api/es-search?q=controls&auditor=KPMG&size=10'
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toEqual([]);
    expect(body.hits.total).toEqual({ value: 0, relation: 'eq' });
  });

  it('distinguishes unavailable auditor evidence from a verified no-prior-report result', async () => {
    dbMock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'statement timeout' } });

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&size=1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits[0]._source.auditor).toBe('');
    expect(body.hits.hits[0]._source.auditor_resolution_status).toBe('temporarily_unavailable');
    const completion = JSON.parse(String(completionSpy.mock.calls[0][0]));
    expect(completion).toMatchObject({
      kind: 'route-completion',
      route: 'es-search',
      outcome: 'degraded',
      candidateCount: 1,
      returnedCount: 1,
      degradedSources: ['auditor-attribution'],
    });
    expect(response.headers.get('x-correlation-id')).toBe(completion.correlationId);
  });

  it('returns a correlated typed DB envelope when required facet enrichment fails', async () => {
    dbMock.rpc.mockImplementation(async (name: string) => name === 'urc_resolve_filing_auditors'
      ? { data: null, error: { code: '57014', message: 'statement timeout' } }
      : { data: [], error: null });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secretQuery = 'query-text-must-not-appear-in-logs';

    try {
      const response = await GET(new Request(
        `http://localhost/api/es-search?q=${secretQuery}&auditor=KPMG&size=10`
      ));
      const body = await response.json();
      const completion = JSON.parse(String(completionSpy.mock.calls[0][0]));

      expect(response.status).toBe(504);
      expect(body).toMatchObject({
        ok: false,
        errorClass: 'statement-timeout',
        correlationId: expect.any(String),
        meta: { efts: { requests: 3, requestBudget: 100 } },
      });
      expect(response.headers.get('x-correlation-id')).toBe(body.correlationId);
      expect(completion).toMatchObject({
        kind: 'route-completion',
        route: 'es-search',
        outcome: 'error',
        errorClass: 'statement-timeout',
        candidateCount: 250,
        attributionRequestCount: 250,
        returnedCount: 0,
        correlationId: body.correlationId,
      });
      expect(String(completionSpy.mock.calls[0][0])).not.toContain(secretQuery);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('returns a safe correlated generic envelope when EFTS throws', async () => {
    const secretQuery = 'never-log-this-query';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`upstream failed for ${secretQuery}`)));

    const response = await GET(new Request(`http://localhost/api/es-search?q=${secretQuery}&size=10`));
    const body = await response.json();
    const rawCompletion = String(completionSpy.mock.calls[0][0]);
    const completion = JSON.parse(rawCompletion);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      errorClass: 'unexpected',
      correlationId: expect.any(String),
      meta: { efts: { requests: 1, requestBudget: 100 } },
    });
    expect(JSON.stringify(body)).not.toContain(secretQuery);
    expect(rawCompletion).not.toContain(secretQuery);
    expect(completion).toMatchObject({
      kind: 'route-completion',
      route: 'es-search',
      outcome: 'error',
      errorClass: 'unexpected',
      candidateCount: 0,
      correlationId: body.correlationId,
    });
    expect(completionSpy).toHaveBeenCalledOnce();
  });

  it.each([
    {
      label: 'wrong content type',
      response: () => new Response(JSON.stringify({
        hits: { total: { value: 0, relation: 'eq' }, hits: [] },
      }), { status: 200, headers: { 'Content-Type': 'text/html' } }),
    },
    {
      label: 'malformed payload shape',
      response: () => new Response(JSON.stringify({ message: 'temporarily unavailable' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    },
  ])('never converts an EFTS HTTP 200 with $label into a verified zero', async ({ response: upstream }) => {
    vi.stubGlobal('fetch', vi.fn(async () => upstream()));

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&size=10'));
    const body = await response.json();
    const completion = JSON.parse(String(completionSpy.mock.calls[0][0]));

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      errorClass: 'unexpected',
      correlationId: expect.any(String),
      meta: { efts: { requests: 1, requestBudget: 100 } },
    });
    expect(body).not.toHaveProperty('hits');
    expect(completion).toMatchObject({
      outcome: 'error',
      candidateCount: 0,
      correlationId: body.correlationId,
    });
  });

  it('does not label or facet-match a co-filer hit from only one resolved CIK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [{
          _id: 'mixed-cofilers',
          _source: {
            ciks: ['0000320193', '0000789019'],
            file_date: '2024-03-01',
            form: '8-K',
          },
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    dbMock.rpc.mockImplementation(async (name: string) => name === 'urc_resolve_filing_auditors'
      ? {
          data: [
            { request_key: '0:0', auditor: 'KPMG', auditor_resolution_status: 'resolved' },
            { request_key: '0:1', auditor: null, auditor_resolution_status: 'no_prior_form_ap_report' },
          ],
          error: null,
        }
      : { data: [], error: null });

    const labelResponse = await GET(new Request('http://localhost/api/es-search?q=controls&size=10'));
    const labelBody = await labelResponse.json();
    expect(labelBody.hits.hits[0]._source.auditor).toBe('');
    expect(labelBody.hits.hits[0]._source.auditor_resolution_status).toBe('incomplete_multiple_ciks');

    const facetResponse = await GET(new Request(
      'http://localhost/api/es-search?q=controls&auditor=KPMG&size=10'
    ));
    const facetBody = await facetResponse.json();
    expect(facetBody.hits.hits).toEqual([]);
  });

  it('fills a sparse facet page when matches occur after the former three-times window', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      const size = Number(params.get('size') || 10);
      const total = 500;
      const hits = Array.from({ length: Math.min(size, total - from) }, (_, index) => {
        const position = from + index;
        return {
          _id: `sparse-${position}`,
          _source: {
            ciks: ['0000320193'],
            adsh: `sparse-${position}`,
            form: '10-K',
            sics: position >= 300 && position < 320 ? ['3571'] : ['2834'],
          },
        };
      });
      return new Response(JSON.stringify({ hits: { total: { value: total, relation: 'eq' }, hits } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&size=20'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(20);
    expect(body.hits.hits[0]._id).toBe('sparse-300');
    expect(body.meta.candidateCoverage).toEqual({ examined: 500, upstreamTotal: 500, complete: true, upstreamTotalIsFloor: false });
  });

  it('fetches a no-facet page beyond candidate 1,000 directly from the requested offset', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      const size = Number(params.get('size') || 10);
      const total = 2_000;
      const hits = Array.from({ length: Math.min(size, total - from) }, (_, index) => ({
        _id: `deep-${from + index}`,
        _source: { ciks: ['0000320193'], adsh: `deep-${from + index}`, form: '10-K' },
      }));
      return new Response(JSON.stringify({ hits: { total: { value: total, relation: 'eq' }, hits } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&from=1100&size=100'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits).toHaveLength(100);
    expect(body.hits.hits[0]._id).toBe('deep-1100');
    expect(body.hits.total).toEqual({ value: 2_000, relation: 'eq' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('rejects facet pagination beyond the bounded candidate window instead of returning a false empty page', async () => {
    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&from=1100&size=20'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain('bounded to the first 1000');
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('rejects a heavy facet scan before SEC fan-out when global capacity is unavailable', async () => {
    concurrencyMock.mockResolvedValueOnce({ allowed: false, reason: 'concurrency', retryAfterSeconds: 5 });

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&size=20'));

    expect(response.status).toBe(429);
    expect(concurrencyMock).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(releaseConcurrencyMock).not.toHaveBeenCalled();
  });

  it('preserves an upstream gte total relation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      const size = Number(params.get('size') || 10);
      const hits = Array.from({ length: size }, (_, index) => ({
        _id: `gte-${from + index}`,
        _source: { ciks: ['0000320193'], adsh: `gte-${from + index}`, form: '10-K' },
      }));
      return new Response(JSON.stringify({ hits: { total: { value: 10_000, relation: 'gte' }, hits } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&size=25'));
    const body = await response.json();
    expect(body.hits.total).toEqual({ value: 10_000, relation: 'gte' });
  });

  it('bounds sequential EFTS candidate requests even when upstream returns one hit per page', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const params = new URL(String(input)).searchParams;
      const from = Number(params.get('from') || 0);
      return new Response(JSON.stringify({
        hits: {
          total: { value: 5_000, relation: 'eq' },
          hits: [{
            _id: `slow-${from}`,
            _source: { ciks: ['0000320193'], adsh: `slow-${from}`, form: '10-K', sics: ['3571'] },
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const response = await GET(new Request('http://localhost/api/es-search?q=controls&sicCode=3571&from=900&size=100'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(100);
    expect(body.meta.efts).toEqual({ requests: 100, requestBudget: 100 });
    expect(body.meta.candidateCoverage).toEqual({ examined: 100, upstreamTotal: 5_000, complete: false, upstreamTotalIsFloor: false });
    expect(body.hits.total).toEqual({ value: 100, relation: 'gte' });
  });

  it('honors a caller-provided SEC EFTS request budget below the route cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const from = Number(new URL(String(input)).searchParams.get('from') || 0);
      return new Response(JSON.stringify({
        hits: {
          total: { value: 5_000, relation: 'eq' },
          hits: [{
            _id: `bounded-${from}`,
            _source: { ciks: ['0000320193'], adsh: `bounded-${from}`, form: '10-K' },
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const response = await GET(new Request(
      'http://localhost/api/es-search?q=controls&from=0&size=100&eftsRequestBudget=7'
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(7);
    expect(body.meta.efts).toEqual({ requests: 7, requestBudget: 7 });
    expect(body.meta.candidateCoverage).toEqual({
      examined: 7,
      upstreamTotal: 5_000,
      complete: false,
      upstreamTotalIsFloor: false,
    });
  });

  it('counts validated redirects as real SEC attempts within the same route budget', async () => {
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      attempt += 1;
      if (attempt === 1) {
        return new Response(null, {
          status: 302,
          headers: { Location: String(input) },
        });
      }
      return new Response(JSON.stringify({
        hits: {
          total: { value: 1, relation: 'eq' },
          hits: [{
            _id: 'redirected-result',
            _source: { ciks: ['0000320193'], adsh: 'redirected-result', form: '10-K' },
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const response = await GET(new Request(
      'http://localhost/api/es-search?q=controls&size=1&eftsRequestBudget=2'
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(body.meta.efts).toEqual({ requests: 2, requestBudget: 2 });
    expect(body.meta.candidateCoverage.complete).toBe(true);
  });

  it('returns validated partial candidates when a later response body times out', async () => {
    vi.useFakeTimers();
    let requestNumber = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requestNumber += 1;
      if (requestNumber === 1) {
        return new Response(JSON.stringify({
          hits: {
            total: { value: 5_000, relation: 'eq' },
            hits: [{
              _id: 'read-timeout-0',
              _source: { ciks: ['0000320193'], adsh: 'read-timeout-0', form: '10-K' },
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(new ReadableStream<Uint8Array>({
        pull: () => new Promise<void>(() => undefined),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const pending = GET(new Request('http://localhost/api/es-search?q=controls&size=100'));
    for (let turn = 0; turn < 10 && requestNumber < 2; turn += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(requestNumber).toBe(2);
    await vi.advanceTimersByTimeAsync(12_000);
    const response = await pending;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits.map((hit: { _id: string }) => hit._id)).toEqual(['read-timeout-0']);
    expect(body.meta.efts).toEqual({ requests: 2, requestBudget: 100 });
    expect(body.meta.candidateCoverage).toMatchObject({ examined: 1, complete: false });
  });

  it('returns validated partial candidates when cancellation interrupts inter-page pacing', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'development');
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      hits: {
        total: { value: 5_000, relation: 'eq' },
        hits: [{
          _id: 'paced-0',
          _source: { ciks: ['0000320193'], adsh: 'paced-0', form: '10-K' },
        }],
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const pending = GET(new Request(
      'http://localhost/api/es-search?q=controls&size=100',
      { signal: controller.signal }
    ));
    for (let turn = 0; turn < 10 && vi.mocked(fetch).mock.calls.length < 1; turn += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    controller.abort('test cancellation during pacing');
    await vi.advanceTimersByTimeAsync(0);
    const response = await pending;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.hits.hits.map((hit: { _id: string }) => hit._id)).toEqual(['paced-0']);
    expect(body.meta.efts).toEqual({ requests: 1, requestBudget: 100 });
    expect(body.meta.candidateCoverage).toMatchObject({ examined: 1, complete: false });
  });
});
