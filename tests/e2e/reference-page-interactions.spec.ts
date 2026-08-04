import { expect, test, type Page, type Route } from '@playwright/test';
import { FILINGS, installBooleanFixtures } from './boolean-fixtures';
import {
  REFERENCE_ADVISERS,
  REFERENCE_GUIDANCE,
  REFERENCE_LITIGATION,
  REFERENCE_RULES,
  installReferenceSourceFixtures,
} from './reference-transaction-fixtures';

/**
 * Action-level evidence for specialist reference surfaces. Every journey
 * asserts the user-visible outcome and the request identity that produced it;
 * a visible spinner or a button click alone is never treated as coverage.
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

async function installAccountingAiFixture(page: Page) {
  const prompts: string[] = [];
  await page.route('**/api/claude', async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { prompt?: string };
    const prompt = body.prompt || '';
    prompts.push(prompt);
    const text = prompt.includes('USER QUERY:')
      ? '## Technical accounting guidance\nASC 842-10-25 provides the recognition starting point. Verify the controlling guidance in the FASB Codification.'
      : '# Accounting adoption memo\n- Both Holdings reports temporary and mezzanine equity terminology in its filed evidence.';
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text }) });
  });
  return prompts;
}

async function runAccountingBooleanSearch(page: Page) {
  await open(page, '/accounting');
  const booleanMode = page.getByRole('button', { name: 'Boolean / w/#' });
  await booleanMode.click();
  await expect(booleanMode).toHaveAttribute('aria-pressed', 'true');
  const input = page.getByRole('textbox', { name: 'Accounting disclosure research query' });
  await input.fill('mezzanine OR temporary');
  await page.getByRole('button', { name: 'Search', exact: true }).first().click();
  await expect(page.getByText(FILINGS[2].company).first()).toBeVisible({ timeout: 30_000 });
}

test.describe('accounting standards interactions', () => {
  test('accounting-standards.run-disclosure-search returns source-identifiable Boolean filing evidence', async ({ page }) => {
    const stats = await installBooleanFixtures(page);
    await runAccountingBooleanSearch(page);

    const row = page.locator('tbody tr', { hasText: FILINGS[2].company }).first();
    await expect(row).toContainText(FILINGS[2].form);
    await expect(row).toContainText(FILINGS[2].filed);
    expect(stats.eftsQueries.some(query => /mezzanine/i.test(query) && /temporary/i.test(query))).toBe(true);
  });

  test('accounting-standards.save-alert-or-memo preserves criteria and grounds the memo in loaded rows', async ({ page }) => {
    await installBooleanFixtures(page);
    const prompts = await installAccountingAiFixture(page);
    await runAccountingBooleanSearch(page);

    await page.getByRole('button', { name: 'Save Alert' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Saved locally in this browser' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      Object.values(window.localStorage).some(value => value?.includes('mezzanine OR temporary'))
    ))).toBe(true);

    await page.getByRole('button', { name: 'Generate Memo' }).click();
    await expect(page.getByRole('heading', { name: 'Accounting Research Memo' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Both Holdings reports temporary and mezzanine equity terminology/)).toBeVisible();
    expect(prompts.some(prompt => (
      prompt.includes(FILINGS[2].company)
      && prompt.includes(FILINGS[2].form)
      && prompt.includes('mezzanine OR temporary')
    )), 'memo prompt must be derived from the submitted criteria and loaded filing evidence').toBe(true);
  });

  test('accounting-standards.manage-checklist changes only the chosen local item and survives a view switch', async ({ page }) => {
    await installBooleanFixtures(page);
    await open(page, '/accounting');
    await page.getByRole('button', { name: 'Review Checklist' }).click();

    await page.getByRole('button', { name: '+ New Item' }).click();
    await page.getByLabel('New review item').fill('Verify lease modification conclusion');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const originalItem = page.locator('li', { hasText: 'Verify lease modification conclusion' });
    await expect(originalItem).toBeVisible();

    await page.getByRole('button', { name: 'Edit Verify lease modification conclusion' }).click();
    const editor = page.getByLabel('Edit review item');
    await editor.fill('Verify ASC 842 lease modification conclusion');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const editedItem = page.locator('li', { hasText: 'Verify ASC 842 lease modification conclusion' });
    await expect(editedItem).toBeVisible();
    // The visible custom checkbox is the intended pointer target; clicking its
    // label must still toggle the native input that carries the accessible state.
    await editedItem.locator('label.checkbox-wrap').click();

    await page.getByRole('button', { name: 'Standards Directory' }).click();
    await expect(page.getByRole('heading', { name: 'Curated ASC Topic Directory' })).toBeVisible();
    await page.getByRole('button', { name: 'Review Checklist' }).click();
    await expect(page.getByRole('checkbox', { name: 'Mark Verify ASC 842 lease modification conclusion incomplete' })).toBeChecked();
    await expect(page.getByText('Compare peer accounting policy wording for the same arrangement')).toBeVisible();

    await page.getByRole('button', { name: 'Delete Verify ASC 842 lease modification conclusion' }).click();
    await expect(page.locator('li', { hasText: 'Verify ASC 842 lease modification conclusion' })).toHaveCount(0);
    await expect(page.getByText('Compare peer accounting policy wording for the same arrangement')).toBeVisible();
    const removed = page.getByRole('status').filter({ hasText: 'Removed' });
    await expect(removed).toBeVisible();
    await removed.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('checkbox', { name: 'Mark Verify ASC 842 lease modification conclusion incomplete' })).toBeChecked();
  });

  test('accounting-standards.ask-guidance submits the exact question and labels source-oriented guidance', async ({ page }) => {
    await installBooleanFixtures(page);
    const prompts = await installAccountingAiFixture(page);
    await open(page, '/accounting');
    await page.getByRole('button', { name: 'Ask AI for ASCs' }).click();

    const question = 'How should a lessee account for a modification under ASC 842?';
    await page.getByRole('textbox', { name: 'Technical accounting guidance question' }).fill(question);
    await page.getByRole('button', { name: 'Ask Expert' }).click();
    await expect(page.getByText('ASC 842-10-25 provides the recognition starting point.')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Verify the controlling guidance in the FASB Codification/)).toBeVisible();
    expect(prompts.some(prompt => prompt.includes(`USER QUERY: ${question}`))).toBe(true);
  });
});

