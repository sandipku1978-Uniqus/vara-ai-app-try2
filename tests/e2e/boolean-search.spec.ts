import { expect, test, type Page } from '@playwright/test';
import { FILINGS, installBooleanFixtures, type FixtureStats } from './boolean-fixtures';

const [MEZZ_ONLY, TEMP_ONLY, BOTH] = FILINGS;

async function openBooleanWorkbench(page: Page): Promise<FixtureStats> {
  const stats = await installBooleanFixtures(page);
  await page.goto('/search', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Boolean / Proximity' }).click();
  return stats;
}

async function runQuery(page: Page, query: string) {
  const input = page.getByRole('combobox', { name: 'Boolean search query' });
  // A completed search collapses the query panel, so reopen it before re-running.
  if (!(await input.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Expand', exact: true }).click();
    await expect(input).toBeVisible();
  }
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
    await runQuery(page, 'mezzanine AND');

    await expect(page.getByText(/ends with an operator/i)).toBeVisible();
    expect(stats.eftsQueries, 'invalid syntax must not reach EDGAR').toEqual([]);
  });

  test('a NOT-only query is rejected without retrieval', async ({ page }) => {
    const stats = await openBooleanWorkbench(page);
    await runQuery(page, 'NOT mezzanine');

    await expect(page.getByText(/not negated/i)).toBeVisible();
    expect(stats.eftsQueries).toEqual([]);
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
