import { expect, test, type Page, type Route } from '@playwright/test';
import { installBooleanFixtures } from './boolean-fixtures';
import { SEARCH_CORPUS, installFilingSearchFixtures } from './filing-search-fixtures';
import {
  IPO_FILINGS,
  MNA_FILINGS,
  installTransactionFixtures,
} from './reference-transaction-fixtures';

/**
 * Transaction-workflow evidence. Fixtures supply stable SEC rows, filing text,
 * and AI outputs, while assertions preserve the accession/document chain from
 * the user's click through the displayed outcome.
 */

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 },
  );
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
}

async function openIpoWithFixtures(page: Page) {
  const fixture = await installTransactionFixtures(page);
  await open(page, '/ipo');
  await expect(page.getByText(IPO_FILINGS[0].entity).first()).toBeVisible({ timeout: 30_000 });
  return fixture;
}

async function openIpoAnalyzer(page: Page) {
  await page.getByRole('button', { name: 'Open Registration Analyzer' }).click();
  await expect(page.getByRole('heading', { name: 'S-1 Registration Statement Analyzer' })).toBeVisible();
}

async function selectIpoFiling(page: Page) {
  await openIpoAnalyzer(page);
  const search = page.getByRole('textbox', { name: 'Company, ticker, or keyword' });
  await search.fill('Arcadia Robotics');
  await page.getByRole('button', { name: 'Search EDGAR' }).click();
  const result = page.getByRole('button', { name: new RegExp(IPO_FILINGS[0].entity) });
  await expect(result).toBeVisible({ timeout: 20_000 });
  await result.click();
  await expect(page.getByRole('heading', { name: IPO_FILINGS[0].entity })).toBeVisible({ timeout: 20_000 });
}

test.describe('IPO Center interactions', () => {
  test('ipo-center.switch-section preserves loaded pipeline evidence across every workflow', async ({ page }) => {
    const fixture = await openIpoWithFixtures(page);
    const requestsAfterLoad = fixture.eftsRequests.length;

    const metrics = page.getByRole('tab', { name: 'Live Feed Metrics' });
    await metrics.click();
    await expect(metrics).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Live Feed Metrics' })).toBeVisible();
    await expect(page.getByText(`${IPO_FILINGS.length} filings`, { exact: true })).toBeVisible();

    const activity = page.getByRole('tab', { name: 'Filing Activity' });
    await activity.click();
    await expect(activity).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'IPO Filing Activity' })).toBeVisible();

    await page.getByRole('tab', { name: 'Global Pipeline' }).click();
    await expect(page.getByText(IPO_FILINGS[0].entity).first()).toBeVisible();
    await expect(page.getByText(IPO_FILINGS[1].entity).first()).toBeVisible();
    expect(fixture.eftsRequests.length, 'switching workflows must not discard and reload the pipeline').toBe(requestsAfterLoad);
  });

  test('ipo-center.open-analyzer opens the filing finder and provides a working return path', async ({ page }) => {
    await openIpoWithFixtures(page);
    await openIpoAnalyzer(page);
    await expect(page.getByRole('textbox', { name: 'Company, ticker, or keyword' })).toBeVisible();
    await page.getByRole('button', { name: 'Back to IPO Center' }).click();
    await expect(page.getByRole('heading', { name: 'IPO & Pre-IPO Readiness Center' })).toBeVisible();
    await expect(page.getByText(IPO_FILINGS[0].entity).first()).toBeVisible();
  });

  test('ipo-center.find-and-select-filing and ipo-center.open-sec-source preserve the exact registration statement identity', async ({ page }) => {
    const fixture = await openIpoWithFixtures(page);
    const source = page.getByRole('link', { name: `View ${IPO_FILINGS[0].entity} filing on SEC.gov` });
    await test.step('ui-action:ipo-center.find-and-select-filing', async () => {
      await selectIpoFiling(page);
      await expect(page.getByText(`Accession: ${IPO_FILINGS[0].accession}`)).toBeVisible();
      await expect(page.getByText(`${IPO_FILINGS[0].form}`, { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/chars loaded/)).toBeVisible({ timeout: 20_000 });
      expect(fixture.filingTextRequests).toContain(IPO_FILINGS[0].document);
    });
    await test.step('ui-action:ipo-center.open-sec-source', async () => {
      await expect(source).toHaveAttribute('target', '_blank');
      await expect(source).toHaveAttribute('rel', /noreferrer|noopener/);
      await expect(source).toHaveAttribute('href', new RegExp(`sec\\.gov/Archives/edgar/data/${IPO_FILINGS[0].cik}/${IPO_FILINGS[0].accession.replace(/-/g, '')}/`));
      const analyzerUrl = page.url();
      const sourceHref = await source.getAttribute('href');
      const [sourcePage] = await Promise.all([page.waitForEvent('popup'), source.click()]);
      await expect.poll(() => sourcePage.url()).toBe(sourceHref);
      await sourcePage.close();
      expect(page.url(), 'opening the registration statement must retain the analyzer').toBe(analyzerUrl);
    });
  });

  test('ipo-center.run-analysis grounds the chosen section in the selected filing evidence', async ({ page }) => {
    const fixture = await openIpoWithFixtures(page);
    await selectIpoFiling(page);
    await expect(page.getByText(/Evidence-linked analysis/).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('tab', { name: 'Risk Factors' }).click();
    const panel = page.getByRole('tabpanel');
    await expect(panel.getByText(/Evidence-linked analysis/)).toBeVisible({ timeout: 20_000 });
    expect(fixture.claudePrompts.some(prompt => (
      prompt.includes('Risk Factors')
      && prompt.includes('customer concentration')
      && prompt.includes('Arcadia Robotics')
    )), 'analysis request must carry both the selected section and filing evidence').toBe(true);
  });

  test('ipo-center.save-or-export-pipeline saves criteria and downloads the loaded official rows', async ({ page }) => {
    await openIpoWithFixtures(page);
    await page.getByRole('button', { name: 'Save Local Search' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved a local IPO filing monitor' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      Object.values(window.localStorage).some(value => value?.includes('IPO registration filings'))
    ))).toBe(true);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^URC_IPO_pipeline_\d{4}-\d{2}-\d{2}\.csv$/);
    const stream = await download.createReadStream();
    expect(stream).not.toBeNull();
    let csv = '';
    for await (const chunk of stream!) csv += chunk.toString();
    for (const filing of IPO_FILINGS) {
      expect(csv).toContain(filing.entity);
      expect(csv).toContain(filing.accession);
    }
    await expect(page.getByRole('status').filter({ hasText: `Exported ${IPO_FILINGS.length} loaded SEC filings` })).toBeVisible();
  });

  test('ipo-center.analyze-pipeline-row selects that row without a second filing search', async ({ page }) => {
    const fixture = await openIpoWithFixtures(page);
    const requestsBeforeAnalyze = fixture.eftsRequests.length;
    const row = page.locator('tbody tr', { hasText: IPO_FILINGS[1].entity });
    await row.getByRole('button', { name: 'Analyze filing' }).click();

    await expect(page.getByRole('heading', { name: IPO_FILINGS[1].entity })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(`Accession: ${IPO_FILINGS[1].accession}`)).toBeVisible();
    expect(fixture.eftsRequests.length, 'a pipeline-row action must not require a second EDGAR search').toBe(requestsBeforeAnalyze);
    expect(fixture.filingTextRequests).toContain(IPO_FILINGS[1].document);
  });
});

