import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AIResultsSummary from '../components/tables/AIResultsSummary';
import { askAi } from '../services/aiApi';

vi.mock('../services/aiApi', () => ({ askAi: vi.fn() }));

describe('AIResultsSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not spend on render and runs only after explicit user action', async () => {
    vi.mocked(askAi).mockResolvedValue('A metadata-supported pattern.');
    const user = userEvent.setup();
    render(
      <AIResultsSummary
        query="revenue"
        resultsSummary="Apple | 10-K | 2026-01-01"
        resultCount={1}
        moduleLabel="filings"
        cacheKey="opt-in-test"
      />
    );

    expect(askAi).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Generate insight' }));
    await waitFor(() => expect(askAi).toHaveBeenCalledTimes(1));
    expect(askAi).toHaveBeenCalledWith(expect.any(String), undefined, { throwOnError: true });
    expect(await screen.findByText('A metadata-supported pattern.')).toBeInTheDocument();
    expect(screen.getByText(/Review the source filings before relying/i)).toBeInTheDocument();
  });

  it('renders a retryable error instead of silently disappearing', async () => {
    vi.mocked(askAi).mockRejectedValue(new Error('upstream unavailable'));
    const user = userEvent.setup();
    render(
      <AIResultsSummary
        query="cybersecurity"
        resultsSummary="Issuer metadata"
        resultCount={2}
        moduleLabel="filings"
        cacheKey="error-test"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Generate insight' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI summary unavailable');
    expect(screen.getByRole('button', { name: 'Retry insight' })).toBeInTheDocument();
  });

  it('rejects and does not cache an empty insight', async () => {
    vi.mocked(askAi).mockResolvedValueOnce('   ').mockResolvedValueOnce('Recovered insight.');
    const user = userEvent.setup();
    render(
      <AIResultsSummary
        query="controls"
        resultsSummary="Issuer metadata"
        resultCount={1}
        moduleLabel="filings"
        cacheKey="empty-test"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Generate insight' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('AI summary unavailable');
    await user.click(screen.getByRole('button', { name: 'Retry insight' }));
    expect(await screen.findByText('Recovered insight.')).toBeInTheDocument();
    expect(askAi).toHaveBeenCalledTimes(2);
  });
});
