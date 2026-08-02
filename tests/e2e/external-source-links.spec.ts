import { expect, test, type Page, type Route } from '@playwright/test';
import { FILINGS, installBooleanFixtures } from './boolean-fixtures';
import { LITIGATION, NO_ACTION, RULEMAKING, installOfficialSourceFixtures } from './official-source-fixtures';

/**
 * Critical-action archetype: global.external-source-links (WP8 burn-down).
 *
 * Contract: "Activate representative SEC, IAPD, FASB, and framework source
 * links. Each link names enough row context, opens the exact official source
 * safely, and leaves the current research state available."
 *
 * This is an archetype, not a link inventory: it collects EVERY cross-origin
 * anchor a surface renders and holds all of them to the same four rules, so a
 * new row-level source link inherits the coverage automatically.
 *
 * The naming rule is the one with teeth. Nine table views used to render an
 * identical, contextless name on every row ("View", "SEC.gov", "IAPD") while
 * the Copilot button beside them carried full row context — a screen-reader
 * user heard an undifferentiated list of links and could not tell which filing
 * any of them opened.
 */

const BOTH = FILINGS[2];

/** Names that identify no source at all when heard out of visual context. */
const CONTEXTLESS_NAMES = new Set([
  '', 'view', 'open', 'link', 'here', 'click here', 'read more', 'more',
  'source', 'details', 'sec.gov', 'iapd', 'sec', 'edgar', 'view source',
  'open source', 'external link',
]);

interface ExternalLink {
  href: string;
  target: string;
  rel: string;
  name: string;
}

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

/**
 * Every cross-origin anchor on the page, with the name a screen reader would
 * announce. These anchors have no nested widgets, so aria-label ?? title ??
 * trimmed text content is a faithful accessible name.
 */
