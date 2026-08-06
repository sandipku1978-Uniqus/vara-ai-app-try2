import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import {
  FIXTURE_DOCUMENT_URL,
  FIXTURE_REGISTRANT,
  FIXTURE_RUN_ID,
  installFilingAiFixtures,
} from './filing-ai-fixtures';

/**
 * Action-level evidence for the Filing AI pre-flight surfaces.
 *
 * Executing a real run needs several paced EDGAR round trips against a live
 * registrant, which is not a dependency a UI suite should carry. Everything
 * asserted here is therefore the behaviour the browser owns — form refusal,
 * the tier explanation, filtering, engagement governance, and the unavailable
 * report path — with the run API stubbed at the network boundary where a run
 * result is needed. The engine's own behaviour is covered by the unit suite
 * against synthetic filings; a green spec here never implies a green engine.
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

/**
 * The page's own alert.
 *
 * Next.js keeps a permanent `role="alert"` route announcer on the document, so
 * an unscoped `getByRole('alert')` is ambiguous everywhere in this app. Scoping
 * to the page container keeps the assertion semantic without matching it.
 */
function pageAlert(page: Page) {
  return page.locator('.fai-page').getByRole('alert');
}

/** Keep the console's history read deterministic and offline. */
async function installConsoleFixtures(page: Page) {
  await installFilingAiFixtures(page);
}