async function openMnaWithFixtures(page: Page) {
  const fixture = await installTransactionFixtures(page);
  await open(page, '/mna');
  await expect(page.getByText(MNA_FILINGS[0].entity).first()).toBeVisible({ timeout: 30_000 });
  return fixture;
}

test.describe('M&A research interactions', () => {
  test('mna-research.load-deals and mna-research.open-sec-source expose matching official transaction rows', async ({ page }) => {
    const fixture = await installTransactionFixtures(page);
    fixture.failures.efts = true;
    await open(page, '/mna');
    const loadError = page.getByRole('alert').filter({ hasText: /could not be loaded from SEC EDGAR/i });
    await expect(loadError).toContainText(/could not be loaded from SEC EDGAR/i, { timeout: 30_000 });

    const row = page.locator('tbody tr', { hasText: MNA_FILINGS[0].entity });
    const source = row.getByRole('link', { name: 'SEC.gov' });
    await test.step('ui-action:mna-research.load-deals', async () => {
      fixture.failures.efts = false;
      await page.getByRole('button', { name: 'Retry filings' }).click();
      await expect(page.getByText(MNA_FILINGS[0].entity).first()).toBeVisible({ timeout: 30_000 });
      await expect(row).toContainText(MNA_FILINGS[0].form);
      await expect(row).toContainText(MNA_FILINGS[0].filed);
      expect(fixture.eftsRequests.some(request => request.forms.includes('SC TO-T'))).toBe(true);
    });
    await test.step('ui-action:mna-research.open-sec-source', async () => {
      await expect(source).toHaveAttribute('target', '_blank');
      await expect(source).toHaveAttribute('rel', /noreferrer|noopener/);
      await expect(source).toHaveAttribute('href', new RegExp(`${MNA_FILINGS[0].accession.replace(/-/g, '')}/`));
      const screenerUrl = page.url();
      const sourceHref = await source.getAttribute('href');
      const [sourcePage] = await Promise.all([page.waitForEvent('popup'), source.click()]);
      await expect.poll(() => sourcePage.url()).toBe(sourceHref);
      await sourcePage.close();
      expect(page.url(), 'opening an official deal filing must retain the screener').toBe(screenerUrl);
      await expect(row).toContainText(MNA_FILINGS[0].entity);
    });
  });

  test('mna-research.extract-deal-details displays structured output traceable to the same row', async ({ page }) => {
    const fixture = await openMnaWithFixtures(page);
    const row = page.locator('tbody tr', { hasText: MNA_FILINGS[0].entity });
    await row.getByRole('button', { name: 'Extract with AI' }).click();
    await expect(row.getByText('Halloway Industries Inc / Trenton Ridge Corporation')).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText('$2.4B — Merger Agreement')).toBeVisible();
    await expect(row.getByRole('link', { name: 'SEC.gov' })).toHaveAttribute('href', new RegExp(MNA_FILINGS[0].accession.replace(/-/g, '')));
    expect(fixture.filingTextRequests).toContain(MNA_FILINGS[0].document);
    expect(fixture.claudePrompts.some(prompt => (
      prompt.includes('Extract deal details')
      && prompt.includes('$2.4 billion')
      && prompt.includes('Trenton Ridge Corporation')
    ))).toBe(true);
  });

  test('mna-research.find-clause-filing and mna-research.extract-clause keep the selected source explicit', async ({ page }) => {
    const fixture = await openMnaWithFixtures(page);
    const input = page.getByLabel('Step 1: Search for a merger filing');
    const candidate = page.getByRole('button', { name: new RegExp(MNA_FILINGS[0].entity) });
    await test.step('ui-action:mna-research.find-clause-filing', async () => {
      await page.getByRole('button', { name: 'Clause Library' }).click();
      await input.fill('Halloway merger agreement');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(candidate).toBeVisible({ timeout: 20_000 });
      await candidate.click();
      await expect(candidate).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText(/Select a clause type and click "Extract Clause"/)).toBeVisible();
    });

    await test.step('ui-action:mna-research.extract-clause', async () => {
      await page.getByLabel('Step 2: Select clause type').selectOption({ label: 'Termination Fee (Reverse Breakup)' });
      await page.getByRole('button', { name: 'Extract Clause' }).click();
      await expect(page.getByRole('heading', { name: 'Termination Fee (Reverse Breakup)' })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('A reverse termination fee of $120 million is payable if the financing conditions are not met.')).toBeVisible();
      await expect(page.getByText('Section 8.3')).toBeVisible();
      await expect(page.getByText(new RegExp(`From: ${MNA_FILINGS[0].entity}`))).toBeVisible();
      expect(fixture.claudePrompts.some(prompt => (
        prompt.includes('Termination Fee (Reverse Breakup)')
        && prompt.includes('Section 8.3')
        && prompt.includes(MNA_FILINGS[0].entity)
      ))).toBe(true);
    });
  });
});

