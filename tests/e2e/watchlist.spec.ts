import { expect, test, type Page } from '@playwright/test';
import { FILINGS, installBooleanFixtures } from './boolean-fixtures';
import { installWatchlistFixtures } from './watchlist-fixtures';

/**
 * Archetype: adding and removing issuers from a browser-local set
 * (WP8 cluster F).
 *
 * Every action in this family promises the same two things, and both are
 * about EXACTNESS rather than the happy path: the issuer is added ONCE (a
 * second add must not duplicate it), and removing one takes only that one
 * (the rest of the set survives). A watchlist that silently duplicates, or
 * that drops a neighbour when you remove an entry, is a quiet data-loss bug —
 * the control appears to work either way.
 */

const BOTH = FILINGS[2]; // 'Both Holdings Ltd' — ticker BOTH in the fixture directory

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

async function installFixtures(page: Page) {
  await installBooleanFixtures(page);
  // Registered second so it wins for the company directory and submissions.
  await installWatchlistFixtures(page);
}

/** Tickers currently on the watchlist, read from their remove controls. */
async function watchedTickers(page: Page): Promise<string[]> {
  return page.$$eval('button[aria-label^="Remove "]', buttons =>
    buttons
      .map(b => (b.getAttribute('aria-label') || '').match(/^Remove (\S+) from watchlist$/)?.[1])
      .filter((t): t is string => Boolean(t))
  );
}

test.describe('archetype: watchlist membership', () => {
  test('dashboard.add-watch-company adds a chosen issuer exactly once', async ({ page }) => {
    await installFixtures(page);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    // The dashboard seeds AAPL and MSFT, so this also proves an add does not
    // disturb issuers already on the list.
    await expect.poll(() => watchedTickers(page), { timeout: 20_000 }).toEqual(['AAPL', 'MSFT']);

    const search = page.getByPlaceholder('Add ticker or company name...');
    await search.click();
    await search.fill('NVDA');
    await page.getByRole('option', { name: /NVDA/ }).first().click();

    await expect.poll(() => watchedTickers(page), { timeout: 20_000 }).toEqual(['AAPL', 'MSFT', 'NVDA']);

    // Adding the same issuer again must not produce a second entry — the
    // contract says "added once", and a duplicate would double every
    // subsequent filing-activity read for that issuer.
    //
    // Note this asserts the OUTCOME, not one implementation layer: duplicates
    // are guarded twice (Dashboard.handleAddCompany refuses, and
    // AppState.addToWatchlist would too). Breaking either alone still yields a
    // correct list, so a layer-specific test here would prove nothing.
    await search.fill('NVDA');
    await page.getByRole('option', { name: /NVDA/ }).first().click();
    await expect
      .poll(() => watchedTickers(page), { timeout: 10_000 })
      .toEqual(['AAPL', 'MSFT', 'NVDA']);
    // The refusal is stated rather than silent, so the researcher knows the
    // issuer is already tracked instead of assuming the click missed.
    await expect(page.getByText('Already in watchlist.')).toBeVisible({ timeout: 10_000 });
  });

  test('dashboard.remove-watch-company removes only the chosen issuer', async ({ page }) => {
    await installFixtures(page);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await expect.poll(() => watchedTickers(page), { timeout: 20_000 }).toEqual(['AAPL', 'MSFT']);

    await page.getByRole('button', { name: 'Remove AAPL from watchlist' }).click();

    // Only AAPL leaves; MSFT is untouched.
    await expect.poll(() => watchedTickers(page), { timeout: 20_000 }).toEqual(['MSFT']);

    // And the removal is durable, not just a render-time filter.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await expect.poll(() => watchedTickers(page), { timeout: 20_000 }).toEqual(['MSFT']);
  });

  test('filing-detail.save-watchlist saves the filing issuer without duplicating it', async ({ page }) => {
    await installFixtures(page);
    await page.goto(`/filing/${Number(BOTH.cik)}_${BOTH.accession}_${BOTH.document}`, { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    const save = page.getByRole('button', { name: /watchlist/i }).first();
    await expect(save).toBeVisible({ timeout: 20_000 });
    await save.click();
    // The issuer's ticker is resolved through the company directory; without a
    // match the app reports that nothing was saved, so assert the success copy.
    await expect(page.getByText(/BOTH was added to your watchlist/i)).toBeVisible({ timeout: 20_000 });

    // Saving twice from the same filing must still leave one entry.
    await save.click();

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await expect
      .poll(() => watchedTickers(page), { timeout: 20_000 })
      .toEqual(['AAPL', 'MSFT', 'BOTH']);
  });
});

/**
 * DEFERRED, with reasons — the rest of cluster F needs data this suite does
 * not fixture:
 * - accounting-analytics.add-company / remove-company: the comparison loads
 *   XBRL company-facts per issuer; a probe showed the add doing nothing at all
 *   without them.
 * - insider-trading.add-company / remove-company: same shape, needs Form 4
 *   filing rows per issuer to prove "only its associated rows are removed".
 * - esg-research.manage-heatmap-companies: the heatmap analyses a 10-K per
 *   issuer before a column exists.
 * - benchmarking.add-or-remove-company: /compare needs a peer cohort loaded
 *   before columns can be removed.
 */
