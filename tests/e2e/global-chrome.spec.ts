import { expect, test, type Page } from '@playwright/test';
import { FILINGS, installBooleanFixtures } from './boolean-fixtures';
import { installWatchlistFixtures } from './watchlist-fixtures';

/**
 * Critical-action archetype: the persistent application chrome (WP8 burn-down).
 *
 * Four global contracts share one surface — src/components/layout/Layout.tsx —
 * and one failure mode, so they share one archetype:
 *
 *   global.sidebar-navigation   "marks that route current"
 *   global.sidebar-collapse     "without hiding navigation from assistive technology"
 *   global.breadcrumb-navigation "the current location is exposed as the current page"
 *   global.theme-preference     "the control describes the next action accurately"
 *
 * Every one of them is a claim about state a sighted user reads off pixels —
 * a highlighted nav row, a bolder final crumb, a sun or moon glyph. Each was
 * signalled ONLY in pixels: the active nav link carried a CSS class named
 * `active` and nothing else, and the final breadcrumb was a bolder `<span>`.
 * A CSS class is not a state; `aria-current` is. This is the same defect class
 * as the contextless source-link names that external-source-links.spec.ts
 * pins down.
 *
 * These four need no SEC data: they are pure chrome, driven by the pathname,
 * `document.documentElement.dataset.theme`, and browser-local preferences.
 */

const BOTH = FILINGS[2];

/**
 * The sidebar is an <aside> (role complementary), so its destinations cannot be
 * addressed as "the links inside the primary navigation landmark", and the
 * brand logo is a link inside it too. `.nav-item` is the sidebar's own name for
 * "a destination in the primary sidebar", which is exactly the set the contract
 * names.
 */
const NAV_ITEMS = '#primary-navigation a.nav-item';

interface Destination {
  href: string;
  name: string;
  tag: string;
}

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

/** Every destination the primary sidebar offers, in the order it offers them. */
async function collectDestinations(page: Page): Promise<Destination[]> {
  return page.$$eval(NAV_ITEMS, links =>
    links.map(link => ({
      href: link.getAttribute('href') || '',
      // These rows are an icon plus a text span, so the author-supplied
      // aria-label is the accessible name — and the only name left once the
      // sidebar collapses and the span is display:none.
      name: (link.getAttribute('aria-label') || link.textContent || '').replace(/\s+/g, ' ').trim(),
      tag: link.tagName,
    }))
  );
}

