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

/**
 * Interactions made before Clerk finishes loading are RESET when it does:
 * the storage scope flips from null and per-identity state re-hydrates
 * (AppState writes the settled scope to <html data-urc-identity-scope>).
 * Every journey waits for that flip before touching the page — a fast CI
 * runner otherwise types into an app that is about to forget everything.
 */
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
    await waitForIdentity(page);

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

    const filingUrl = page.url();
    const [sourcePage] = await Promise.all([
      page.waitForEvent('popup'),
      sourceLink.click(),
    ]);
    await expect.poll(() => sourcePage.url()).toBe(href);
    await sourcePage.close();
    expect(page.url(), 'opening the source must retain the filing workspace').toBe(filingUrl);
    await expect(page.getByRole('heading', { name: BOTH.document })).toBeVisible();
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
    await waitForIdentity(page);
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
    await waitForIdentity(page);
    const input = page.getByLabel('Search inside SEC comment letters');
    await input.fill('revenue recognition');
    await input.press('Enter');

    await expect(page.getByText(/not authoritative/i).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('critical action: the alert journey (save, then check on the Dashboard)', () => {
  test('research-workbench.save-alert and dashboard.check-saved-alert round-trip', async ({ page }) => {
    const stats = await installBooleanFixtures(page);
    // The Dashboard check validates documents through /api/filing-text —
    // unstubbed, that reaches real SEC and the poll below races a network
    // round-trip per candidate.
    await installFilingDetailFixtures(page);
    await runBooleanQuery(page, 'mezzanine OR temporary');
    await expect(page.getByText(BOTH.company).first()).toBeVisible({ timeout: 30_000 });

    await test.step('ui-action:research-workbench.save-alert', async () => {
      // A completed search collapses the query panel; Save Alert lives in the
      // expanded branch, so reopen it first.
      const expand = page.getByRole('button', { name: 'Expand', exact: true });
      if (await expand.isVisible().catch(() => false)) {
        await expand.click();
      }
      await page.getByRole('button', { name: 'Save Alert' }).click();
      await expect.poll(() => page.evaluate(() =>
        Object.keys(window.localStorage).some(key =>
          (window.localStorage.getItem(key) || '').includes('mezzanine OR temporary')
        )
      )).toBe(true);
    });

    // Identity settled before the save (waitForIdentity), so the alert
    // persists to the scoped key; a hard navigation now proves durability.
    await page.goto('/dashboard');
    await waitForIdentity(page);
    await expect(page.getByText('mezzanine OR temporary').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\d+ current match(es)? in scope/).first()).toBeVisible();

    // Check Now reruns the saved search (through the same fixtures) and lands
    // back on a truthful, non-error status line.
    await test.step('ui-action:dashboard.check-saved-alert', async () => {
      const queriesBeforeCheck = stats.eftsQueries.length;
      await page.getByRole('button', { name: 'Check Now' }).click();
      // The status line never disappears (it shows the saved count), so the
      // proof that Check Now re-ran retrieval is the fixture request counter —
      // polled, because the check is asynchronous.
      await expect
        .poll(() => stats.eftsQueries.length, { timeout: 30_000 })
        .toBeGreaterThan(queriesBeforeCheck);
      await expect(page.getByText(/current matches in scope|new filings? detected/).first()).toBeVisible();
    });
  });
});

test.describe('critical action: comment-letter AI summary generation', () => {
  const THREAD_ID = 'thread-letterhaven-1';
  const LETTER_ROW = {
    accession: '0000000900-26-000900',
    cik: 900,
    company_name: 'Letterhaven Industries',
    form: 'UPLOAD',
    date_filed: '2026-03-04',
    thread_id: THREAD_ID,
    filename: 'letter1.txt',
    headline: 'The Staff challenged revenue recognition.',
    rank: 0.9,
  };
  const SUMMARY_TEXT = 'The Staff challenged principal-agent revenue recognition; resolved after two response rounds.';

  test('comment-letters.generate-summary POSTs only on explicit click and renders labeled output', async ({ page }) => {
    let generatePosts = 0;
    await page.route('**/api/letters/summary**', async (route: Route) => {
      if (route.request().method() === 'POST') {
        generatePosts += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ thread: THREAD_ID, summary: SUMMARY_TEXT, model: 'claude-sonnet-5', generatedAt: '2026-08-01T12:00:00Z', coverage: null, cached: false }),
        });
        return;
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'none' }) });
    });
    await page.route('**/api/letters**', async (route: Route) => {
      if (route.request().url().includes('/api/letters/summary')) return route.fallback();
      const url = new URL(route.request().url());
      if (url.searchParams.get('thread')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ thread: THREAD_ID, letters: [LETTER_ROW] }) });
        return;
      }
      if (url.searchParams.get('q')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 1, matches: [LETTER_ROW] }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, threads: [] }) });
    });

    const searchInput = page.getByLabel('Search inside SEC comment letters');
    const generateButton = page.getByRole('button', { name: 'Generate AI summary' });
    const summaryOutput = page.getByText(SUMMARY_TEXT);

    const searchAndExpand = async () => {
      await searchInput.fill('revenue recognition');
      await searchInput.press('Enter');
      await expect(page.getByText(LETTER_ROW.company_name).first()).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'View conversation' }).click();
    };

    await page.goto('/comment-letters');
    await waitForIdentity(page);
    await searchAndExpand();

    // The contract's first half: expanding a thread checks the cache with GET
    // but never consumes AI capacity — no POST before an explicit click.
    await expect(generateButton).toBeVisible({ timeout: 20_000 });
    expect(generatePosts, 'expanding a thread must not consume AI capacity').toBe(0);

    // Second half: an explicit click generates and renders labeled output.
    // The app shell can remount once mid-test (observed under long suite runs
    // with the Clerk dev instance; instrumentation showed NO page navigation),
    // which resets this view to its pristine state. The archetype tolerates
    // one remount by redoing search/expand — the contract being proven is
    // explicit-POST-and-render, not shell stability.
    await expect(async () => {
      if (await summaryOutput.isVisible().catch(() => false)) return;
      if (!(await generateButton.isVisible().catch(() => false))) {
        await searchAndExpand();
      }
      await generateButton.click({ timeout: 3_000 });
      await expect(summaryOutput).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000 });

    await expect(page.getByText(/AI-generated/).first()).toBeVisible();
    expect(generatePosts).toBeGreaterThanOrEqual(1);
  });
});
