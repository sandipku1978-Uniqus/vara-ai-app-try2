import { describe, expect, it } from 'vitest';
import { defaultSearchFilters } from '../domain/searchFilters';
import {
  buildSearchJobHeadline,
  compileSearchJobPlan,
  createSearchJobCursor,
  parseSearchJobCursor,
  type SearchJobHit,
  type SearchJobPlan,
  type SearchJobSummary,
  type StoredSearchJobCursor,
} from '../services/searchJobs';
import type { ClaimedSearchJob, SearchJobStore } from '../app/api/search-jobs/_server/store';
import { advanceClaimedSearchJob } from '../app/api/search-jobs/_server/worker';
import { fixtureClients, fixtureHit } from './searchJobFixtures';

/**
 * An in-memory SearchJobStore with the migration-028 semantics the worker
 * relies on: lease-scoped claim/advance/release, hits upserted by accession,
 * `verified` recomputed from stored hits, and the cursor round-tripped
 * through JSON exactly as jsonb would.
 */
function memoryStore(plan: SearchJobPlan, cursor: StoredSearchJobCursor) {
  let row = {
    id: '00000000-0000-4000-8000-000000000001',
    ownerUserId: 'user_1',
    orgId: null as string | null,
    plan,
    cursor: JSON.stringify(cursor),
    status: 'running' as SearchJobSummary['status'],
    statusReason: null as string | null,
    examined: 0,
    upstreamTotal: null as number | null,
    upstreamTotalIsFloor: false,
    coverage: null as SearchJobSummary['coverage'],
    waves: 0,
    leaseToken: null as string | null,
    createdAt: '2026-10-04T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const hits = new Map<string, SearchJobHit>();
  let leases = 0;

  const summary = (): SearchJobSummary => ({
    id: row.id,
    status: row.status,
    statusReason: row.statusReason,
    plan: row.plan,
    examined: row.examined,
    verified: hits.size,
    upstreamTotal: row.upstreamTotal,
    upstreamTotalIsFloor: row.upstreamTotalIsFloor,
    coverage: row.coverage,
    waves: row.waves,
    leased: row.leaseToken !== null,
    lastWaveAt: null,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
    expiresAt: row.expiresAt,
  });

  const store: SearchJobStore = {
    create: async () => { throw new Error('not used'); },
    get: async () => summary(),
    list: async () => [summary()],
    hitsPage: async (_owner, _id, offset, limit) => {
      const ordered = [...hits.values()].sort((a, b) =>
        b.fileDate.localeCompare(a.fileDate) || a.accessionNumber.localeCompare(b.accessionNumber));
      return { total: hits.size, hits: ordered.slice(offset, offset + limit) };
    },
    cancel: async () => {
      if (row.status === 'running') row = { ...row, status: 'cancelled', statusReason: 'cancelled by the user' };
      return summary();
    },
    claim: async () => {
      if (row.status !== 'running' || row.leaseToken) return null;
      leases += 1;
      row = { ...row, leaseToken: `lease-${leases}` };
      const claimed: ClaimedSearchJob = {
        ...summary(),
        ownerUserId: row.ownerUserId,
        orgId: row.orgId,
        cursor: parseSearchJobCursor(JSON.parse(row.cursor)),
        leaseToken: row.leaseToken!,
      };
      return claimed;
    },
    lookupHits: async (_id, lease, accessions) => {
      if (lease !== row.leaseToken) return [];
      return accessions.map(accession => hits.get(accession)).filter((hit): hit is SearchJobHit => Boolean(hit));
    },
    advance: async input => {
      if (input.leaseToken !== row.leaseToken) return 'lease-lost';
      for (const write of input.hits) hits.set(write.accession, JSON.parse(JSON.stringify(write.hit)));
      row = {
        ...row,
        cursor: JSON.stringify(input.cursor),
        status: row.status === 'running' ? input.status : row.status,
        statusReason: row.status === 'running' ? input.statusReason : row.statusReason,
        examined: input.examined,
        upstreamTotal: input.upstreamTotal,
        upstreamTotalIsFloor: input.upstreamTotalIsFloor,
        coverage: input.coverage,
        waves: row.waves + 1,
        leaseToken: null,
      };
      return summary();
    },
    release: async (_id, lease) => {
      if (lease !== row.leaseToken) return 'lease-lost';
      row = { ...row, leaseToken: null };
      return summary();
    },
  };
  return { store, summary, hits, cursor: () => parseSearchJobCursor(JSON.parse(row.cursor)) };
}

function jobFor(query: string) {
  const compiled = compileSearchJobPlan({
    query,
    mode: 'boolean',
    filters: { ...defaultSearchFilters, formTypes: ['10-K'] },
    defaultForms: '10-K',
    includeExhibits: false,
    hydrateTextSignals: true,
  }, '2026-10-04');
  if (!compiled.ok) throw new Error(compiled.message);
  return compiled.plan;
}

const MATCH = 'Management identified a material weakness in internal control over financial reporting.';
const MISS = 'Management concluded that internal control over financial reporting was effective.';

async function runToCompletion(store: SearchJobStore, clients: ReturnType<typeof fixtureClients>['clients'], maxWaves = 50) {
  const headlines: string[] = [];
  for (let wave = 0; wave < maxWaves; wave += 1) {
    const job = await store.claim({ id: null, ownerUserId: null, leaseSeconds: 150 });
    if (!job) break;
    const outcome = await advanceClaimedSearchJob(job, { store, clients });
    expect(outcome.kind).toBe('advanced');
    if (outcome.kind !== 'advanced') break;
    headlines.push(buildSearchJobHeadline(outcome.job));
  }
  return headlines;
}

describe('search job worker (deterministic fixture plan)', () => {
  it('advances wave by wave past the 500-row cap and ends with a verified population', async () => {
    const plan = jobFor('material W/3 weakness');
    // 700 candidates, every fifth one matches → 140 filings truly match; more
    // than one 120-document wave, and more candidates than the browser's cap.
    const hits = Array.from({ length: 700 }, (_, index) => fixtureHit(index));
    const texts = Object.fromEntries(hits.map((hit, index) => [hit._source.primary_document!, index % 5 === 0 ? MATCH : MISS]));
    const memory = memoryStore(plan, createSearchJobCursor(plan));
    const { clients, calls } = fixtureClients({ lanes: { [plan.lanes[0]]: hits }, texts });

    const headlines = await runToCompletion(memory.store, clients);

    // ceil(700 / 120) waves of the unchanged per-wave document policy.
    expect(headlines).toHaveLength(6);
    expect(headlines[0]).toMatch(/^700 upstream candidates — 24 validated matches so far$/);
    expect(headlines.at(-1)).toBe('140 filings match (verified)');

    const job = memory.summary();
    expect(job.status).toBe('finished');
    expect(job.verified).toBe(140);
    expect(job.coverage?.complete).toBe(true);
    expect(job.coverage?.verifiedMatchTotal).toBe(140);
    expect(job.coverage?.verifiedMatchTotalIsFloor).toBe(false);
    // Every candidate was read exactly once — the cursor never re-collected a
    // window or re-validated a document.
    expect(calls.documents).toHaveLength(700);
    expect(new Set(calls.documents).size).toBe(700);
    expect(new Set(calls.pages.map(page => page.offset)).size).toBe(calls.pages.length);
    expect(memory.cursor()?.totals.examined).toBe(700);

    // Server pagination pages the full verified set in stable order.
    const first = await memory.store.hitsPage('user_1', job.id, 0, 100);
    const second = await memory.store.hitsPage('user_1', job.id, 100, 100);
    expect(first!.hits).toHaveLength(100);
    expect(second!.hits).toHaveLength(40);
    const accessions = [...first!.hits, ...second!.hits].map(hit => hit.accessionNumber);
    expect(new Set(accessions).size).toBe(140);
    // Snippets come from validated text, never from the candidate index.
    expect(first!.hits.every(hit => hit.matchSnippet.includes('material weakness'))).toBe(true);
  });

  it('gives every required Boolean branch its reserved share in each wave', async () => {
    const plan = jobFor('(mezzanine OR "temporary equity") AND redemption');
    expect(plan.requiredBranches).toBe(2);
    const [laneA, laneB] = plan.lanes;
    const broad = Array.from({ length: 400 }, (_, index) => fixtureHit(index));
    const rare = Array.from({ length: 30 }, (_, index) => fixtureHit(10_000 + index));
    const texts: Record<string, string> = {};
    for (const hit of broad) texts[hit._source.primary_document!] = 'Mezzanine equity with a redemption feature.';
    for (const hit of rare) texts[hit._source.primary_document!] = 'Shares classified as temporary equity subject to redemption.';
    const memory = memoryStore(plan, createSearchJobCursor(plan));
    const { clients, calls } = fixtureClients({ lanes: { [laneA]: broad, [laneB]: rare }, texts });

    const job = await memory.store.claim({ id: null, ownerUserId: null, leaseSeconds: 150 });
    const outcome = await advanceClaimedSearchJob(job!, { store: memory.store, clients });
    expect(outcome.kind).toBe('advanced');

    // The rare branch was reached in the FIRST wave despite the broad branch
    // having far more candidates than one wave can validate.
    const cursor = memory.cursor()!;
    expect(calls.pages.some(page => page.query === laneB)).toBe(true);
    expect(cursor.lanes[1].ledger.examined).toBeGreaterThan(0);
    expect(cursor.lanes[0].ledger.examined).toBeLessThanOrEqual(120 - 24);

    const headlines = await runToCompletion(memory.store, clients);
    expect(headlines.at(-1)).toBe('430 filings match (verified)');
  });

  it('retries a transient fetch failure once instead of excluding the filing', async () => {
    const plan = jobFor('material W/3 weakness');
    const hits = Array.from({ length: 20 }, (_, index) => fixtureHit(index));
    const texts = Object.fromEntries(hits.map(hit => [hit._source.primary_document!, MATCH]));
    const flaky = new Set([hits[3]._source.primary_document!]);
    const memory = memoryStore(plan, createSearchJobCursor(plan));
    const { clients } = fixtureClients({ lanes: { [plan.lanes[0]]: hits }, texts, flaky });

    const headlines = await runToCompletion(memory.store, clients);
    expect(headlines.at(-1)).toBe('20 filings match (verified)');
    expect(memory.cursor()?.totals.unvalidatedFailures).toBe(0);
  });

  it('counts a permanently unreadable filing and never calls the result verified', async () => {
    const plan = jobFor('material W/3 weakness');
    const hits = Array.from({ length: 10 }, (_, index) => fixtureHit(index));
    const texts = Object.fromEntries(hits.slice(1).map(hit => [hit._source.primary_document!, MATCH]));
    const memory = memoryStore(plan, createSearchJobCursor(plan));
    const { clients } = fixtureClients({ lanes: { [plan.lanes[0]]: hits }, texts });

    const headlines = await runToCompletion(memory.store, clients);
    const job = memory.summary();
    expect(job.status).toBe('finished');
    expect(job.verified).toBe(9);
    expect(job.coverage?.complete).toBe(false);
    expect(headlines.at(-1)).not.toMatch(/\(verified\)/);
    expect(memory.cursor()?.totals.failureKinds).toEqual({ 'not-found': 1 });
  });

  it('fails a job whose stored plan no longer compiles to the same lanes, without running a wave', async () => {
    const plan = jobFor('material W/3 weakness');
    const tampered: SearchJobPlan = { ...plan, lanes: ['something else'] };
    const memory = memoryStore(tampered, createSearchJobCursor(plan));
    const { clients, calls } = fixtureClients({ lanes: {}, texts: {} });
    const job = await memory.store.claim({ id: null, ownerUserId: null, leaseSeconds: 150 });
    const outcome = await advanceClaimedSearchJob(job!, { store: memory.store, clients });
    expect(outcome.kind).toBe('failed');
    expect(memory.summary().status).toBe('failed');
    expect(calls.pages).toHaveLength(0);
  });
});
