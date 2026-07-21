import { expect, test, type Page } from '@playwright/test';
import { LANDING_ROUTE_CONTRACT, PUBLIC_ROUTE_CONTRACTS } from './route-contracts';

function intendedPathFromAuthRedirect(url: URL): string | null {
  for (const key of ['redirect_url', 'redirectUrl', 'return_url', 'returnUrl']) {
    const raw = url.searchParams.get(key);
    if (!raw) continue;
    try {
      return new URL(raw, url).pathname;
    } catch {
      return raw.startsWith('/') ? raw.split(/[?#]/)[0] : null;
    }
  }
  return null;
}

async function expectIntendedDestination(page: Page, expectedPath: string) {
  await expect.poll(() => {
    const current = new URL(page.url());
    if (current.pathname === expectedPath) return expectedPath;
    return intendedPathFromAuthRedirect(current);
  }, {
    message: `the action should reach ${expectedPath}, or an authentication gate that preserves ${expectedPath}`,
    timeout: 15_000,
  }).toBe(expectedPath);
}

async function clickFromHome(page: Page, name: string | RegExp, expectedPath: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: LANDING_ROUTE_CONTRACT.heading })).toBeVisible();
  await page.getByRole('button', { name, exact: typeof name === 'string' }).click();
  await expectIntendedDestination(page, expectedPath);
}

test.describe('neutral visitor: public information contract', () => {
  for (const contract of PUBLIC_ROUTE_CONTRACTS) {
    test(`${contract.path} is available without an account`, async ({ page }) => {
      const response = await page.goto(contract.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBeLessThan(400);
      await expect(page.getByRole('heading', {
        level: contract.headingLevel,
        name: contract.heading,
      })).toBeVisible();
    });
  }

  test('landing page explains product scope, source, and illustrative content', async ({ page }) => {
    await page.goto('/');
    const app = page.locator('#root');
    await expect(page.getByRole('heading', { level: 1, name: LANDING_ROUTE_CONTRACT.heading })).toBeVisible();
    await expect(app.getByText(/live EDGAR discovery/i)).toBeVisible();
    await expect(app.getByText(/Illustrative Research Workbench/i)).toBeAttached();
    await expect(app.getByRole('link', { name: 'Support' })).toBeVisible();
    await expect(app.getByRole('link', { name: 'Privacy' })).toBeVisible();
    await expect(app.getByRole('link', { name: 'Terms' })).toBeVisible();
  });

  test('hero search carries the visitor query into research', async ({ page }) => {
    await page.goto('/');
    const app = page.locator('#root');
    const search = app.getByPlaceholder(/Search filings, risk factors/i);
    await search.fill('cybersecurity risk factors');
    await app.getByRole('button', { name: 'Start Research', exact: true }).click();
    await expectIntendedDestination(page, '/search');

    const current = new URL(page.url());
    if (current.pathname === '/search') {
      expect(current.searchParams.get('q')).toBe('cybersecurity risk factors');
    } else {
      const redirect = current.searchParams.get('redirect_url') || current.searchParams.get('redirectUrl') || '';
      expect(decodeURIComponent(redirect)).toContain('q=cybersecurity');
    }
  });

  test('coverage control scrolls to the promised section', async ({ page }) => {
    await page.goto('/');
    const app = page.locator('#root');
    const coverage = app.locator('#landing-capabilities');
    await page.getByRole('button', { name: 'See what it covers' }).click();
    await expect(coverage).toBeInViewport({ ratio: 0.25 });
  });

  const landingActions = [
    ['Open Research', '/search'],
    ['See Benchmarking', '/compare'],
    ['Explore Governance', '/esg'],
    ['Review Specialty Tools', '/regulation'],
    ['Open Support Center', '/support'],
    ['Open Research Workbench', '/search'],
    ['Go to Dashboard', '/dashboard'],
    ['Open IPO Center', '/ipo'],
  ] as const;

  for (const [buttonName, expectedPath] of landingActions) {
    test(`landing action "${buttonName}" has a meaningful destination`, async ({ page }) => {
      await clickFromHome(page, buttonName, expectedPath);
    });
  }

  for (const [linkName, expectedPath, expectedHeading] of [
    ['Support', '/support', /^Learn the URC workflow quickly$/],
    ['Privacy', '/privacy', /^Privacy and data use$/],
    ['Terms', '/terms', /^Terms of use$/],
  ] as const) {
    test(`footer link "${linkName}" opens the correct public page`, async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: linkName, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${expectedPath.replace('/', '\\/')}/?(?:[?#].*)?$`));
      await expect(page.getByRole('heading', { level: 1, name: expectedHeading })).toBeVisible();
    });
  }
});

test.describe('neutral visitor: responsive first impression', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('landing page remains readable and operable on a phone viewport', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: LANDING_ROUTE_CONTRACT.heading })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Research', exact: true })).toBeVisible();

    const measurements = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      unnamedVisibleControls: Array.from(document.querySelectorAll('a[href], button, input, select, textarea'))
        .filter(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        })
        .filter(element => {
          const ariaLabel = element.getAttribute('aria-label')?.trim();
          const text = element.textContent?.replace(/\s+/g, ' ').trim();
          const labels = 'labels' in element
            ? Array.from((element as HTMLInputElement).labels || []).map(label => label.textContent || '').join(' ').trim()
            : '';
          return !ariaLabel && !text && !labels && !element.getAttribute('title');
        })
        .map(element => element.outerHTML.slice(0, 240)),
    }));

    await testInfo.attach('mobile-first-impression.json', {
      body: Buffer.from(JSON.stringify(measurements, null, 2)),
      contentType: 'application/json',
    });
    expect(measurements.documentWidth - measurements.viewportWidth, 'mobile landing page should not scroll horizontally').toBeLessThanOrEqual(2);
    expect(measurements.unnamedVisibleControls, 'mobile landing controls need accessible names').toEqual([]);
  });
});
