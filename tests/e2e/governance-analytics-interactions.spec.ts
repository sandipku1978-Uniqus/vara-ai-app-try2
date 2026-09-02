import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { installGovernanceAnalyticsFixtures } from './governance-analytics-fixtures';

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 },
  );
}

async function openWorkspace(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
  await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 20_000 });
}

async function chooseCompany(page: Page, fieldName: string, ticker: string) {
  const field = page.getByRole('combobox', { name: fieldName, exact: true }).first();
  await expect(field).toBeVisible({ timeout: 20_000 });
  const option = page.getByRole('option').filter({ hasText: ticker }).first();
  // CompanySearchInput does not replay a query typed before its async SEC
  // directory arrives. Re-enter until the observable suggestion exists; this
  // synchronizes on product readiness instead of guessing a network delay.
  await expect.poll(async () => {
    await field.fill('');
    await field.fill(ticker);
    return option.count();
  }, { timeout: 20_000 }).toBeGreaterThan(0);
  await option.click();
}

function companyBadge(page: Page, ticker: string): Locator {
  return page.locator('.selected-company-badge').filter({ has: page.getByText(ticker, { exact: true }) });
}

async function waitForBenchmarkColumns(page: Page, text: string) {
  await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('Fetching XBRL financial data from SEC EDGAR...')).toHaveCount(0, { timeout: 25_000 });
}

