import { describe, expect, it } from 'vitest';
import { defaultSearchFilters } from '../domain/searchFilters';
import {
  createResumableCursor,
  runResumableWave,
  type ResumableWaveCursor,
} from '../services/filingResearchExecution';
import type { FilingResearchResult } from '../services/filingResearch';
import {
  buildSearchJobCoverage,
  buildSearchJobHeadline,
  compileSearchJobPlan,
  createSearchJobCursor,
  decideSearchJobStatus,
  digestSeenSet,
  mergeSearchJobHits,
  parseSearchJobCursor,
  parseSearchJobPlanInput,
  recompileStoredPlan,
  SEARCH_JOB_ENGINE_VERSION,
  SEARCH_JOB_LIMITS,
  searchJobContext,
  searchJobPolicy,
  serializeSearchJobCursor,
  shouldOfferSearchContinuation,
  type SearchJobPlanInput,
} from '../services/searchJobs';
import { filingResearchStages } from '../services/filingResearch';
import { fixtureClients, fixtureHit } from './searchJobFixtures';

const TODAY = '2026-10-04';

function booleanInput(query: string, overrides: Partial<SearchJobPlanInput> = {}): SearchJobPlanInput {
  return {
    query,
    mode: 'boolean',
    filters: { ...defaultSearchFilters, formTypes: ['10-K'] },
    defaultForms: '10-K',
    includeExhibits: false,
    hydrateTextSignals: true,
    ...overrides,
  };
}

