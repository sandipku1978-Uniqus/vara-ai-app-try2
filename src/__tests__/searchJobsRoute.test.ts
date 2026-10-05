import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSearchFilters } from '../domain/searchFilters';
import { compileSearchJobPlan } from '../services/searchJobs';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  writer: true,
  session: true as boolean,
}));

vi.mock('../lib/api-auth', () => ({
  requireApiAccess: async () => (mocks.session
    ? { identity: { userId: 'user_1', orgId: null, cacheScope: 'user_1:personal' } }
    : { response: Response.json({ error: 'Authentication required.' }, { status: 401 }) }),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  acquireResourceConcurrency: async () => ({ allowed: true, lease: undefined }),
  releaseAiConcurrency: async () => undefined,
}));
vi.mock('../lib/supabase-web', () => ({
  getUserWriterSupabase: () => (mocks.writer ? { rpc: mocks.rpc } : null),
  getWebSupabase: () => null,
}));

import { GET as listJobs, POST as createJob } from '../app/api/search-jobs/route';
import { GET as readJob, POST as actOnJob } from '../app/api/search-jobs/[id]/route';
import { GET as cronContinue, POST as ownerContinue } from '../app/api/search-jobs/continue/route';

const JOB_ID = '00000000-0000-4000-8000-000000000001';

function plan() {
  const compiled = compileSearchJobPlan({
    query: 'material W/3 weakness',
    mode: 'boolean',
    filters: { ...defaultSearchFilters, formTypes: ['10-K'] },
    defaultForms: '10-K',
    includeExhibits: false,
    hydrateTextSignals: true,
  }, '2026-10-04');
  if (!compiled.ok) throw new Error('fixture plan');
  return compiled.plan;
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    status: 'running',
    statusReason: null,
    plan: plan(),
    examined: 120,
    verified: 24,
    upstreamTotal: 700,
    upstreamTotalIsFloor: false,
    coverage: { examined: 120, upstreamTotal: 700, complete: false },
    waves: 1,
    leased: false,
    lastWaveAt: null,
    createdAt: '2026-10-04T00:00:00Z',
    updatedAt: '2026-10-04T00:00:00Z',
    expiresAt: '2026-10-05T00:00:00Z',
    ...overrides,
  };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