async function collectExternalLinks(page: Page): Promise<ExternalLink[]> {
  return page.$$eval('a[href]', anchors =>
    anchors
      .filter(a => {
        const href = a.getAttribute('href') || '';
        if (!/^https?:\/\//i.test(href)) return false;
        // The Next.js dev-server badge injects its own nextjs.org anchor. It is
        // absent from the production build CI runs (PW_PROD_BUILD), but it
        // would otherwise fail these rules during local iteration.
        if (/(^|\.)nextjs\.org$/i.test(new URL(href).hostname)) return false;
        try {
          return new URL(href).origin !== window.location.origin;
        } catch {
          return false;
        }
      })
      .map(a => ({
        href: a.getAttribute('href') || '',
        target: a.getAttribute('target') || '',
        rel: a.getAttribute('rel') || '',
        name: (
          a.getAttribute('aria-label') ||
          a.getAttribute('title') ||
          a.textContent ||
          ''
        ).replace(/\s+/g, ' ').trim(),
      }))
  );
}

function assertSourceLinkContract(links: ExternalLink[], surface: string, officialHost: RegExp) {
  expect(links.length, `${surface}: rendered no external source links to check`).toBeGreaterThan(0);

  for (const link of links) {
    // Opens the exact official source — not a search page, not a redirector.
    expect(link.href, `${surface}: "${link.name}" does not point at an official source`).toMatch(officialHost);

    // Leaves the current research state available: the research surface must
    // survive activation rather than being navigated away from.
    expect(link.target, `${surface}: "${link.name}" (${link.href}) would replace the research view`).toBe('_blank');

    // Safely: never hand window.opener to the target document.
    expect(
      /noopener|noreferrer/.test(link.rel),
      `${surface}: "${link.name}" (${link.href}) opens a new tab without noopener/noreferrer`
    ).toBe(true);

    // Names enough row context to be actionable on its own.
    expect(
      CONTEXTLESS_NAMES.has(link.name.toLowerCase()),
      `${surface}: a source link is named "${link.name}", which identifies no source`
    ).toBe(false);
    expect(link.name.length, `${surface}: source link name "${link.name}" is too short to identify a source`).toBeGreaterThan(8);
  }

  // The core of "names enough row context": links that go to DIFFERENT
  // documents must be distinguishable by name alone. Repeated links to the
  // same href may legitimately share a name.
  const nameByHref = new Map<string, string>();
  for (const link of links) nameByHref.set(link.href, link.name);
  const namesForDistinctHrefs = [...nameByHref.values()].map(name => name.toLowerCase());
  const duplicates = namesForDistinctHrefs.filter((name, i) => namesForDistinctHrefs.indexOf(name) !== i);
  expect(
    [...new Set(duplicates)],
    `${surface}: these names are reused across links that open DIFFERENT sources, so they cannot be told apart`
  ).toEqual([]);
}

test.describe('critical action: external source links', () => {
  test('global.external-source-links names, secures, and preserves state on SEC links', async ({ page }) => {
    await installBooleanFixtures(page);
    await page.route('**/api/filing-text**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, text: BOTH.text, cached: true }),
      });
    });
    await page.route('**/api/sec-proxy**', async (route: Route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    await page.goto(`/filing/${Number(BOTH.cik)}_${BOTH.accession}_${BOTH.document}`);
    await waitForIdentity(page);
    await expect(page.getByRole('link', { name: 'Open filing on SEC.gov' }).first()).toBeVisible({ timeout: 20_000 });

    assertSourceLinkContract(await collectExternalLinks(page), 'filing detail (SEC)', /sec\.gov/);
  });

  test('global.external-source-links names each IAPD record by its firm', async ({ page }) => {
    // The IAPD directory is called straight from the browser; fixture it so
    // this proves our rendering, not adviserinfo.sec.gov's availability.
    await page.route('**api.adviserinfo.sec.gov/search/firm**', async (route: Route) => {
      const firm = (id: string, name: string) => ({
        _source: {
          firm_source_id: id,
          firm_name: name,
          firm_ia_full_sec_number: `801-${id}`,
          firm_ia_scope: 'SEC',
          firm_ia_disclosure_fl: 'N',
          firm_ia_address_details: JSON.stringify({ officeAddress: { city: 'Boston', state: 'MA', country: 'USA' } }),
        },
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Two firms: one row cannot prove names are distinguishable.
        body: JSON.stringify({ hits: { total: 2, hits: [firm('1001', 'Northgate Advisers LLC'), firm('1002', 'Southbank Capital Management')] } }),
      });
    });

    await page.goto('/adv-registrations');
    await waitForIdentity(page);
    const input = page.getByLabel('Firm name, CRD number, or SEC number');
    await input.fill('advisers');
    await input.press('Enter');

    await expect(page.getByText('Northgate Advisers LLC').first()).toBeVisible({ timeout: 20_000 });
    assertSourceLinkContract(await collectExternalLinks(page), 'adviser registrations (IAPD)', /adviserinfo\.sec\.gov/);

    // Activating a source link must leave the research state available: the
    // result table is still there and the route has not changed underneath it.
    const before = page.url();
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('link', { name: /Northgate Advisers LLC/ }).first().click(),
    ]);
    await popup.close();
    expect(page.url()).toBe(before);
    await expect(page.getByText('Southbank Capital Management').first()).toBeVisible();
  });

  test('global.external-source-links names FASB and framework sources by their standard', async ({ page }) => {
    await page.goto('/accounting');
    await waitForIdentity(page);
    // Codification topics live behind the Standards tab; 'research' is default.
    await page.getByRole('button', { name: /Standards/i }).first().click();
    await expect(page.getByText(/ASC \d+/).first()).toBeVisible({ timeout: 20_000 });

    assertSourceLinkContract(await collectExternalLinks(page), 'accounting hub (FASB)', /fasb\.org/);

    await page.goto('/esg');
    await waitForIdentity(page);
    await expect(page.getByText('SASB Standards').first()).toBeVisible({ timeout: 20_000 });

    // Framework and policy sources are issued by many standard-setters, so the
    // host allowlist here is "an official https origin", not a single domain.
    assertSourceLinkContract(await collectExternalLinks(page), 'ESG research (frameworks)', /^https:\/\//);
  });

  /**
   * The scraped-index surfaces. These parse real SEC HTML, so they need
   * structure-faithful fixtures (see official-source-fixtures.ts) — a generic
   * stub makes them render their honest "no parseable entries" failure state
   * instead of rows, and the archetype would have nothing to check.
   */
  test('global.external-source-links names each scraped SEC index row by its document', async ({ page }) => {
    await installOfficialSourceFixtures(page);

    await page.goto('/regulation');
    await waitForIdentity(page);
    await expect(page.getByText(RULEMAKING[0].title).first()).toBeVisible({ timeout: 20_000 });
    assertSourceLinkContract(await collectExternalLinks(page), 'securities regulation (SEC)', /sec\.gov/);

    await page.goto('/no-action-letters');
    await waitForIdentity(page);
    await expect(page.getByText(NO_ACTION[0].title).first()).toBeVisible({ timeout: 20_000 });
    assertSourceLinkContract(await collectExternalLinks(page), 'no-action letters (SEC)', /sec\.gov/);

    await page.goto('/enforcement');
    await waitForIdentity(page);
    await expect(page.getByText(LITIGATION[0].title).first()).toBeVisible({ timeout: 20_000 });
    assertSourceLinkContract(await collectExternalLinks(page), 'SEC enforcement (SEC)', /sec\.gov/);
  });
});
