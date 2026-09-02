import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type Route } from '@playwright/test';
import { FILINGS, installBooleanFixtures, type FixtureFiling } from './boolean-fixtures';

/**
 * Filing-detail interaction archetype (WP8 burn-down).
 *
 * The identity and extracted text come from the same committed Boolean corpus
 * used by the search journey. This layer only gives those filings the richer
 * HTML needed to exercise the viewer's TOC, selection and export behavior.
 * No request in this file reaches SEC or an AI provider.
 */

const CURRENT = FILINGS[2];
const OTHER = FILINGS[1];
const SELECTED_EVIDENCE = 'The company records a contingent liability when loss is probable and estimable.';
const NOTE = 'Confirm the recognition threshold against the accounting policy footnote.';

interface FilingDetailFixtureStats {
  filingTextDocuments: string[];
  proxyDocumentPaths: string[];
}

function filingHtml(filing: FixtureFiling): string {
  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.5; }
          nav a { display: block; padding: 3px; }
          section { min-height: 620px; padding-top: 32px; }
        </style>
      </head>
      <body>
        <h1>${filing.company} Annual Report</h1>
        <nav aria-label="Table of contents">
          <a href="#item1">Item 1. Business</a>
          <a href="#item1a">Item 1A. Risk Factors</a>
          <a href="#item2">Item 2. Properties</a>
          <a href="#item7">Item 7. Management Discussion</a>
          <a href="#item8">Item 8. Financial Statements</a>
          <a href="#item9">Item 9. Controls and Procedures</a>
        </nav>
        <section id="item1"><h2>Item 1. Business</h2><p>${filing.text}</p></section>
        <section id="item1a"><h2>Item 1A. Risk Factors</h2><p>${SELECTED_EVIDENCE}</p></section>
        <section id="item2"><h2>Item 2. Properties</h2><p>Our principal offices support the operating business.</p></section>
        <section id="item7"><h2>Item 7. Management Discussion</h2><p>Management evaluates liquidity and capital resources each quarter.</p></section>
        <section id="item8">
          <h2>Item 8. Financial Statements</h2>
          <h3>Commitments table</h3>
          <table>
            <thead><tr><th>Commitment</th><th>2026</th></tr></thead>
            <tbody><tr><td>Operating leases</td><td>$125</td></tr></tbody>
          </table>
        </section>
        <section id="item9"><h2>Item 9. Controls and Procedures</h2><p>Disclosure controls were evaluated as of year end.</p></section>
      </body>
    </html>`;
}

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
}

async function installFilingDetailFixtures(page: Page): Promise<FilingDetailFixtureStats> {
  await installBooleanFixtures(page);
  const stats: FilingDetailFixtureStats = { filingTextDocuments: [], proxyDocumentPaths: [] };

  // Registered after the shared fixture, so these richer filing documents win
  // while every unrelated deterministic SEC surface continues to fall back.
  await page.route('**/api/filing-text**', async (route: Route) => {
    const document = new URL(route.request().url()).searchParams.get('document') || '';
    const filing = FILINGS.find(item => document.includes(item.document));
    if (!filing) {
      await route.fallback();
      return;
    }
    stats.filingTextDocuments.push(document);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, text: filing.text, cached: true }),
    });
  });

  await page.route('**/api/sec-proxy**', async (route: Route) => {
    const path = new URL(route.request().url()).searchParams.get('path') || '';
    const filing = FILINGS.find(item => path.includes(item.document));
    if (filing) {
      stats.proxyDocumentPaths.push(path);
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: filingHtml(filing),
      });
      return;
    }
    // Keep background metadata/prefetch effects deterministic as well. Supplying
    // only the current filing yields a truthful "no prior comparable" state.
    if (path.includes('submissions/CIK')) {
      const submissionFiling = FILINGS.find(item => path.includes(item.cik.padStart(10, '0'))) || CURRENT;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cik: submissionFiling.cik,
          name: submissionFiling.company,
          tickers: [],
          exchanges: [],
          ein: '',
          description: '',
          sic: '',
          sicDescription: '',
          filings: {
            recent: {
              accessionNumber: [submissionFiling.accession],
              filingDate: [submissionFiling.filed],
              reportDate: [submissionFiling.filed],
              acceptanceDateTime: [`${submissionFiling.filed}T12:00:00.000Z`],
              act: ['34'],
              form: [submissionFiling.form],
              fileNumber: ['001-00003'],
              primaryDocument: [submissionFiling.document],
              primaryDocDescription: ['Annual report'],
            },
            files: [],
          },
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/stream', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: 'The requested filing workflow completed.' }),
    });
  });

  return stats;
}

function filingPath(filing: FixtureFiling, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    company: filing.company,
    date: filing.filed,
    form: filing.form,
    file: '001-00003',
    auditor: 'Fixture & Co. LLP',
    ...extra,
  });
  return `/filing/${Number(filing.cik)}_${filing.accession}_${filing.document}?${params.toString()}`;
}

async function openFiling(page: Page, filing = CURRENT, extra: Record<string, string> = {}) {
  await page.goto(filingPath(filing, extra), { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
  await expect(page.frameLocator('iframe[title="SEC Document View"]').getByRole('heading', { name: `${filing.company} Annual Report` }))
    .toBeVisible({ timeout: 20_000 });
}

test.describe('archetype: filing-detail evidence workspace', () => {
  test('filing-detail.return-to-search restores an approved workbench URL and rejects an external return target', async ({ page }) => {
    await installFilingDetailFixtures(page);
    const approved = '/search?mode=boolean&query=mezzanine%20OR%20temporary#results';

    await openFiling(page, CURRENT, { returnTo: approved });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    // Browsers may serialize the same query-space value as either `%20` or
    // `+`. Assert the exact decoded workbench state instead of mistaking that
    // standards-compliant canonicalization for a lost return target.
    await expect.poll(() => {
      const current = new URL(page.url());
      return {
        path: current.pathname,
        mode: current.searchParams.get('mode'),
        query: current.searchParams.get('query'),
        hash: current.hash,
      };
    }).toEqual({
      path: '/search',
      mode: 'boolean',
      query: 'mezzanine OR temporary',
      hash: '#results',
    });

    // A crafted absolute target must never become the Back destination. The
    // safe fallback is the Research Workbench, independent of browser history.
    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    await openFiling(page, CURRENT, { returnTo: 'https://attacker.example/collect' });
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/search');
  });

  test('filing-detail.search-or-highlight marks only matching loaded filing text', async ({ page }) => {
    await installFilingDetailFixtures(page);
    await runBooleanQuery(page, '"mezzanine equity"');
    await expect(page.getByText(CURRENT.company).first()).toBeVisible({ timeout: 30_000 });
    await page.getByText(CURRENT.company).first().click();
    await page.getByRole('button', { name: 'Open Filing' }).click();
    await expect(page).toHaveURL(/highlight=%22mezzanine(?:\+|%20)equity%22/);
    await expect(page.frameLocator('iframe[title="SEC Document View"]')
      .getByRole('heading', { name: `${CURRENT.company} Annual Report` }))
      .toBeVisible({ timeout: 20_000 });

    const frame = page.frameLocator('iframe[title="SEC Document View"]');
    const marks = frame.locator('mark[data-vara-search-hit="true"]');
    const phraseMark = marks.filter({ hasText: /^mezzanine equity$/i });
    const trailingTokenMark = marks.filter({ hasText: /^equity$/i });
    await expect(marks).toHaveCount(2);
    await expect(phraseMark).toHaveCount(1);
    await expect(trailingTokenMark).toHaveCount(1);
    await expect(frame.locator('mark[data-vara-search-hit]', { hasText: /management|business/i })).toHaveCount(0);
    await expect.poll(() => frame.locator('html').evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(phraseMark).toBeInViewport();
  });

  test('filing-detail.copy-link-or-citation copies a current-document reference through primary and fallback clipboard paths', async ({ page, context }) => {
    await installFilingDetailFixtures(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openFiling(page);

    const copy = page.getByRole('button', { name: 'Copy filing citation' });
    await copy.click();
    await expect(page.getByText('Filing citation copied to clipboard.')).toBeVisible();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain(CURRENT.company);
    expect(clipboard).toContain(`Form ${CURRENT.form}`);
    expect(clipboard).toContain(`filed ${CURRENT.filed}`);
    expect(clipboard).toContain(`accession ${CURRENT.accession}`);
    expect(clipboard).toContain(`document ${CURRENT.document}`);
    expect(clipboard).toContain('https://www.sec.gov/Archives/edgar/data/');

    // Exercise the hardened-browser path without claiming that a status toast
    // alone is evidence. Capture the textarea selection handed to execCommand
    // and assert it is the same document-bound citation.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new Error('blocked by fixture'); } },
      });
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: (command: string) => {
          if (command !== 'copy') return false;
          const active = document.activeElement as HTMLTextAreaElement | null;
          (window as typeof window & { __filingCitationFallback?: string }).__filingCitationFallback = active?.value || '';
          return true;
        },
      });
    });
    await copy.click();
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __filingCitationFallback?: string }).__filingCitationFallback || ''
    )).toContain(CURRENT.accession);
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & { __filingCitationFallback?: string }).__filingCitationFallback || ''
    )).toContain(CURRENT.document);
    await expect(page.getByText('Filing citation copied to clipboard.')).toBeVisible();

    await page.evaluate(() => {
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: () => false,
      });
    });
    await copy.click();
    await expect(page.getByText('Clipboard access was blocked. Use Open in SEC.gov to copy the official filing link.')).toBeVisible();
  });

  test('filing-detail.export-document-data downloads current-filing tables and opens a clean current-filing print view', async ({ page }) => {
    await installFilingDetailFixtures(page);
    await openFiling(page);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Extract Tables' }).click();
    const download = await downloadPromise;
    const exportStatus = page.locator('[data-filing-tool-status]');
    await expect(exportStatus).toBeVisible();
    await expect(exportStatus).toHaveText('Downloaded 1 table as CSV.');
    await expect(exportStatus).toHaveAttribute('role', 'status');
    await expect(exportStatus).toHaveAttribute('aria-live', 'polite');
    expect(download.suggestedFilename()).toBe('both-holdings-ltd-tables.csv');
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const csv = await readFile(downloadPath!, 'utf8');
    expect(csv).toContain('Commitments table (1/1)');
    expect(csv).toContain('Commitment,2026');
    expect(csv).toContain('Operating leases,$125');
    // Feedback must remain visible after the file has been consumed; a short
    // timer or a stale async clear would make the download look like a no-op.
    await expect(exportStatus).toBeVisible();
    await expect(exportStatus).toHaveText('Downloaded 1 table as CSV.');

    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Print / Save PDF' }).click();
    const printView = await popupPromise;
    await expect(printView).toHaveTitle(`${CURRENT.company} ${CURRENT.form}`);
    await expect(printView.getByRole('heading', { name: `${CURRENT.company} ${CURRENT.form}` })).toBeVisible();
    await expect(printView.getByText(SELECTED_EVIDENCE)).toBeVisible();
    await expect(printView.getByRole('link', { name: /sec\.gov/i })).toHaveAttribute('href', new RegExp(CURRENT.document));
    await expect(page.getByText(/Opened a clean print view/)).toBeVisible();
    await printView.close();
  });

  test('filing-detail.use-tools-panel keeps one keyboard-operable panel active and returns to the document after close', async ({ page }) => {
    await installFilingDetailFixtures(page);
    await openFiling(page);

    const tools = page.getByRole('tab', { name: 'Tools', exact: true });
    await tools.click();
    await expect(tools).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText('Workflow Tools');

    await tools.press('Home');
    const toc = page.getByRole('tab', { name: 'TOC', exact: true });
    await expect(toc).toBeFocused();
    await expect(toc).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText('Document Sections');

    await toc.press('ArrowRight');
    const details = page.getByRole('tab', { name: 'Details', exact: true });
    await expect(details).toBeFocused();
    await expect(details).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText(CURRENT.company);

    await page.getByRole('button', { name: 'Close filing tools panel' }).first().click();
    await expect(page.getByRole('complementary', { name: 'Filing tools panel' })).toHaveCount(0);
    await expect(page.frameLocator('iframe[title="SEC Document View"]').getByText(SELECTED_EVIDENCE)).toBeVisible();
    const reopen = page.getByRole('button', { name: 'Open filing tools panel' });
    await expect(reopen).toHaveAttribute('aria-expanded', 'false');
    await reopen.click();
    await expect(page.getByRole('complementary', { name: 'Filing tools panel' })).toBeVisible();
  });

  test('filing-detail.navigate-section scrolls the document to the exact detected section', async ({ page }) => {
    await installFilingDetailFixtures(page);
    await openFiling(page);

    const section = page.getByRole('button', { name: 'Item 8. Financial Statements', exact: true });
    await expect(section).toBeVisible();
    await section.click();
    await expect(section).toHaveClass(/toc-active/);

    const frame = page.frameLocator('iframe[title="SEC Document View"]');
    await expect.poll(() => frame.locator('html').evaluate(() => window.scrollY)).toBeGreaterThan(1_500);
    await expect(frame.locator('#item8')).toBeInViewport();
  });

  test('filing-detail.manage-note persists and isolates selected evidence, then removes it durably', async ({ page }) => {
    await installFilingDetailFixtures(page);
    await openFiling(page);

    await page.getByRole('button', { name: 'Annotate' }).click();
    const evidence = page.frameLocator('iframe[title="SEC Document View"]').getByText(SELECTED_EVIDENCE);
    await evidence.evaluate(element => {
      const selection = element.ownerDocument.getSelection();
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const composer = page.getByPlaceholder('Add your note, issue framing, or follow-up...');
    await expect(composer).toBeVisible();
    await composer.fill(NOTE);
    await page.getByRole('button', { name: 'Save Note' }).click();
    await expect(page.getByText('Annotation saved locally for this filing.')).toBeVisible();
    await expect(page.getByText(NOTE)).toBeVisible();

    // The note is durable for this filing but does not leak onto another
    // filing that reuses the same viewer and browser identity.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await page.getByRole('tab', { name: 'Tools', exact: true }).click();
    await expect(page.getByText(NOTE)).toBeVisible();

    await openFiling(page, OTHER);
    await page.getByRole('tab', { name: 'Tools', exact: true }).click();
    await expect(page.getByText(NOTE)).toHaveCount(0);
    await expect(page.getByText('No annotations saved for this filing yet.')).toBeVisible();

    await openFiling(page, CURRENT);
    await page.getByRole('tab', { name: 'Tools', exact: true }).click();
    const savedCard = page.locator('.related-card', { hasText: NOTE });
    await expect(savedCard).toBeVisible();
    await savedCard.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText(NOTE)).toHaveCount(0);
    await expect(page.getByText('No annotations saved for this filing yet.')).toBeVisible();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await page.getByRole('tab', { name: 'Tools', exact: true }).click();
    await expect(page.getByText(NOTE)).toHaveCount(0);
  });

  test('filing-detail.cite-evidence cites the active section and a selected passage as distinct memo evidence', async ({ page }) => {
    await installFilingDetailFixtures(page);
    await openFiling(page);
    const identity = `${CURRENT.company} ${CURRENT.form} filed ${CURRENT.filed}`;
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${Number(CURRENT.cik)}/${CURRENT.accession.replace(/-/g, '')}/${CURRENT.document}`;
    const header = page.locator('.header-actions');

    // With no section or selection, the page-level control cites the filing itself.
    await expect(header.getByRole('button', { name: `Cite ${identity} in memo tray`, exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Item 1A. Risk Factors', exact: true }).click();
    await header.getByRole('button', { name: `Cite ${identity}, Item 1A. Risk Factors in memo tray`, exact: true }).click();
    await expect(header.getByRole('button', { name: `Cited ✓ ${identity}, Item 1A. Risk Factors — remove from memo tray`, exact: true }))
      .toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Annotate' }).click();
    const evidence = page.frameLocator('iframe[title="SEC Document View"]').getByText(SELECTED_EVIDENCE);
    await evidence.evaluate(element => {
      const selection = element.ownerDocument.getSelection();
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const composer = page.locator('.annotation-composer-overlay');
    await expect(composer).toContainText(SELECTED_EVIDENCE);
    // The same section, but a quoted passage: its own citation, not a no-op.
    await composer.getByRole('button', { name: `Cite ${identity}, Item 1A. Risk Factors in memo tray`, exact: true }).click();
    const passageCited = composer.getByRole('button', { name: `Cited ✓ ${identity}, Item 1A. Risk Factors — remove from memo tray`, exact: true });
    await expect(passageCited).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Open memo tray (2 citations)' }).click();
    const tray = page.getByRole('complementary', { name: 'Memo tray' });
    const items = tray.locator('.memo-tray-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('Item 1A. Risk Factors');
    await expect(items.nth(0).locator('.el-excerpt')).toHaveCount(0);
    await expect(items.nth(1)).toContainText('Item 1A. Risk Factors');
    await expect(items.nth(1).locator('.el-excerpt')).toHaveText(SELECTED_EVIDENCE);
    for (const item of [items.nth(0), items.nth(1)]) {
      await expect(item).toContainText(CURRENT.company);
      await expect(item).toContainText(CURRENT.form);
      await expect(item).toContainText(CURRENT.filed);
      await expect(item.getByRole('link', { name: 'SEC.gov source' })).toHaveAttribute('href', sourceUrl);
    }
    await tray.getByRole('button', { name: 'Close memo tray' }).click();

    // Removing the passage leaves the section citation intact.
    await passageCited.click();
    await page.getByRole('button', { name: 'Open memo tray (1 citation)' }).click();
    const remaining = page.getByRole('complementary', { name: 'Memo tray' }).locator('.memo-tray-item');
    await expect(remaining).toHaveCount(1);
    await expect(remaining.locator('.el-excerpt')).toHaveCount(0);
  });

  test('filing-detail.cite-redline cites a changed block against both filings with their accessions', async ({ page, context }) => {
    await installFilingDetailFixtures(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const PRIOR = { accession: '0001000003-25-000003', document: 'f3-prior.htm', filed: '2025-02-12', form: CURRENT.form };
    // Headings flush disclosure blocks, so the diff yields one modified pair
    // (the mezzanine sentence), one current-only block, and one prior-only block.
    const CURRENT_TEXT = [
      'ITEM 1A. RISK FACTORS',
      'Amounts shown as mezzanine equity are presented as temporary equity in the notes to the financial statements.',
      'ITEM 7. LIQUIDITY AND CAPITAL RESOURCES',
      'Deferred revenue is recognized when control of the promised goods transfers to the customer at contract inception.',
    ].join('\n');
    const PRIOR_TEXT = [
      'ITEM 1A. RISK FACTORS',
      'Amounts shown as mezzanine equity are presented as temporary equity on the consolidated balance sheet.',
      'ITEM 9. CONTROLS AND PROCEDURES',
      'Legacy lease commitments were disclosed under the superseded operating lease accounting standard last year.',
    ].join('\n');

    // Registered after the shared fixtures, so these answer first and only the
    // two redline documents plus this issuer's submissions are overridden.
    await page.route('**/api/filing-text**', async (route: Route) => {
      const document = new URL(route.request().url()).searchParams.get('document') || '';
      const text = document.includes(PRIOR.document) ? PRIOR_TEXT : document.includes(CURRENT.document) ? CURRENT_TEXT : null;
      if (text === null) {
        await route.fallback();
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, text, cached: true }) });
    });
    await page.route('**/api/sec-proxy**', async (route: Route) => {
      const path = new URL(route.request().url()).searchParams.get('path') || '';
      if (!path.includes(`submissions/CIK${CURRENT.cik.padStart(10, '0')}`)) {
        await route.fallback();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          cik: CURRENT.cik,
          name: CURRENT.company,
          tickers: [],
          exchanges: [],
          ein: '',
          description: '',
          sic: '',
          sicDescription: '',
          filings: {
            recent: {
              accessionNumber: [CURRENT.accession, PRIOR.accession],
              filingDate: [CURRENT.filed, PRIOR.filed],
              reportDate: [CURRENT.filed, PRIOR.filed],
              acceptanceDateTime: [`${CURRENT.filed}T12:00:00.000Z`, `${PRIOR.filed}T12:00:00.000Z`],
              act: ['34', '34'],
              form: [CURRENT.form, PRIOR.form],
              fileNumber: ['001-00003', '001-00003'],
              primaryDocument: [CURRENT.document, PRIOR.document],
              primaryDocDescription: ['Annual report', 'Annual report'],
            },
            files: [],
          },
        }),
      });
    });
    await page.route('**/api/claude', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '[]' }) });
    });

    await openFiling(page);
    await page.getByRole('button', { name: 'YoY Redline' }).click();
    const tools = page.getByRole('tabpanel');
    await expect(tools).toContainText(`Comparing against ${PRIOR.form} filed on ${PRIOR.filed}.`, { timeout: 20_000 });
    await expect(tools.getByRole('heading', { name: 'Modified disclosure blocks' })).toBeVisible();

    const identity = `${CURRENT.company} ${CURRENT.form} filed ${CURRENT.filed}`;
    const scope = `Redline vs ${PRIOR.form} filed ${PRIOR.filed}`;
    await tools.getByRole('button', { name: `Cite ${identity}, ${scope} — modified block 1 in memo tray`, exact: true }).click();
    await expect(tools.getByRole('button', { name: `Cited ✓ ${identity}, ${scope} — modified block 1 — remove from memo tray`, exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect(tools.getByRole('button', { name: `Cite ${identity}, ${scope} — current-only block 1 in memo tray`, exact: true }))
      .toHaveAttribute('aria-pressed', 'false');
    await expect(tools.getByRole('button', { name: `Cite ${identity}, ${scope} — prior-only block 1 in memo tray`, exact: true }))
      .toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: 'Open memo tray (1 citation)' }).click();
    const tray = page.getByRole('complementary', { name: 'Memo tray' });
    const item = tray.locator('.memo-tray-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText(`${scope} — modified block 1`);
    await expect(item).toContainText(`Compared with Form ${PRIOR.form} filed ${PRIOR.filed} (accession ${PRIOR.accession})`);
    await expect(item.getByRole('link', { name: 'SEC.gov source' })).toHaveAttribute(
      'href',
      `https://www.sec.gov/Archives/edgar/data/${Number(CURRENT.cik)}/${CURRENT.accession.replace(/-/g, '')}/${CURRENT.document}`
    );
    await expect(item.getByRole('link', { name: 'prior filing on SEC.gov' })).toHaveAttribute(
      'href',
      `https://www.sec.gov/Archives/edgar/data/${Number(CURRENT.cik)}/${PRIOR.accession.replace(/-/g, '')}/${PRIOR.document}`
    );
    const excerpt = item.locator('.el-excerpt');
    await expect(excerpt).toContainText(`Prior filing (Form ${PRIOR.form}, filed ${PRIOR.filed}, accession ${PRIOR.accession})`);
    await expect(excerpt).toContainText('on the consolidated balance sheet');
    await expect(excerpt).toContainText('Current filing:');
    await expect(excerpt).toContainText('in the notes to the financial statements');

    await tray.getByRole('button', { name: 'Copy citations' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(`(accession ${CURRENT.accession}), compared with Form ${PRIOR.form} filed ${PRIOR.filed} (accession ${PRIOR.accession})`);
  });

  test('filing-detail.open-assistant retains the source and uses the active filing as action context', async ({ page }) => {
    const stats = await installFilingDetailFixtures(page);
    await openFiling(page);
    const filingUrl = page.url();

    const openedPopups: Page[] = [];
    page.on('popup', popup => {
      openedPopups.push(popup);
    });

    await page.getByRole('button', { name: 'Ask URC Copilot' }).click();
    const assistant = page.getByRole('complementary', { name: 'URC Copilot research assistant' });
    await expect(assistant).toBeVisible();
    await expect(page).toHaveURL(filingUrl);
    await expect(page.frameLocator('iframe[title="SEC Document View"]').getByText(SELECTED_EVIDENCE)).toBeVisible();

    // Export is intentionally used as the probe: its deterministic agent plan
    // consumes currentFilingContext directly. Observing the exact document
    // fetch proves the panel did not merely open as a context-free shell.
    const input = assistant.getByRole('textbox', { name: 'Message URC Copilot' });
    await input.fill('Export this filing as a clean PDF');
    await assistant.getByRole('button', { name: 'Send message to copilot' }).click();
    await expect.poll(() => stats.filingTextDocuments).toContain(CURRENT.document);
    await assistant.getByRole('button', { name: 'Action Log' }).click();
    await expect(assistant.getByText(/Opened a clean print view for PDF export|Unable to open the print view/)).toBeVisible();
    await expect(page).toHaveURL(filingUrl);
    await expect(page.frameLocator('iframe[title="SEC Document View"]').getByText(SELECTED_EVIDENCE)).toBeVisible();

    for (const popup of openedPopups) await popup.close().catch(() => undefined);
  });
});
