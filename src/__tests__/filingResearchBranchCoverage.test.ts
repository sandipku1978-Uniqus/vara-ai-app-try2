import { describe, it, expect, beforeEach, vi } from 'vitest';

// Query-dependent EDGAR mock: each candidate query returns only the filings that
// contain ALL of its bare tokens (mirrors EFTS AND-of-terms). This is what makes
// the test able to prove OR-branch coverage — returning the same docs for every
// query would hide the bug.
const mocks = vi.hoisted(() => ({ search: vi.fn(), fetchText: vi.fn() }));

vi.mock('../services/secApi', () => ({
  searchEdgarFilings: mocks.search,
  fetchFilingText: mocks.fetchText,
  fetchFilingTextOutcome: async (...a: unknown[]) => { const t = await mocks.fetchText(...a); return t ? { ok: true, text: t } : { ok: false, kind: "upstream", retryable: true }; },
  isEnrichedSearchEnabled: () => false,
  fetchCompanySubmissions: async () => null,
  resolveCompanyInput: async () => null,
  // null = pre-screen unavailable. Branch-fairness, budget and coverage
  // guarantees must hold on the local path alone, so these cases keep testing
  // it directly; the pre-screen has its own suites.
  prescreenBooleanCandidates: async () => null,
}));
vi.mock('../services/referenceData', () => ({
  loadSicDirectoryIndex: async () => ({}),
  loadSicDirectory: async () => [],
}));

import { executeFilingResearchSearch } from '../services/filingResearch';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import type { SearchCandidateCoverage } from '../services/secApi';

const TEXT: Record<string, string> = {
  D1: 'alpha only appears here',
  D2: 'beta only appears here',
  D3: 'alpha and beta together',
  D4: 'beta and gamma together',
  D5: 'alpha beta gamma all present',
};

function hit(id: string) {
  return {
    _id: `${id}:doc.htm`,
    _score: 1,
    _source: {
      display_names: [`Co ${id}`],
      file_date: '2026-01-01',
      file_type: '10-K',
      adsh: `0000000000-26-0000${id.slice(1)}`,
      ciks: [`000000000${id.slice(1)}`],
    },
  };
}

const DOC_IDS = Object.keys(TEXT);

