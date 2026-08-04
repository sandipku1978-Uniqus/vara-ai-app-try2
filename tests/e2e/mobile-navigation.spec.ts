import { expect, test, type Locator, type Page } from '@playwright/test';
import { installBooleanFixtures } from './boolean-fixtures';
import { installWatchlistFixtures } from './watchlist-fixtures';

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

async function expectFocusReturned(trigger: Locator) {
  await expect(trigger).toHaveAccessibleName('Open navigation');
  await expect(trigger).toBeFocused();
}

test('global.mobile-navigation traps focus, inerts the page, and restores focus after every close path', async ({ page }) => {
  await installBooleanFixtures(page);
  await installWatchlistFixtures(page);
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);

  // CSS identity stays stable while the accessible name correctly changes
  // from Open to Close. A role locator keyed to the old name stops matching
  // as soon as the drawer opens.
  const trigger = page.locator('.mobile-menu-btn');
  const drawer = page.locator('#primary-navigation');
  const main = page.locator('.main-content');
  const memoTrigger = page.locator('.memo-tray-trigger');
  await expect(memoTrigger).toBeVisible();

  const openAndAssertModalState = async () => {
    await trigger.click();
    await expect(page.getByRole('dialog', { name: 'Primary navigation' })).toBeVisible();
    await expect(drawer).toHaveAttribute('aria-modal', 'true');
    // The trigger sits inside the now-inert background, so it intentionally
    // has no name in the accessibility tree while the drawer is modal. Its
    // DOM label still tracks the state for when the page becomes active again.
    await expect(trigger).toHaveAttribute('aria-label', 'Close navigation');
    await expect(main).toHaveAttribute('inert', '');
    await expect(main).toHaveAttribute('aria-hidden', 'true');
    // The fixed memo trigger used to remain an interactive sibling behind the
    // overlay. It stays mounted, but the modal background subtree removes it
    // from both sequential focus and the accessibility tree.
    await expect(memoTrigger).toBeVisible();
    await expect(page.getByRole('button', { name: /Open memo tray/ })).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  };

  // Focus cannot Tab out of the drawer and into the inert page behind it.
  await openAndAssertModalState();
  const visibleFocusable = drawer.locator('a[href], button:not([disabled])').filter({ visible: true });
  await visibleFocusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(visibleFocusable.first()).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(drawer).not.toBeVisible();
  await expectFocusReturned(trigger);
  await expect(page.getByRole('button', { name: /Open memo tray/ })).toBeVisible();

  await openAndAssertModalState();
  await drawer.getByRole('button', { name: 'Close navigation' }).click();
  await expect(drawer).not.toBeVisible();
  await expectFocusReturned(trigger);

  await openAndAssertModalState();
  await page.locator('.mobile-nav-overlay').click({ position: { x: 380, y: 100 } });
  await expect(drawer).not.toBeVisible();
  await expectFocusReturned(trigger);
});
