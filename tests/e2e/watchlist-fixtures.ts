import type { Page, Route } from '@playwright/test';

/**
 * Company directory + submissions stand-ins for the watchlist archetype.
 *
 * The Boolean fixtures deliberately serve `company_tickers.json` as `{}` —
 * Boolean search never needs the directory. But the watchlist DOES: the
 * dashboard's company search resolves suggestions from it, and Filing
 * Detail's "add to watchlist" resolves a filing's CIK to a ticker through it
 * (with no match it reports "no ticker symbol is attached" and saves nothing).
 * An empty directory therefore makes every add path silently do nothing,
 * which is exactly what the first probe of /dashboard showed.
 */

export const DIRECTORY = [
  { cik: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  { cik: 789019, ticker: 'MSFT', title: 'Microsoft Corporation' },
  { cik: 1045810, ticker: 'NVDA', title: 'NVIDIA Corporation' },
  // The Boolean corpus issuers, so a filing opened from fixtures can resolve
  // its own ticker when saved to the watchlist.
  { cik: 1000001, ticker: 'MEZZ', title: 'Mezz Only Corp' },
  { cik: 1000002, ticker: 'TEMP', title: 'Temp Only Inc' },
  { cik: 1000003, ticker: 'BOTH', title: 'Both Holdings Ltd' },
  { cik: 1000004, ticker: 'NEAR', title: 'Near Miss Partners' },
];

/** The SEC ships this as an object keyed by row index, not an array. */
function directoryPayload(): Record<string, { cik_str: number; ticker: string; title: string }> {
  return Object.fromEntries(
    DIRECTORY.map((entry, index) => [
      String(index),
      { cik_str: entry.cik, ticker: entry.ticker, title: entry.title },
    ])
  );
}

function submissionsPayload(cik: string) {
  const entry = DIRECTORY.find(d => String(d.cik) === String(Number(cik)));
  return {
    cik: String(Number(cik)),
    name: entry?.title ?? 'Fixture Issuer',
    tickers: entry ? [entry.ticker] : [],
    filings: {
      recent: {
        accessionNumber: ['0001000003-26-000003'],
        filingDate: ['2026-03-04'],
        reportDate: ['2026-03-04'],
        form: ['10-K'],
        primaryDocument: ['fixture-10k.htm'],
        primaryDocDescription: ['Annual report'],
      },
    },
  };
}

/**
 * Layer onto installBooleanFixtures. Playwright matches routes most-recently
 * registered first, so this handler wins for the directory and submissions
 * reads while the Boolean fixtures keep serving filing documents.
 */
export async function installWatchlistFixtures(page: Page): Promise<void> {
  await page.route('**/api/sec-proxy**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') || '';

    if (path.includes('company_tickers.json')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(directoryPayload()) });
      return;
    }
    const submissions = path.match(/submissions\/CIK(\d+)\.json/i);
    if (submissions) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(submissionsPayload(submissions[1])) });
      return;
    }
    // Anything else is a filing document read — let the Boolean fixtures answer.
    await route.fallback();
  });
}
