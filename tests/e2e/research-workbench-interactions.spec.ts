import { expect, test, type Page } from '@playwright/test';
import { FILINGS, installBooleanFixtures } from './boolean-fixtures';
import type { SearchFilters } from '../../src/domain/searchFilters';
import type { FilingResearchResult } from '../../src/services/filingResearch';
import type { ResearchSearchSession } from '../../src/services/researchSessions';
import { buildCompleteSecCompanyDirectory } from './sec-company-directory-fixture';

/**
 * Interaction coverage for the stateful parts of the Research Workbench.
 *
 * These tests intentionally assert what survives each interaction. Merely
 * finding or clicking a control is census coverage, not behavior coverage.
 */

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

async function exposeBooleanInput(page: Page) {
  const input = page.getByRole('combobox', { name: 'Boolean search query' });
  const expandFilters = page.getByRole('button', { name: 'Expand search filters' });
  if (await expandFilters.isVisible().catch(() => false)) await expandFilters.click();
  const expand = page.getByRole('button', { name: 'Expand', exact: true });
  if (await expand.isVisible().catch(() => false)) await expand.click();

  await expect(async () => {
    await page.getByRole('button', { name: 'Boolean / Proximity' }).click();
    await expect(input).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return input;
}

async function runBooleanQuery(page: Page, query: string) {
  const input = await exposeBooleanInput(page);
  await input.fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('tab', { name: new RegExp(query, 'i') })).toBeVisible({ timeout: 30_000 });
}

const EMPTY_FILTERS: SearchFilters = {
  keyword: '',
  dateFrom: '',
  dateTo: '',
  entityName: '',
  entityCik: '',
  formTypes: ['10-K'],
  sectionKeywords: '',
  sicCode: '',
  stateOfInc: '',
  headquarters: '',
  exchange: [],
  acceleratedStatus: [],
  accountant: '',
  accessionNumber: '',
  fileNumber: '',
  fiscalYearEnd: '',
  accountingFramework: '',
  ascReference: '',
  sectionScope: '',
};

function paginationResult(index: number): FilingResearchResult {
  const label = String(index).padStart(2, '0');
  const cik = String(2_000_000 + index);
  const accessionNumber = `${cik.padStart(10, '0')}-26-${String(index).padStart(6, '0')}`;
  const primaryDocument = `pagination-${label}.htm`;
  const entityName = `Pagination Issuer ${label}`;

  return {
    id: `pagination-result-${label}`,
    entityName,
    fileDate: new Date(Date.UTC(2025, 0, index)).toISOString().slice(0, 10),
    formType: '10-K',
    documentType: '10-K',
    cik,
    accessionNumber,
    primaryDocument,
    filingPrimaryDocument: primaryDocument,
    description: `Deterministic pagination evidence ${label}`,
    matchSnippet: `Pagination proof evidence row ${label}.`,
    matchReason: 'Validated filing text',
    score: 1_000 - index,
    relevanceScore: 1_000 - index,
    filingUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNumber.replace(/-/g, '')}/${primaryDocument}`,
    companyName: entityName,
    tickers: [`PG${label}`],
    sic: '7372',
    sicDescription: 'Prepackaged Software',
    exchange: 'NASDAQ',
    stateOfIncorporation: 'DE',
    fiscalYearEnd: '1231',
    headquarters: 'Test City, DE',
    fileNumber: `001-${String(index).padStart(5, '0')}`,
    auditor: 'Fixture Audit LLP',
    acceleratedStatus: 'Large Accelerated Filer',
  };
}

const PAGINATION_RESULTS = Array.from({ length: 65 }, (_, index) => paginationResult(index + 1));

const COMPANY_SUGGESTION_DIRECTORY = buildCompleteSecCompanyDirectory([
  { cik_str: 2_100_001, ticker: 'ACM', title: 'Acme Neighbor Ventures' },
  { cik_str: 2_100_002, ticker: 'ACME', title: 'Acme Evidence Holdings' },
  { cik_str: 2_100_003, ticker: 'ACMEX', title: 'Acme Extended Markets' },
]);

async function restorePaginationSession(page: Page) {
  const sessionId = 'research-pagination-proof';
  const now = '2026-08-03T12:00:00.000Z';
  const session: ResearchSearchSession = {
    id: sessionId,
    title: 'pagination proof',
    query: 'pagination proof',
    mode: 'semantic',
    filters: { ...EMPTY_FILTERS, formTypes: [...EMPTY_FILTERS.formTypes] },
    results: PAGINATION_RESULTS,
    isRefining: false,
    searched: true,
    errorMsg: '',
    interpretation: [],
    resolvedSearch: {
      query: 'pagination proof',
      mode: 'semantic',
      filters: { ...EMPTY_FILTERS, formTypes: [...EMPTY_FILTERS.formTypes] },
    },
    selectedResultId: PAGINATION_RESULTS[0].id,
    createdAt: now,
    updatedAt: now,
    coverage: {
      examined: PAGINATION_RESULTS.length,
      upstreamTotal: PAGINATION_RESULTS.length,
      complete: true,
    },
  };

  await page.evaluate(value => {
    const scope = document.documentElement.dataset.urcIdentityScope;
    if (!scope) throw new Error('Identity scope was not ready before fixture installation.');
    const key = `urc.identity.${encodeURIComponent(scope)}.vara.research.sessions.v1`;
    window.sessionStorage.setItem(key, JSON.stringify([value]));
  }, session);

  await page.goto(`/search?v=1&tab=${sessionId}&q=pagination+proof`, { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
  await expect(page.getByRole('tab', { name: 'pagination proof' })).toHaveAttribute('aria-selected', 'true');
}

async function visibleResultNames(page: Page): Promise<string[]> {
  const cards = page.locator('.research-hit-card');
  await expect(cards.first()).toBeVisible();
  return cards.locator('.company').allTextContents();
}

test.describe('research workbench stateful interactions', () => {
  test.beforeEach(async ({ page }) => {
    await installBooleanFixtures(page);
    // Serve the SEC evidence popup locally, matching the convention in
    // company-dossier-fixtures / governance-analytics-fixtures. Without it,
    // open-issuer-or-source navigated a popup to the LIVE sec.gov: fine in
    // isolation and fine within this file, but order-dependently flaky in a
    // full-suite run where dozens of earlier tests have already hit SEC.
    // The contract under test is the href, target and rel the app emits and
    // the research state it retains — none of which needs a live third party.
    await page.context().route('https://www.sec.gov/**', route => route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><h1>SEC source fixture</h1></body></html>',
    }));
    await page.goto('/search', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
  });

  test('research-workbench.manage-search-sessions restores and closes only the chosen search', async ({ page }) => {
    await runBooleanQuery(page, 'mezzanine');
    await expect(page.getByText('Mezz Only Corp').first()).toBeVisible({ timeout: 30_000 });

    await runBooleanQuery(page, 'temporary');
    await expect(page.getByText('Temp Only Inc').first()).toBeVisible({ timeout: 30_000 });

    const mezzanineTab = page.getByRole('tab', { name: /mezzanine/i });
    const temporaryTab = page.getByRole('tab', { name: /temporary/i });
    await expect(mezzanineTab).toHaveAttribute('aria-selected', 'false');
    await expect(temporaryTab).toHaveAttribute('aria-selected', 'true');

    await mezzanineTab.click();
    await expect(mezzanineTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Mezz Only Corp').first()).toBeVisible();

    await page.getByRole('button', { name: 'Close mezzanine search' }).click();
    await expect(mezzanineTab).toHaveCount(0);
    await expect(temporaryTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Temp Only Inc').first()).toBeVisible();
  });

  test('research-workbench.toggle-panels preserves criteria and results through collapse round trips', async ({ page }) => {
    await runBooleanQuery(page, 'mezzanine OR temporary');
    await expect(page.getByText('Both Holdings Ltd').first()).toBeVisible({ timeout: 30_000 });

    // A completed run collapses both panels. Reopening them must restore the
    // submitted query and the exact same result set.
    await page.getByRole('button', { name: 'Expand search filters' }).click();
    await expect(page.getByRole('button', { name: 'Collapse search filters' })).toBeVisible();
    await page.getByRole('button', { name: 'Collapse search filters' }).click();
    await expect(page.getByRole('button', { name: 'Expand search filters' })).toBeVisible();

    await page.getByRole('button', { name: 'Expand', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Boolean search query' })).toHaveValue('mezzanine OR temporary');
    await page.getByRole('button', { name: 'Collapse search bar' }).click();
    await page.getByRole('button', { name: 'Expand', exact: true }).click();

    await expect(page.getByRole('combobox', { name: 'Boolean search query' })).toHaveValue('mezzanine OR temporary');
    await expect(page.getByText('Both Holdings Ltd').first()).toBeVisible();
  });

  test('research-workbench.choose-company-suggestion chooses the exact issuer without submitting a neighboring company', async ({ page }) => {
    // Replace the default empty SEC directory with deliberately similar
    // issuers. The target sits between two neighboring matches so the test
    // proves the clicked suggestion, not merely the first prefix match.
    await page.unroute('**/api/sec-proxy**');
    await page.route('**/api/sec-proxy**', async route => {
      const url = new URL(route.request().url());
      const path = url.searchParams.get('path') || '';
      if (path.includes('company_tickers.json')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(COMPANY_SUGGESTION_DIRECTORY),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body></body></html>' });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    let retrievalRequests = 0;
    page.on('request', request => {
      if (/\/api\/(?:es-search|sec-efts|boolean-validate)(?:\?|$)/.test(request.url())) {
        retrievalRequests += 1;
      }
    });

    const input = page.getByRole('combobox', { name: 'Search filings' });
    await input.fill('ACM');
    const listbox = page.getByRole('listbox', { name: 'Company suggestions' });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole('option')).toHaveCount(3);
    await expect(listbox.getByRole('option').filter({ hasText: 'Acme Neighbor Ventures' })).toBeVisible();
    const exactIssuer = listbox.getByRole('option').filter({ hasText: 'Acme Evidence Holdings' });
    await exactIssuer.click();

    await expect(input).toHaveValue('ACME ');
    await expect(listbox).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(0);
    expect(retrievalRequests, 'choosing a suggestion must not submit the search form').toBe(0);
    await expect(page).toHaveURL(/\/search\/?$/);
  });

  test('research-workbench.select-result updates the evidence preview to the exact chosen filing', async ({ page }) => {
    await runBooleanQuery(page, 'mezzanine OR temporary');
    const chosen = FILINGS[1];

    await page.locator('.research-hit-card', { hasText: chosen.company }).click();
    const preview = page.locator('.research-preview');
    await expect(preview.getByRole('heading', { name: chosen.company })).toBeVisible();
    await expect(preview).toContainText(chosen.filed);
    await expect(preview).toContainText(/reported within temporary equity under ASC 480/i);
  });

  test('research-workbench.open-issuer-or-source targets the chosen issuer and exact SEC document', async ({ page }) => {
    await runBooleanQuery(page, 'mezzanine OR temporary');
    const chosen = FILINGS[1];
    await page.locator('.research-hit-card', { hasText: chosen.company }).click();

    const preview = page.locator('.research-preview');
    const issuer = preview.getByRole('link', { name: 'Issuer dossier' });
    await expect(issuer).toHaveAttribute('href', `/company/${Number(chosen.cik)}`);

    const source = preview.getByRole('link', { name: /SEC\.gov/ });
    const href = await source.getAttribute('href');
    expect(href).toBe(
      `https://www.sec.gov/Archives/edgar/data/${Number(chosen.cik)}/${chosen.accession.replace(/-/g, '')}/${chosen.document}`
    );
    await expect(source).toHaveAttribute('target', '_blank');
    await expect(source).toHaveAttribute('rel', /noreferrer/);

    const searchUrl = page.url();
    const [sourcePage] = await Promise.all([page.waitForEvent('popup'), source.click()]);
    await expect.poll(() => sourcePage.url()).toBe(href);
    await sourcePage.close();
    expect(page.url(), 'opening SEC evidence must retain the active research result').toBe(searchUrl);

    await issuer.click();
    await expect(page).toHaveURL(`/company/${Number(chosen.cik)}`);
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await expect(page).toHaveURL(searchUrl);
    await expect(page.locator('.research-preview').getByRole('heading', { name: chosen.company })).toBeVisible();
  });

  test('research-workbench.sort-and-page preserves every unique filing across sort and Previous/Next boundaries', async ({ page }) => {
    await restorePaginationSession(page);

    const expectedRelevance = PAGINATION_RESULTS.map(result => result.entityName);
    const expectedNewest = [...PAGINATION_RESULTS]
      .sort((a, b) => b.fileDate.localeCompare(a.fileDate))
      .map(result => result.entityName);
    const pagination = page.getByRole('navigation', { name: 'Search result pages' });

    await expect(pagination).toContainText('1–50 of 65');
    const relevancePageOne = await visibleResultNames(page);
    expect(relevancePageOne).toEqual(expectedRelevance.slice(0, 50));

    const chosen = PAGINATION_RESULTS[2];
    await page.locator('.research-hit-card', { hasText: chosen.entityName }).click();
    const selectedPreview = page.locator('.research-preview').getByRole('heading', { name: chosen.entityName });
    await expect(selectedPreview).toBeVisible();

    await pagination.getByRole('button', { name: 'Next' }).click();
    await expect(pagination).toContainText('51–65 of 65');
    const relevancePageTwo = await visibleResultNames(page);
    expect(relevancePageTwo).toEqual(expectedRelevance.slice(50));
    expect(new Set([...relevancePageOne, ...relevancePageTwo])).toEqual(new Set(expectedRelevance));
    expect([...relevancePageOne, ...relevancePageTwo]).toHaveLength(65);
    await expect(selectedPreview, 'pagination must retain the explicitly selected evidence').toBeVisible();

    await pagination.getByRole('button', { name: 'Previous' }).click();
    await expect(pagination).toContainText('1–50 of 65');
    expect(await visibleResultNames(page)).toEqual(relevancePageOne);

    await page.getByRole('button', { name: 'Newest', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Newest', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(pagination).toContainText('1–50 of 65');
    const newestPageOne = await visibleResultNames(page);
    expect(newestPageOne).toEqual(expectedNewest.slice(0, 50));

    await pagination.getByRole('button', { name: 'Next' }).click();
    await expect(pagination).toContainText('51–65 of 65');
    const newestPageTwo = await visibleResultNames(page);
    expect(newestPageTwo).toEqual(expectedNewest.slice(50));
    expect(new Set([...newestPageOne, ...newestPageTwo])).toEqual(new Set(expectedNewest));
    expect([...newestPageOne, ...newestPageTwo]).toHaveLength(65);
    await expect(selectedPreview, 'sorting must not silently change the selected filing').toBeVisible();
  });

  test('research-workbench.open-assistant-or-help preserves a URL-backed search through both guidance paths', async ({ page }) => {
    await runBooleanQuery(page, 'mezzanine OR temporary');
    await expect(page.getByText('Both Holdings Ltd').first()).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/search\?.*\btab=/);

    const expandFilters = page.getByRole('button', { name: 'Expand search filters' });
    if (await expandFilters.isVisible().catch(() => false)) await expandFilters.click();
    const searchUrl = page.url();

    await page.getByRole('button', { name: 'Ask URC Copilot' }).click();
    const assistant = page.getByRole('complementary', { name: 'URC Copilot research assistant' });
    await expect(assistant).toBeVisible();
    await expect(page).toHaveURL(searchUrl);
    await expect(page.getByRole('tab', { name: /mezzanine OR temporary/i })).toHaveAttribute('aria-selected', 'true');
    await assistant.getByRole('button', { name: 'Close copilot' }).click();
    await expect(assistant).toHaveCount(0);

    await page.getByRole('button', { name: 'Open full help' }).click();
    await expect(page).toHaveURL(/\/support\/?$/);
    await expect(page.getByRole('heading', { name: 'Learn the URC workflow quickly' })).toBeVisible();

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await expect(page).toHaveURL(searchUrl);
    await expect(page.getByRole('tab', { name: /mezzanine OR temporary/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Both Holdings Ltd').first()).toBeVisible();
  });
});
