import { expect, test, type Page, type Route } from '@playwright/test';
import { installBooleanFixtures } from './boolean-fixtures';
import {
  SEARCH_CORPUS,
  installFilingSearchFixtures,
  type SearchFixtureFiling,
} from './filing-search-fixtures';
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

function officialDocumentUrl(filing: SearchFixtureFiling): string {
  return `https://www.sec.gov/Archives/edgar/data/${filing.cik}/${filing.accession.replace(/-/g, '')}/${filing.document}`;
}

/**
 * Activate one exact row source, while keeping every network byte local to
 * the test. The post-click checks deliberately cover the opener as well as
 * the popup: opening the right SEC document is only half the action contract
 * if the submitted research state is lost in the process.
 */
async function assertExactOfficialSourceActivation(
  page: Page,
  options: {
    filing: SearchFixtureFiling;
    accessibleName: string;
    searchLabel: string;
  }
) {
  const { filing, accessibleName, searchLabel } = options;
  const expectedUrl = officialDocumentUrl(filing);
  const resultRow = page.locator('tbody tr', { hasText: filing.entity }).first();
  const source = resultRow.getByRole('link', { name: accessibleName, exact: true });
  const search = page.getByLabel(searchLabel, { exact: true });
  const openerUrl = page.url();
  const submittedQuery = await search.inputValue();
  const resultCount = await page.locator('tbody tr').count();

  await expect(source).toHaveAttribute('href', expectedUrl);
  await page.context().route(
    url => url.href === expectedUrl,
    route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<html><body><h1>Official SEC fixture for ${filing.entity}</h1></body></html>`,
    })
  );

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    source.click(),
  ]);
  await expect(popup).toHaveURL(expectedUrl);
  await expect(popup.getByRole('heading', { name: `Official SEC fixture for ${filing.entity}` })).toBeVisible();

  await expect(page).toHaveURL(openerUrl);
  await expect(search).toHaveValue(submittedQuery);
  await expect(resultRow).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(resultCount);
  await popup.close();
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
    const filing = REG_D[0];
    await page.getByLabel('Search Form D filings', { exact: true }).fill(filing.entity);
    await runSearch(page, filing.entity);
    assertSourceLinkContract(await collectExternalLinks(page), 'exempt offerings', /sec\.gov/);
    await assertExactOfficialSourceActivation(page, {
      filing,
      accessibleName: `View the ${filing.form} filing from ${filing.entity}, filed ${filing.filed}, on SEC.gov`,
      searchLabel: 'Search Form D filings',
    });
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
    const filing = EXHIBITS[0];
    await page.getByLabel('Search exhibits', { exact: true }).fill(filing.entity);
    await runSearch(page, filing.entity);
    assertSourceLinkContract(await collectExternalLinks(page), 'exhibits', /sec\.gov/);
    await assertExactOfficialSourceActivation(page, {
      filing,
      accessibleName: `View exhibit ${filing.fileType} attached to ${filing.form} from ${filing.entity}, filed ${filing.filed}, on SEC.gov`,
      searchLabel: 'Search exhibits',
    });
  });

  test('exhibits.choose-types re-filters collected rows without another SEC search', async ({ page }) => {
    await installBooleanFixtures(page);
    const stats = await installFilingSearchFixtures(page);
    await page.goto('/exhibits', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await runSearch(page, EXHIBITS[0].entity);

    const requestsBeforeFiltering = stats.formRequests.length;
    const merger = page.getByRole('button', { name: 'Merger Agreement (EX-2.1)' });
    const material = page.getByRole('button', { name: 'Material Contract (EX-10.x)' });

    await merger.click();
    await expect(merger).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(EXHIBITS[0].entity).first()).toBeVisible();
    await expect(page.getByText(EXHIBITS[1].entity)).toHaveCount(0);

    await material.click();
    await merger.click();
    await expect(merger).toHaveAttribute('aria-pressed', 'false');
    await expect(material).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(EXHIBITS[0].entity)).toHaveCount(0);
    await expect(page.getByText(EXHIBITS[1].entity).first()).toBeVisible();
    expect(stats.formRequests.length, 'type chips must filter the collected window client-side').toBe(requestsBeforeFiltering);
  });

  test('exhibits.open-recent-filing opens the exact recent exhibit in the filing viewer', async ({ page }) => {
    await openWithFixtures(page, '/exhibits');
    const recent = EXHIBITS[0];
    await page.getByRole('button', { name: new RegExp(recent.entity) }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(
      `/filing/${recent.cik}_${recent.accession}_${recent.document}`
    );
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
    const filing = EARNINGS[0];
    await page.getByLabel('Search earnings-release exhibits', { exact: true }).fill(filing.entity);
    await runSearch(page, filing.entity);
    assertSourceLinkContract(await collectExternalLinks(page), 'earnings releases', /sec\.gov/);
    await assertExactOfficialSourceActivation(page, {
      filing,
      accessibleName: `View earnings-release exhibit ${filing.fileType} attached to ${filing.form} from ${filing.entity}, filed ${filing.filed}, on SEC.gov`,
      searchLabel: 'Search earnings-release exhibits',
    });
  });

  test('earnings.open-recent-filing opens the exact recent release in the filing viewer', async ({ page }) => {
    await openWithFixtures(page, '/earnings');
    const recent = EARNINGS[0];
    await page.getByRole('button', { name: new RegExp(recent.entity) }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(
      `/filing/${recent.cik}_${recent.accession}_${recent.document}`
    );
  });

  async function assertRecentRetry(
    page: Page,
    surface: { route: string; retryName: string; recoveredEntity: string }
  ) {
    await installBooleanFixtures(page);
    await installFilingSearchFixtures(page);

    let attempts = 0;
    let recover = false;
    await page.route('**/api/sec-efts**', async (route: Route) => {
      attempts += 1;
      // The production client retries transient failures internally. Keep the
      // upstream down until the visible Retry action is used, otherwise an
      // automatic attempt could recover and this would test no failure state.
      if (!recover) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'fixture upstream unavailable' }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(surface.route, { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    const retry = page.getByRole('button', { name: surface.retryName });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    const attemptsBeforeRetry = attempts;

    recover = true;
    await retry.click();
    await expect(page.getByText(surface.recoveredEntity).first()).toBeVisible({ timeout: 30_000 });
    await expect(retry).toHaveCount(0);
    expect(attempts, 'Retry must issue a new request rather than only clear the error').toBeGreaterThan(attemptsBeforeRetry);
  }

  test('exhibits.retry-failure repeats the failed recent request and replaces its error', async ({ page }) => {
    await assertRecentRetry(page, {
      route: '/exhibits',
      retryName: 'Retry recent SEC exhibits',
      recoveredEntity: EXHIBITS[0].entity,
    });
  });

  test('earnings.retry-failure repeats the failed recent request and replaces its error', async ({ page }) => {
    await assertRecentRetry(page, {
      route: '/earnings',
      retryName: 'Retry recent official source',
      recoveredEntity: EARNINGS[0].entity,
    });
  });
});

/**
 * STILL DEFERRED, with an explicit boundary: exempt-offerings recent-opening
 * and retry behavior need their own assertions. Exhibits and earnings are
 * covered above, but one working sibling is not evidence for another route.
 */
