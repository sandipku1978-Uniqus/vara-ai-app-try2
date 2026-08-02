import { expect, test, type Page } from '@playwright/test';

/**
 * Archetype: the public pages a signed-out visitor can reach — privacy,
 * terms, and the support guide (WP8 cluster I).
 *
 * These need no fixtures at all: no SEC data, no identity, no search. That
 * makes them the cheapest remaining coverage in the inventory, and two of
 * them carry obligations rather than conveniences — an analytics consent
 * choice that must actually be stored, and a legal page that must actually
 * state the professional-advice limitation. Both are the kind of thing that
 * can be deleted in a refactor without anything else noticing.
 */

const CONSENT_KEY = 'urc.analytics-consent.v1';

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

function storedConsent(page: Page) {
  return page.evaluate(key => window.localStorage.getItem(key), CONSENT_KEY);
}

test.describe('archetype: public legal and support pages', () => {
  test('privacy.allow-analytics stores consent as granted and reports it truthfully', async ({ page }) => {
    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    const status = page.getByRole('status').first();
    await expect(status).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Allow analytics' }).click();
    await expect.poll(() => storedConsent(page), { timeout: 10_000 }).toBe('granted');

    // The status region is live and must never overstate what is running.
    // Where the deployment has no analytics configured — the default, and
    // what CI runs — the honest report is that it is unavailable, NOT that
    // analytics is now active.
    await expect(status).toHaveText(/allowed optional product analytics|disabled for this deployment/i);

    // Durable: a preference that does not survive a reload was never stored.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    expect(await storedConsent(page)).toBe('granted');
  });

  test('privacy.decline-analytics stores consent as denied and reports it truthfully', async ({ page }) => {
    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    await page.getByRole('button', { name: 'Allow analytics' }).click();
    await expect.poll(() => storedConsent(page), { timeout: 10_000 }).toBe('granted');

    // Declining after allowing is the case that matters: the opt-out has to
    // overwrite a previous grant, not merely fail to add one.
    await page.getByRole('button', { name: 'Decline analytics' }).click();
    await expect.poll(() => storedConsent(page), { timeout: 10_000 }).toBe('denied');

    await expect(page.getByRole('status').first()).toHaveText(/analytics is disabled|disabled for this deployment/i);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    expect(await storedConsent(page)).toBe('denied');
  });

  test('privacy.return-home and terms.return-home reach the public landing without sign-in', async ({ page }) => {
    for (const route of ['/privacy', '/terms']) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await waitForIdentity(page);

      const back = page.getByRole('link', { name: 'Return to Uniqus Research Center' });
      await expect(back, `${route} must offer a way back`).toBeVisible({ timeout: 20_000 });
      await back.click();

      // The landing page itself, not an auth wall — these pages are reachable
      // by signed-out visitors, so their way out must be too.
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
    }
  });

  test('terms.review-limitations states the professional-advice limitation', async ({ page }) => {
    await page.goto('/terms', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    // The specific obligation, not merely "some text rendered": output is not
    // professional advice, and does not replace reading the sources.
    await expect(page.getByRole('heading', { name: /not professional advice/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/not legal,\s*accounting, investment, tax, or other professional advice/i).first()).toBeVisible();
    await expect(page.getByText(/should not replace review\s*of the underlying source documents/i).first()).toBeVisible();
  });

  test('support-center.filter-guidance narrows the guide and says so when nothing matches', async ({ page }) => {
    await page.goto('/support', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    const search = page.getByLabel('Search the guide, workflows, and FAQ');
    await expect(search).toBeVisible({ timeout: 20_000 });

    const sectionCount = () => page.locator('.guide-section').count();
    const before = await sectionCount();
    expect(before, 'the guide should render sections before filtering').toBeGreaterThan(1);

    await search.fill('benchmarking');
    await expect.poll(sectionCount, { timeout: 10_000 }).toBeLessThan(before);

    // A query with no matches must SAY so rather than render an empty page
    // that reads as "this guide covers nothing".
    await search.fill('zzzzz-no-such-guidance');
    await expect(page.getByRole('heading', { name: 'No guide matches' })).toBeVisible({ timeout: 10_000 });

    // Clearing restores the full guide — the filter is not destructive.
    await search.fill('');
    await expect.poll(sectionCount, { timeout: 10_000 }).toBe(before);
  });

  test('support-center.jump-to-section moves to the named section and names it in the URL', async ({ page }) => {
    await page.goto('/support', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    const jump = page.locator('a[href^="#"]').first();
    await expect(jump).toBeVisible({ timeout: 20_000 });
    const href = await jump.getAttribute('href');
    const id = (href || '').replace(/^#/, '');
    expect(id, 'in-page link must name a target').toBeTruthy();

    await jump.click();

    // The fragment identifies the section, and the section it names exists —
    // a link to a missing anchor scrolls nowhere and says nothing.
    await expect(page).toHaveURL(new RegExp(`#${id}$`));
    await expect(page.locator(`#${id}`)).toBeVisible();
  });
});

/**
 * DEFERRED, with reasons:
 * - support-center.open-summary-route / open-feature-route: both assert that a
 *   specific product route opens "requesting sign-in if required". The e2e
 *   webServer bypasses auth entirely, so the sign-in half is unobservable here
 *   for the same reason global.authentication is.
 * - design-gallery.review-component-states / exercise-static-controls: left
 *   deliberately untouched. "Inspect components" is arguably not an action at
 *   all, but exercise-static-controls also asserts that production visitors
 *   cannot reach the internal gallery — a real exposure claim that deserves
 *   its own test rather than being narrowed away in passing.
 */
