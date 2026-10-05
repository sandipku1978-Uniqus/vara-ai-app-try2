import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { defaultSearchFilters } from '../domain/searchFilters';
import SearchJobPanel from '../components/research/SearchJobPanel';
import { compileSearchJobPlan, type SearchJobPlanInput } from '../services/searchJobs';

const JOB_ID = '00000000-0000-4000-8000-000000000001';

const input: SearchJobPlanInput = {
  query: 'material W/3 weakness',
  mode: 'boolean',
  filters: { ...defaultSearchFilters, formTypes: ['10-K'] },
  defaultForms: '10-K',
  includeExhibits: false,
  hydrateTextSignals: true,
};

function plan() {
  const compiled = compileSearchJobPlan(input, '2026-10-04');
  if (!compiled.ok) throw new Error('fixture plan');
  return compiled.plan;
}

function job(overrides: Record<string, unknown>) {
  return {
    id: JOB_ID,
    status: 'running',
    statusReason: null,
    plan: plan(),
    examined: 120,
    verified: 24,
    upstreamTotal: 700,
    upstreamTotalIsFloor: false,
    coverage: { examined: 120, upstreamTotal: 700, complete: false, verifiedMatchTotal: 24, verifiedMatchTotalIsFloor: true },
    waves: 1,
    leased: false,
    lastWaveAt: null,
    createdAt: '2026-10-04T00:00:00Z',
    updatedAt: '2026-10-04T00:00:00Z',
    expiresAt: '2026-10-05T00:00:00Z',
    ...overrides,
  };
}

const hit = {
  id: 'h1',
  accessionNumber: '0001000001-24-000001',
  entityName: 'Issuer One',
  fileDate: '2024-02-01',
  formType: '10-K',
  documentType: '10-K',
  primaryDocument: 'one.htm',
  cik: '1000001',
  matchReason: 'Matched within 1 words',
  matchSnippet: 'identified a material weakness in controls',
  filingUrl: 'https://www.sec.gov/Archives/edgar/data/1000001/000100000124000001/one.htm',
  jobDocuments: ['one.htm'],
};

let jobReads = 0;

beforeEach(() => {
  jobReads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/filing-scope')) {
      return Response.json({ ok: true, scope: { total: 41_203, byYear: [{ year: 2019, filings: 5_000 }, { year: 2026, filings: 4_000 }], coverageStart: '2010-01-02' } });
    }
    if (url === '/api/search-jobs' && init?.method === 'POST') {
      return Response.json({ ok: true, job: job({}) }, { status: 201 });
    }
    if (url === '/api/search-jobs/continue') {
      return Response.json({ ok: true, advanced: true, job: job({}) });
    }
    if (url.startsWith(`/api/search-jobs/${JOB_ID}`)) {
      jobReads += 1;
      // First read: mid-job. Every later read: finished with complete coverage.
      const current = jobReads === 1
        ? job({})
        : job({
            status: 'finished',
            examined: 700,
            verified: 140,
            waves: 6,
            coverage: { examined: 700, upstreamTotal: 700, complete: true, verifiedMatchTotal: 140, verifiedMatchTotalIsFloor: false },
          });
      return Response.json({ ok: true, job: current, hits: { total: current.verified, offset: 0, limit: 50, items: [hit] } });
    }
    return new Response(null, { status: 404 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SearchJobPanel', () => {
  it('offers Keep validating for a partial run and attaches the created job', async () => {
    const onAttach = vi.fn();
    render(
      <SearchJobPanel jobId={null} offerSearch={input} onAttach={onAttach} onDetach={() => undefined} onOpenFiling={() => undefined} />
    );
    fireEvent.click(screen.getByRole('button', { name: /keep validating/i }));
    await waitFor(() => expect(onAttach).toHaveBeenCalledWith(JOB_ID));
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => url === '/api/search-jobs')!;
    expect(JSON.parse(init.body).search.query).toBe('material W/3 weakness');
  });

  it('renders nothing when there is neither a job nor an offer', () => {
    const { container } = render(
      <SearchJobPanel jobId={null} offerSearch={null} onAttach={() => undefined} onDetach={() => undefined} onOpenFiling={() => undefined} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('grows the headline from validated matches to a verified population', async () => {
    const onJobChange = vi.fn();
    render(
      <SearchJobPanel jobId={JOB_ID} offerSearch={null} onAttach={() => undefined} onDetach={() => undefined} onOpenFiling={() => undefined} onJobChange={onJobChange} />
    );
    expect(await screen.findByRole('heading', { name: '700 upstream candidates — 24 validated matches so far' })).toBeInTheDocument();
    // The owner's open pane drives a wave, then re-reads the job.
    expect(await screen.findByRole('heading', { name: '140 filings match (verified)' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/search-jobs/continue', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByText('identified a material weakness in controls')).toBeInTheDocument();
    expect(onJobChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'finished', verified: 140 }));
  });

  it('states the searched population as a population, never as matches', async () => {
    render(
      <SearchJobPanel jobId={JOB_ID} offerSearch={null} onAttach={() => undefined} onDetach={() => undefined} onOpenFiling={() => undefined} />
    );
    expect(await screen.findByText('What was searched')).toBeInTheDocument();
    expect(await screen.findByText('41,203')).toBeInTheDocument();
    expect(screen.getByText(/a population, not matches/)).toBeInTheDocument();
    const scopeCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url).startsWith('/api/filing-scope'));
    expect(String(scopeCall?.[0])).toContain('forms=10-K');
    expect(String(scopeCall?.[0])).toContain('end=2026-10-04');
  });
});
