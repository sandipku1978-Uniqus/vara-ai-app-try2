import { expect, test } from '@playwright/test';
import { clerk, setupClerkTestingToken } from '@clerk/testing/playwright';
// PUBLIC_PAGE_PATHS, not isPublicPath from src/proxy: proxy.ts imports
// next/server, which resolves under Next's bundler but NOT under Playwright's
// loader — importing it makes the whole spec file fail to load, and Playwright
// reports the far less obvious "No tests found". This module is plain data.
import { PUBLIC_PAGE_PATHS } from '../../src/config/routes';

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
    const publicPaths: readonly string[] = PUBLIC_PAGE_PATHS;
    expect(publicPaths.includes(PROTECTED_ROUTE), `${PROTECTED_ROUTE} must be protected`).toBe(false);
    expect(publicPaths.includes(DEEP_PROTECTED_ROUTE), `${DEEP_PROTECTED_ROUTE} must be protected`).toBe(false);
    expect(publicPaths.includes('/privacy'), '/privacy must stay public').toBe(true);
  });

  /**
   * Clerk carries the return target in two places. The middleware redirect
   * puts it in the query string (?redirect_url=…); the hosted Account Portal
   * URL that clerk-js builds for <SignInButton> puts it in the FRAGMENT
   * (#/?redirect_url=…) — read straight from clerk-js's URL builder, which
   * assembles `hashSearchParams` for redirect_url and leaves only the dev
   * session token (__clerk_db_jwt) in the query. Reading searchParams alone
   * reported "no target" for a flow that always carried one.
   */
  function clerkReturnTarget(url: string): string {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get('redirect_url');
    if (fromQuery) return fromQuery;
    const fragment = parsed.hash.replace(/^#/, '');
    const fragmentQuery = fragment.includes('?') ? fragment.slice(fragment.indexOf('?') + 1) : '';
    return new URLSearchParams(fragmentQuery).get('redirect_url') || '';
  }

  test('public Sign In and Get Started controls open Clerk identity surfaces with their return target', async ({ page }) => {
    await setupClerkTestingToken({ page });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await clerk.loaded({ page });
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect.poll(() => page.url()).toMatch(/clerk\.accounts\.dev|\.clerk\.com|\/sign-in/);
    const signInTarget = clerkReturnTarget(page.url());
    expect(signInTarget, `Sign In did not retain the application target: ${page.url()}`).toContain('/');

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await clerk.loaded({ page });
    await page.getByRole('button', { name: 'Get Started', exact: true }).click();
    await expect.poll(() => page.url()).toMatch(/clerk\.accounts\.dev|\.clerk\.com|\/sign-up/);
    const signUpTarget = clerkReturnTarget(page.url());
    expect(signUpTarget, `Get Started did not retain the application target: ${page.url()}`).toContain('/');
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
    await setupClerkTestingToken({ page });

    // Clerk requires a loaded, unprotected page before its helpers run.
    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    await clerk.loaded({ page });
    await clerk.signIn({ page, emailAddress: TEST_EMAIL });

    await page.goto(PROTECTED_ROUTE, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`${PROTECTED_ROUTE}$`));
    await expect(page.getByRole('heading', { name: 'Overview Dashboard' })).toBeVisible({ timeout: 30_000 });

    // Clerk's UserButton trigger is labelled "Open user menu" today ("Open user
    // button" in older releases); accept either so a label change in the
    // hosted UI bundle cannot masquerade as a sign-out regression.
    await page.getByRole('button', { name: /^Open user (menu|button)$/ }).click();
    // The account panel is a dialog ("Account panel") whose actions are plain
    // buttons, not menu items; the run's page snapshot showed two unnamed
    // buttons in the "Account actions" group. Match the action by its
    // accessible name when Clerk exposes one, else by Clerk's stable
    // sign-out action class.
    const accountPanel = page.getByRole('dialog', { name: 'Account panel' });
    await expect(accountPanel).toBeVisible({ timeout: 10_000 });
    await accountPanel
      .getByRole('button', { name: /sign out/i })
      .or(accountPanel.locator('.cl-userButtonPopoverActionButton__signOut'))
      .first()
      .click();

    // The claim that matters: access is genuinely revoked, not just hidden.
    // A fresh navigation must be bounced back to the identity surface.
    await page.goto(PROTECTED_ROUTE, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(new RegExp(`${PROTECTED_ROUTE}$`));
  });
});

/**
 * These two live here rather than with the other support-center coverage for
 * one reason: both contracts end in "requesting sign-in if required", and that
 * clause is unobservable in the main suite because its webServer bypasses
 * auth. This harness is the only place the requirement is real.
 */
test.describe('support-center routes that require sign-in', () => {
  test('support-center.open-summary-route opens the product route, not a documentation placeholder', async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto('/support', { waitUntil: 'domcontentloaded' });

    const card = page.getByRole('button', { name: /Benchmark peers/i });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.click();

    // /compare is protected, so a signed-out visitor is sent to sign in — but
    // carrying /compare, which is what makes this "the corresponding working
    // product route" rather than a documentation page.
    await expect(page).not.toHaveURL(/\/support$/);
    const target = new URL(page.url());
    const carried = target.searchParams.get('redirect_url') || target.pathname;
    expect(carried, `expected /compare to be the destination, got ${page.url()}`).toContain('/compare');
  });

  test('support-center.open-feature-route opens the exact route named by the link', async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto('/support', { waitUntil: 'domcontentloaded' });

    const link = page.locator('a.platform-link').first();
    await expect(link).toBeVisible({ timeout: 20_000 });
    const href = (await link.getAttribute('href')) || '';
    expect(href, 'the feature link must name a route').toMatch(/^\//);
    await link.click();

    // Wait for the navigation to actually settle before reading the URL.
    // These links call router.push() from an onClick handler, so the address
    // does not change synchronously with the click — reading page.url()
    // immediately races the client-side navigation and sees /support.
    await expect(page).not.toHaveURL(/\/support$/, { timeout: 20_000 });

    // "The EXACT product route described by the link": a link that sends the
    // reader somewhere adjacent is the failure this catches.
    const landed = new URL(page.url());
    const carried = landed.searchParams.get('redirect_url') || landed.pathname;
    expect(carried, `link said ${href} but landed on ${page.url()}`).toContain(href);
  });
});