test.describe('securities regulation interactions', () => {
  test('securities-regulation.choose-source and securities-regulation.run-search keep category, query, and results aligned', async ({ page }) => {
    const fixture = await installReferenceSourceFixtures(page);
    await open(page, '/regulation');
    await expect(page.getByText(REFERENCE_RULES[0].title).first()).toBeVisible({ timeout: 20_000 });

    const input = page.getByRole('textbox', { name: 'Search official SEC regulation sources' });
    await input.fill('stale rule query');
    const guidance = page.getByRole('button', { name: 'Staff guidance', exact: true });
    await test.step('ui-action:securities-regulation.choose-source', async () => {
      await guidance.click();
      await expect(guidance).toHaveAttribute('aria-pressed', 'true');
      await expect(input).toHaveValue('');
      await expect(page.getByText(REFERENCE_GUIDANCE[0].title).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(REFERENCE_RULES[0].title)).toHaveCount(0);
    });

    const segmentRow = page.locator('tbody tr', { hasText: REFERENCE_GUIDANCE[1].title });
    await test.step('ui-action:securities-regulation.run-search', async () => {
      await input.fill('Segment Reporting');
      await input.press('Enter');
      await expect(segmentRow).toBeVisible();
      await expect(page.getByText(REFERENCE_GUIDANCE[0].title)).toHaveCount(0);
      await expect(segmentRow.getByRole('link', { name: new RegExp(REFERENCE_GUIDANCE[1].title) }))
        .toHaveAttribute('href', `https://www.sec.gov${REFERENCE_GUIDANCE[1].href}`);
      expect(fixture.requests.filter(request => request.includes('staff-guidance')).length).toBeGreaterThanOrEqual(2);
    });
  });

  test('securities-regulation.retry-source repeats the unchanged category and query and replaces the error', async ({ page }) => {
    const fixture = await installReferenceSourceFixtures(page);
    fixture.failures.rulemaking = true;
    await open(page, '/regulation');
    const retry = page.getByRole('button', { name: 'Retry official source' });
    await expect(retry).toBeVisible({ timeout: 20_000 });

    const input = page.getByRole('textbox', { name: 'Search official SEC regulation sources' });
    await input.fill('Settlement Cycle');
    const requestsBeforeRetry = fixture.requests.length;
    fixture.failures.rulemaking = false;
    await retry.click();

    await expect(page.getByText(REFERENCE_RULES[1].title).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(REFERENCE_RULES[0].title)).toHaveCount(0);
    await expect(input).toHaveValue('Settlement Cycle');
    expect(fixture.requests.length).toBeGreaterThan(requestsBeforeRetry);
    expect(fixture.requests.some(request => (
      request.includes('rulemaking-activity') && request.includes('search=Settlement+Cycle')
    ))).toBe(true);
  });
});

