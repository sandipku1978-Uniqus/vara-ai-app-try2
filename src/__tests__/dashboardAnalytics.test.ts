import { describe, expect, it } from 'vitest';
import { buildWatchlistAnalytics } from '../services/dashboardAnalytics';
import type { SecSubmission } from '../services/secApi';

function submission(forms: string[], dates: string[]): SecSubmission {
  return {
    cik: '1', name: 'Example', tickers: ['EX'], exchanges: ['NYSE'], ein: '', description: '', sic: '3571', sicDescription: 'Computers',
    filings: {
      recent: {
        accessionNumber: forms.map((_, index) => `a-${index}`),
        filingDate: dates,
        reportDate: dates,
        acceptanceDateTime: dates,
        act: forms.map(() => '34'),
        form: forms,
        fileNumber: forms.map(() => '001-1'),
        primaryDocument: forms.map((_, index) => `doc-${index}.htm`),
        primaryDocDescription: forms,
      },
    },
  };
}

describe('watchlist dashboard analytics', () => {
  it('computes only from the named live watchlist population and current year', () => {
    const analytics = buildWatchlistAnalytics(['AAA', 'BBB'], {
      AAA: submission(['10-K', '8-K', '10-Q'], ['2026-01-10', '2026-02-10', '2025-12-31']),
      BBB: submission(['8-K', '8-K'], ['2026-02-11', '2026-02-12']),
      OUTSIDE: submission(['S-1'], ['2026-02-15']),
    }, 2026, 1);

    expect(analytics.filingVolumeData).toEqual([
      { month: 'Jan', AAA: 1, BBB: 0 },
      { month: 'Feb', AAA: 1, BBB: 2 },
    ]);
    expect(analytics.filingMix).toEqual([
      { form: '8-K', count: 3 },
      { form: '10-K', count: 1 },
    ]);
    expect(analytics.unavailableTickers).toEqual([]);
  });

  it('renders unavailable issuer data as gaps rather than false zero filings', () => {
    const analytics = buildWatchlistAnalytics(['AAA', 'MISSING'], {
      AAA: submission(['10-K'], ['2026-01-10']),
    }, 2026, 0);

    expect(analytics.filingVolumeData).toEqual([
      { month: 'Jan', AAA: 1, MISSING: null },
    ]);
    expect(analytics.filingMix).toEqual([{ form: '10-K', count: 1 }]);
    expect(analytics.unavailableTickers).toEqual(['MISSING']);
  });
});
