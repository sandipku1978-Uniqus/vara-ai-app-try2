import { expect, test, type Page } from '@playwright/test';
import {
  LOCAL_E2E_DOSSIER_ACCESSION,
  LOCAL_E2E_DOSSIER_CIK,
  LOCAL_E2E_DOSSIER_COMPANY,
} from '../../src/app/company/[ticker]/dossierE2eFixture';
import {
  DOSSIER_SOURCE_URL,
  DOSSIER_THREAD,
  DOSSIER_THREAD_ID,
  installCompanyDossierFixtures,
  type CompanyDossierFixtureOptions,
} from './company-dossier-fixtures';

const DOSSIER_PATH = `/company/${Number(LOCAL_E2E_DOSSIER_CIK)}`;
const FILING_LINK_NAME = 'View 10-K filed 2026-03-18 on SEC.gov';

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 },
  );
}

async function openDossier(page: Page, options: CompanyDossierFixtureOptions = {}) {
  const stats = await installCompanyDossierFixtures(page, options);
  await page.goto(DOSSIER_PATH, { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
  await expect(page.getByRole('heading', { name: LOCAL_E2E_DOSSIER_COMPANY })).toBeVisible({ timeout: 20_000 });
  return stats;
}

function dossierView(page: Page, name: 'Filings' | 'Comment Letters' | 'Financials') {
  return page.getByRole('group', { name: 'Issuer dossier view' }).getByRole('button', { name, exact: true });
}

function filingLink(page: Page) {
  return page.getByRole('link', { name: FILING_LINK_NAME, exact: true });
}

test.describe('company dossier action contracts', () => {
  test('company-dossier.navigate-breadcrumbs routes Home and Research without corrupting issuer identity', async ({ page }) => {
    await openDossier(page);

    let breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await breadcrumbs.getByRole('link', { name: 'Home', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/dashboard');

    await page.goto(DOSSIER_PATH, { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);
    await expect(page.getByRole('heading', { name: LOCAL_E2E_DOSSIER_COMPANY })).toBeVisible({ timeout: 20_000 });
    breadcrumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await breadcrumbs.getByRole('link', { name: 'Research', exact: true }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/search');
    await expect(page.getByRole('heading', { name: 'Research Workbench' })).toBeVisible({ timeout: 20_000 });
  });

  test('company-dossier.switch-view activates each issuer dataset and preserves resolved identity', async ({ page }) => {
    const stats = await openDossier(page);

    await expect(dossierView(page, 'Filings')).toHaveAttribute('aria-pressed', 'true');
    await expect(filingLink(page)).toBeVisible();

    await dossierView(page, 'Comment Letters').click();
    await expect(dossierView(page, 'Comment Letters')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: /Review episode/ })).toContainText(DOSSIER_THREAD.first_letter);
    await expect(page.getByRole('heading', { name: LOCAL_E2E_DOSSIER_COMPANY })).toBeVisible();

    await dossierView(page, 'Financials').click();
    await expect(dossierView(page, 'Financials')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Fiscal year 2025 · from XBRL company facts (amounts as reported)', { exact: true })).toBeVisible();
    await expect(page.getByRole('row', { name: /Revenue/ })).toContainText('$1.3B');
    await expect(page.getByRole('heading', { name: LOCAL_E2E_DOSSIER_COMPANY })).toBeVisible();

    await dossierView(page, 'Filings').click();
    await expect(filingLink(page)).toHaveAttribute('href', DOSSIER_SOURCE_URL);
    expect(stats.letterRequests).toHaveLength(1);
    expect(stats.factsRequests).toHaveLength(1);
  });

  test('company-dossier.open-filing-source opens the exact SEC document in a separate tab', async ({ page }) => {
    const stats = await openDossier(page);
    const source = filingLink(page);
    await expect(source).toHaveAttribute('href', DOSSIER_SOURCE_URL);
    await expect(source).toHaveAttribute('target', '_blank');
    await expect(source).toHaveAttribute('rel', /noopener/);

    const popupPromise = page.waitForEvent('popup');
    await source.click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup).toHaveURL(DOSSIER_SOURCE_URL);
    await expect(popup.getByText(`Exact filing fixture: ${LOCAL_E2E_DOSSIER_ACCESSION}`)).toBeVisible();
    expect(stats.filingSourceRequests).toEqual([DOSSIER_SOURCE_URL]);
    await popup.close();
  });

  test('company-dossier.open-comment-thread carries the exact issuer and episode identity', async ({ page }) => {
    await openDossier(page);
    await dossierView(page, 'Comment Letters').click();

    const episode = page.getByRole('link', { name: /Review episode/ });
    await expect(episode).toBeVisible({ timeout: 20_000 });
    await episode.click();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/comment-letters');
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return { company: params.get('company'), thread: params.get('thread') };
    }).toEqual({ company: LOCAL_E2E_DOSSIER_COMPANY, thread: DOSSIER_THREAD_ID });
  });

  test('company-dossier.retry-dataset retries only comment-letter history and preserves filing identity', async ({ page }) => {
    const stats = await openDossier(page, { letterFailuresBeforeSuccess: 1 });
    await dossierView(page, 'Comment Letters').click();

    const retry = page.getByRole('button', { name: 'Retry comment-letter history' });
    await expect(page.getByRole('alert').filter({ hasText: 'comment-letter corpus' })).toContainText('could not be loaded', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: LOCAL_E2E_DOSSIER_COMPANY })).toBeVisible();
    await retry.click();
    await expect(page.getByRole('link', { name: /Review episode/ })).toContainText(DOSSIER_THREAD.last_letter);
    expect(stats.letterRequests).toHaveLength(2);
    expect(stats.factsRequests).toHaveLength(0);

    await dossierView(page, 'Filings').click();
    await expect(filingLink(page)).toHaveAttribute('href', DOSSIER_SOURCE_URL);
  });

  test('company-dossier.retry-dataset retries only XBRL facts and preserves loaded comment history', async ({ page }) => {
    const stats = await openDossier(page, { factsFailuresBeforeSuccess: 1 });
    await dossierView(page, 'Comment Letters').click();
    await expect(page.getByRole('link', { name: /Review episode/ })).toContainText(DOSSIER_THREAD.first_letter);
    expect(stats.letterRequests).toHaveLength(1);

    await dossierView(page, 'Financials').click();
    const retry = page.getByRole('button', { name: 'Retry XBRL company facts' });
    await expect(page.getByRole('alert').filter({ hasText: 'XBRL company-facts' })).toContainText('request failed', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: LOCAL_E2E_DOSSIER_COMPANY })).toBeVisible();
    await retry.click();
    await expect(page.getByRole('row', { name: /Revenue/ })).toContainText('$1.3B');
    expect(stats.factsRequests).toHaveLength(2);

    await dossierView(page, 'Comment Letters').click();
    await expect(page.getByRole('link', { name: /Review episode/ })).toContainText(DOSSIER_THREAD.last_letter);
    expect(stats.letterRequests).toHaveLength(1);
    await expect(page.getByRole('heading', { name: LOCAL_E2E_DOSSIER_COMPANY })).toBeVisible();
  });
});
