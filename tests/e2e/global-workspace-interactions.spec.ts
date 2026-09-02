import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type Route } from '@playwright/test';
import { FILINGS, installBooleanFixtures } from './boolean-fixtures';
import {
  COMMENT_LETTER,
  fulfillAdviserPayload,
  installCopilotFixtures,
  installLookupFixtures,
} from './global-workspace-fixtures';

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

async function runBooleanQuery(page: Page, query: string) {
  await page.goto('/search', { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
  const input = page.getByRole('combobox', { name: 'Boolean search query' });
  await expect(async () => {
    await page.getByRole('button', { name: 'Boolean / Proximity' }).click();
    await expect(input).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await input.fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(FILINGS[2].company).first()).toBeVisible({ timeout: 30_000 });
}

function adviserQuery(route: Route): string {
  return new URL(route.request().url()).searchParams.get('query') || '';
}

async function openCopilot(page: Page) {
  const trigger = page.getByRole('button', { name: /URC Copilot/ }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const composer = page.getByRole('textbox', { name: 'Message URC Copilot' });
  await expect(composer).toBeFocused();
  return { trigger, composer };
}

async function submitCopilot(page: Page, prompt: string) {
  const composer = page.getByRole('textbox', { name: 'Message URC Copilot' });
  await composer.fill(prompt);
  await page.getByRole('button', { name: 'Send message to copilot' }).click();
  await expect(page.locator('.run-status')).toContainText('completed', { timeout: 30_000 });
}

test.describe('global research interaction archetypes', () => {
  test('global.copilot-panel manages focus, executes grounded runs, switches views, revisits history, and opens citations', async ({ page }) => {
    await installBooleanFixtures(page);
    await installCopilotFixtures(page);
    await page.goto('/dashboard');
    await waitForIdentity(page);

    // Opening moves focus to the composer; closing returns it to the exact
    // invoking control instead of dropping keyboard users at document start.
    const firstOpen = await openCopilot(page);
    const trigger = firstOpen.trigger;
    await page.getByRole('button', { name: 'Close copilot' }).click();
    await expect(trigger).toBeFocused();
    const { composer } = await openCopilot(page);
    // Evidence citations and the tab buttons are the panel's own controls.
    // The research sessions the actions open render result rows behind the
    // panel whose cite chips name the filing — including the fixture's
    // "Evidence Ledger Industries" comment letter, which a non-exact
    // `name: 'Evidence'` also matches — so every locator stays inside the
    // assistant and tab names match exactly.
    const assistant = page.getByRole('complementary', { name: 'URC Copilot research assistant' });
    const panelTab = (name: 'Answer' | 'Evidence' | 'Action Log') => assistant.getByRole('button', { name, exact: true });

    const filingPrompt = 'Find mezzanine equity';
    await submitCopilot(page, filingPrompt);
    await panelTab('Action Log').click();
    await expect(page.getByText('Search filings', { exact: true }).first()).toBeVisible();
    await panelTab('Evidence').click();
    const filingCitation = assistant.getByRole('button', { name: /Mezz Only Corp 10-K/ });
    await expect(filingCitation).toBeVisible();
    // The action also opens a research session. Wait for that route-state sync
    // to settle before activating its evidence link, or the session writer and
    // citation navigation race each other for the URL.
    await expect(page).toHaveURL(/\/search\?.*q=mezzanine(?:\+|%20)equity/);
    await filingCitation.click();
    await expect(page).toHaveURL(new RegExp(`/filing/${Number(FILINGS[0].cik)}_${FILINGS[0].accession}_${FILINGS[0].document}`));

    const letterPrompt = 'Find SEC comment letters on revenue recognition';
    await composer.fill(letterPrompt);
    await page.getByRole('button', { name: 'Send message to copilot' }).click();
    await expect(page.locator('.run-status')).toContainText('completed', { timeout: 30_000 });
    await panelTab('Evidence').click();
    const letterCitation = assistant.getByRole('button', { name: new RegExp(`${COMMENT_LETTER.company_name} ${COMMENT_LETTER.form}`) });
    await expect(letterCitation).toBeVisible();
    await letterCitation.click();
    await expect(page).toHaveURL(new RegExp(`thread=${COMMENT_LETTER.thread_id}`));

    // History selection changes the represented run, not just the chip style.
    await page.getByRole('button', { name: filingPrompt, exact: true }).click();
    await expect(page.locator('.run-prompt')).toHaveText(filingPrompt);
    await panelTab('Answer').click();
    await expect(page.getByText('The result is grounded in the cited SEC evidence packet.')).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`^${letterPrompt.slice(0, 42)}`) }).click();
    await expect(page.locator('.run-prompt')).toHaveText(letterPrompt);
  });

  test('global.memo-tray persists only intended evidence, exports labelled artifacts, drafts, and confirms clearing', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await installBooleanFixtures(page);
    let memoPrompt = '';
    await page.route('**/api/claude', async route => {
      memoPrompt = String((JSON.parse(route.request().postData() || '{}') as { prompt?: string }).prompt || '');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: '# Research memo — equity classification\n\n## Purpose\nAssess the cited disclosure [1].\n\n## Evidence summary\n- The filing describes mezzanine equity [1].\n\n## Observations\n- Classification is explicit [1].\n\n## Open questions\n- Review later periods [1].' }),
      });
    });

    await runBooleanQuery(page, 'mezzanine OR temporary');
    for (const company of [FILINGS[0].company, FILINGS[1].company]) {
      await page.getByText(company).first().click();
      await page.getByRole('button', { name: 'Cite', exact: true }).click();
    }

    await page.getByRole('button', { name: 'Open memo tray (2 citations)' }).click();
    const tray = page.getByRole('complementary', { name: 'Memo tray' });
    await expect(tray).toBeVisible();
    const firstItem = tray.locator('.memo-tray-item').filter({ hasText: FILINGS[0].company });
    await firstItem.getByRole('textbox').fill('Classification note for the first filing only.');

    await tray.getByRole('button', { name: 'Copy citations' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(FILINGS[0].accession);

    const exportEvent = page.waitForEvent('download');
    await tray.getByRole('button', { name: 'Export .md' }).click();
    const download = await exportEvent;
    expect(download.suggestedFilename()).toMatch(/^urc-memo-\d{4}-\d{2}-\d{2}\.md$/);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const markdown = await readFile(downloadPath as string, 'utf8');
    expect(markdown).toContain('# Research memo — cited evidence');
    expect(markdown).toContain('Classification note for the first filing only.');
    expect(markdown).toContain(FILINGS[1].accession);

    // Remove citation 2 and prove citation 1 (and its note) survived reload.
    await tray.getByRole('button', { name: 'Remove citation 2' }).click();
    await expect(tray.locator('.memo-tray-item')).toHaveCount(1);
    await expect(firstItem.getByRole('textbox')).toHaveValue('Classification note for the first filing only.');
    await page.reload();
    await waitForIdentity(page);
    await page.getByRole('button', { name: 'Open memo tray (1 citation)' }).click();
    const reloadedTray = page.getByRole('complementary', { name: 'Memo tray' });
    await expect(reloadedTray.getByRole('textbox')).toHaveValue('Classification note for the first filing only.');

    await reloadedTray.getByRole('button', { name: 'Draft memo with AI' }).click();
    await expect(reloadedTray.getByText('Research memo — equity classification')).toBeVisible({ timeout: 20_000 });
    expect(memoPrompt).toContain(FILINGS[0].accession);
    expect(memoPrompt).not.toContain(FILINGS[1].accession);

    await reloadedTray.getByRole('button', { name: 'Clear all', exact: true }).click();
    await expect(reloadedTray.locator('.memo-tray-item')).toHaveCount(1);
    await expect(reloadedTray.getByRole('button', { name: 'Confirm clear all' })).toBeVisible();
    await reloadedTray.getByRole('button', { name: 'Confirm clear all' }).click();
    await expect(reloadedTray.getByText('No citations yet.')).toBeVisible();
  });

  test('global.results-table sorts both directions and paginates without skipping or duplicating rows', async ({ page }) => {
    await page.route('**/api/sec-proxy?**upstream=iapd**', route =>
      fulfillAdviserPayload(route, 'Ledger Adviser', 27, 27, { descending: true })
    );
    await page.goto('/adv-registrations');
    await waitForIdentity(page);
    await page.getByRole('textbox', { name: 'Firm name, CRD number, or SEC number' }).fill('ledger');
    await page.getByRole('button', { name: 'Search IAPD' }).click();
    await expect(page.getByText('Showing 27 of 27 matching IAPD firms.')).toBeVisible();

    const table = page.getByRole('table');
    const firstFirm = () => table.locator('tbody tr').first().locator('td').first();
    await table.getByRole('button', { name: 'Firm' }).click();
    await expect(table.getByRole('columnheader', { name: 'Firm' })).toHaveAttribute('aria-sort', 'ascending');
    await expect(firstFirm()).toHaveText('Ledger Adviser 01');
    await table.getByRole('button', { name: 'Firm' }).click();
    await expect(table.getByRole('columnheader', { name: 'Firm' })).toHaveAttribute('aria-sort', 'descending');
    await expect(firstFirm()).toHaveText('Ledger Adviser 27');

    const pageOne = await table.locator('tbody tr td:first-child').allTextContents();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByText('Showing 26–27 of 27')).toBeVisible();
    const pageTwo = await table.locator('tbody tr td:first-child').allTextContents();
    expect(pageOne).toHaveLength(25);
    expect(pageTwo).toHaveLength(2);
    expect(new Set([...pageOne, ...pageTwo]).size).toBe(27);
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(page.getByText('Showing 1–25 of 27')).toBeVisible();
  });

  test('global.results-toolbar exports and copies the visible scope and tells Copilot its exact evidence bound', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.route('**/api/sec-proxy?**upstream=iapd**', route =>
      fulfillAdviserPayload(route, 'Scope Adviser', 27, 40)
    );
    await page.route('**/api/sec-efts**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: { total: { value: 0, relation: 'eq' }, hits: [] } }) });
    });
    await page.route('**/api/es-search**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ hits: { total: { value: 0, relation: 'eq' }, hits: [] } }) });
    });
    await page.route('**/api/enrich**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ companies: {} }) });
    });
    await page.route('**/api/stream', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'Bounded analysis complete.' }) });
    });

    await page.goto('/adv-registrations');
    await waitForIdentity(page);
    await page.getByRole('textbox', { name: 'Firm name, CRD number, or SEC number' }).fill('scope');
    await page.getByRole('button', { name: 'Search IAPD' }).click();
    const toolbar = page.getByRole('toolbar', { name: 'investment advisers result actions' });
    await expect(toolbar).toBeVisible();

    const exportEvent = page.waitForEvent('download');
    await toolbar.getByRole('button', { name: 'CSV' }).click();
    const download = await exportEvent;
    expect(download.suggestedFilename()).toMatch(/^URC_investment_advisers_\d{4}-\d{2}-\d{2}\.csv$/);
    const csvPath = await download.path();
    const csv = await readFile(csvPath as string, 'utf8');
    expect(csv).toContain('Firm,CRD #,SEC #,Registration,Principal Office,Disclosures,Official Record');
    expect(csv).toContain('Scope Adviser 27');

    await toolbar.getByRole('button', { name: 'Copy' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('Scope Adviser 01');
    expect(copied).toContain('Scope Adviser 27');

    await toolbar.getByRole('button', { name: 'Analyze in Copilot' }).click();
    await expect(page.locator('.run-prompt')).toContainText('bounded snapshot of 20 of 27 investment advisers results');
    await expect(page.locator('.run-prompt')).toContainText('Scope Adviser 20');
    await expect(page.locator('.run-prompt')).not.toContainText('Scope Adviser 21');
  });

  test('global.lookup-fields select official company, entity, SIC, and auditor suggestions and clear parent state', async ({ page }) => {
    await installLookupFixtures(page);
    await page.goto('/search');
    await waitForIdentity(page);
    await page.getByRole('button', { name: /Advanced Filters/ }).click();

    const company = page.getByRole('combobox', { name: 'Company or entity' });
    await company.fill('Apple');
    const companyList = page.getByRole('listbox', { name: 'Company matches' });
    await expect(companyList).toBeVisible();
    await companyList.getByRole('option', { name: /Apple Inc.*AAPL.*CIK 0000320193/ }).click();
    await expect(company).toHaveValue('Apple Inc.');
    await page.getByRole('button', { name: 'Clear company or entity' }).click();
    await expect(company).toHaveValue('');

    await page.getByRole('button', { name: 'Company Characteristics' }).click();
    const sic = page.getByRole('combobox', { name: 'Industry or SIC code' });
    await sic.fill('pharmaceutical');
    await expect(sic).toHaveAttribute('aria-activedescendant', /option-0$/);
    await sic.press('Enter');
    await expect(sic).toHaveValue('2834');
    await page.getByRole('button', { name: 'Clear industry or SIC code' }).click();
    await expect(sic).toHaveValue('');

    const auditor = page.getByRole('combobox', { name: 'Accountant or auditor' });
    await auditor.fill('ernst');
    await page.getByRole('listbox', { name: 'Auditor matches' }).getByRole('option', { name: /^EY / }).click();
    await expect(auditor).toHaveValue('EY');
    await page.getByRole('button', { name: 'Clear accountant or auditor' }).click();
    await expect(auditor).toHaveValue('');

    await page.goto('/exempt-offerings');
    await waitForIdentity(page);
    const entity = page.getByRole('combobox', { name: 'Search Form D filings' });
    await entity.fill('Micros');
    await expect(entity).toHaveAttribute('aria-activedescendant', /option-0$/);
    await entity.press('Enter');
    await expect(entity).toHaveValue('MSFT ');
    await entity.fill('');
    await expect(entity).toHaveValue('');
    await expect(entity).toHaveAttribute('aria-expanded', 'false');
  });

  test('global.async-and-retry distinguishes loading, failure, empty, and partial success while retrying the same criteria', async ({ page }) => {
    let failureAttempts = 0;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
    const requested: string[] = [];

    await page.route('**/api/sec-proxy?**upstream=iapd**', async route => {
      const query = adviserQuery(route);
      requested.push(query);
      if (query === 'Failure Ledger') {
        failureAttempts += 1;
        if (failureAttempts === 1) {
          await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'fixture failure' }) });
          return;
        }
        await retryGate;
        await fulfillAdviserPayload(route, 'Recovered Adviser', 3, 9);
        return;
      }
      if (query === 'No Match Ledger') {
        await fulfillAdviserPayload(route, 'Unused', 0, 0);
        return;
      }
      await fulfillAdviserPayload(route, 'Unexpected', 1, 1);
    });

    await page.goto('/adv-registrations');
    await waitForIdentity(page);
    const input = page.getByRole('textbox', { name: 'Firm name, CRD number, or SEC number' });
    await input.fill('Failure Ledger');
    await page.getByRole('button', { name: 'Search IAPD' }).click();
    const alert = page.locator('main').getByRole('alert');
    await expect(alert).toContainText('could not be reached');
    await expect(page.getByText(/No IAPD firms matched/)).toHaveCount(0);

    // Editing the field does not mutate the failed request represented by
    // Retry: it replays the exact criteria that produced the error.
    await input.fill('Unsubmitted replacement');
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('status')).toContainText('Loading official IAPD results');
    expect(requested.at(-1)).toBe('Failure Ledger');
    releaseRetry();
    await expect(page.getByText('Showing 3 of 9 matching IAPD firms.')).toBeVisible();

    await input.fill('No Match Ledger');
    await input.press('Enter');
    await expect(page.getByText('No IAPD firms matched that search.')).toBeVisible();
  });

  test('global.async-and-retry allows only the newest overlapping request to update the view', async ({ page }) => {
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
    let slowStarted = false;
    let fastStarted = false;

    await page.route('**/api/sec-proxy?**upstream=iapd**', async route => {
      const query = adviserQuery(route);
      if (query === 'Slow Ledger') {
        slowStarted = true;
        await slowGate;
        await fulfillAdviserPayload(route, 'Stale Adviser', 1, 1);
        return;
      }
      if (query === 'Fast Ledger') {
        fastStarted = true;
        await fulfillAdviserPayload(route, 'Current Adviser', 2, 5);
        return;
      }
      await fulfillAdviserPayload(route, 'Unexpected', 0, 0);
    });

    await page.goto('/adv-registrations');
    await waitForIdentity(page);
    const input = page.getByRole('textbox', { name: 'Firm name, CRD number, or SEC number' });
    await input.fill('Slow Ledger');
    await input.press('Enter');
    await expect.poll(() => slowStarted).toBe(true);
    await input.fill('Fast Ledger');
    await page.getByRole('button', { name: 'Search IAPD' }).click();
    await expect.poll(() => fastStarted).toBe(true);
    await expect(page.getByText('Showing 2 of 5 matching IAPD firms.')).toBeVisible();
    releaseSlow();
    await expect(page.getByText('Current Adviser 01')).toBeVisible();
    await expect(page.getByText('Stale Adviser 01')).toHaveCount(0);
  });
});
