import { expect, test, type Page } from '@playwright/test';

const productionBuild = Boolean(process.env.QA_BASE_URL) || process.env.PW_PROD_BUILD === '1';

async function openDevelopmentGallery(page: Page) {
  const response = await page.goto('/design-gallery', { waitUntil: 'domcontentloaded' });
  expect(response, 'the development gallery should return a document').not.toBeNull();
  expect(response?.status(), 'the development gallery should not be an HTTP error').toBeLessThan(400);
  const gallery = page.locator('.el-gallery:visible');
  await expect(gallery).toBeVisible();
  await expect(gallery.getByRole('heading', { level: 1, name: 'Evidence Ledger — component gallery' })).toBeVisible();
  return gallery;
}

test.describe('archetype: internal evidence-ledger design gallery', () => {
  test('design-gallery.review-component-states presents the full static evidence-ledger state matrix', async ({ page }) => {
    test.skip(productionBuild, 'The component gallery is intentionally absent from production builds.');

    const liveDataRequests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/') || url.hostname === 'www.sec.gov' || url.hostname === 'data.sec.gov') {
        liveDataRequests.push(`${request.method()} ${url.href}`);
      }
    });

    const gallery = await openDevelopmentGallery(page);

    const disclosure = gallery.locator('[data-gallery-fixture-disclosure]');
    await expect(disclosure).toContainText('STATIC SAMPLE DATA');
    await expect(disclosure).toContainText('fabricated for component review and must not be cited');

    await expect(gallery.getByRole('heading', { level: 2 })).toHaveText([
      'Command bar',
      'Filter tokens',
      'Evidence table',
      'State vocabulary',
      'Citation chip + memo actions',
      'AI synthesis block',
      'Empty, error, and loading states',
      'Type & spacing specimens',
    ]);

    const query = gallery.getByLabel('Search companies, filings, topics, or standards');
    await expect(query).toHaveAttribute('readonly', '');
    await expect(query).toHaveAttribute('aria-describedby', 'gallery-command-specimen');
    await expect(gallery.getByText('All sources', { exact: true })).toBeVisible();

    const tokens = gallery.locator('.el-token');
    await expect(tokens).toHaveCount(4);
    await expect(tokens).toHaveText([
      'Forms: 10-K, 10-K/A✕',
      '2010 → today✕',
      'Issuer: Organon & Co.✕',
      'Auditor: PwC✕',
    ]);

    const evidenceRows = gallery.locator('.el-table tbody tr');
    await expect(evidenceRows).toHaveCount(3);
    await expect(evidenceRows.nth(0)).toContainText('10-K');
    await expect(evidenceRows.nth(0)).toContainText('2026-02-24');
    await expect(evidenceRows.nth(1)).toContainText('10-K/A');
    await expect(evidenceRows.nth(2)).toContainText('8-K');
    await expect(gallery.locator('[data-gallery-selected="true"]')).toHaveCount(1);
    await expect(evidenceRows.nth(0)).toHaveAttribute('data-gallery-selected', 'true');
    await expect(gallery.locator('[data-gallery-state="verified"]')).toHaveCount(3);

    const stateClasses: Record<string, string> = {
      verified: 'el-badge-verified',
      citation: 'el-badge-citation',
      review: 'el-badge-review',
      risk: 'el-badge-risk',
      neutral: 'el-badge-neutral',
    };
    for (const [state, className] of Object.entries(stateClasses)) {
      const badge = gallery.locator(`[data-gallery-vocabulary="${state}"]`);
      await expect(badge, `${state} should have its own state treatment`).toHaveCount(1);
      await expect(badge).toHaveClass(new RegExp(`(?:^|\\s)${className}(?:\\s|$)`));
    }

    await expect(gallery.locator('[data-gallery-state-treatment="empty"]')).toContainText('“climate remediation”');
    await expect(gallery.locator('[data-gallery-state-treatment="empty"]')).toContainText('CIK 1821825');
    await expect(gallery.locator('[data-gallery-state-treatment="error"]')).toContainText('HTTP 503');
    await expect(gallery.locator('[data-gallery-state-treatment="error"]')).toContainText('facet store');
    await expect(gallery.locator('[data-gallery-state-treatment="loading"] .el-skeleton')).toHaveCount(3);

    const synthesis = gallery.locator('.el-synthesis');
    await expect(synthesis).toContainText('3 sources');
    await expect(synthesis).toContainText('Awaiting review');
    await expect(synthesis.locator('[data-gallery-static-control="citation-reference"]')).toHaveCount(3);
    await expect(gallery.getByText('Mono — 0001821825 · 0001104659-26-018395 · OGN')).toBeVisible();

    // Reviewing the matrix is a real user journey, not merely a direct-route
    // smoke check: traverse to the final specimen and prove it remains usable.
    await page.mouse.move(720, 450);
    await page.mouse.wheel(0, 100_000);
    await expect(gallery.getByRole('heading', { level: 2, name: 'Type & spacing specimens' })).toBeInViewport();

    expect(liveDataRequests, 'static component review must not depend on APIs or SEC responses').toEqual([]);
  });

  test('design-gallery.exercise-static-controls keeps every illustrative specimen non-interactive', async ({ page }) => {
    test.skip(productionBuild, 'The component gallery is intentionally absent from production builds.');
    const gallery = await openDevelopmentGallery(page);
    const notices = gallery.locator('[data-gallery-specimen-notice]');
    await expect(notices).toHaveCount(5);
    for (const notice of await notices.all()) {
      await expect(notice).toContainText('Illustrative specimen');
    }

    const expectedSpecimens: Record<string, number> = {
      'filter-remove': 4,
      'evidence-company': 3,
      'evidence-section': 3,
      'open-source': 1,
      'memo-action': 1,
      'copy-citation': 1,
      'citation-reference': 3,
    };
    for (const [kind, count] of Object.entries(expectedSpecimens)) {
      await expect(gallery.locator(`[data-gallery-static-control="${kind}"]`)).toHaveCount(count);
    }

    // Styling must not lie about behavior: none of the specimens are exposed
    // to pointer, keyboard, or assistive-technology users as a button/link.
    await expect(gallery.getByRole('button')).toHaveCount(0);
    await expect(gallery.getByRole('link')).toHaveCount(0);
    const semanticShape = await gallery.locator('[data-gallery-static-control]').evaluateAll(nodes => nodes.map(node => ({
      href: node.getAttribute('href'),
      role: node.getAttribute('role'),
      tabIndex: node.getAttribute('tabindex'),
      tag: node.tagName,
    })));
    expect(semanticShape).toHaveLength(16);
    expect(semanticShape).toEqual(semanticShape.map(() => ({ href: null, role: null, tabIndex: null, tag: 'SPAN' })));

    const before = await gallery.evaluate(node => node.innerHTML);
    const urlBefore = page.url();
    const controls = gallery.locator('[data-gallery-static-control]');
    for (let index = 0; index < await controls.count(); index += 1) {
      await controls.nth(index).click({ force: true });
    }
    expect(page.url(), 'illustrative evidence treatments must not change location or fragment').toBe(urlBefore);
    expect(await gallery.evaluate(node => node.innerHTML), 'illustrative controls must not mutate the specimen state').toBe(before);
    await expect(gallery.locator('.el-token')).toHaveCount(4);
    await expect(gallery.locator('[data-gallery-selected="true"]')).toHaveCount(1);

    const query = gallery.getByLabel('Search companies, filings, topics, or standards');
    await query.focus();
    await page.keyboard.type('material weakness');
    await expect(query, 'the command specimen is explicitly read-only').toHaveValue('');
  });

  test('design-gallery.exercise-static-controls is unreachable in production', async ({ page }) => {
    test.skip(!productionBuild, 'This safety boundary is meaningful only against a production build.');

    const response = await page.goto('/design-gallery', { waitUntil: 'domcontentloaded' });
    expect(response, 'the production route should still return a not-found document').not.toBeNull();
    await expect(page.locator('.el-gallery')).toHaveCount(0);
    await expect(page.getByText('Organon & Co.')).toHaveCount(0);
    await expect(page.getByText('✓ Verified source', { exact: true })).toHaveCount(0);
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
  });
});
