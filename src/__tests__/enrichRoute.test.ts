import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('../lib/supabase-web', () => ({
  getWebSupabase: () => mocks,
}));
vi.mock('../lib/api-auth', () => ({
  requireApiAccess: vi.fn().mockResolvedValue({
    identity: { userId: 'test-user', orgId: null, cacheScope: 'test-user:personal' },
  }),
}));
vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitResponse: vi.fn(),
}));

import { GET, POST } from '../app/api/enrich/route';

describe('/api/enrich auditor scopes', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset().mockImplementation((table: string) => ({
      select: () => ({
        in: async () => table === 'urc_current_auditors'
          ? { data: [{ issuer_cik: 320193, firm_canonical: 'Deloitte', fiscal_period_end: '2025-09-27' }], error: null }
          : { data: [{ cik: 320193, sic: '3571', tickers: ['AAPL'] }], error: null },
      }),
    }));
  });

  it('labels GET auditor data as current issuer context', async () => {
    const response = await GET(new Request('http://localhost/api/enrich?ciks=320193'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.companies['320193']).toMatchObject({
      auditor: 'Deloitte',
      auditor_scope: 'current_issuer_latest_form_ap',
    });
    expect(body.meta).toEqual({ auditorScope: 'current_issuer_latest_form_ap' });
  });

  it('resolves POST inputs by filing key and date through the temporal RPC', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [{
        request_key: 'old-filing',
        auditor: 'KPMG',
        auditor_firm_name: 'KPMG LLP',
        auditor_candidates: ['KPMG'],
        auditor_firm_names: ['KPMG LLP'],
        auditor_form_filing_ids: [42],
        auditor_report_date: '2019-02-20',
        auditor_fiscal_period_ends: ['2018-12-31'],
        auditor_report_types: ['Issuer, other than Employee Benefit Plan or Investment Company'],
        auditor_source_rows: [{ formFilingId: 42 }],
        auditor_resolution_status: 'resolved',
        auditor_basis: 'latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date',
      }],
      error: null,
    });

    const response = await POST(new Request('http://localhost/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filings: [{ key: 'old-filing', cik: '0000320193', fileDate: '2020-03-01' }],
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('urc_resolve_filing_auditors', {
      p_filings: [{ key: 'old-filing', cik: '320193', file_date: '2020-03-01' }],
    });
    expect(body.filings['old-filing']).toMatchObject({
      auditor: 'KPMG',
      auditReportDate: '2019-02-20',
      resolutionStatus: 'resolved',
    });
    expect(body.meta).toEqual({ auditorScope: 'filing_date_form_ap_evidence' });
  });

  it('rejects duplicate keys before touching the database', async () => {
    const response = await POST(new Request('http://localhost/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filings: [
          { key: 'same', cik: '320193', fileDate: '2020-03-01' },
          { key: 'same', cik: '320193', fileDate: '2024-03-01' },
        ],
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('fails visibly when temporal evidence cannot be read', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });

    const response = await POST(new Request('http://localhost/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filings: [{ key: 'filing', cik: '320193', fileDate: '2020-03-01' }],
      }),
    }));

    expect(response.status).toBe(503);
  });
});