beforeEach(() => {
  mocks.search.mockReset();
  mocks.fetchText.mockReset();
  // Return docs whose text contains every bare token of the candidate query.
  mocks.search.mockImplementation(async (query: string) => {
    const tokens = String(query).replace(/["()]/g, ' ').split(/\s+/)
      .filter(t => t && !/^(AND|OR|NOT)$/i.test(t)).map(t => t.toLowerCase());
    return DOC_IDS.filter(id => tokens.every(tok => TEXT[id].toLowerCase().includes(tok))).map(hit);
  });
  mocks.fetchText.mockImplementation(async (cik: string) => {
    const id = DOC_IDS.find(d => d.slice(1) === String(cik).replace(/^0+/, ''));
    return id ? TEXT[id] : '';
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
});

describe('Boolean OR-branch coverage', () => {
  it('retrieves every OR disjunct, including the rare beta-only branch', async () => {
    const results = await executeFilingResearchSearch({
      query: 'alpha OR beta',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
    });
    const ids = results.map(r => r.cik.replace(/^0+/, ''));
    // Union: D1..D5 (beta-only D2 and D4 must be present).
    expect(ids).toContain('2'); // D2 beta-only
    expect(ids).toContain('4'); // D4 beta+gamma
    expect(ids).toContain('1'); // D1 alpha-only
  });

  it('AND is a subset of OR over the same corpus', async () => {
    const or = await executeFilingResearchSearch({
      query: 'alpha OR beta', filters: { ...defaultSearchFilters }, mode: 'boolean', limit: 50,
    });
    const and = await executeFilingResearchSearch({
      query: 'alpha AND beta', filters: { ...defaultSearchFilters }, mode: 'boolean', limit: 50,
    });
    const orIds = new Set(or.map(r => r.cik));
    const andIds = and.map(r => r.cik);
    expect(andIds.length).toBeGreaterThan(0);
    for (const id of andIds) expect(orIds.has(id)).toBe(true);
    // AND is exactly {D3, D5}
    expect(new Set(and.map(r => r.cik.replace(/^0+/, '')))).toEqual(new Set(['3', '5']));
  });

  it('queries the second OR branch even when the first branch fills the display limit', async () => {
    // "alpha" returns a full page; "beta" returns the rare doc. With the bug the
    // loop breaks after the display limit fills on the alpha branch and never
    // queries beta.
    const bulk = Array.from({ length: 60 }, (_, i) => hit(`A${i}`));
    mocks.search.mockImplementation(async (query: string) => {
      const q = String(query).toLowerCase();
      if (q === 'alpha') return bulk;
      if (q === 'beta') return [hit('D2')];
      return [];
    });
    mocks.fetchText.mockImplementation(async () => 'alpha beta'); // everything validates
    await executeFilingResearchSearch({
      query: 'alpha OR beta', filters: { ...defaultSearchFilters }, mode: 'boolean', limit: 5,
    });
    const queried = mocks.search.mock.calls.map(c => String(c[0]).toLowerCase());
    expect(queried).toContain('beta');
  });

  it('a saturated broad branch cannot hide a branch-exclusive match (F-06)', async () => {
    // Branch 1 (alpha) saturates the display limit before branch 2 (beta) is
    // validated. Querying beta is not enough — its exclusive document must be
    // able to ENTER the result set. The rare doc matches BOTH terms, so it
    // outscores every single-term bulk doc (~93 points) and deterministically
    // ranks first once it is allowed to validate at all.
    const bulk = Array.from({ length: 40 }, (_, i) => hit(`A${i}`));
    const rare = {
      _id: 'RARE:doc.htm',
      _score: 1,
      _source: {
        display_names: ['Rare Branch Co'],
        file_date: '2026-06-30',
        file_type: '10-K',
        adsh: '0000000777-26-000777',
        ciks: ['0000000777'],
      },
    };
    mocks.search.mockImplementation(async (query: string) => {
      const q = String(query).toLowerCase();
      if (q === 'alpha') return bulk;
      if (q === 'beta') return [rare];
      return [];
    });
    mocks.fetchText.mockImplementation(async (cik: string) =>
      String(cik).replace(/^0+/, '') === '777' ? 'alpha beta both present here' : 'alpha appears here'
    );

    const results = await executeFilingResearchSearch({
      query: 'alpha OR beta', filters: { ...defaultSearchFilters }, mode: 'boolean', limit: 5,
    });

    expect(results.map(r => r.cik.replace(/^0+/, ''))).toContain('777');
  });

  it('stops at the per-run document budget and reports the run as partial', async () => {
    // One branch returns far more candidates than the 120-document cap.
    const many = Array.from({ length: 300 }, (_, i) => hit(`B${i}`));
    mocks.search.mockImplementation(async () => many);
    mocks.fetchText.mockImplementation(async () => 'alpha present');
    const onDegraded = vi.fn();
    await executeFilingResearchSearch({
      query: 'alpha',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 500,
      onDegraded,
    });
    // Never exceeds the 120 document-attempt budget.
    expect(mocks.fetchText.mock.calls.length).toBeLessThanOrEqual(120);
    // And the run is honestly disclosed as a bounded partial.
    expect(onDegraded).toHaveBeenCalledWith(expect.stringMatching(/request budget/i));
  });

  it('applies an explicit issuer CIK as structured scope in Boolean mode', async () => {
    mocks.search.mockImplementation(async () => [hit('D1')]);
    mocks.fetchText.mockImplementation(async () => 'alpha present');
    await executeFilingResearchSearch({
      query: 'alpha',
      filters: { ...defaultSearchFilters, entityCik: '0000320193' },
      mode: 'boolean',
      limit: 50,
    });
    // The CIK reaches retrieval as scope rather than being re-resolved from text.
    const options = mocks.search.mock.calls[0]?.[6] as { entityCik?: string } | undefined;
    expect(options?.entityCik).toBe('0000320193');
  });

  it('honors an already-aborted signal without issuing any EDGAR page', async () => {
    mocks.search.mockImplementation(async () => [hit('D1')]);
    const controller = new AbortController();
    controller.abort();
    await executeFilingResearchSearch({
      query: 'alpha',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
      signal: controller.signal,
    });
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('stops fetching filing text once the run is aborted mid-flight', async () => {
    const many = Array.from({ length: 50 }, (_, i) => hit(`D${i}`));
    const controller = new AbortController();
    // Abort as the first EDGAR page resolves — before any text validation runs.
    mocks.search.mockImplementation(async () => { controller.abort(); return many; });
    mocks.fetchText.mockImplementation(async () => 'alpha present');
    await executeFilingResearchSearch({
      query: 'alpha',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 50,
      signal: controller.signal,
    });
    expect(mocks.fetchText).not.toHaveBeenCalled();
  });
});

describe('deterministic ordering', () => {
  it('returns identical IDs and order across runs with randomised arrival timing', async () => {
    const docs = ['D1', 'D3', 'D5'];
    const runOnce = async () => {
      // Vary per-call latency so promise completion order differs between runs.
      mocks.search.mockImplementation(async () => {
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 12)));
        return docs.map(hit);
      });
      mocks.fetchText.mockImplementation(async (cik: string) => {
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 12)));
        const id = docs.find(d => d.slice(1) === String(cik).replace(/^0+/, ''));
        return id ? TEXT[id] : '';
      });
      const res = await executeFilingResearchSearch({
        query: 'alpha',
        filters: { ...defaultSearchFilters },
        mode: 'boolean',
        limit: 50,
      });
      return res.map(r => `${r.accessionNumber}:${r.primaryDocument}`).join('|');
    };

    const baseline = await runOnce();
    expect(baseline.length).toBeGreaterThan(0);
    // Plan §12 gate: twenty randomised-latency runs return identical IDs/order.
    for (let i = 0; i < 20; i += 1) {
      expect(await runOnce()).toBe(baseline);
    }
  });
});