test.describe('SEC enforcement interactions', () => {
  test('sec-enforcement.filter-releases narrows loaded releases without refetching the official feed', async ({ page }) => {
    const fixture = await installReferenceSourceFixtures(page);
    await open(page, '/enforcement');
    await expect(page.getByText(REFERENCE_LITIGATION[0].title).first()).toBeVisible({ timeout: 20_000 });
    const requestsBeforeFilter = fixture.requests.length;

    await page.getByRole('searchbox', { name: 'Filter litigation releases' }).fill(REFERENCE_LITIGATION[1].number);
    await expect(page.getByText(REFERENCE_LITIGATION[1].title).first()).toBeVisible();
    await expect(page.getByText(REFERENCE_LITIGATION[0].title)).toHaveCount(0);
    expect(fixture.requests.length, 'filtering must be immediate and client-side').toBe(requestsBeforeFilter);
  });

  test('sec-enforcement.retry-source requests the feed again and replaces its failure state', async ({ page }) => {
    const fixture = await installReferenceSourceFixtures(page);
    fixture.failures.litigation = true;
    await open(page, '/enforcement');
    const retry = page.getByRole('button', { name: 'Retry official source' });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    const requestsBeforeRetry = fixture.requests.length;

    fixture.failures.litigation = false;
    await retry.click();
    await expect(page.getByText(REFERENCE_LITIGATION[0].title).first()).toBeVisible({ timeout: 20_000 });
    await expect(retry).toHaveCount(0);
    expect(fixture.requests.length).toBeGreaterThan(requestsBeforeRetry);
  });
});

test.describe('investment adviser registration interactions', () => {
  test('adv-registrations.run-search displays distinguishing IAPD registration identity', async ({ page }) => {
    const fixture = await installReferenceSourceFixtures(page);
    await open(page, '/adv-registrations');
    const query = page.getByRole('textbox', { name: 'Firm name, CRD number, or SEC number' });
    await query.fill('Atlas');
    await query.press('Enter');

    for (const firm of REFERENCE_ADVISERS) {
      const row = page.locator('tbody tr', { hasText: firm.name });
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row).toContainText(firm.crd);
      await expect(row).toContainText(firm.sec);
      await expect(row).toContainText(`${firm.city}, ${firm.state}, ${firm.country}`);
      await expect(row.getByRole('link', { name: `Open the IAPD record for ${firm.name} on adviserinfo.sec.gov` }))
        .toHaveAttribute('href', `https://adviserinfo.sec.gov/firm/summary/${firm.crd}`);
    }
    expect(fixture.iapdQueries).toEqual(['Atlas']);
  });

  test('adv-registrations.retry-search resubmits the same firm query and replaces the error', async ({ page }) => {
    const fixture = await installReferenceSourceFixtures(page);
    fixture.failures.iapd = true;
    await open(page, '/adv-registrations');
    const input = page.getByRole('textbox', { name: 'Firm name, CRD number, or SEC number' });
    await input.fill('145678');
    await input.press('Enter');
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible({ timeout: 20_000 });

    fixture.failures.iapd = false;
    await retry.click();
    await expect(page.getByText(REFERENCE_ADVISERS[0].name).first()).toBeVisible({ timeout: 20_000 });
    await expect(input).toHaveValue('145678');
    expect(fixture.iapdQueries).toEqual(['145678', '145678']);
  });
});