test.describe('filing ai pre-flight console', () => {
  test('filing-ai-console.run-check opens the exception report for the completed run', async ({ page }) => {
    const state = await installFilingAiFixtures(page);
    await open(page, '/filing-ai');

    await page.getByLabel('Registrant CIK').fill('0001234567');
    await page.getByLabel('Input tier').selectOption('1');
    await page.getByRole('button', { name: 'Run pre-flight check' }).click();

    await expect(page).toHaveURL(new RegExp(`/filing-ai/runs/${FIXTURE_RUN_ID}$`));
    await expect(page.getByRole('heading', { level: 1, name: FIXTURE_REGISTRANT })).toBeVisible();
    // The submitted identity, not merely that a request happened.
    expect(state.runRequests).toHaveLength(1);
    expect(state.runRequests[0]).toMatchObject({ cik: '0001234567', form_type: '10-K', tier: 1 });
  });

  test('filing-ai-console.reject-invalid-cik refuses a run without a registrant identifier', async ({ page }) => {
    const state = await installFilingAiFixtures(page);
    await open(page, '/filing-ai');
    await page.getByLabel('Registrant CIK').fill('not-a-cik');
    await page.getByRole('button', { name: 'Run pre-flight check' }).click();

    await expect(pageAlert(page)).toContainText('Enter the registrant’s CIK');
    expect(state.runRequests, 'an invalid registrant must not reach the run API').toHaveLength(0);
  });

  test('filing-ai-console.open-run reaches the exception report from the recent-checks table', async ({ page }) => {
    await installFilingAiFixtures(page, { withHistory: true });
    await open(page, '/filing-ai');

    const row = page.locator('.fai-table tbody tr', { hasText: FIXTURE_REGISTRANT }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('link', { name: 'Open' }).click();

    await expect(page.getByRole('heading', { level: 1, name: FIXTURE_REGISTRANT })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Coverage statement' })).toBeVisible();
  });

  test('filing-ai-console.choose-tier states what the chosen tier cannot see before the run', async ({ page }) => {
    await installConsoleFixtures(page);
    await open(page, '/filing-ai');

    const tier = page.getByLabel('Input tier');
    const tierField = page.locator('.fai-field', { has: page.getByLabel('Input tier') });

    await tier.selectOption('0');
    await expect(tierField.getByText(/Needs nothing from the client/i)).toBeVisible();

    await tier.selectOption('2');
    await expect(tierField.getByText(/Requires client source data/i)).toBeVisible();
  });

  test('filing-ai-console.open-catalog reaches the governed rule catalog', async ({ page }) => {
    await installConsoleFixtures(page);
    await open(page, '/filing-ai');
    await page.locator('.fai-header').getByRole('link', { name: 'Rule catalog' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Rule catalog' })).toBeVisible();
  });

  test('filing-ai-console.scope-language states the reporting limitation without an interaction', async ({ page }) => {
    await installConsoleFixtures(page);
    await open(page, '/filing-ai');
    await expect(
      page.getByText(/evidences the operation of a management review control/i),
    ).toBeVisible();
    await expect(page.getByText(/not an audit, review or attestation/i)).toBeVisible();
  });

  test('filing-ai-console.ipog explains input, process, output and governance where the work starts', async ({ page }) => {
    await installConsoleFixtures(page);
    await open(page, '/filing-ai');
    const rail = page.getByRole('region', { name: 'How a run works' });
    for (const layer of ['Input', 'Process', 'Output', 'Governance']) {
      await expect(rail.getByText(layer, { exact: true })).toBeVisible();
    }
  });
});

test.describe('filing ai exception report', () => {
  test('filing-ai-run.filter-severity narrows the finding list to one severity', async ({ page }) => {
    await installFilingAiFixtures(page);
    await open(page, `/filing-ai/runs/${FIXTURE_RUN_ID}`);

    const findings = page.locator('.fai-finding');
    await expect(findings).toHaveCount(3);
    await page.getByRole('button', { name: /^critical \(/ }).click();
    await expect(findings).toHaveCount(1);
    await expect(findings.first()).toContainText('Exhibit 19');
    await expect(page.getByText('1 of 3 shown')).toBeVisible();
  });

  test('filing-ai-run.filter-layer narrows the finding list to one check layer', async ({ page }) => {
    await installFilingAiFixtures(page);
    await open(page, `/filing-ai/runs/${FIXTURE_RUN_ID}`);

    await page.getByRole('button', { name: /^Internal consistency/ }).click();
    const findings = page.locator('.fai-finding');
    await expect(findings).toHaveCount(1);
    await expect(findings.first()).toContainText('Balance sheet balances');
  });

  test('filing-ai-run.expand-finding reveals the evidence, authority and next step', async ({ page }) => {
    await installFilingAiFixtures(page);
    await open(page, `/filing-ai/runs/${FIXTURE_RUN_ID}`);

    const finding = page.locator('.fai-finding', { hasText: 'Balance sheet balances' }).first();
    await finding.getByRole('button').first().click();

    await expect(finding.getByText(/recomputation gives 5,200,000/)).toBeVisible();
    await expect(finding.getByText('Reg S-X Rule 5-02')).toBeVisible();
    await expect(finding.getByText(/Reconcile total assets/)).toBeVisible();
    // Root-cause grouping: one finding, its other symptom attached.
    await expect(finding.getByText('R-CONS-006')).toBeVisible();
  });

  test('filing-ai-run.open-provenance links the finding to the filed document', async ({ page }) => {
    await installFilingAiFixtures(page);
    await open(page, `/filing-ai/runs/${FIXTURE_RUN_ID}`);

    const finding = page.locator('.fai-finding', { hasText: 'Balance sheet balances' }).first();
    await finding.getByRole('button').first().click();
    const link = finding.getByRole('link', { name: /open document/i });
    await expect(link).toHaveAttribute('href', FIXTURE_DOCUMENT_URL);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(finding.getByText(/characters 402,100/)).toBeVisible();
  });

  test('filing-ai-run.dispose-finding refuses a disposition without a stated basis and records a complete one', async ({ page }) => {
    const state = await installFilingAiFixtures(page);
    await open(page, `/filing-ai/runs/${FIXTURE_RUN_ID}`);

    const finding = page.locator('.fai-finding', { hasText: 'Balance sheet balances' }).first();
    await finding.getByRole('button').first().click();
    await finding.getByLabel('Disposed by').fill('Priya Raman');
    await finding.getByLabel('Rationale').fill('Fixed.');
    await finding.getByRole('button', { name: 'Record disposition' }).click();
    await expect(finding.getByRole('alert')).toContainText(/rationale must explain/i);

    await finding.getByLabel('Rationale').fill('The comparative was corrected in draft nine before submission.');
    await finding.getByRole('button', { name: 'Record disposition' }).click();
    await expect(finding.getByText('Priya Raman')).toBeVisible();
    expect(state.dispositions.at(-1)).toMatchObject({ actor: 'Priya Raman', status: 'remediated' });
  });

  test('filing-ai-run.coverage-statement states rule coverage and what the run could not see', async ({ page }) => {
    await installFilingAiFixtures(page);
    await open(page, `/filing-ai/runs/${FIXTURE_RUN_ID}`);

    await expect(page.getByText('96 of 148 applicable rules executed')).toBeVisible();
    await expect(page.getByText(/64\.9% of the applicable catalog executed/)).toBeVisible();
    await expect(page.getByText(/require the trial balance/i)).toBeVisible();
    await expect(page.getByText(/not an audit, review or attestation/i)).toBeVisible();
  });

  test('filing-ai-run.gate-and-score shows the gate beside the coverage-adjusted readiness figure', async ({ page }) => {
    await installFilingAiFixtures(page);
    await open(page, `/filing-ai/runs/${FIXTURE_RUN_ID}`);

    await expect(page.getByText('Not ready to file').first()).toBeVisible();
    await expect(page.getByText('1 open blocking finding(s)')).toBeVisible();
    await expect(page.getByRole('img', { name: /Readiness 52\.4 out of 100, at 65 percent rule coverage/ })).toBeVisible();
  });

  test('filing-ai-run.suppressed-rules lists each unexecuted rule with the gate that stopped it', async ({ page }) => {
    await installFilingAiFixtures(page);
    await open(page, `/filing-ai/runs/${FIXTURE_RUN_ID}`);

    const row = page.locator('.fai-table tbody tr', { hasText: 'R-CONS-026' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('G5');
    await expect(row).toContainText(/No client source data/);
  });

  test('filing-ai-run.missing-run states unavailability instead of rendering an empty report', async ({ page }) => {
    // Reached the way a reader actually reaches it: opening a run from the
    // recent-checks table that is no longer readable — a stale link, or one
    // belonging to another scope. Typing the URL would prove the page renders
    // an error, not that the control leads anywhere honest.
    await installFilingAiFixtures(page, { withHistory: true });
    // Registered last, so it takes precedence over the fixture's run handler.
    await page.route('**/api/filing-ai/runs/run_*', async (route: Route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Run not found.' }),
      });
    });

    await open(page, '/filing-ai');
    const row = page.locator('.fai-table tbody tr', { hasText: FIXTURE_REGISTRANT }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole('link', { name: 'Open' }).click();

    await expect(pageAlert(page)).toContainText('Run not found');
    await expect(page.getByRole('link', { name: 'Back to the console' })).toBeVisible();
    // The empty report is the failure this guards against.
    await expect(page.getByRole('heading', { level: 2, name: 'Coverage statement' })).toBeHidden();
  });

  test('filing-ai-run.back-to-console returns to the pre-flight console from an unavailable report', async ({ page }) => {
    await installConsoleFixtures(page);
    await page.route('**/api/filing-ai/runs/run_*', async (route: Route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Run not found.' }),
      });
    });

    await open(page, '/filing-ai/runs/run_00000000-0000-0000-0000-000000000000');
    await page.getByRole('link', { name: 'Back to the console' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Pre-flight integrity check' })).toBeVisible();
  });
});

test.describe('filing ai rule catalog', () => {
  test('filing-ai-catalog.search-rules narrows the catalog to matching rules', async ({ page }) => {
    await open(page, '/filing-ai/catalog');
    const rows = page.locator('.fai-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const before = await rows.count();

    await page.getByLabel('Search rules').fill('R-MECH-EXH');
    await expect.poll(async () => rows.count()).toBeLessThan(before);
    await expect(page.locator('.fai-table tbody').getByText('R-MECH-EXH-010').first()).toBeVisible();
  });

  test('filing-ai-catalog.filter-layer restricts the catalog to one check layer', async ({ page }) => {
    await open(page, '/filing-ai/catalog');
    const rows = page.locator('.fai-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });

    await page.getByLabel('Layer').selectOption('disclosure');
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);
    await expect(page.locator('.fai-table tbody').getByText('Mechanical').first()).toBeHidden();
  });

  test('filing-ai-catalog.filter-deployed removes rules with no deployed predicate', async ({ page }) => {
    await open(page, '/filing-ai/catalog');
    const rows = page.locator('.fai-table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const before = await rows.count();

    await page.getByLabel('Predicate').selectOption('bound');
    await expect.poll(async () => rows.count()).toBeLessThan(before);
    await expect(page.getByText('not deployed').first()).toBeHidden();
  });

  test('filing-ai-catalog.unbound-reasons states why each undeployed rule cannot run', async ({ page }) => {
    await open(page, '/filing-ai/catalog');
    await expect(page.locator('.fai-table tbody tr').first()).toBeVisible({ timeout: 30_000 });
    const undeployed = page.locator('.fai-table tbody tr', { hasText: 'not deployed' }).first();
    await expect(undeployed).toBeVisible();
    await expect(undeployed).toContainText(/needs|requires|scheduled|ships/i);
  });

  test('filing-ai-catalog.promotion-ladder shows the rule board stages and the bar for live', async ({ page }) => {
    await open(page, '/filing-ai/catalog');
    await expect(page.getByText(/Draft → Back-tested → Reviewed → Approved → Live/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/named reviewer and a recorded back-test/i)).toBeVisible();
  });
});

test.describe('filing ai engagements', () => {
  /**
   * Engagements live in the server's store for the life of the process, so
   * every test in this file sees the ones its predecessors created. Naming each
   * one after the test that created it keeps the assertions unambiguous without
   * pretending the store is per-test — which is exactly the behaviour a real
   * deployment has.
   */
  function clientName(testInfo: TestInfo, suffix = ''): string {
    return `Playwright ${testInfo.testId}${suffix} Industries, Inc.`;
  }

  async function createEngagement(page: Page, name: string, cik = '1234567') {
    await open(page, '/filing-ai/governance');
    await page.getByLabel('Client').fill(name);
    await page.getByLabel('Registrant CIK').fill(cik);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible({ timeout: 30_000 });
  }

  test('filing-ai-governance.create-engagement opens a new engagement with its onboarding gate outstanding', async ({ page }, testInfo) => {
    await createEngagement(page, clientName(testInfo));
    await expect(page.getByText('Onboarding.')).toBeVisible();
    await expect(page.getByText(/0 of 6 complete/)).toBeVisible();
  });

  test('filing-ai-governance.add-member records the member with their role', async ({ page }, testInfo) => {
    await createEngagement(page, clientName(testInfo));
    const email = `dana-${testInfo.testId}@example.com`;
    await page.getByLabel('Name').fill('Dana Whitfield');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Role').selectOption('reviewer');
    await page.getByRole('button', { name: 'Add member' }).click();

    const row = page.locator('.fai-table tbody tr', { hasText: email });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('Reviewer');
  });

  test('filing-ai-governance.remove-member drops only the selected member', async ({ page }, testInfo) => {
    await createEngagement(page, clientName(testInfo));
    const keep = `priya-${testInfo.testId}@example.com`;
    const remove = `dana-${testInfo.testId}@example.com`;
    for (const [name, email, role] of [['Priya Raman', keep, 'reviewer'], ['Dana Whitfield', remove, 'preparer']]) {
      await page.getByLabel('Name').fill(name);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Role').selectOption(role);
      await page.getByRole('button', { name: 'Add member' }).click();
      await expect(page.locator('.fai-table tbody tr', { hasText: email })).toBeVisible({ timeout: 30_000 });
    }

    await page.locator('.fai-table tbody tr', { hasText: remove })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.locator('.fai-table tbody tr', { hasText: remove })).toBeHidden();
    // "Only": the neighbour must survive.
    await expect(page.locator('.fai-table tbody tr', { hasText: keep })).toBeVisible();
  });

  test('filing-ai-governance.sign-off-step refuses the team step until the team can dispose of a finding', async ({ page }, testInfo) => {
    await createEngagement(page, clientName(testInfo));
    const teamStep = page.locator('.fai-step', { hasText: 'Name the team and roles' });
    await teamStep.getByRole('button', { name: 'Sign off' }).click();

    await expect(pageAlert(page)).toContainText(/four-eyes|disposition requirements/i);
    await expect(teamStep.getByRole('button', { name: 'Sign off' })).toBeVisible();
  });

  test('filing-ai-governance.roles states what each role may do', async ({ page }) => {
    await open(page, '/filing-ai/governance');
    for (const role of ['Preparer', 'Reviewer', 'Engagement partner', 'Rule board member', 'Observer']) {
      await expect(page.getByRole('heading', { level: 3, name: role })).toBeVisible({ timeout: 30_000 });
    }
    await expect(page.getByText(/second approval on a critical finding/i)).toBeVisible();
  });

  test('filing-ai-governance.team-shortfall names the four-eyes requirement a one-person team cannot meet', async ({ page }, testInfo) => {
    await createEngagement(page, clientName(testInfo));
    await page.getByLabel('Name').fill('Dana Whitfield');
    await page.getByLabel('Email').fill(`dana-${testInfo.testId}@example.com`);
    await page.getByLabel('Role').selectOption('preparer');
    await page.getByRole('button', { name: 'Add member' }).click();

    await expect(page.getByText(/cannot yet dispose of what the engine will find/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/four-eyes requirement/i)).toBeVisible();
  });

  test('filing-ai-governance.select-engagement replaces the visible engagement', async ({ page }, testInfo) => {
    const first = clientName(testInfo, '-first');
    const second = clientName(testInfo, '-second');
    await createEngagement(page, first);
    await createEngagement(page, second, '7654321');
    await expect(page.getByRole('heading', { level: 2, name: second })).toBeVisible();

    await page.locator('.fai-layer', { hasText: first }).click();
    await expect(page.getByRole('heading', { level: 2, name: first })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: second })).toBeHidden();
  });
});