describe('structured filter family semantics', () => {
  // Distinct CIKs/accessions: the filing-signal cache is module-level and keyed
  // by cik+accession, so reusing D1/D3 here would replay signals cached by the
  // earlier tests (whose fixture text carries no filer status).
  function filerHit(n: number) {
    return {
      _id: `FAM${n}:doc.htm`,
      _score: 1,
      _source: {
        display_names: [`Filer Co ${n}`],
        file_date: '2026-05-0' + n,
        file_type: '10-K',
        adsh: `0000009${n}9-26-00009${n}`,
        ciks: [`00000009${n}9`],
      },
    };
  }

  it('combines values inside one filter family with OR, not AND', async () => {
    // "Large accelerated filer" and "Accelerated filer" are mutually exclusive
    // statuses. Under the old AND-within-family rule, selecting both could only
    // ever return zero filings.
    mocks.search.mockImplementation(async () => [filerHit(1), filerHit(2)]);
    mocks.fetchText.mockImplementation(async (cik: string) =>
      String(cik).endsWith('919')
        ? 'alpha appears here. Large accelerated filer.'
        : 'alpha appears here. Accelerated filer.'
    );

    const results = await executeFilingResearchSearch({
      query: 'alpha',
      filters: { ...defaultSearchFilters, acceleratedStatus: ['LAF', 'AF'] },
      mode: 'boolean',
      limit: 50,
    });

    expect(results.length).toBeGreaterThan(0);
  });
});