function compiled(input: SearchJobPlanInput) {
  const result = compileSearchJobPlan(input, TODAY);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe('search job plan', () => {
  it('pins the filing-date ceiling at creation so the population cannot drift', () => {
    const open = compiled(booleanInput('material W/5 weakness'));
    expect(open.plan.pinnedDateTo).toBe(TODAY);
    expect(open.compiled.filters.dateTo).toBe(TODAY);

    const bounded = compiled(booleanInput('material W/5 weakness', {
      filters: { ...defaultSearchFilters, formTypes: ['10-K'], dateTo: '2020-12-31' },
    }));
    expect(bounded.plan.pinnedDateTo).toBe('2020-12-31');
  });

  it('refuses a search EDGAR already answers without reading text', () => {
    const delegated = compileSearchJobPlan(booleanInput('"net ai"'), TODAY);
    expect(delegated.ok).toBe(false);
    if (!delegated.ok) expect(delegated.code).toBe('not-needed');
  });

  it('refuses a filter-only browse with no pageable text', () => {
    const browse = compileSearchJobPlan({
      query: '',
      mode: 'semantic',
      filters: { ...defaultSearchFilters, sectionScope: '1A' },
      defaultForms: '10-K',
      includeExhibits: false,
      hydrateTextSignals: true,
    }, TODAY);
    expect(browse.ok).toBe(false);
    if (!browse.ok) expect(browse.code).toBe('unsupported');
  });

  it('re-derives the same lanes for every wave and refuses engine drift', () => {
    const { plan } = compiled(booleanInput('(mezzanine OR "temporary equity") AND redemption'));
    expect(plan.engineVersion).toBe(SEARCH_JOB_ENGINE_VERSION);
    expect(plan.requiredBranches).toBeGreaterThanOrEqual(2);
    expect(recompileStoredPlan(plan).ok).toBe(true);
    const drifted = recompileStoredPlan({ ...plan, engineVersion: 'wave-cursor-0.boolean-1' });
    expect(drifted.ok).toBe(false);
    const tampered = recompileStoredPlan({ ...plan, lanes: [...plan.lanes].reverse() });
    expect(tampered.ok).toBe(false);
  });

  it('accepts only a strictly typed request', () => {
    expect(parseSearchJobPlanInput(booleanInput('a AND b'))).not.toBeNull();
    expect(parseSearchJobPlanInput({ ...booleanInput('a AND b'), mode: 'regex' })).toBeNull();
    expect(parseSearchJobPlanInput({ ...booleanInput('a AND b'), filters: { formTypes: '10-K' } })).toBeNull();
    expect(parseSearchJobPlanInput({ ...booleanInput('a AND b'), filters: { dateFrom: 'last year' } })).toBeNull();
    const extra = parseSearchJobPlanInput({ ...booleanInput('a AND b'), filters: { formTypes: ['10-K'], injected: 'x' } });
    expect(extra?.filters).not.toHaveProperty('injected');
  });
});

describe('search job cursor serialization', () => {
  it('round-trips a fresh cursor through JSON', () => {
    const { plan } = compiled(booleanInput('(mezzanine OR "temporary equity") AND redemption'));
    const stored = createSearchJobCursor(plan);
    const wire = JSON.parse(JSON.stringify(stored));
    const parsed = parseSearchJobCursor(wire);
    expect(parsed).toEqual(stored);
    expect(parsed?.lanes.map(lane => lane.query)).toEqual(plan.lanes);
    expect(parsed?.lanes.filter(lane => lane.required)).toHaveLength(plan.requiredBranches);
  });

  it('round-trips a mid-job cursor with pending candidates, retries and ledgers', async () => {
    const hits = Array.from({ length: 160 }, (_, index) => fixtureHit(index));
    const texts = Object.fromEntries(hits.map((hit, index) => [
      hit._source.primary_document!,
      index % 4 === 0 ? 'The company reported a material weakness in controls.' : 'Nothing relevant here.',
    ]));
    const { plan, compiled: compiledPlan } = compiled(booleanInput('material W/3 weakness'));
    const cursor = createResumableCursor<FilingResearchResult>(plan.lanes, plan.requiredBranches);
    const { clients } = fixtureClients({ lanes: { [plan.lanes[0]]: hits }, texts });

    const wave = await runResumableWave({
      cursor,
      search: searchJobContext(compiledPlan, plan.input),
      policy: searchJobPolicy(compiledPlan),
      clients,
      maxExamined: SEARCH_JOB_LIMITS.maxExamined,
      perQueryResultLimit: compiledPlan.perQueryResultLimit,
    });

    const stored = serializeSearchJobCursor(wave.cursor);
    const parsed = parseSearchJobCursor(JSON.parse(JSON.stringify(stored)));
    expect(parsed).toEqual(stored);
    // The wave validated its 120-document budget and carried the rest.
    expect(parsed!.totals.examined).toBe(120);
    expect(parsed!.lanes[0].pending.length + parsed!.totals.examined).toBe(parsed!.lanes[0].nextOffset);
    expect(parsed!.seen).toHaveLength(parsed!.lanes[0].nextOffset);
  });

  it('rejects a cursor whose seen set no longer matches its digest', () => {
    const { plan } = compiled(booleanInput('material W/3 weakness'));
    const stored = createSearchJobCursor(plan);
    const tampered = { ...stored, seen: ['0000000001-24-000001:doc.htm'] };
    expect(parseSearchJobCursor(tampered)).toBeNull();
    expect(parseSearchJobCursor({ ...stored, version: 2 })).toBeNull();
    expect(parseSearchJobCursor({ ...stored, lanes: [{ query: 'x' }] })).toBeNull();
  });

  it('digests the seen set independently of order', () => {
    expect(digestSeenSet(['b', 'a'])).toBe(digestSeenSet(['a', 'b']));
    expect(digestSeenSet(['a'])).not.toBe(digestSeenSet(['a', 'b']));
  });
});

function cursorWith(mutate: (cursor: ResumableWaveCursor<FilingResearchResult>) => void) {
  const cursor = createResumableCursor<FilingResearchResult>(['lane a', 'lane b'], 2);
  mutate(cursor);
  return cursor;
}

describe('search job status and headline', () => {
  const policy = searchJobPolicy(compiled(booleanInput('material W/3 weakness')).compiled);
  const future = Date.parse('2026-10-05T00:00:00Z');
  const now = Date.parse('2026-10-04T12:00:00Z');

  it('grows from validated matches to a verified population only when complete', () => {
    // Wave 1: some lanes still collecting.
    const running = cursorWith(cursor => {
      cursor.lanes[0].upstreamTotal = 2_400;
      cursor.lanes[0].nextOffset = 120;
      cursor.seen = Array.from({ length: 120 }, (_, i) => `id-${i}`);
      cursor.totals.examined = 120;
      cursor.totals.waves = 1;
    });
    const runningStatus = decideSearchJobStatus(running, { now, expiresAt: future });
    expect(runningStatus.status).toBe('running');
    const runningCoverage = buildSearchJobCoverage(running, {
      stoppedEarly: false, cancelled: false, verifiedFilings: 31, perWavePolicy: policy,
    });
    expect(runningCoverage.complete).toBe(false);
    expect(runningCoverage.verifiedMatchTotalIsFloor).toBe(true);
    // Two required lanes: the aggregate total is a floor (finalizer rule).
    expect(buildSearchJobHeadline({ status: 'running', verified: 31, coverage: runningCoverage, examined: 120 }))
      .toBe('2,400+ upstream candidates — 31 validated matches so far');

    // Final wave: every lane exhausted, every candidate examined.
    const done = cursorWith(cursor => {
      for (const lane of cursor.lanes) {
        lane.collectionComplete = true;
        lane.upstreamTotal = 2_400;
        lane.ledger.exhausted = true;
      }
      cursor.seen = Array.from({ length: 2_400 }, (_, i) => `id-${i}`);
      cursor.totals.examined = 2_400;
      cursor.totals.waves = 20;
    });
    expect(decideSearchJobStatus(done, { now, expiresAt: future }).status).toBe('finished');
    const doneCoverage = buildSearchJobCoverage(done, {
      stoppedEarly: false, cancelled: false, verifiedFilings: 612, perWavePolicy: policy,
    });
    expect(doneCoverage.complete).toBe(true);
    expect(doneCoverage.verifiedMatchTotal).toBe(612);
    expect(doneCoverage.verifiedMatchTotalIsFloor).toBe(false);
    expect(buildSearchJobHeadline({ status: 'finished', verified: 612, coverage: doneCoverage, examined: 2_400 }))
      .toBe('612 filings match (verified)');
  });

  it('never calls a stopped or unreadable run a verified population', () => {
    const capped = cursorWith(cursor => {
      cursor.lanes[0].upstreamTotal = 9_000;
      cursor.totals.examined = SEARCH_JOB_LIMITS.maxExamined;
      cursor.totals.waves = 42;
    });
    const decision = decideSearchJobStatus(capped, { now, expiresAt: future });
    expect(decision.status).toBe('capped');
    const coverage = buildSearchJobCoverage(capped, {
      stoppedEarly: true, cancelled: false, verifiedFilings: 800, perWavePolicy: policy,
    });
    expect(coverage.complete).toBe(false);
    expect(buildSearchJobHeadline({ status: 'capped', verified: 800, coverage, examined: 5_000 }))
      .toBe('9,000+ upstream candidates — 800 validated matches — stopped at a limit');

    const unreadable = cursorWith(cursor => {
      for (const lane of cursor.lanes) lane.collectionComplete = true;
      cursor.seen = ['a', 'b'];
      cursor.totals.examined = 2;
      cursor.totals.unvalidatedFailures = 1;
      cursor.totals.failureKinds = { 'not-found': 1 };
    });
    expect(decideSearchJobStatus(unreadable, { now, expiresAt: future }).status).toBe('finished');
    const unreadableCoverage = buildSearchJobCoverage(unreadable, {
      stoppedEarly: false, cancelled: false, verifiedFilings: 1, perWavePolicy: policy,
    });
    expect(unreadableCoverage.complete).toBe(false);
    expect(buildSearchJobHeadline({ status: 'finished', verified: 1, coverage: unreadableCoverage, examined: 2 }))
      .not.toMatch(/\(verified\)/);
  });

  it('caps a lane EDGAR will not page past 10,000 and explains why', () => {
    const windowed = cursorWith(cursor => {
      cursor.lanes[0].windowCapped = true;
      cursor.lanes[1].collectionComplete = true;
    });
    const decision = decideSearchJobStatus(windowed, { now, expiresAt: future });
    expect(decision.status).toBe('capped');
    expect(decision.reason).toMatch(/10,000/);
  });

  it('expires a job that outlives its window', () => {
    const cursor = cursorWith(() => undefined);
    expect(decideSearchJobStatus(cursor, { now: future + 1, expiresAt: future }).status).toBe('expired');
  });

  it('offers continuation only when EDGAR cannot answer the question', () => {
    expect(shouldOfferSearchContinuation({ examined: 120, upstreamTotal: 900, complete: false }, 'boolean', true)).toBe(true);
    expect(shouldOfferSearchContinuation({ examined: 900, upstreamTotal: 900, complete: true }, 'boolean', true)).toBe(false);
    expect(shouldOfferSearchContinuation(
      { examined: 120, upstreamTotal: 900, complete: false, verifiedMatchTotal: 900, verifiedMatchTotalIsFloor: false },
      'boolean',
      true
    )).toBe(false);
    expect(shouldOfferSearchContinuation({ examined: 50, upstreamTotal: 900, complete: false }, 'semantic', false)).toBe(false);
  });
});

describe('search job hit merge', () => {
  const row = (accession: string, document: string, documentType: string): FilingResearchResult =>
    ({
      ...filingResearchStages.mapSearchHit(fixtureHit(1)),
      id: `${accession}:${document}`,
      accessionNumber: accession,
      primaryDocument: document,
      documentType,
      cik: '1000001',
    });

  it('keeps one row per filing across waves, preferring the parent document', () => {
    const accession = '0001000001-24-000001';
    const wave1 = mergeSearchJobHits([], [row(accession, 'ex99.htm', 'EX-99.1')], filingResearchStages.isExhibitDocumentType);
    expect(wave1.writes).toHaveLength(1);
    expect(wave1.writes[0].hit.matchedDocumentType).toBe('EX-99.1');
    expect(wave1.writes[0].hit.matchedDocumentCount).toBe(1);

    const wave2 = mergeSearchJobHits(
      wave1.writes.map(write => write.hit),
      [row(accession, 'form10k.htm', '10-K')],
      filingResearchStages.isExhibitDocumentType
    );
    expect(wave2.writes).toHaveLength(1);
    const merged = wave2.writes[0].hit;
    expect(merged.primaryDocument).toBe('form10k.htm');
    expect(merged.matchedDocumentType).toBeUndefined();
    expect(merged.matchedDocumentCount).toBe(2);
    expect(merged.jobDocuments).toEqual(['ex99.htm', 'form10k.htm']);
  });

  it('skips rows that cannot be keyed by accession rather than inventing a key', () => {
    const result = mergeSearchJobHits([], [row('not-an-accession', 'a.htm', '10-K')], filingResearchStages.isExhibitDocumentType);
    expect(result.writes).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });
});
