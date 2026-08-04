import { afterEach, describe, expect, it, vi } from 'vitest';

const submissionsApi = vi.hoisted(() => ({
  fetchCompanySubmissions: vi.fn(),
  fetchSubmissionHistory: vi.fn(),
}));

vi.mock('../services/secSubmissions', () => ({
  fetchCompanySubmissions: submissionsApi.fetchCompanySubmissions,
  fetchSubmissionHistory: submissionsApi.fetchSubmissionHistory,
}));

import { resolvePrimaryDocumentPath } from '../services/secApi';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('primary document resolution cache', () => {
  it('deduplicates success but evicts an empty failure so a later visit can retry', async () => {
    const accession = '0000320193-24-000123';
    submissionsApi.fetchCompanySubmissions
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        filings: {
          recent: {
            accessionNumber: [accession],
            primaryDocument: ['aapl-20240928.htm'],
          },
        },
      });
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolvePrimaryDocumentPath('320193', accession)).resolves.toBe('');
    await expect(resolvePrimaryDocumentPath('320193', accession)).resolves.toBe('aapl-20240928.htm');
    await expect(resolvePrimaryDocumentPath('320193', accession)).resolves.toBe('aapl-20240928.htm');

    expect(submissionsApi.fetchCompanySubmissions).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