describe('fair branch retrieval and the per-branch coverage ledger (WP4)', () => {
  // The handoff's critical starvation fixture: branch alpha exposes 300
  // candidates, branch beta exposes ONE exclusive matching accession, and the
  // run has a 120-document validation budget. Before fair-share reservations,
  // alpha's validation spent the whole budget and broke the outer loop on
  // budgetExhausted — beta's exclusive match was collected, counted, and then
  // silently absent from results presented as the full expression.
  const BETA_CIK = '0000000777';
  const BETA_ACCESSION = '0000000777-26-000777';

  function alphaHit(index: number) {
    const serial = String(index).padStart(4, '0');
    return {
      _id: `S${serial}:doc.htm`,
      _score: 1,
      _source: {
        display_names: [`Alpha Issuer ${serial}`],
        file_date: '2026-01-01',
        file_type: '10-K',
        adsh: `0000550000-26-0${serial}`,
        ciks: [`000055${serial}`],
      },
    };
  }
  const betaHit = {
    _id: 'SBETA:doc.htm',
    _score: 1,
    _source: {
      display_names: ['Beta Exclusive Issuer'],
      file_date: '2026-06-30',
      file_type: '10-K',
      adsh: BETA_ACCESSION,
      ciks: [BETA_CIK],
    },
  };

  function mockStarvationCorpus(alphaCount: number) {
    mocks.search.mockImplementation(async (query: string) => {
      const q = String(query).toLowerCase();
      if (q === 'beta') return [betaHit];
      if (q === 'alpha') return Array.from({ length: alphaCount }, (_, i) => alphaHit(i));
      return [];
    });
    mocks.fetchText.mockImplementation(async (cik: string) =>
      String(cik).replace(/^0+/, '') === '777'
        ? 'the beta disclosure appears here'
        : 'the alpha disclosure appears here'
    );
  }

  it('starvation fixture: the beta-exclusive accession survives a 300-candidate alpha branch', async () => {
    mockStarvationCorpus(300);
    let coverage: SearchCandidateCoverage | null = null;
    const degraded: string[] = [];

    const results = await executeFilingResearchSearch({
      query: 'alpha OR beta',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 500,
      hydrateTextSignals: true,
      onCoverage: c => { coverage = c; },
      onDegraded: message => { degraded.push(message); },
    });

    // The exclusive branch's match is in the result set.
    expect(results.some(row => row.accessionNumber === BETA_ACCESSION)).toBe(true);

    // Both required branches are ledgered truthfully: beta fully validated,
    // alpha honestly partial at its fair-share document cap (120 global minus
    // the 24-document reserve held for beta = 96).
    const branches = coverage!.branches ?? [];
    const alpha = branches.find(entry => entry.branch === 'alpha');
    const beta = branches.find(entry => entry.branch === 'beta');
    expect(alpha?.required).toBe(true);
    expect(beta?.required).toBe(true);
    expect(beta?.candidatesSurfaced).toBe(1);
    expect(beta?.examined).toBe(1);
    expect(beta?.matched).toBe(1);
    expect(alpha?.incompleteReason).toBe('doc-budget');
    expect(alpha?.exhausted).toBe(false);
    expect(alpha?.examined).toBe(96);
    expect(alpha?.candidatesNew).toBe(300);

    // A truncated run never claims complete coverage, and says so out loud.
    expect(coverage!.complete).toBe(false);
    expect(degraded.some(message => /request budget/i.test(message))).toBe(true);
  });

  it('a run that validates every branch candidate ledgers both branches exhausted', async () => {
    mockStarvationCorpus(5);
    let coverage: SearchCandidateCoverage | null = null;

    const results = await executeFilingResearchSearch({
      query: 'alpha OR beta',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 500,
      hydrateTextSignals: true,
      onCoverage: c => { coverage = c; },
    });

    expect(results.length).toBe(6);
    const branches = coverage!.branches ?? [];
    for (const name of ['alpha', 'beta']) {
      const entry = branches.find(candidate => candidate.branch === name);
      expect(entry?.examined).toBe(entry?.candidatesNew);
      expect(entry?.incompleteReason).toBeUndefined();
      expect(entry?.exhausted).toBe(true);
    }
  });

  it('aggregate completeness requires every required branch exhausted, not just aggregate counts', async () => {
    mockStarvationCorpus(300);
    let coverage: SearchCandidateCoverage | null = null;

    await executeFilingResearchSearch({
      query: 'alpha OR beta',
      filters: { ...defaultSearchFilters },
      mode: 'boolean',
      limit: 500,
      hydrateTextSignals: true,
      onCoverage: c => { coverage = c; },
    });

    const required = (coverage!.branches ?? []).filter(entry => entry.required);
    expect(required.length).toBeGreaterThanOrEqual(2);
    expect(required.every(entry => entry.exhausted)).toBe(false);
    expect(coverage!.complete).toBe(false);
  });
});