function urlEndingIn(path: string): RegExp {
  return new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

test.describe('critical action: global application chrome', () => {
  test('global.sidebar-navigation opens each destination and marks it as the current page', async ({ page }) => {
    // One client-side transition per destination; the sidebar is the assertion
    // target, so page data does not have to settle, but 19 routes still need
    // more than the 45s default.
    test.setTimeout(240_000);

    await page.goto('/dashboard');
    await waitForIdentity(page);
    await expect(page.locator(NAV_ITEMS).first()).toBeVisible({ timeout: 20_000 });

    const destinations = await collectDestinations(page);
    expect(destinations.length, 'the primary sidebar rendered no destinations to activate').toBeGreaterThan(10);

    for (const destination of destinations) {
      // "Preserves normal link behaviors such as opening in a new tab" is a
      // property of the MECHANISM: a real anchor with a real in-app href gets
      // middle-click, modifier-click, and "copy link address" for free, and a
      // click handler dressed as a link gets none of them.
      expect(destination.tag, `sidebar destination "${destination.name}" is a <${destination.tag.toLowerCase()}>, not a link`).toBe('A');
      expect(destination.href, `sidebar destination "${destination.name}" has no in-app href`).toMatch(/^\/\w/);
      expect(destination.name.length, `sidebar destination ${destination.href} has no usable accessible name`).toBeGreaterThan(2);
    }

    // Destinations a listener cannot tell apart are not navigable by name.
    const names = destinations.map(d => d.name.toLowerCase());
    expect([...new Set(names.filter((name, i) => names.indexOf(name) !== i))], 'sidebar destinations share an accessible name').toEqual([]);

    for (const destination of destinations) {
      const link = page.locator(`${NAV_ITEMS}[href="${destination.href}"]`);
      await link.click();
      await expect(page, `"${destination.name}" did not open ${destination.href}`).toHaveURL(urlEndingIn(destination.href));

      // The contract's teeth: the route is MARKED current, not merely painted
      // current. A CSS class named `active` is invisible to a screen reader.
      await expect(
        link,
        `"${destination.name}" opened ${destination.href} without marking it the current page`
      ).toHaveAttribute('aria-current', 'page');

      // ...and marked exactly once, or "current" identifies nothing.
      await expect(
        page.locator('#primary-navigation [aria-current="page"]'),
        `${destination.href}: the sidebar reports more or fewer than one current destination`
      ).toHaveCount(1);
    }

    // Prove the mechanism claim above rather than only inspecting it: a real
    // link opens a new tab and leaves the current research state in place.
    // This runs after nineteen client-side transitions; the link must be
    // settled before the modifier-click, and a new tab on a loaded runner can
    // take longer than the default 10s event wait (the one flake this test
    // produced on main was exactly that timeout, on retry it passed).
    const current = page.url();
    const searchLink = page.locator(`${NAV_ITEMS}[href="/search"]`);
    await expect(searchLink).toBeVisible();
    await searchLink.scrollIntoViewIfNeeded();
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 30_000 }),
      searchLink.click({ modifiers: ['ControlOrMeta'] }),
    ]);
    // A freshly opened tab reports about:blank until the navigation commits.
    await popup.waitForURL(urlEndingIn('/search'), { timeout: 30_000 });
    await popup.close();
    expect(page.url(), 'modifier-click navigated the original tab as well').toBe(current);
  });

  test('global.sidebar-collapse changes density only, and the preference outlives navigation and reload', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForIdentity(page);
    await expect(page.locator(NAV_ITEMS).first()).toBeVisible({ timeout: 20_000 });

    const expanded = await collectDestinations(page);
    expect(expanded.length).toBeGreaterThan(10);

    const collapseControl = () => page.getByRole('button', { name: 'Collapse side navigation' }).filter({ visible: true });
    const expandControl = () => page.getByRole('button', { name: 'Expand side navigation' }).filter({ visible: true });

    await expect(collapseControl()).toHaveCount(1);
    await collapseControl().click();

    // The control names what it will do next, not the state it just produced.
    await expect(collapseControl(), 'the collapse control still offers to collapse an already-collapsed sidebar').toHaveCount(0);
    await expect(expandControl().first()).toBeVisible();

    // Density, not removal: collapsing hides the label TEXT, so the accessible
    // name has to survive on the link itself or the entire product navigation
    // disappears for anyone not reading pixels.
    const collapsed = await collectDestinations(page);
    expect(collapsed.map(d => `${d.name} -> ${d.href}`)).toEqual(expanded.map(d => `${d.name} -> ${d.href}`));
    const unreachable = await page.$$eval(NAV_ITEMS, links =>
      links
        .filter(link => {
          const box = link.getBoundingClientRect();
          return box.width === 0 || box.height === 0;
        })
        .map(link => link.getAttribute('href') || '')
    );
    expect(unreachable, 'collapsing the sidebar took these destinations out of reach').toEqual([]);

    // Survives a navigation...
    await page.locator(`${NAV_ITEMS}[href="/search"]`).click();
    await expect(page).toHaveURL(urlEndingIn('/search'));
    await expect(expandControl().first(), 'the sidebar re-expanded on navigation').toBeVisible();

    // ...and a reload.
    await page.reload();
    await waitForIdentity(page);
    await expect(expandControl().first(), 'the collapsed preference did not survive reload').toBeVisible();
    await expect(page.locator(NAV_ITEMS)).toHaveCount(expanded.length);

    // Expanding is equally durable, so the preference is remembered rather
    // than merely defaulting to collapsed.
    await expandControl().first().click();
    await expect(collapseControl()).toHaveCount(1);
    await page.reload();
    await waitForIdentity(page);
    await expect(collapseControl(), 'the expanded preference did not survive reload').toHaveCount(1);
  });

  test('global.breadcrumb-navigation exposes the current location and reaches its ancestors', async ({ page }) => {
    await installBooleanFixtures(page);

    // The filing workspace is the one trail with a LINKED ancestor between Home
    // and the current page, and the fixtures keep it off the live SEC corpus.
    await page.goto(`/filing/${Number(BOTH.cik)}_${BOTH.accession}_${BOTH.document}`);
    await waitForIdentity(page);

    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(trail).toBeVisible({ timeout: 20_000 });

    const currentCrumb = trail.locator('[aria-current="page"]');
    await expect(currentCrumb, 'the breadcrumb trail exposes no current page').toHaveCount(1);
    await expect(currentCrumb).toHaveText('Filing viewer');
    // Where you already are is not a destination.
    await expect(trail.getByRole('link', { name: 'Filing viewer' })).toHaveCount(0);

    // "Visitor-appropriate" is one rule with two implementations — the trail
    // and the brand logo — and they must not drift apart.
    const homeHref = await trail.getByRole('link', { name: 'Home' }).getAttribute('href');
    const logoHref = await page.locator('.sidebar-logo-link').getAttribute('href');
    expect(homeHref, 'breadcrumb Home and the brand logo disagree about where home is').toBe(logoHref);

    await trail.getByRole('link', { name: 'Research' }).click();
    await expect(page, 'the linked breadcrumb ancestor did not reach the research workbench').toHaveURL(urlEndingIn('/search'));

    // A product route's trail ends in the route's own name, and that end is
    // the current page too.
    await page.goto('/comment-letters');
    await waitForIdentity(page);
    await expect(trail.locator('[aria-current="page"]')).toHaveText('Comment Letters');

    await trail.getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(urlEndingIn(homeHref || '/'));
  });

  test('global.theme-preference applies immediately, names the next appearance, and survives reload', async ({ page }) => {
    await page.goto('/dashboard');
    await waitForIdentity(page);

    // The control's own copy names the DESTINATION appearance, so "Dark mode"
    // means "go dark", not "you are dark". Its explanatory subtext is hidden
    // below 1280px wide or 820px tall — which includes this suite's viewport —
    // so the announced name really is just the destination, and the title is
    // the long form. Before hydration the name reads "Theme", which this
    // pattern deliberately does not match.
    const toggle = () => page.getByRole('banner').getByRole('button', { name: /^(Light|Dark) mode$/ });
    await expect(toggle()).toBeVisible({ timeout: 20_000 });

    const appliedTheme = () => page.evaluate(() => document.documentElement.dataset.theme || '');
    const before = await appliedTheme();
    expect(['light', 'dark'], 'no theme is applied to the document').toContain(before);
    const after = before === 'dark' ? 'light' : 'dark';
    const named = (theme: string) => `${theme[0].toUpperCase()}${theme.slice(1)} mode`;

    // Names the NEXT action, not the current state — a control announced as
    // "Dark mode" while the app is already dark is a lie either way round.
    await expect(toggle()).toHaveAccessibleName(named(after));
    await expect(toggle()).toHaveAttribute('title', `Switch to ${after} mode`);

    await toggle().click();

    await expect.poll(appliedTheme, { message: 'the document theme did not change immediately' }).toBe(after);
    await expect(page.locator('html')).toHaveCSS('color-scheme', after);
    await expect(toggle(), 'the control still offers the appearance the app is already in').toHaveAccessibleName(named(before));
    await expect(toggle()).toHaveAttribute('title', `Switch to ${before} mode`);

    await page.reload();
    await waitForIdentity(page);

    await expect.poll(appliedTheme, { message: 'the chosen theme did not survive reload' }).toBe(after);
    await expect(toggle(), 'the reloaded control misnames the next appearance').toHaveAccessibleName(named(before));
    await expect(toggle()).toHaveAttribute('title', `Switch to ${before} mode`);
  });

  test('global.quick-find filters, keyboard-selects one route, and restores focus on Escape', async ({ page }) => {
    await installBooleanFixtures(page);
    await installWatchlistFixtures(page);
    await page.goto('/dashboard');
    await waitForIdentity(page);

    const opener = page.getByRole('button', { name: 'Open quick navigation and search' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Quick navigation and filing search' });
    const input = page.getByRole('combobox', { name: 'Quick navigation search' });
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();

    await input.fill('Accounting Analytics');
    const analytics = page.getByRole('option', { name: /^Accounting Analytics Go to/ });
    await expect(analytics).toBeVisible();
    await expect(page.getByRole('option', { name: /Research Workbench/ })).toHaveCount(0);

    // There is also an explicit "search filings for" option. Move to it and
    // back to prove Arrow navigation updates the active descendant, then open
    // the highlighted product route with Enter.
    await input.press('ArrowDown');
    await expect(page.getByRole('option', { name: /Search filings for/ })).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowUp');
    await expect(analytics).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(page).toHaveURL(urlEndingIn('/accounting-analytics'));

    // The keyboard shortcut opens the same labelled dialog. Escape closes it
    // and returns focus to whichever control opened it most recently.
    const routeOpener = page.getByRole('button', { name: 'Open quick navigation and search' });
    await routeOpener.focus();
    await page.keyboard.press('ControlOrMeta+K');
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(routeOpener).toBeFocused();
  });
});
