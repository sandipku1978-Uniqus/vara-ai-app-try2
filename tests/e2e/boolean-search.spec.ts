import { expect, test, type Page } from '@playwright/test';
import { FILINGS, installBooleanFixtures, type FixtureStats } from './boolean-fixtures';

const [MEZZ_ONLY, TEMP_ONLY, BOTH, NEAR_MISS] = FILINGS;

async function openBooleanWorkbench(page: Page): Promise<FixtureStats> {
  const stats = await installBooleanFixtures(page);
  await page.goto('/search', { waitUntil: 'domcontentloaded' });
  // On slow runners the toggle can render before hydration attaches its
  // handler, so a single click lands on an inert button and the mode never
  // switches (CI failed every journey twice this way — first as an Expand
  // timeout, then as the Boolean input never appearing). Re-click until the
  // Boolean-mode input actually exists; each attempt gets a short wait.
  await expect(async () => {
    await page.getByRole('button', { name: 'Boolean / Proximity' }).click();
    await expect(page.getByRole('combobox', { name: 'Boolean search query' }))
      .toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return stats;
}

async function runQuery(page: Page, query: string) {
  const input = page.getByRole('combobox', { name: 'Boolean search query' });
  // A completed search collapses the query panel; reopen it when collapsed.
  // Only the Expand probe may be a one-shot check — probing the input itself
  // races the Boolean-mode re-render on slow runners (the input exists but
  // still carries the semantic-mode label for a frame), which sent CI down the
  // Expand branch on a fresh, uncollapsed page and timed out all six journeys.
  const expand = page.getByRole('button', { name: 'Expand', exact: true });
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
  }
  // Auto-waits for the mode-switch render to commit.
  await expect(input).toBeVisible();
  await input.fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

/**
 * A company name can legitimately appear twice — once in the hit list and once
 * in the preview pane — so presence assertions take the first match and absence
 * assertions require zero matches anywhere on the page.
 */
function anyMention(page: Page, company: string) {
  return page.getByText(company);
}

test.describe('Boolean search behaviour', () => {
  test('a disjoint OR returns the union, not the intersection', async ({ page }) => {
    await openBooleanWorkbench(page);
    await runQuery(page, 'mezzanine OR temporary');

    // Every branch must be retrieved independently: filings carrying only one
    // side of the disjunction are exactly what the old executor lost.
    await expect(anyMention(page, BOTH.company).first()).toBeVisible({ timeout: 30_000 });
    await expect(anyMention(page, MEZZ_ONLY.company).first()).toBeVisible();
    await expect(anyMention(page, TEMP_ONLY.company).first()).toBeVisible();
  });

  test('AND returns the exact intersection and is a subset of OR', async ({ page }) => {
    await openBooleanWorkbench(page);
    await runQuery(page, 'mezzanine AND temporary');

    await expect(anyMention(page, BOTH.company).first()).toBeVisible({ timeout: 30_000 });
    await expect(anyMention(page, MEZZ_ONLY.company)).toHaveCount(0);
    await expect(anyMention(page, TEMP_ONLY.company)).toHaveCount(0);
  });

  test('malformed syntax reports inline and performs no retrieval', async ({ page }) => {
    const stats = await openBooleanWorkbench(page);
    // Scope the assertion to this submission so unrelated page startup traffic
    // can never make it pass or fail for the wrong reason.
    const before = stats.eftsQueries.length;
    await runQuery(page, 'mezzanine AND');

    await expect(page.getByText(/ends with an operator/i)).toBeVisible();
    expect(stats.eftsQueries.length - before, 'invalid syntax must not reach EDGAR').toBe(0);
  });

  test('auditor: inside OR is rejected before any extraction can rewrite it (F-05)', async ({ page }) => {
    const stats = await openBooleanWorkbench(page);
    const before = stats.eftsQueries.length;
    await runQuery(page, 'mezzanine OR auditor:KPMG');

    // The complete expression must be validated BEFORE the auditor token is
    // lifted out — otherwise this becomes "mezzanine + global KPMG filter",
    // a silent AND. The user sees the AND-only rule, and nothing is fetched.
    await expect(page.getByText(/only be combined with AND/i)).toBeVisible();
    expect(stats.eftsQueries.length - before, 'rewritten query must not reach EDGAR').toBe(0);
  });

  test('a NOT-only query is rejected without retrieval', async ({ page }) => {
    const stats = await openBooleanWorkbench(page);
    const before = stats.eftsQueries.length;
    await runQuery(page, 'NOT mezzanine');

    await expect(page.getByText(/not negated/i)).toBeVisible();
    expect(stats.eftsQueries.length - before, 'a NOT-only query must not reach EDGAR').toBe(0);
  });

  test('the server pre-screen drops non-matches before the browser downloads them', async ({ page }) => {
    const stats = await openBooleanWorkbench(page);
    // NEAR_MISS carries both phrase tokens but never adjacently, so EDGAR
    // returns it and exact-phrase matching must reject it.
    await runQuery(page, '"mezzanine equity"');

    await expect(anyMention(page, MEZZ_ONLY.company).first()).toBeVisible({ timeout: 30_000 });
    await expect(anyMention(page, NEAR_MISS.company)).toHaveCount(0);

    expect(stats.prescreenBatches.length, 'the pre-screen must actually run').toBeGreaterThan(0);
    // The point of the whole phase: a rejected candidate costs zero bytes.
    expect(
      stats.documentFetches.some(doc => doc.includes(NEAR_MISS.document)),
      'a server-rejected filing must never be downloaded by the browser'
    ).toBe(false);
  });

  test('an identical repeat returns the same filings', async ({ page }) => {
    await openBooleanWorkbench(page);

    await runQuery(page, 'mezzanine OR temporary');
    await expect(anyMention(page, BOTH.company).first()).toBeVisible({ timeout: 30_000 });
    for (const filing of FILINGS) {
      await expect(anyMention(page, filing.company).first()).toBeVisible();
    }

    await runQuery(page, 'mezzanine OR temporary');
    await expect(anyMention(page, BOTH.company).first()).toBeVisible({ timeout: 30_000 });
    for (const filing of FILINGS) {
      await expect(anyMention(page, filing.company).first()).toBeVisible();
    }
  });
});
