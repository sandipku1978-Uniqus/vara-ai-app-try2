import { expect, test } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
import { isPublicPath } from '../../src/proxy';

/**
 * Archetype: global.authentication.
 *
 * Contract: "Activate Sign in, Get started, account, and sign-out controls
 * from public and protected destinations. Authentication uses the production
 * identity surface, preserves the exact intended return URL, and removes
 * protected access after sign-out."
 *
 * Three claims, and they are tested separately because they fail separately:
 *   1. protected destinations are actually protected when signed out
 *   2. the intended return URL survives the trip through the identity surface
 *   3. signing out actually removes access again
 *
 * (3) is the one worth the most: a sign-out that clears the visible chrome but
 * leaves the session valid looks completely correct to the person using it.
 *
 * Runs under playwright.auth.config.ts, which serves the app with the e2e
 * auth bypass OFF. `npx playwright test --config playwright.auth.config.ts`.
 */

const PROTECTED_ROUTE = '/dashboard';
const DEEP_PROTECTED_ROUTE = '/search';

/**
 * A test user in the Clerk development instance. Clerk's `+clerk_test`
 * convention means no real inbox and NO PASSWORD is ever needed or stored —
 * sign-in goes through a backend-issued ticket.
 */
const TEST_EMAIL = process.env.CLERK_TEST_EMAIL || '';

test.describe('critical action: global.authentication', () => {
  test('the route inventory agrees with what the middleware protects', () => {
    // Cheap, but it is the premise every other test here rests on: if the
    // protected routes below were public, the suite would pass while proving
    // nothing at all.
    expect(isPublicPath(PROTECTED_ROUTE), `${PROTECTED_ROUTE} must be protected`).toBe(false);
    expect(isPublicPath(DEEP_PROTECTED_ROUTE), `${DEEP_PROTECTED_ROUTE} must be protected`).toBe(false);
    expect(isPublicPath('/privacy'), '/privacy must stay public').toBe(true);
  });

  test('a signed-out visitor is sent to the identity surface with the intended return URL intact', async ({ page }) => {
    await setupClerkTestingToken({ page });

    const response = await page.goto(PROTECTED_ROUTE, { waitUntil: 'domcontentloaded' });
    expect(response, 'the protected route should respond').toBeTruthy();

    // Landing ON the protected route while signed out would mean it is not
    // protected. The visitor must end up somewhere else.
    await expect(page).not.toHaveURL(new RegExp(`${PROTECTED_ROUTE}$`));

    const landed = new URL(page.url());
    // "Uses the production identity surface": Clerk's own hosted sign-in, not
    // a homegrown form collecting credentials.
    expect(
      /clerk\.accounts\.dev$|\.clerk\.com$|\/sign-in/.test(`${landed.host}${landed.pathname}`),
      `expected the Clerk identity surface, got ${page.url()}`
    ).toBe(true);

    // "Preserves the exact intended return URL": the destination has to
    // survive, or the visitor signs in and lands somewhere they did not ask
    // for. Clerk carries it as redirect_url.
    const returnTarget = landed.searchParams.get('redirect_url') || '';
    expect(returnTarget, `no return URL was carried through: ${page.url()}`).toContain(PROTECTED_ROUTE);
  });

  test('a different protected destination carries its own return URL, not a shared default', async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto(DEEP_PROTECTED_ROUTE, { waitUntil: 'domcontentloaded' });

    const returnTarget = new URL(page.url()).searchParams.get('redirect_url') || '';
    // The point of the second route: a hard-coded "/dashboard" return would
    // satisfy the previous test while quietly discarding the real intent.
    expect(returnTarget, `expected ${DEEP_PROTECTED_ROUTE} to be preserved, got ${page.url()}`)
      .toContain(DEEP_PROTECTED_ROUTE);
  });

  test('signing in reaches the protected route, and signing out removes access again', async ({ page }) => {
    test.skip(!TEST_EMAIL, 'CLERK_TEST_EMAIL is not set — see docs/pending-keys-checklist.md');
    await setupClerkTestingToken({ page });

    // Clerk requires a loaded, unprotected page before its helpers run.
    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    await clerk.loaded({ page });
    await clerk.signIn({ page, emailAddress: TEST_EMAIL });

    await page.goto(PROTECTED_ROUTE, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`${PROTECTED_ROUTE}$`));
    await expect(page.getByRole('heading', { name: 'Overview Dashboard' })).toBeVisible({ timeout: 30_000 });

    await clerk.signOut({ page });

    // The claim that matters: access is genuinely revoked, not just hidden.
    // A fresh navigation must be bounced back to the identity surface.
    await page.goto(PROTECTED_ROUTE, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(new RegExp(`${PROTECTED_ROUTE}$`));
  });
});
