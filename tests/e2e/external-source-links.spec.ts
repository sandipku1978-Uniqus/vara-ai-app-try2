import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { FILINGS, installBooleanFixtures } from './boolean-fixtures';
import { LITIGATION, NO_ACTION, RULEMAKING, installOfficialSourceFixtures } from './official-source-fixtures';
import { assertSourceLinkContract, collectExternalLinks } from './source-link-contract';

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

interface OfficialSourceActivation {
  link: Locator;
  expectedUrl: string;
  assertOriginState: () => Promise<void>;
}

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

/**
 * Exercise the browser activation, not just the anchor attributes. External
 * navigation is fulfilled in the popup context so these checks are exact and
 * deterministic without depending on an official site's availability.
 */
async function activateOfficialSource(
  page: Page,
  { link, expectedUrl, assertOriginState }: OfficialSourceActivation,
) {
  const sourceRequests: string[] = [];
  await page.context().route(expectedUrl, async route => {
    sourceRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body><h1>Official destination fixture</h1></body></html>',
    });
  });

  const originUrl = page.url();
  try {
    await expect(link).toHaveAttribute('href', expectedUrl);
    await expect(link).toHaveAttribute('target', '_blank');

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      link.click(),
    ]);
    await expect.poll(() => popup.url()).toBe(expectedUrl);
    await expect(popup.getByRole('heading', { name: 'Official destination fixture', exact: true })).toBeVisible();
    expect(sourceRequests, 'activation must request the exact official URL once').toEqual([expectedUrl]);

    expect(page.url(), 'external activation must not replace the research surface').toBe(originUrl);
    await assertOriginState();
    await popup.close();
    expect(page.url(), 'closing the source must leave the original route intact').toBe(originUrl);
    await assertOriginState();
  } finally {
    await page.context().unroute(expectedUrl);
  }
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

    const expectedUrl = `https://www.sec.gov/Archives/edgar/data/${BOTH.cik}/${BOTH.accession.replace(/-/g, '')}/${BOTH.document}`;
    await activateOfficialSource(page, {
      link: page.getByRole('link', { name: 'Open filing on SEC.gov', exact: true }).first(),
      expectedUrl,
      assertOriginState: async () => {
        await expect(page.getByRole('heading', {
          name: `SEC filing viewer — CIK ${BOTH.cik}, accession ${BOTH.accession.replace(/-/g, '')}`,
          exact: true,
        })).toBeVisible();
        await expect(page.getByText(BOTH.document, { exact: true })).toBeVisible();
      },
    });
  });

  test('global.external-source-links names each IAPD record by its firm', async ({ page }) => {
    // The IAPD directory is reached through the authenticated, centrally paced
    // same-origin SEC proxy; fixture it so this proves rendering, not IAPD uptime.
    await page.route('**/api/sec-proxy?**upstream=iapd**', async (route: Route) => {
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

    await test.step('ui-action:adv-registrations.open-source,global.external-source-links', async () => {
      await activateOfficialSource(page, {
        link: page.getByRole('link', {
          name: 'Open the IAPD record for Northgate Advisers LLC on adviserinfo.sec.gov',
          exact: true,
        }),
        expectedUrl: 'https://adviserinfo.sec.gov/firm/summary/1001',
        assertOriginState: async () => {
          await expect(input).toHaveValue('advisers');
          await expect(page.getByText('Northgate Advisers LLC').first()).toBeVisible();
          await expect(page.getByText('Southbank Capital Management').first()).toBeVisible();
        },
      });
    });
  });

  test('global.external-source-links names FASB and framework sources by their standard', async ({ page }) => {
    await page.goto('/accounting');
    await waitForIdentity(page);
    // Codification topics live behind the Standards tab; 'research' is default.
    await page.getByRole('button', { name: /Standards/i }).first().click();
    await expect(page.getByText(/ASC \d+/).first()).toBeVisible({ timeout: 20_000 });

    assertSourceLinkContract(await collectExternalLinks(page), 'accounting hub (FASB)', /fasb\.org/);

    const standardsSearch = page.getByLabel('Search accounting standards topics');
    await standardsSearch.fill('606');
    const asc606 = page.getByTitle('Open ASC 606 - Revenue from Contracts with Customers on FASB.org');
    await expect(asc606).toBeVisible();
    await test.step('ui-action:accounting-standards.open-topic-source,global.external-source-links', async () => {
      await activateOfficialSource(page, {
        link: asc606,
        expectedUrl: 'https://asc.fasb.org/606/',
        assertOriginState: async () => {
          await expect(page.getByRole('button', { name: /Standards Directory/i })).toHaveAttribute('aria-pressed', 'true');
          await expect(standardsSearch).toHaveValue('606');
          await expect(asc606).toBeVisible();
        },
      });
    });

    await page.goto('/esg');
    await waitForIdentity(page);
    await expect(page.getByText('SASB Standards').first()).toBeVisible({ timeout: 20_000 });

    // Framework and policy sources are issued by many standard-setters, so the
    // host allowlist here is "an official https origin", not a single domain.
    assertSourceLinkContract(await collectExternalLinks(page), 'ESG research (frameworks)', /^https:\/\//);

    const sasb = page.locator('a.framework-card', { hasText: 'SASB Standards' });
    await activateOfficialSource(page, {
      link: sasb,
      expectedUrl: 'https://sasb.ifrs.org/standards/',
      assertOriginState: async () => {
        await expect(page.getByRole('button', { name: /Framework Navigator/i })).toHaveAttribute('aria-pressed', 'true');
        await expect(sasb).toBeVisible();
        await expect(page.getByText('Cross-Framework Mapping', { exact: true })).toBeVisible();
      },
    });
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

    const regulationSearch = page.getByRole('textbox', { name: 'Search official SEC regulation sources' });
    await regulationSearch.fill('Climate-Related');
    await regulationSearch.press('Enter');
    await expect(page.getByText(RULEMAKING[0].title).first()).toBeVisible();
    await test.step('ui-action:securities-regulation.open-source', async () => {
      await activateOfficialSource(page, {
        link: page.getByRole('link', {
          name: `Open the official SEC Rulemaking "${RULEMAKING[0].title}" on SEC.gov`,
          exact: true,
        }),
        expectedUrl: `https://www.sec.gov${RULEMAKING[0].href}`,
        assertOriginState: async () => {
          await expect(regulationSearch).toHaveValue('Climate-Related');
          await expect(page.getByText(RULEMAKING[0].title).first()).toBeVisible();
        },
      });
    });

    await page.goto('/no-action-letters');
    await waitForIdentity(page);
    await expect(page.getByText(NO_ACTION[0].title).first()).toBeVisible({ timeout: 20_000 });
    assertSourceLinkContract(await collectExternalLinks(page), 'no-action letters (SEC)', /sec\.gov/);

    const noActionSearch = page.getByRole('textbox', { name: 'Search official SEC no-action responses' });
    await noActionSearch.fill('Acme Corp');
    await noActionSearch.press('Enter');
    await expect(page.getByText(NO_ACTION[0].title).first()).toBeVisible();
    await expect(page.getByText(NO_ACTION[1].title)).toHaveCount(0);
    await test.step('ui-action:no-action-letters.open-source', async () => {
      await activateOfficialSource(page, {
        link: page.getByRole('link', {
          name: `Open the SEC staff No-action response "${NO_ACTION[0].title}" on SEC.gov`,
          exact: true,
        }),
        expectedUrl: `https://www.sec.gov${NO_ACTION[0].href}`,
        assertOriginState: async () => {
          await expect(noActionSearch).toHaveValue('Acme Corp');
          await expect(page.getByText(NO_ACTION[0].title).first()).toBeVisible();
          await expect(page.getByText(NO_ACTION[1].title)).toHaveCount(0);
        },
      });
    });

    await page.goto('/enforcement');
    await waitForIdentity(page);
    await expect(page.getByText(LITIGATION[0].title).first()).toBeVisible({ timeout: 20_000 });
    assertSourceLinkContract(await collectExternalLinks(page), 'SEC enforcement (SEC)', /sec\.gov/);

    const enforcementFilter = page.getByRole('searchbox', { name: 'Filter litigation releases' });
    await enforcementFilter.fill(LITIGATION[0].number);
    await expect(page.getByText(LITIGATION[0].title).first()).toBeVisible();
    await expect(page.getByText(LITIGATION[1].title)).toHaveCount(0);
    await test.step('ui-action:sec-enforcement.open-source', async () => {
      await activateOfficialSource(page, {
        link: page.getByRole('link', {
          name: `View SEC litigation release ${LITIGATION[0].number} (${LITIGATION[0].title}) on SEC.gov`,
          exact: true,
        }),
        expectedUrl: `https://www.sec.gov${LITIGATION[0].href}`,
        assertOriginState: async () => {
          await expect(enforcementFilter).toHaveValue(LITIGATION[0].number);
          await expect(page.getByText(LITIGATION[0].title).first()).toBeVisible();
          await expect(page.getByText(LITIGATION[1].title)).toHaveCount(0);
        },
      });
    });
  });
});
