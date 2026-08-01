import { expect, test, type Page } from '@playwright/test';
import {
  DYNAMIC_ROUTE_CONTRACTS,
  INTERNAL_ROUTE_CONTRACT,
  STATIC_ROUTE_CONTRACTS,
  type RouteContract,
} from './route-contracts';

const publicOnly = process.env.QA_PUBLIC_ONLY === '1';

async function openContract(page: Page, contract: RouteContract) {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const response = await page.goto(contract.path, {
    waitUntil: 'domcontentloaded',
    timeout: contract.note ? 60_000 : 30_000,
  });
  expect(response, `${contract.path} should produce a document response`).not.toBeNull();
  expect(response?.status(), `${contract.path} should not be an HTTP error`).toBeLessThan(400);

  const heading = page.getByRole('heading', {
    level: contract.headingLevel,
    name: contract.heading,
  });
  await expect(heading, `${contract.path} should render its route-specific heading`).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-nextjs-error-page', 'true');
  expect(pageErrors, `${contract.path} raised an uncaught browser exception`).toEqual([]);
}

test.describe('static product route smoke contracts', () => {
  for (const contract of STATIC_ROUTE_CONTRACTS) {
    test(`${contract.path} renders the intended page`, async ({ page }) => {
      test.skip(publicOnly && !contract.public, 'QA_PUBLIC_ONLY excludes authenticated product routes.');
      await openContract(page, contract);
    });
  }
});

test.describe('representative dynamic route smoke contracts', () => {
  test.describe.configure({ timeout: 75_000 });

  for (const contract of DYNAMIC_ROUTE_CONTRACTS) {
    test(`${contract.path} renders a usable deep link`, async ({ page }) => {
      test.skip(publicOnly, 'QA_PUBLIC_ONLY excludes authenticated dynamic routes.');
      await openContract(page, contract);
    });
  }
});

test('the internal design gallery renders in dev and 404s in a production build', async ({ page }) => {
  test.skip(publicOnly, 'QA_PUBLIC_ONLY excludes the internal design gallery.');
  // The gallery carries fabricated filings wearing "verified" badges, so a
  // production build must never serve it (it calls notFound()). Any remote
  // QA_BASE_URL target and any PW_PROD_BUILD-managed server are production
  // builds; only the local dev server renders the gallery.
  const productionBuild = Boolean(process.env.QA_BASE_URL) || process.env.PW_PROD_BUILD === '1';
  if (productionBuild) {
    // The safety property is CONTENT, not status code: Next serves a
    // statically-generated notFound() as the not-found UI, sometimes with
    // HTTP 200. What must never appear is the gallery itself — fabricated
    // filings wearing "verified" badges.
    await page.goto(INTERNAL_ROUTE_CONTRACT.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Command bar' })).toHaveCount(0);
    await expect(page.getByText('Organon & Co.')).toHaveCount(0);
    return;
  }
  await openContract(page, INTERNAL_ROUTE_CONTRACT);
});