const searchBody = {
  search: {
    query: 'material W/3 weakness',
    mode: 'boolean',
    filters: { ...defaultSearchFilters, formTypes: ['10-K'] },
    defaultForms: '10-K',
    includeExhibits: false,
    hydrateTextSignals: true,
  },
};

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.writer = true;
  mocks.session = true;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/search-jobs', () => {
  it('creates a job scoped to the session owner with a compiled, pinned plan', async () => {
    mocks.rpc.mockResolvedValue({ data: { job: summary() }, error: null });
    const res = await createJob(post('http://localhost/api/search-jobs', searchBody));
    expect(res.status).toBe(201);
    const [fn, args] = mocks.rpc.mock.calls[0];
    expect(fn).toBe('urc_search_job_create');
    expect(args.p_owner_user_id).toBe('user_1');
    expect(args.p_plan.engineVersion).toMatch(/^wave-cursor-1/);
    expect(args.p_plan.pinnedDateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(args.p_cursor.lanes[0].nextOffset).toBe(0);
    expect(typeof args.p_cursor.seenDigest).toBe('string');
  });

  it('answers 409 with the running job when the user already has one', async () => {
    mocks.rpc.mockResolvedValue({ data: { error: 'active-job-exists', job: summary() }, error: null });
    const res = await createJob(post('http://localhost/api/search-jobs', searchBody));
    expect(res.status).toBe(409);
    expect((await res.json()).job.id).toBe(JOB_ID);
  });

  it('refuses a search EDGAR already answers, before touching the database', async () => {
    const res = await createJob(post('http://localhost/api/search-jobs', {
      search: { ...searchBody.search, query: '"net ai"' },
    }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not-needed');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed request and requires a session', async () => {
    expect((await createJob(post('http://localhost/api/search-jobs', { search: { query: 1 } }))).status).toBe(400);
    mocks.session = false;
    expect((await createJob(post('http://localhost/api/search-jobs', searchBody))).status).toBe(401);
  });

  it('answers 503 rather than degrading when the writer is not configured', async () => {
    mocks.writer = false;
    expect((await createJob(post('http://localhost/api/search-jobs', searchBody))).status).toBe(503);
    expect((await listJobs(new Request('http://localhost/api/search-jobs'))).status).toBe(503);
  });
});

describe('GET /api/search-jobs/[id]', () => {
  it('returns the job and one server-side page of verified filings', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'urc_search_job_get') return { data: summary(), error: null };
      if (fn === 'urc_search_job_hits_page') {
        return { data: { total: 24, hits: [{ id: 'a', accessionNumber: '0001000001-24-000001', jobDocuments: ['a.htm'] }] }, error: null };
      }
      return { data: null, error: null };
    });
    const res = await readJob(
      new Request(`http://localhost/api/search-jobs/${JOB_ID}?offset=50&limit=500`),
      { params: Promise.resolve({ id: JOB_ID }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hits).toMatchObject({ total: 24, offset: 50, limit: 200 });
    expect(body.hits.items).toHaveLength(1);
    const pageCall = mocks.rpc.mock.calls.find(([fn]) => fn === 'urc_search_job_hits_page');
    expect(pageCall?.[1]).toEqual({ p_owner_user_id: 'user_1', p_id: JOB_ID, p_offset: 50, p_limit: 200 });
  });

  it('treats another user\'s job as unknown and validates the id', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const missing = await readJob(new Request(`http://localhost/api/search-jobs/${JOB_ID}`), { params: Promise.resolve({ id: JOB_ID }) });
    expect(missing.status).toBe(404);
    const invalid = await readJob(new Request('http://localhost/api/search-jobs/x'), { params: Promise.resolve({ id: 'x' }) });
    expect(invalid.status).toBe(400);
  });

  it('cancels through an explicit action only', async () => {
    mocks.rpc.mockResolvedValue({ data: summary({ status: 'cancelled' }), error: null });
    const bad = await actOnJob(post(`http://localhost/api/search-jobs/${JOB_ID}`, { action: 'delete' }), { params: Promise.resolve({ id: JOB_ID }) });
    expect(bad.status).toBe(400);
    const ok = await actOnJob(post(`http://localhost/api/search-jobs/${JOB_ID}`, { action: 'cancel' }), { params: Promise.resolve({ id: JOB_ID }) });
    expect(ok.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('urc_search_job_cancel', { p_owner_user_id: 'user_1', p_id: JOB_ID });
  });
});

describe('/api/search-jobs/continue', () => {
  it('fails closed for cron without a configured secret, or with the wrong one', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await cronContinue(new Request('http://localhost/api/search-jobs/continue'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', 'a-long-enough-cron-secret');
    const wrong = new Request('http://localhost/api/search-jobs/continue', { headers: { authorization: 'Bearer nope' } });
    expect((await cronContinue(wrong)).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('lets an authorized cron pass finish cleanly when nothing is runnable', async () => {
    vi.stubEnv('CRON_SECRET', 'a-long-enough-cron-secret');
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const res = await cronContinue(new Request('http://localhost/api/search-jobs/continue', {
      headers: { authorization: 'Bearer a-long-enough-cron-secret' },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, waves: [] });
    expect(mocks.rpc).toHaveBeenCalledWith('urc_search_job_claim', { p_id: null, p_owner_user_id: null, p_lease_seconds: 150 });
  });

  it('lets only the owner nudge their own job, scoped by the session', async () => {
    mocks.rpc.mockImplementation(async (fn: string) => {
      if (fn === 'urc_search_job_claim') return { data: null, error: null };
      if (fn === 'urc_search_job_get') return { data: summary({ leased: true }), error: null };
      return { data: null, error: null };
    });
    const res = await ownerContinue(post('http://localhost/api/search-jobs/continue', { jobId: JOB_ID }));
    expect(res.status).toBe(200);
    expect((await res.json()).advanced).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith('urc_search_job_claim', { p_id: JOB_ID, p_owner_user_id: 'user_1', p_lease_seconds: 150 });

    mocks.session = false;
    expect((await ownerContinue(post('http://localhost/api/search-jobs/continue', { jobId: JOB_ID }))).status).toBe(401);
  });
});
