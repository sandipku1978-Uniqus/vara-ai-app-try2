import { expect, test, type Page, type Route } from '@playwright/test';
import { installBooleanFixtures } from './boolean-fixtures';

const NO_ACTION_HTML = `
  <html><body><div class="field--name-body"><ul>
    <li><a href="/files/no-action/acme-capital.pdf">Acme Capital Markets</a> August 1, 2026</li>
    <li><a href="/files/no-action/beacon-funds.pdf">Beacon Funds Trust</a> July 14, 2026</li>
  </ul></div></body></html>
`;

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

async function installNoActionFixture(page: Page) {
  let requests = 0;
  await page.route('**/api/sec-proxy**', async (route: Route) => {
    const path = new URL(route.request().url()).searchParams.get('path') || '';
    if (!/no-action|noaction/i.test(path)) {
      await route.fallback();
      return;
    }
    requests += 1;
    await route.fulfill({ status: 200, contentType: 'text/html', body: NO_ACTION_HTML });
  });
  return () => requests;
}

test.describe('official-source search interactions', () => {
  test('no-action-letters.run-search repeats the official query and displays only matching records', async ({ page }) => {
    await installBooleanFixtures(page);
    const requestCount = await installNoActionFixture(page);
    await page.goto('/no-action-letters', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await expect(page.getByText('Acme Capital Markets').first()).toBeVisible({ timeout: 20_000 });

    const initialRequests = requestCount();
    const input = page.getByRole('textbox', { name: 'Search official SEC no-action responses' });
    await input.fill('Acme');
    await input.press('Enter');

    const row = page.locator('tbody tr', { hasText: 'Acme Capital Markets' });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row).toContainText('August 1, 2026');
    await expect(row).toContainText(/Corporation Finance|Investment Management|Trading and Markets/);
    await expect(page.getByText('Beacon Funds Trust')).toHaveCount(0);
    expect(requestCount(), 'submitting the query must fetch the official indexes again').toBeGreaterThan(initialRequests);
  });

  test('no-action-letters.retry-source repeats the same criteria and replaces the failure', async ({ page }) => {
    await installBooleanFixtures(page);
    let failedOnce = false;
    let requests = 0;
    await page.route('**/api/sec-proxy**', async (route: Route) => {
      const path = new URL(route.request().url()).searchParams.get('path') || '';
      if (!/no-action|noaction/i.test(path)) {
        await route.fallback();
        return;
      }
      requests += 1;
      if (!failedOnce) {
        failedOnce = true;
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'fixture upstream unavailable' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: NO_ACTION_HTML });
    });

    await page.goto('/no-action-letters', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    const retry = page.getByRole('button', { name: 'Retry official source' });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    const requestsBeforeRetry = requests;

    await retry.click();
    await expect(page.getByText('Acme Capital Markets').first()).toBeVisible({ timeout: 20_000 });
    await expect(retry).toHaveCount(0);
    expect(requests, 'Retry must issue another request for the official source').toBeGreaterThan(requestsBeforeRetry);
  });
});
