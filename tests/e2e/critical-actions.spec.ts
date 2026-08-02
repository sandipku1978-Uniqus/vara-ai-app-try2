import { expect, test, type Page, type Route } from '@playwright/test';
import { FILINGS, installBooleanFixtures } from './boolean-fixtures';

/**
 * Critical-action archetypes (WP8 burn-down, acceptance T18/T19).
 *
 * Each test here retires a manual exception in uiActionCoverage.ts for one of
 * the CRITICAL_ACTION_IDS — the actions whose silent failure would corrupt
 * research output. SEC-facing calls are intercepted with the shared
 * deterministic fixtures, so these prove the app's own behavior, not EDGAR's
 * availability.
 */

const BOTH = FILINGS[2]; // 'Both Holdings Ltd' — matches mezzanine AND temporary

async function runBooleanQuery(page: Page, query: string) {
  await page.goto('/search', { waitUntil: 'domcontentloaded' });
  // Same hydration-race guard as boolean-search.spec.ts: re-click the mode
  // toggle until the Boolean input actually exists.
  const input = page.getByRole('combobox', { name: 'Boolean search query' });
  await expect(async () => {
    await page.getByRole('button', { name: 'Boolean / Proximity' }).click();
    await expect(input).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await input.fill(query);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

/** Serve the fixture document and degrade every other SEC surface safely. */
async function installFilingDetailFixtures(page: Page) {
  await page.route('**/api/filing-text**', async (route: Route) => {
    const url = new URL(route.request().url());
    const document = url.searchParams.get('document') || '';
    const filing = FILINGS.find(f => f.document === document);
    await route.fulfill({
      status: filing ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(filing ? { ok: true, text: filing.text, cached: true } : { ok: false, error: 'not found' }),
    });
  });
  await page.route('**/api/sec-proxy**', async (route: Route) => {
    const url = route.request().url();
    const filing = FILINGS.find(f => url.includes(f.document));
    if (filing) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<html><body><h1>${filing.company}</h1><p>${filing.text}</p></body></html>`,
      });
      return;
    }
    // Submissions/history lookups degrade to "unavailable" — the filing view
    // must stay usable from the document alone.
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
}

test.describe('critical action: open a filing from research results', () => {
  test('research-workbench.open-filing reaches the exact selected filing workspace', async ({ page }) => {
    await installBooleanFixtures(page);
    await installFilingDetailFixtures(page);
    await runBooleanQuery(page, 'mezzanine AND temporary');

    // Select the result row, then open the full workspace from the preview.
    await page.getByText(BOTH.company).first().click();
    await page.getByRole('button', { name: 'Open Filing' }).click();

    // The exact filing opens — issuer, accession and document preserved in the
    // route rather than falling back to a generic search.
    await expect(page).toHaveURL(new RegExp(`/filing/${Number(BOTH.cik)}_${BOTH.accession}_${BOTH.document}`));
    await expect(page.getByRole('heading', { name: BOTH.document })).toBeVisible({ timeout: 20_000 });
  });

  test('filing-detail.open-sec-source links to the authoritative SEC document', async ({ page }) => {
    await installBooleanFixtures(page);
    await installFilingDetailFixtures(page);
    await page.goto(`/filing/${Number(BOTH.cik)}_${BOTH.accession}_${BOTH.document}`);

    const sourceLink = page.getByRole('link', { name: 'Open filing on SEC.gov' });
    await expect(sourceLink).toBeVisible({ timeout: 20_000 });
    const href = await sourceLink.getAttribute('href');
    // The link must target sec.gov for THIS accession — an external source
    // link that points anywhere else is worse than none.
    expect(href).toContain('sec.gov');
    expect(href).toContain(BOTH.accession.replace(/-/g, ''));
    expect(href).toContain(BOTH.document);
    // External links never hand the opener to the target page.
    await expect(sourceLink).toHaveAttribute('rel', /noreferrer|noopener/);
  });
});

test.describe('critical action: comment-letter search', () => {
  const LETTER = {
    accession: '0000000900-26-000900',
    cik: 900,
    company_name: 'Letterhaven Industries',
    form: 'UPLOAD',
    date_filed: '2026-03-04',
    thread_id: 'thread-letterhaven-1',
    filename: 'letter1.txt',
    headline: 'The Staff challenged <b>revenue recognition</b> for principal-agent arrangements.',
    rank: 0.9,
  };

  test('comment-letters.run-search renders matches from the letter corpus', async ({ page }) => {
    await page.route('**/api/letters**', async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('q')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ total: 1, matches: [LETTER] }),
        });
        return;
      }
      // Browse list and thread detail lanes stay empty and well-formed.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 0, threads: [], letters: [] }),
      });
    });

    await page.goto('/comment-letters');
    const input = page.getByLabel('Search inside SEC comment letters');
    await input.fill('revenue recognition');
    await input.press('Enter');

    await expect(page.getByText(LETTER.company_name).first()).toBeVisible({ timeout: 20_000 });
  });

  test('a failed letter search says the zero is not authoritative', async ({ page }) => {
    await page.route('**/api/letters**', async (route: Route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('q')) {
        await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'boom' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, threads: [] }) });
    });

    await page.goto('/comment-letters');
    const input = page.getByLabel('Search inside SEC comment letters');
    await input.fill('revenue recognition');
    await input.press('Enter');

    await expect(page.getByText(/not authoritative/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