test.describe('comparison and governance interaction evidence', () => {
  test('benchmarking.add-or-remove-company keeps every comparison surface on the exact resulting cohort', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/compare', 'Disclosure Benchmarking Matrix');
    await waitForBenchmarkColumns(page, '2 columns: AAPL FY2025 · MSFT FY2025');

    await chooseCompany(page, 'Type ticker & press Enter', 'NVDA');
    await waitForBenchmarkColumns(page, '3 columns: AAPL FY2025 · MSFT FY2025 · NVDA FY2025');
    await companyBadge(page, 'MSFT').getByTitle('Remove company').click();
    await waitForBenchmarkColumns(page, '2 columns: AAPL FY2025 · NVDA FY2025');
    await expect(companyBadge(page, 'MSFT')).toHaveCount(0);

    await page.getByRole('button', { name: 'Section Matrix', exact: true }).click();
    const matrix = page.getByRole('table', { name: 'Section presence by company' });
    await expect(matrix).toBeVisible({ timeout: 20_000 });
    await expect(matrix.getByRole('columnheader', { name: 'AAPL', exact: true })).toHaveCount(1);
    await expect(matrix.getByRole('columnheader', { name: 'NVDA', exact: true })).toHaveCount(1);
    await expect(matrix.getByRole('columnheader', { name: 'MSFT', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Text Redline', exact: true }).click();
    await expect(page.locator('.col-ticker')).toHaveText(['AAPL', 'NVDA'], { timeout: 20_000 });
  });

  test('benchmarking.switch-view preserves companies, years, and fetched evidence across all surfaces', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/compare', 'Disclosure Benchmarking Matrix');
    await waitForBenchmarkColumns(page, '2 columns: AAPL FY2025 · MSFT FY2025');

    await companyBadge(page, 'AAPL').getByRole('button', { name: '+ FY', exact: true }).click();
    await page.getByRole('button', { name: 'FY2024', exact: true }).click();
    const preserved = '3 columns: AAPL FY2025 · AAPL FY2024 · MSFT FY2025';
    await waitForBenchmarkColumns(page, preserved);
    await expect(page.getByText('$90.0B', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Text Redline', exact: true }).click();
    await expect(page.getByText(/Comparing Revenue recognition.*across: AAPL, MSFT/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(preserved, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Section Matrix', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Section presence by company' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(preserved, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Financials', exact: true }).click();
    await expect(page.getByText('$90.0B', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(preserved, { exact: true })).toBeVisible();
  });

  test('benchmarking.choose-years-or-section recalculates the visible period and disclosure target', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/compare', 'Disclosure Benchmarking Matrix');
    await waitForBenchmarkColumns(page, '2 columns: AAPL FY2025 · MSFT FY2025');

    await companyBadge(page, 'AAPL').getByRole('button', { name: '+ FY', exact: true }).click();
    await page.getByRole('button', { name: 'FY2024', exact: true }).click();
    await waitForBenchmarkColumns(page, '3 columns: AAPL FY2025 · AAPL FY2024 · MSFT FY2025');
    await expect(page.getByText('$90.0B', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Text Redline', exact: true }).click();
    const target = page.getByLabel('Disclosure topic or filing section to compare');
    await target.selectOption({ label: 'Item 2. Properties' });
    await expect(page.getByText('Comparing Item 2. Properties across: AAPL, MSFT', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Fixture properties disclosure/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('benchmarking.build-peer-group adds only matching non-duplicate SIC peers', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/compare', 'Disclosure Benchmarking Matrix');
    await waitForBenchmarkColumns(page, '2 columns: AAPL FY2025 · MSFT FY2025');
    await expect(page.getByLabel('Peer group industry (SIC code or name)')).toHaveValue('3571', { timeout: 20_000 });

    await page.getByRole('button', { name: 'Find SIC Peers', exact: true }).click();
    await expect(page.getByText('Added 1 peers for SIC 3571 (Electronic Computers).', { exact: true })).toBeVisible({ timeout: 25_000 });
    await waitForBenchmarkColumns(page, '3 columns: AAPL FY2025 · MSFT FY2025 · NVDA FY2025');
    await expect(companyBadge(page, 'NVDA')).toHaveCount(1);

    await page.getByRole('button', { name: 'Find SIC Peers', exact: true }).click();
    await expect(page.getByText(/No peers found yet for SIC 3571/)).toBeVisible({ timeout: 20_000 });
    await expect(companyBadge(page, 'NVDA')).toHaveCount(1);
  });

  test('benchmarking.generate-summary-or-memo retries a failed grounded comparison and builds the cohort memo', async ({ page }) => {
    const stats = await installGovernanceAnalyticsFixtures(page, {
      aiFailuresBeforeSuccess: { 'financial-summary': 2 },
    });
    await openWorkspace(page, '/compare', 'Disclosure Benchmarking Matrix');
    await waitForBenchmarkColumns(page, '2 columns: AAPL FY2025 · MSFT FY2025');

    await page.getByRole('button', { name: 'Generate Financial Summary', exact: true }).click();
    const comparisonError = page.getByRole('alert').filter({ hasText: 'financial comparison could not be generated' });
    await expect(comparisonError).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Total Revenue', { exact: true }).first()).toBeVisible();
    expect(stats.claudePrompts).toHaveLength(2);

    await page.getByRole('button', { name: 'Retry summary', exact: true }).click();
    await expect(page.getByText('Evidence-grounded comparison', { exact: true })).toBeVisible({ timeout: 20_000 });
    expect(stats.claudePrompts).toHaveLength(3);
    expect(stats.claudePrompts.at(-1)).toContain('AAPL FY2025');
    expect(stats.claudePrompts.at(-1)).toContain('MSFT FY2025');
    expect(stats.claudePrompts.at(-1)).toContain('Revenue: $100.0B');

    await page.getByRole('button', { name: 'Generate Cohort Memo', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cohort Memo', exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/loaded AAPL and MSFT metrics show positive margins/i)).toBeVisible();
    expect(stats.claudePrompts).toHaveLength(4);
    expect(stats.claudePrompts.at(-1)).toContain('peer benchmarking memo');
    expect(stats.claudePrompts.at(-1)).toContain('AAPL FY2025 | Apple Fixture Corp | Revenue $100.0B');
    expect(stats.claudePrompts.at(-1)).toContain('MSFT FY2025 | Microsoft Fixture Corp | Revenue $120.0B');
  });

  test('benchmarking.export-results downloads the visible cohort periods labels and values', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/compare', 'Disclosure Benchmarking Matrix');
    await waitForBenchmarkColumns(page, '2 columns: AAPL FY2025 · MSFT FY2025');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('benchmarking_AAPL_MSFT.csv');
    const path = await download.path();
    expect(path).toBeTruthy();
    const csv = await readFile(path!, 'utf8');
    expect(csv).toContain('Metric,AAPL FY2025,MSFT FY2025');
    expect(csv).toContain('Total Revenue,$100.0B,$120.0B');
    expect(csv).toContain('Gross Margin,60.0%,60.0%');
  });

  test('benchmarking.verify-sections marks sections only from filing text, surfaces a rate limit with retry, and exports states with accessions', async ({ page }) => {
    // Two 429s exhaust the client's single automatic retry, so the AAPL
    // column must show the rate limit and the explicit Retry must clear it.
    const stats = await installGovernanceAnalyticsFixtures(page, { filingTextRateLimitsBeforeSuccess: { AAPL: 2 } });
    await openWorkspace(page, '/compare', 'Disclosure Benchmarking Matrix');
    await waitForBenchmarkColumns(page, '2 columns: AAPL FY2025 · MSFT FY2025');

    await page.getByRole('button', { name: 'Section Matrix', exact: true }).click();
    const matrix = page.getByRole('table', { name: 'Section presence by company' });
    await expect(matrix).toBeVisible({ timeout: 20_000 });
    const mark = (name: string) => matrix.getByRole('img', { name, exact: true });
    const progress = page.getByRole('status').filter({ hasText: /filings/ });

    // Nothing is marked and no filing text is requested until the user asks.
    await expect(mark('Item 1A. Risk Factors: not checked for AAPL — 10-K 0000320193-26-000002 not read yet')).toBeVisible();
    await expect(matrix.getByRole('img', { name: /found in/ })).toHaveCount(0);
    await expect(progress).toHaveText('2 of 2 filings not read yet');
    expect(stats.filingTextRequests).toHaveLength(0);

    await test.step('ui-action:benchmarking.verify-sections', async () => {
      await page.getByRole('button', { name: 'Verify sections', exact: true }).click();
      await expect(mark("Item 1A. Risk Factors: found in MSFT's 10-K 0000789019-26-000002")).toBeVisible({ timeout: 20_000 });
      await expect(mark("Item 1C. Cybersecurity: not found in MSFT's 10-K 0000789019-26-000002")).toBeVisible();
      await expect(mark('Item 1A. Risk Factors: could not be checked for AAPL — rate limited — retry')).toBeVisible({ timeout: 20_000 });
      await expect(progress).toHaveText('1 of 2 filings read · 1 failed');
      expect(stats.filingTextRequests.filter(request => request.cik === '320193')).toHaveLength(2);
      expect(stats.filingTextRequests.filter(request => request.cik === '789019')).toHaveLength(1);

      await page.getByRole('button', { name: 'Retry failed filings', exact: true }).click();
      await expect(mark("Item 1A. Risk Factors: found in AAPL's 10-K 0000320193-26-000002")).toBeVisible({ timeout: 20_000 });
      await expect(mark("Item 1C. Cybersecurity: not found in AAPL's 10-K 0000320193-26-000002")).toBeVisible();
      await expect(progress).toHaveText('2 of 2 filings read');
      // Each filing is read exactly once more; MSFT's cached read is reused.
      expect(stats.filingTextRequests.filter(request => request.cik === '320193')).toHaveLength(3);
      expect(stats.filingTextRequests.filter(request => request.cik === '789019')).toHaveLength(1);
    });

    await test.step('ui-action:benchmarking.export-results', async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: 'Export', exact: true }).click(),
      ]);
      expect(download.suggestedFilename()).toBe('section_matrix_10-K_AAPL_MSFT.csv');
      const path = await download.path();
      expect(path).toBeTruthy();
      const csv = await readFile(path!, 'utf8');
      expect(csv).toContain('Section,AAPL,AAPL source,MSFT,MSFT source');
      expect(csv).toContain('Item 1A. Risk Factors,present,10-K 0000320193-26-000002 aapl-10k.htm,present,10-K 0000789019-26-000002 msft-10k.htm');
      expect(csv).toContain('Item 1C. Cybersecurity,absent,10-K 0000320193-26-000002 aapl-10k.htm,absent,10-K 0000789019-26-000002 msft-10k.htm');
    });
  });

  test('accounting-analytics.add-company and accounting-analytics.remove-company keep XBRL columns exact', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/accounting-analytics', 'Accounting Analytics');

    const table = page.getByRole('table', { name: 'Financial ratios by company' });
    await test.step('ui-action:accounting-analytics.add-company', async () => {
      await chooseCompany(page, 'Add company by ticker...', 'AAPL');
      await expect(table).toBeVisible({ timeout: 20_000 });
      await expect(table.getByRole('columnheader', { name: 'AAPL', exact: true })).toHaveCount(1);
      await expect(table.getByRole('row', { name: /Gross Margin 60\.0%/ })).toBeVisible();

      await chooseCompany(page, 'Add company by ticker...', 'AAPL');
      await expect(table.getByRole('columnheader', { name: 'AAPL', exact: true })).toHaveCount(1);
      await chooseCompany(page, 'Add company by ticker...', 'MSFT');
      await expect(table.getByRole('columnheader', { name: 'MSFT', exact: true })).toHaveCount(1);
    });

    await test.step('ui-action:accounting-analytics.remove-company', async () => {
      await page.getByRole('button', { name: 'Remove AAPL', exact: true }).click();
      await expect(table.getByRole('columnheader', { name: 'AAPL', exact: true })).toHaveCount(0);
      await expect(table.getByRole('columnheader', { name: 'MSFT', exact: true })).toHaveCount(1);
      await expect(table.getByRole('row', { name: /Gross Margin 60\.0%/ })).toBeVisible();
    });
  });

  test('accounting-analytics.retry-facts repeats the selected issuer request and replaces failure', async ({ page }) => {
    const stats = await installGovernanceAnalyticsFixtures(page, {
      factFailuresBeforeSuccess: { AAPL: 1 },
    });
    await openWorkspace(page, '/accounting-analytics', 'Accounting Analytics');
    await chooseCompany(page, 'Add company by ticker...', 'AAPL');

    const factsError = page.getByRole('alert').filter({ hasText: 'Ratio data could not be loaded for AAPL' });
    await expect(factsError).toBeVisible({ timeout: 20_000 });
    expect(stats.factsRequests.AAPL).toBe(1);
    await page.getByRole('button', { name: 'Retry XBRL data', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Financial ratios by company' })).toBeVisible({ timeout: 20_000 });
    await expect(factsError).toHaveCount(0);
    expect(stats.factsRequests.AAPL).toBe(2);
  });

  test('esg-research.open-framework-source opens the exact official framework in a separate tab', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/esg', 'ESG Research Center');
    const source = page.getByRole('link', { name: /SASB Standards/ });
    await expect(source).toHaveAttribute('href', 'https://sasb.ifrs.org/standards/');
    await expect(source).toHaveAttribute('target', '_blank');
    const before = page.url();
    const [popup] = await Promise.all([page.waitForEvent('popup'), source.click()]);
    await expect.poll(() => popup.url()).toBe('https://sasb.ifrs.org/standards/');
    await popup.close();
    expect(page.url()).toBe(before);
  });

  test('esg-research.manage-heatmap-companies changes only the requested issuer column', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/esg', 'ESG Research Center');
    await page.getByRole('button', { name: 'Disclosure Heatmap', exact: true }).click();
    const coverage = page.locator('.heatmap-coverage');
    await expect(coverage).toContainText('Analyzed 4 of 4 selected companies.', { timeout: 30_000 });
    const table = page.locator('.heatmap-container table');

    await page.getByRole('button', { name: 'Remove GOOGL from ESG heatmap', exact: true }).click();
    await expect(coverage).toContainText('Analyzed 3 of 3 selected companies.', { timeout: 30_000 });
    await expect(table.getByRole('columnheader', { name: 'GOOGL', exact: true })).toHaveCount(0);
    for (const ticker of ['AAPL', 'MSFT', 'META']) {
      await expect(table.getByRole('columnheader', { name: ticker, exact: true })).toHaveCount(1);
    }

    await chooseCompany(page, 'Add company to heatmap...', 'NVDA');
    await expect(coverage).toContainText('Analyzed 4 of 4 selected companies.', { timeout: 30_000 });
    await expect(table.getByRole('columnheader', { name: 'NVDA', exact: true })).toHaveCount(1);
    await chooseCompany(page, 'Add company to heatmap...', 'NVDA');
    await expect(table.getByRole('columnheader', { name: 'NVDA', exact: true })).toHaveCount(1);
  });

  test('esg-research.inspect-topic expands issuer-specific ratings and their evidence source', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/esg', 'ESG Research Center');
    await page.getByRole('button', { name: 'Disclosure Heatmap', exact: true }).click();
    await expect(page.locator('.heatmap-coverage')).toContainText('Analyzed 4 of 4 selected companies.', { timeout: 30_000 });

    await page.getByRole('button', { name: 'GHG Emissions (Scope 1 & 2)', exact: true }).click();
    const detail = page.getByRole('heading', { name: 'GHG Emissions (Scope 1 & 2) — disclosure depth by company' }).locator('..');
    await expect(detail.locator('span').filter({ hasText: /AAPL\s*high/i })).toHaveCount(1);
    await expect(detail.locator('span').filter({ hasText: /MSFT\s*medium/i })).toHaveCount(1);
    await expect(detail.locator('span').filter({ hasText: /META\s*low/i })).toHaveCount(1);
    await expect(detail).toContainText('AI-rated from each company\'s latest 10-K on SEC EDGAR');
    await expect(page.getByRole('button', { name: 'GHG Emissions (Scope 1 & 2)', exact: true })).toHaveAttribute('aria-expanded', 'true');
  });

  test('esg-research.filter-signals retries SEC and excludes unrelated issuers', async ({ page }) => {
    const stats = await installGovernanceAnalyticsFixtures(page, { eftsFailuresBeforeSuccess: 2 });
    await openWorkspace(page, '/esg', 'ESG Research Center');
    await page.getByRole('button', { name: 'Earnings Releases', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Unable to load recent 8-K filing metadata' })).toBeVisible({ timeout: 20_000 });
    expect(stats.eftsRequests).toBe(2);

    await page.getByRole('button', { name: 'Retry SEC request', exact: true }).click();
    await expect(page.getByText('Alpha Energy Corp', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Beta Health Inc', { exact: true })).toBeVisible();
    expect(stats.eftsRequests).toBe(3);

    await page.getByLabel('Filter recent 8-K candidates by company').fill('Alpha');
    await expect(page.getByText('Alpha Energy Corp', { exact: true })).toBeVisible();
    await expect(page.getByText('Beta Health Inc', { exact: true })).toHaveCount(0);
  });

  test('esg-research.summarize-or-open-filing retries a release summary and opens its exact filing', async ({ page }) => {
    const stats = await installGovernanceAnalyticsFixtures(page, {
      aiFailuresBeforeSuccess: { 'release-summary': 2 },
    });
    await openWorkspace(page, '/esg', 'ESG Research Center');
    await page.getByRole('button', { name: 'Earnings Releases', exact: true }).click();
    const release = page.locator('article').filter({ hasText: 'Alpha Energy Corp' });
    await expect(release).toBeVisible({ timeout: 20_000 });

    await release.getByRole('button', { name: 'Generate source summary', exact: true }).click();
    await expect(release.getByRole('alert')).toContainText('source summary could not be generated', { timeout: 20_000 });
    await release.getByRole('button', { name: 'Retry summary', exact: true }).click();
    await expect(release).toContainText('Alpha Energy reported quarterly revenue of $125 million', { timeout: 20_000 });
    await expect(release).toContainText('Verify the summary against the source filing.');
    expect(stats.claudePrompts).toHaveLength(3);
    expect(stats.claudePrompts.at(-1)).toContain('Source: Alpha Energy Corp, Form 8-K');

    const source = release.getByRole('link', { name: 'Open source filing', exact: true });
    const href = await source.getAttribute('href');
    expect(href).toBe('/filing/9000010_0009000010-26-000005_alph-8k.htm');
    await source.click();
    await expect(page).toHaveURL(/\/filing\/9000010_0009000010-26-000005_alph-8k\.htm$/);
  });

  test('board-profiles.load-target resolves the requested issuer and states missing data honestly', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/boards', 'Board Profiles & Executive Compensation');
    await expect(page.getByRole('heading', { name: 'Board of Directors — Apple Fixture Corp' })).toBeVisible({ timeout: 25_000 });

    // Every value traces to one filing: form, filing date, accession, the
    // meeting and fiscal year it relates to, and links to that exact document.
    await expect(page.getByText("AI-extracted from AAPL's DEF 14A filed 2026-04-10 (accession 0000320193-26-000001) for the 2026 annual meeting.").first()).toBeVisible();
    await expect(page.getByText('Covers the 2026 annual meeting (meeting date 2026-05-20, EDGAR period of report); compensation for fiscal 2025 (fiscal year ended 2025-12-31).').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'AAPL proxy on SEC.gov — DEF 14A filed 2026-04-10' }).first())
      .toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-proxy.htm');
    await expect(page.getByRole('link', { name: 'AAPL DEF 14A filing index — accession 0000320193-26-000001' }).first())
      .toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.htm');

    const target = page.getByLabel('Target company ticker');
    await target.fill('MSFT');
    await target.press('Enter');
    await expect(page.getByRole('heading', { name: 'Board of Directors — Microsoft Fixture Corp' })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByText('MSFT Independent Director', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'MSFT proxy on SEC.gov — DEF 14A filed 2026-04-10' }).first())
      .toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/789019/000078901926000001/msft-proxy.htm');

    // A ticker the loaded directory does not have is a truthful absence: a
    // status naming the directory, not an alert, and nothing to retry.
    await target.fill('ZZZZ');
    await target.press('Enter');
    const absence = page.getByRole('status').filter({ hasText: 'No issuer with ticker "ZZZZ" in the SEC company directory' });
    await expect(absence).toBeVisible({ timeout: 20_000 });
    await expect(absence).toContainText('Ticker not in SEC directory');
    await expect(absence.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    // Scoped to the board workspace: the dev server injects its own alert
    // region (Next dev tools), which the production build CI runs does not.
    await expect(page.locator('.board-main').getByRole('alert')).toHaveCount(0);
  });

  test('board-profiles.load-target distinguishes a failed SEC lookup, a missing proxy, and an unreadable proxy', async ({ page }) => {
    const stats = await installGovernanceAnalyticsFixtures(page, {
      proxylessTickers: ['GOOGL'],
      filingTextFailures: { META: { status: 404, count: 2 } },
      submissionFailuresBeforeSuccess: { NVDA: 6 },
    });
    await openWorkspace(page, '/boards', 'Board Profiles & Executive Compensation');
    await expect(page.getByRole('heading', { name: 'Board of Directors — Apple Fixture Corp' })).toBeVisible({ timeout: 25_000 });
    const target = page.getByLabel('Target company ticker');

    // No DEF 14A on record: an absence that names the CIK and what was checked.
    await target.fill('GOOGL');
    await target.press('Enter');
    const missing = page.getByRole('status').filter({ hasText: 'No DEF 14A proxy statement on record for CIK 1652044 (Alphabet Fixture Corp)' });
    await expect(missing).toBeVisible({ timeout: 20_000 });
    await expect(missing).toContainText('4 filings from 2026-02-20 to 2026-07-08 were checked');
    await expect(missing).toContainText('Nothing was extracted');
    await expect(missing.getByRole('button', { name: 'Retry' })).toHaveCount(0);

    // On record but unreadable: an error that names the filing, the document,
    // and the reason, and still links the filing index for manual inspection.
    await target.fill('META');
    await target.press('Enter');
    const unreadable = page.getByRole('alert').filter({ hasText: 'DEF 14A filed 2026-04-10 (accession 0001326801-26-000001) is on record, but its document meta-proxy.htm could not be read' });
    await expect(unreadable).toBeVisible({ timeout: 20_000 });
    await expect(unreadable).toContainText('SEC returned 404 for the document');
    await expect(unreadable.getByRole('link', { name: 'META DEF 14A filing index — accession 0001326801-26-000001' }))
      .toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/1326801/000132680126000001/0001326801-26-000001-index.htm');
    await expect(unreadable).not.toContainText('No DEF 14A');

    // SEC outage: a lookup failure that denies nothing and can be retried.
    await target.fill('NVDA');
    await target.press('Enter');
    const outage = page.getByRole('alert').filter({ hasText: 'SEC EDGAR submissions could not be loaded for CIK 1045810 (NVDA)' });
    await expect(outage).toBeVisible({ timeout: 30_000 });
    await expect(outage).toContainText('not evidence that the issuer has no proxy statement on record');
    expect(stats.submissionRequests.NVDA).toBe(6);

    await outage.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Board of Directors — Nvidia Fixture Corp' })).toBeVisible({ timeout: 25_000 });
    await expect(outage).toHaveCount(0);
    expect(stats.submissionRequests.NVDA).toBeGreaterThanOrEqual(7);
    await expect(page.getByRole('link', { name: 'NVDA proxy on SEC.gov — DEF 14A filed 2026-04-10' }).first())
      .toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/nvda-proxy.htm');
  });

  test('board-profiles.open-proxy-source opens the exact DEF 14A on SEC.gov without losing the board view', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/boards', 'Board Profiles & Executive Compensation');
    await expect(page.getByRole('heading', { name: 'Board of Directors — Apple Fixture Corp' })).toBeVisible({ timeout: 25_000 });

    const documentUrl = 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-proxy.htm';
    const source = page.getByRole('link', { name: 'AAPL proxy on SEC.gov — DEF 14A filed 2026-04-10' }).first();
    await expect(source).toHaveAttribute('href', documentUrl);
    await expect(source).toHaveAttribute('target', '_blank');
    await expect(source).toHaveAttribute('rel', /noopener/);
    const before = page.url();
    const [popup] = await Promise.all([page.waitForEvent('popup'), source.click()]);
    await expect.poll(() => popup.url()).toBe(documentUrl);
    await popup.close();
    expect(page.url()).toBe(before);
    await expect(page.getByRole('heading', { name: 'Board of Directors — Apple Fixture Corp' })).toBeVisible();

    const indexUrl = 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.htm';
    const index = page.getByRole('link', { name: 'AAPL DEF 14A filing index — accession 0000320193-26-000001' }).first();
    await expect(index).toHaveAttribute('href', indexUrl);
    const [indexPopup] = await Promise.all([page.waitForEvent('popup'), index.click()]);
    await expect.poll(() => indexPopup.url()).toBe(indexUrl);
    await indexPopup.close();
    expect(page.url()).toBe(before);
    await expect(page.getByText('AAPL Independent Director', { exact: true })).toBeVisible();
  });

  test('board-profiles.manage-comparison adds chooses and removes without disturbing neighbours', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/boards', 'Board Profiles & Executive Compensation');
    await expect(page.getByRole('heading', { name: 'Board of Directors — Apple Fixture Corp' })).toBeVisible({ timeout: 25_000 });

    await chooseCompany(page, 'Add ticker...', 'NVDA');
    const comparison = page.getByRole('table', { name: 'Board governance comparison for selected companies' });
    await expect(comparison).toBeVisible({ timeout: 30_000 });
    await expect(comparison.getByRole('columnheader', { name: 'Apple Fixture Corp', exact: true })).toHaveCount(1);
    await expect(comparison.getByRole('columnheader', { name: 'Nvidia Fixture Corp', exact: true })).toHaveCount(1);
    // Each column names its own source filing.
    await expect(comparison.getByRole('link', { name: 'NVDA proxy on SEC.gov — DEF 14A filed 2026-04-10' }))
      .toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/nvda-proxy.htm', { timeout: 20_000 });
    await expect(comparison.getByRole('link', { name: 'AAPL proxy on SEC.gov — DEF 14A filed 2026-04-10' }))
      .toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-proxy.htm');

    await page.getByRole('button', { name: 'AAPL', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Board of Directors — Apple Fixture Corp' })).toBeVisible({ timeout: 20_000 });
    await chooseCompany(page, 'Add ticker...', 'NVDA');
    await expect(comparison.getByRole('columnheader', { name: 'Nvidia Fixture Corp', exact: true })).toHaveCount(1);

    await page.getByRole('button', { name: 'Remove NVDA from comparison', exact: true }).click();
    await expect(comparison).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'AAPL', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('AAPL Independent Director', { exact: true })).toBeVisible();
  });

  test('board-profiles.switch-view activates issuer-specific directors diversity and compensation', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/boards', 'Board Profiles & Executive Compensation');
    await expect(page.getByRole('heading', { name: 'Board of Directors — Apple Fixture Corp' })).toBeVisible({ timeout: 25_000 });

    const diversity = page.getByRole('button', { name: 'Board Diversity', exact: true });
    await diversity.click();
    await expect(page.getByRole('heading', { name: 'Board Diversity — Apple Fixture Corp' })).toBeVisible();
    await expect(page.getByText("AI-extracted from AAPL's DEF 14A filed 2026-04-10 (accession 0000320193-26-000001) for the 2026 annual meeting.")).toBeVisible();
    // The percentage is the disclosed evidence. The fixture proxy states no
    // headcount, so the count is offered only as a labelled derivation (both
    // bars: 50% of eight), never as a fact.
    await expect(page.getByText('≈ 4 of 8 — derived from a rounded 50% of 8 directors, not a disclosed count')).toHaveCount(2);
    await expect(page.getByText('count disclosed in the proxy')).toHaveCount(0);
    // Say-on-pay is attributed to an earlier meeting than the proxy's own.
    await expect(page.getByText(/an annual meeting no later than 2025 — not the 2026 meeting's vote/)).toBeVisible();
    await expect(diversity).toHaveAttribute('aria-pressed', 'true');

    const compensation = page.getByRole('button', { name: 'Executive Comp (PvP)', exact: true });
    await compensation.click();
    await expect(page.getByRole('heading', { name: 'Executive Compensation — Apple Fixture Corp' })).toBeVisible();
    await expect(page.getByText('AAPL Chief Executive', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Named Executive Officers (NEOs): fiscal 2025 (fiscal year ended 2025-12-31) compensation, as disclosed in the DEF 14A filed 2026-04-10.')).toBeVisible();
    await expect(page.getByText('Earlier vote (meeting no later than 2025) as reported in the 2026-meeting proxy filed 2026-04-10; not the 2026 meeting result.')).toBeVisible();
    await expect(page.getByText('From latest annual shareholder meeting')).toHaveCount(0);
    await expect(compensation).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Director Profiles', exact: true }).click();
    await expect(page.getByText('AAPL Independent Director', { exact: true })).toBeVisible();
  });

  test('board-profiles.retry-company re-fetches the current ticker and replaces the failure', async ({ page }) => {
    const stats = await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/boards', 'Board Profiles & Executive Compensation');
    await expect(page.getByRole('heading', { name: 'Board of Directors — Apple Fixture Corp' })).toBeVisible({ timeout: 25_000 });

    const promptsBeforeFailure = stats.claudePrompts.length;
    // Selecting a new target also adds it to the comparison cohort. Both paths
    // share one in-flight load, so exactly one two-attempt Claude call fails
    // before the explicit retry.
    stats.failNextAiAttempts('board', 2);
    const target = page.getByLabel('Target company ticker');
    await target.fill('MSFT');
    await target.press('Enter');
    const boardError = page.getByRole('alert').filter({ hasText: 'AI extraction returned no usable data' });
    await expect(boardError).toBeVisible({ timeout: 25_000 });
    // The failure names the filing that WAS read and denies nothing about it.
    await expect(boardError).toContainText('DEF 14A filed 2026-04-10 (accession 0000789019-26-000001) was read');
    await expect(boardError).toContainText('not evidence that the proxy lacks these disclosures');
    expect(stats.claudePrompts).toHaveLength(promptsBeforeFailure + 2);
    // The comparison column reports the same failure in every metric row —
    // distinctly, never as an absent proxy.
    const comparison = page.getByRole('table', { name: 'Board governance comparison for selected companies' });
    await expect(comparison.getByText('Extraction failed', { exact: true }).first()).toBeVisible();
    await expect(comparison.getByText('No DEF 14A on record', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Board of Directors — Microsoft Fixture Corp' })).toBeVisible({ timeout: 25_000 });
    await expect(boardError).toHaveCount(0);
    expect(stats.claudePrompts).toHaveLength(promptsBeforeFailure + 3);
    expect(stats.claudePrompts.at(-1)).toContain('evidence for MSFT');
    expect(stats.submissionRequests.MSFT).toBeGreaterThanOrEqual(2);
    // The same retry repaired the comparison column, which shares the load.
    await expect(comparison.getByText('Extraction failed', { exact: true })).toHaveCount(0);
    await expect(comparison.getByRole('link', { name: 'MSFT proxy on SEC.gov — DEF 14A filed 2026-04-10' })).toBeVisible({ timeout: 20_000 });
  });

  test('insider-trading.add-company and insider-trading.remove-company keep only associated filing rows', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/insiders', 'Insider Trading');

    await test.step('ui-action:insider-trading.add-company', async () => {
      await chooseCompany(page, 'Add company by ticker...', 'AAPL');
      await expect(page.getByRole('link', { name: /Apple Fixture Corp/ })).toHaveCount(2, { timeout: 20_000 });
      await chooseCompany(page, 'Add company by ticker...', 'AAPL');
      await expect(page.getByRole('link', { name: /Apple Fixture Corp/ })).toHaveCount(2);

      await chooseCompany(page, 'Add company by ticker...', 'MSFT');
      await expect(page.getByRole('link', { name: /Microsoft Fixture Corp/ })).toHaveCount(2, { timeout: 20_000 });
    });
    await test.step('ui-action:insider-trading.remove-company', async () => {
      await page.getByRole('button', { name: 'Remove AAPL', exact: true }).click();
      await expect(page.getByRole('link', { name: /Apple Fixture Corp/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: /Microsoft Fixture Corp/ })).toHaveCount(2);
      await expect(page.getByRole('button', { name: 'Remove MSFT', exact: true })).toBeVisible();
    });
  });

  test('insider-trading.open-source opens the exact official filing without losing the monitor', async ({ page }) => {
    await installGovernanceAnalyticsFixtures(page);
    await openWorkspace(page, '/insiders', 'Insider Trading');
    await chooseCompany(page, 'Add company by ticker...', 'AAPL');
    const source = page.getByRole('link', { name: /View Form 4 insider filing for Apple Fixture Corp/ });
    await expect(source).toHaveAttribute('href', 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000003/aapl-form4.htm');
    await expect(source).toHaveAttribute('target', '_blank');

    const before = page.url();
    const [popup] = await Promise.all([page.waitForEvent('popup'), source.click()]);
    await expect.poll(() => popup.url()).toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000003/aapl-form4.htm');
    await popup.close();
    expect(page.url()).toBe(before);
    await expect(page.getByRole('link', { name: /Apple Fixture Corp/ })).toHaveCount(2);
  });
});
