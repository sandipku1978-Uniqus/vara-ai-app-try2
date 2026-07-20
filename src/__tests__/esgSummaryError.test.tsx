import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const secApi = vi.hoisted(() => ({
  searchEdgarFilings: vi.fn(),
  fetchFilingText: vi.fn(),
}));

const aiApi = vi.hoisted(() => ({
  aiSummarize: vi.fn(),
}));

vi.mock('../services/secApi', () => ({
  lookupCIK: vi.fn(),
  fetchCompanySubmissions: vi.fn(),
  findLatestFiling: vi.fn(),
  fetchFilingText: secApi.fetchFilingText,
  searchEdgarFilings: secApi.searchEdgarFilings,
}));

vi.mock('../services/aiApi', () => ({
  aiRateESGDisclosure: vi.fn(),
  aiSummarize: aiApi.aiSummarize,
}));

import ESGResearch from '../views/ESGResearch';

describe('ESG source-summary failures', () => {
  it('renders an AI failure as a retryable alert, never as summary content', async () => {
    secApi.searchEdgarFilings.mockResolvedValueOnce([{
      _id: 'filing-id',
      _source: {
        display_names: ['Example Corp'],
        file_date: '2026-07-01',
        ciks: ['0000123456'],
        adsh: '0000123456-26-000001',
        primary_document: 'example-8k.htm',
      },
    }]);
    secApi.fetchFilingText.mockResolvedValueOnce('Item 2.02 Results of Operations. '.repeat(30));
    aiApi.aiSummarize.mockRejectedValueOnce(new Error('AI service is not configured.'));

    render(<ESGResearch />);
    fireEvent.click(screen.getByRole('button', { name: /Earnings Releases/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Generate source summary' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The source summary could not be generated');
    expect(screen.getByRole('button', { name: 'Retry summary' })).toBeInTheDocument();
    expect(screen.queryByText('AI service is not configured.')).not.toBeInTheDocument();
  });
});
