import { expect, test, type Page } from '@playwright/test';
import { defaultSearchFilters } from '../../src/domain/searchFilters';
import { installBooleanFixtures } from './boolean-fixtures';
import {
  COMMENT_LETTERS,
  COMMENT_RETRY_SUMMARY,
  COMMENT_THREAD,
  COMMENT_TOPIC_QUERY,
  DASHBOARD_AAPL_FILING,
  installCommentLetterFixtures,
  installDashboardActionFixtures,
  type CommentLetterFixtureOptions,
} from './dashboard-comment-letter-fixtures';
import { installWatchlistFixtures } from './watchlist-fixtures';

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

async function installDashboardFixtures(page: Page) {
  await installBooleanFixtures(page);
  await installWatchlistFixtures(page);
  // Registered last so the exact AAPL/MSFT filing locators win over the
  // generic watchlist submissions fixture.
  await installDashboardActionFixtures(page);
}

async function openCommentLetters(page: Page, options: CommentLetterFixtureOptions = {}) {
  const stats = await installCommentLetterFixtures(page, options);
  await page.goto('/comment-letters', { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
  return stats;
}

function lastParams(requests: string[]): URLSearchParams {
  return new URLSearchParams(requests.at(-1) || '');
}

const SAVED_ALERTS = [
  {
    id: 'alert-revenue',
    name: 'Revenue covenant alert',
    query: 'mezzanine OR temporary',
    mode: 'boolean' as const,
    filters: {
      ...defaultSearchFilters,
      dateFrom: '2026-01-01',
      formTypes: ['10-K'],
    },
    defaultForms: '',
    createdAt: '2026-04-01T12:00:00.000Z',
    // Keep fixture alerts fresh so opening the Dashboard does not implicitly
    // exercise Check Now; that has its own critical-action journey.
    lastCheckedAt: '2099-01-01T00:00:00.000Z',
    lastSeenAccessions: [],
    latestNewAccessions: [],
    latestResultCount: 2,
    engineVersion: 5,
  },
  {
    id: 'alert-control',
    name: 'Control alert that must survive',
    query: 'mezzanine',
    mode: 'boolean' as const,
    filters: { ...defaultSearchFilters, formTypes: ['10-Q'] },
    defaultForms: '',
    createdAt: '2026-04-02T12:00:00.000Z',
    lastCheckedAt: '2099-01-01T00:00:00.000Z',
    lastSeenAccessions: [],
    latestNewAccessions: [],
    latestResultCount: 1,
    engineVersion: 5,
  },
];

async function seedSavedAlerts(page: Page, alerts = SAVED_ALERTS): Promise<string> {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
  await expect.poll(
    () => page.evaluate(() => Object.keys(localStorage).find(key => key.endsWith('.vara.alerts.v1')) || ''),
    { timeout: 20_000 }
  ).not.toBe('');

  const storageKey = await page.evaluate(() =>
    Object.keys(localStorage).find(key => key.endsWith('.vara.alerts.v1')) || ''
  );
  if (!storageKey) throw new Error('The identity-scoped alert storage key was not created.');
  await page.evaluate(
    ({ key, alerts }) => localStorage.setItem(key, JSON.stringify(alerts)),
    { key: storageKey, alerts }
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
  return storageKey;
}

test.describe('dashboard action contracts', () => {
  test('dashboard.open-company-research supplies the activated ticker to the Research Workbench', async ({ page }) => {
    await installDashboardFixtures(page);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    const company = page.getByRole('button', { name: 'Research Apple Inc.' });
    await expect(company).toBeVisible({ timeout: 20_000 });
    await company.click();

    await expect(page).toHaveURL(/\/search\?/);
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('AAPL');
    await expect(page.getByRole('combobox', { name: 'Search filings' })).toHaveValue('AAPL');
    await expect(page.getByRole('heading', { name: 'Research Workbench' })).toBeVisible();
  });

  test('dashboard.open-recent-filing opens the exact selected filing identity', async ({ page }) => {
    await installDashboardFixtures(page);
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    const row = page.getByRole('button', {
      name: `Open ${DASHBOARD_AAPL_FILING.issuer} ${DASHBOARD_AAPL_FILING.form} filed ${DASHBOARD_AAPL_FILING.filed}`,
    });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();

    const exactPath = `/filing/${DASHBOARD_AAPL_FILING.cik}_${DASHBOARD_AAPL_FILING.accession}_${DASHBOARD_AAPL_FILING.document}`;
    await expect(page).toHaveURL(new RegExp(`${exactPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?|$)`));
    await expect(page.getByRole('heading', { name: DASHBOARD_AAPL_FILING.document })).toBeVisible({ timeout: 20_000 });
  });

  test('dashboard.open-or-remove-alert restores exact criteria and removes only the chosen alert', async ({ page }) => {
    await installDashboardFixtures(page);
    const storageKey = await seedSavedAlerts(page);

    const revenueCard = page.locator('.rss-news-card').filter({ hasText: SAVED_ALERTS[0].name });
    await expect(revenueCard).toBeVisible({ timeout: 20_000 });
    await revenueCard.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page).toHaveURL(/\/search\?/);

    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        q: params.get('q'),
        mode: params.get('mode'),
        forms: params.get('forms'),
        from: params.get('from'),
      };
    }).toEqual({
      q: SAVED_ALERTS[0].query,
      mode: SAVED_ALERTS[0].mode,
      forms: '10-K',
      from: '2026-01-01',
    });

    const showFilters = page.getByRole('button', { name: 'Expand search filters' });
    if (await showFilters.isVisible().catch(() => false)) await showFilters.click();
    const expandQuery = page.getByRole('button', { name: 'Expand', exact: true });
    if (await expandQuery.isVisible().catch(() => false)) await expandQuery.click();
    await expect(page.getByRole('button', { name: 'Boolean / Proximity' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('combobox', { name: 'Boolean search query' })).toHaveValue(SAVED_ALERTS[0].query);
    await expect(page.getByRole('button', { name: 'Remove 10-K filter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove From: 2026-01-01 filter' })).toBeVisible();

    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    const chosenCard = page.locator('.rss-news-card').filter({ hasText: SAVED_ALERTS[0].name });
    await chosenCard.getByRole('button', { name: 'Remove', exact: true }).click();

    await expect(page.getByText(SAVED_ALERTS[0].name)).toHaveCount(0);
    await expect(page.getByText(SAVED_ALERTS[1].name)).toBeVisible();
    await expect.poll(() => page.evaluate(
      key => JSON.parse(localStorage.getItem(key) || '[]').map((alert: { id: string }) => alert.id),
      storageKey
    )).toEqual([SAVED_ALERTS[1].id]);

    // Persistence distinguishes deletion from a temporary render filter.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await expect(page.getByText(SAVED_ALERTS[0].name)).toHaveCount(0);
    await expect(page.getByText(SAVED_ALERTS[1].name)).toBeVisible();
  });

  test('dashboard.check-saved-alert rejects an unmeasured run without replacing prior alert evidence', async ({ page }) => {
    await installDashboardFixtures(page);
    const previousCoverage = {
      complete: true,
      examined: 7,
      upstreamTotal: 7,
      upstreamTotalIsFloor: false,
    };
    const invalidAlert = {
      ...SAVED_ALERTS[0],
      id: 'alert-invalid-plan',
      name: 'Prior evidence must survive',
      query: 'temporary AND (',
      lastSeenAccessions: ['0000320193-26-000101'],
      latestNewAccessions: ['0000320193-26-000101'],
      latestResultCount: 7,
      lastCheckCoverage: previousCoverage,
    };
    const storageKey = await seedSavedAlerts(page, [invalidAlert]);
    const card = page.locator('.rss-news-card').filter({ hasText: invalidAlert.name });
    await expect(card).toBeVisible({ timeout: 20_000 });

    await card.getByRole('button', { name: 'Check Now' }).click();
    await expect(card.getByRole('alert')).toContainText('Existing counts were not replaced', { timeout: 20_000 });
    await expect.poll(() => page.evaluate(
      ({ key, id }) => {
        const alerts = JSON.parse(localStorage.getItem(key) || '[]') as Array<Record<string, unknown>>;
        const alert = alerts.find(item => item.id === id);
        return alert && {
          lastCheckedAt: alert.lastCheckedAt,
          lastSeenAccessions: alert.lastSeenAccessions,
          latestNewAccessions: alert.latestNewAccessions,
          latestResultCount: alert.latestResultCount,
          engineVersion: alert.engineVersion,
          lastCheckCoverage: alert.lastCheckCoverage,
        };
      },
      { key: storageKey, id: invalidAlert.id }
    )).toEqual({
      lastCheckedAt: invalidAlert.lastCheckedAt,
      lastSeenAccessions: invalidAlert.lastSeenAccessions,
      latestNewAccessions: invalidAlert.latestNewAccessions,
      latestResultCount: invalidAlert.latestResultCount,
      engineVersion: invalidAlert.engineVersion,
      lastCheckCoverage: previousCoverage,
    });
  });
});

test.describe('comment-letter action contracts', () => {
  test('comment-letters.apply-example-or-form applies the example and reruns an active search in the selected form scope', async ({ page }) => {
    const stats = await openCommentLetters(page);
    const input = page.getByLabel('Search inside SEC comment letters');

    await page.getByRole('button', { name: 'Revenue (ASC 606)' }).click();
    await expect(input).toHaveValue(COMMENT_TOPIC_QUERY);
    await expect(page.getByText('2 matching letters')).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => lastParams(stats.searchRequests).get('q')).toBe(COMMENT_TOPIC_QUERY);

    await page.getByRole('button', { name: 'Responses', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Responses', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => lastParams(stats.searchRequests).get('form')).toBe('CORRESP');
    await expect(page.getByText('1 matching letters')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Company response').first()).toBeVisible();
    await expect(page.getByText('SEC Staff')).toHaveCount(0);
    await expect(input).toHaveValue(COMMENT_TOPIC_QUERY);
  });

  test('comment-letters.expand-thread expands only the activated sibling result and collapses it again', async ({ page }) => {
    const stats = await openCommentLetters(page);
    await page.getByRole('button', { name: 'Revenue (ASC 606)' }).click();
    await expect(page.getByRole('button', { name: 'View conversation' })).toHaveCount(2);

    await page.getByRole('button', { name: 'View conversation' }).first().click();
    await expect(page.getByRole('button', { name: 'Hide conversation' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'View conversation' })).toHaveCount(1);
    await expect(page.getByText(COMMENT_LETTERS[0].preview)).toHaveCount(1);
    await expect(page.getByText(COMMENT_LETTERS[1].preview)).toHaveCount(1);
    await expect.poll(() => stats.threadRequests.length).toBeGreaterThan(0);
    const firstExpansionRequests = stats.threadRequests.length;

    // Activating the sibling moves the one conversation rather than cloning it
    // under both letters from the same review thread.
    await page.getByRole('button', { name: 'View conversation' }).click();
    await expect(page.getByRole('button', { name: 'Hide conversation' })).toHaveCount(1);
    await expect(page.getByText(COMMENT_LETTERS[0].preview)).toHaveCount(1);
    await expect(page.getByText(COMMENT_LETTERS[1].preview)).toHaveCount(1);
    await expect.poll(() => stats.threadRequests.length).toBeGreaterThan(firstExpansionRequests);

    await page.getByRole('button', { name: 'Hide conversation' }).click();
    await expect(page.getByText(COMMENT_LETTERS[0].preview)).toHaveCount(0);
    await expect(page.getByText(COMMENT_LETTERS[1].preview)).toHaveCount(0);
  });

  test('comment-letters.open-issuer-or-edgar opens the matching official index and issuer route', async ({ page, context }) => {
    await openCommentLetters(page);
    await page.getByRole('button', { name: 'Staff letters', exact: true }).click();
    await page.getByRole('button', { name: 'Revenue (ASC 606)' }).click();
    await expect(page.getByText('1 matching letters')).toBeVisible({ timeout: 20_000 });

    await context.route('https://www.sec.gov/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><h1>Official SEC letter index fixture</h1></body></html>',
    }));
    const edgar = page.getByRole('link', { name: 'EDGAR', exact: true });
    const expectedEdgar = 'https://www.sec.gov/Archives/edgar/data/900/000000090026000900/0000000900-26-000900-index.htm';
    const openerUrl = page.url();
    const [popup] = await Promise.all([page.waitForEvent('popup'), edgar.click()]);
    await expect(popup).toHaveURL(expectedEdgar);
    await expect(popup.getByRole('heading', { name: 'Official SEC letter index fixture' })).toBeVisible();
    expect(page.url()).toBe(openerUrl);
    await expect(page.getByLabel('Search inside SEC comment letters')).toHaveValue(COMMENT_TOPIC_QUERY);
    await popup.close();

    const issuer = page.getByRole('link', { name: COMMENT_THREAD.company_name }).first();
    await expect(issuer).toHaveAttribute('href', `/company/${COMMENT_THREAD.cik}`);
    await Promise.all([
      page.waitForURL(`**/company/${COMMENT_THREAD.cik}`, { waitUntil: 'commit' }),
      issuer.click(),
    ]);
    await expect(page).toHaveURL(new RegExp(`/company/${COMMENT_THREAD.cik}$`));
  });

  test('comment-letters.retry-source retries the corpus without clearing draft criteria', async ({ page }) => {
    const stats = await openCommentLetters(page, { browseFailures: 1 });
    const input = page.getByLabel('Search inside SEC comment letters');
    await input.fill('draft criteria retained');
    await expect(page.getByText('The letter corpus is not reachable right now.')).toBeVisible({ timeout: 20_000 });
    const requestsBeforeRetry = stats.browseRequests.length;

    stats.recoverBrowse();
    await page.getByRole('button', { name: 'Retry letter corpus' }).click();
    await expect(page.getByText(COMMENT_THREAD.company_name).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('The letter corpus is not reachable right now.')).toHaveCount(0);
    await expect(input).toHaveValue('draft criteria retained');
    expect(stats.browseRequests.length).toBeGreaterThan(requestsBeforeRetry);
    expect(stats.searchRequests).toHaveLength(0);
    expect(stats.threadRequests).toHaveLength(0);
  });

  test('comment-letters.retry-source reruns the same failed search scope and replaces its error', async ({ page }) => {
    const stats = await openCommentLetters(page, { searchFailures: 1 });
    const input = page.getByLabel('Search inside SEC comment letters');
    await page.getByRole('button', { name: 'Responses', exact: true }).click();
    await input.fill('revenue recognition');
    await input.press('Enter');
    await expect(page.getByText(/zero-result state is not authoritative/i)).toBeVisible({ timeout: 20_000 });
    const browseRequests = stats.browseRequests.length;
    const failedParams = lastParams(stats.searchRequests);

    stats.recoverSearch();
    await page.getByRole('button', { name: 'Retry letter search' }).click();
    await expect(page.getByText('1 matching letters')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Company response').first()).toBeVisible();
    await expect(input).toHaveValue('revenue recognition');
    await expect(page.getByRole('button', { name: 'Responses', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(stats.searchRequests).toHaveLength(2);
    expect(lastParams(stats.searchRequests).get('q')).toBe(failedParams.get('q'));
    expect(lastParams(stats.searchRequests).get('form')).toBe(failedParams.get('form'));
    expect(stats.browseRequests).toHaveLength(browseRequests);
    expect(stats.threadRequests).toHaveLength(0);
  });

  test('comment-letters.retry-source retries only a failed conversation and retains the active search', async ({ page }) => {
    const stats = await openCommentLetters(page, { threadFailures: 1 });
    const input = page.getByLabel('Search inside SEC comment letters');
    await page.getByRole('button', { name: 'Staff letters', exact: true }).click();
    await page.getByRole('button', { name: 'Revenue (ASC 606)' }).click();
    await page.getByRole('button', { name: 'View conversation' }).click();
    await expect(page.getByText('This letter conversation could not be loaded from the corpus.')).toBeVisible({ timeout: 20_000 });
    const searchRequests = stats.searchRequests.length;
    const browseRequests = stats.browseRequests.length;
    const summaryGets = stats.summaryGetRequests;
    const threadRequests = stats.threadRequests.length;

    stats.recoverThread();
    await page.getByRole('button', { name: 'Retry conversation' }).click();
    await expect(page.getByText(COMMENT_LETTERS[0].preview)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COMMENT_LETTERS[1].preview)).toBeVisible();
    await expect(input).toHaveValue(COMMENT_TOPIC_QUERY);
    await expect(page.getByRole('button', { name: 'Staff letters', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(stats.threadRequests.length).toBeGreaterThan(threadRequests);
    expect(stats.searchRequests).toHaveLength(searchRequests);
    expect(stats.browseRequests).toHaveLength(browseRequests);
    expect(stats.summaryGetRequests).toBe(summaryGets);
  });

  test('comment-letters.retry-source retries summary generation without clearing source evidence', async ({ page }) => {
    const stats = await openCommentLetters(page, { summaryPostFailures: 1 });
    const input = page.getByLabel('Search inside SEC comment letters');
    await page.getByRole('button', { name: 'Staff letters', exact: true }).click();
    await page.getByRole('button', { name: 'Revenue (ASC 606)' }).click();
    await page.getByRole('button', { name: 'View conversation' }).click();

    const generate = page.getByRole('button', { name: 'Generate AI summary' });
    await expect(generate).toBeVisible({ timeout: 20_000 });
    const threadRequests = stats.threadRequests.length;
    const searchRequests = stats.searchRequests.length;
    await generate.click();
    await expect(page.getByText(/AI summary generation failed: fixture generation unavailable/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(COMMENT_LETTERS[0].preview)).toBeVisible();
    await expect(page.getByText(COMMENT_LETTERS[1].preview)).toBeVisible();

    stats.recoverSummaryPost();
    await page.getByRole('button', { name: 'Retry AI summary' }).click();
    await expect(page.getByText(COMMENT_RETRY_SUMMARY)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/2\/2 letters represented/)).toBeVisible();
    await expect(input).toHaveValue(COMMENT_TOPIC_QUERY);
    await expect(page.getByRole('button', { name: 'Staff letters', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(stats.summaryPostRequests).toBe(2);
    expect(stats.threadRequests).toHaveLength(threadRequests);
    expect(stats.searchRequests).toHaveLength(searchRequests);
  });
});
