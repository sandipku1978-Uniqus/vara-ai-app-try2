import { expect, test, type Page } from '@playwright/test';
import { installBooleanFixtures } from './boolean-fixtures';
import { SEARCH_CORPUS, installFilingSearchFixtures } from './filing-search-fixtures';
import { assertSourceLinkContract, collectExternalLinks } from './source-link-contract';

/**
 * Archetype: the form-scoped research surfaces — exempt offerings, exhibits,
 * and earnings releases (WP8 clusters A and E).
 *
 * All three run the same pipeline against DIFFERENT form scopes, and all
 * three were previously unprovable for the same reason: the Boolean corpus
 * carries none of the forms they ask for, so every search returned nothing
 * and no result row — and therefore no source link — ever rendered.
 * filing-search-fixtures.ts supplies a form-aware corpus, which is what makes
 * both halves of this file possible.
 *
 * Each surface proves two things: a submitted search puts matching official
 * rows on screen, and every source link on those rows satisfies the shared
 * external-source contract.
 */

const REG_D = SEARCH_CORPUS.filter(f => f.form === 'D');
const EXHIBITS = SEARCH_CORPUS.filter(f => f.fileType.startsWith('EX-'));
const EARNINGS = SEARCH_CORPUS.filter(f => f.fileType === 'EX-99.1');

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

async function openWithFixtures(page: Page, route: string) {
  await installBooleanFixtures(page);
  // Registered second so it answers /api/sec-efts first, falling back to the
  // Boolean corpus for form scopes it does not carry.
  await installFilingSearchFixtures(page);
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
}

/** Submit the surface's own search form and wait for its rows. */
async function runSearch(page: Page, expectFirst: string) {
  await page.getByRole('button', { name: /^Search$/ }).first().click();
  await expect(page.getByText(expectFirst).first()).toBeVisible({ timeout: 30_000 });
}

test.describe('archetype: form-scoped research surfaces', () => {
  test('exempt-offerings.run-search returns Form D rows with their filing metadata', async ({ page }) => {
    await openWithFixtures(page, '/exempt-offerings');
    await runSearch(page, REG_D[0].entity);

    // Every issuer in scope appears, each carrying the metadata the contract
    // names — the form and the filing date, not just a company name.
    for (const filing of REG_D) {
      const row = page.locator('tbody tr', { hasText: filing.entity }).first();
      await expect(row, `${filing.entity} should be listed`).toBeVisible();
      await expect(row).toContainText(filing.form);
      await expect(row).toContainText(filing.filed);
    }
  });

  test('exempt-offerings.open-result-source links each Form D row to its official filing', async ({ page }) => {
    await openWithFixtures(page, '/exempt-offerings');
    await runSearch(page, REG_D[0].entity);
    assertSourceLinkContract(await collectExternalLinks(page), 'exempt offerings', /sec\.gov/);
  });

  test('exhibits.run-search returns exhibit rows and preserves the submitted type scope', async ({ page }) => {
    await openWithFixtures(page, '/exhibits');
    await runSearch(page, EXHIBITS[0].entity);

    // The contract's second half: the exhibit TYPE must survive into the
    // results, since that scope is the whole point of the search.
    for (const filing of EXHIBITS) {
      const row = page.locator('tbody tr', { hasText: filing.entity }).first();
      await expect(row, `${filing.entity} should be listed`).toBeVisible();
      await expect(row).toContainText(filing.fileType);
    }
  });

  test('exhibits.open-result-source links each exhibit row to its official document', async ({ page }) => {
    await openWithFixtures(page, '/exhibits');
    await runSearch(page, EXHIBITS[0].entity);
    assertSourceLinkContract(await collectExternalLinks(page), 'exhibits', /sec\.gov/);
  });

  test('earnings.run-search returns earnings-release exhibit rows', async ({ page }) => {
    await openWithFixtures(page, '/earnings');
    await runSearch(page, EARNINGS[0].entity);

    for (const filing of EARNINGS) {
      const row = page.locator('tbody tr', { hasText: filing.entity }).first();
      await expect(row, `${filing.entity} should be listed`).toBeVisible();
      // Earnings scope is EX-99.1 specifically; a row of another exhibit type
      // would mean the surface silently widened its own scope.
      await expect(row).toContainText('EX-99.1');
    }
  });

  test('earnings.open-result-source links each earnings row to its official exhibit', async ({ page }) => {
    await openWithFixtures(page, '/earnings');
    await runSearch(page, EARNINGS[0].entity);
    assertSourceLinkContract(await collectExternalLinks(page), 'earnings releases', /sec\.gov/);
  });
});

/**
 * NOW UNLOCKED BY THIS FIXTURE but not yet claimed — each still needs its own
 * assertions rather than being assumed from the rows existing:
 * - {earnings,exhibits,exempt-offerings}.open-recent-filing: the recent cards
 *   populate now, so opening one into the filing viewer is provable.
 * - {earnings,exhibits,exempt-offerings}.retry-failure: needs a failing
 *   variant of the corpus plus a request counter to prove the retry reruns
 *   only the failed region.
 * - exhibits.choose-types: the chips re-filter already-fetched rows, which is
 *   now observable because there are rows to re-filter.
 */