const FORM_D = SEARCH_CORPUS.find(filing => filing.form === 'D')!;

async function installExemptFixtures(page: Page) {
  await installBooleanFixtures(page);
  return installFilingSearchFixtures(page);
}

test.describe('exempt offering interactions', () => {
  test('exempt-offerings.open-recent-filing opens the exact card in the internal filing viewer', async ({ page }) => {
    await installExemptFixtures(page);
    await open(page, '/exempt-offerings');
    const recent = page.getByRole('button', { name: new RegExp(FORM_D.entity) });
    await expect(recent).toBeVisible({ timeout: 30_000 });
    await recent.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe(
      `/filing/${FORM_D.cik}_${FORM_D.accession}_${FORM_D.document}`,
    );
  });

  test('exempt-offerings.retry-failure reruns only the failed recent operation and replaces its error', async ({ page }) => {
    await installExemptFixtures(page);
    let attempts = 0;
    let recover = false;
    await page.route('**/api/sec-efts**', async (route: Route) => {
      attempts += 1;
      if (!recover) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'fixture source unavailable' }),
        });
        return;
      }
      await route.fallback();
    });

    await open(page, '/exempt-offerings');
    const retry = page.getByRole('button', { name: 'Retry recent filings' });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    const attemptsBeforeRetry = attempts;
    recover = true;
    await retry.click();

    await expect(page.getByText(FORM_D.entity).first()).toBeVisible({ timeout: 30_000 });
    await expect(retry).toHaveCount(0);
    expect(attempts).toBeGreaterThan(attemptsBeforeRetry);
    await expect(page.getByRole('combobox', { name: 'Search Form D filings' })).toHaveValue('');
    await expect(page.getByText(/Recent Exempt Offerings/)).toBeVisible();
  });
});
