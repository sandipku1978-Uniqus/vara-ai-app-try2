import type { Page, Route } from '@playwright/test';
import { buildCompleteSecCompanyDirectory } from './sec-company-directory-fixture';

export const COMPANY_DIRECTORY = buildCompleteSecCompanyDirectory([
  { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corporation' },
  { cik_str: 1652044, ticker: 'GOOGL', title: 'Alphabet Inc.' },
  { cik_str: 1018724, ticker: 'AMZN', title: 'Amazon.com, Inc.' },
]);

export const SIC_DIRECTORY_HTML = `<!doctype html>
<html><body><table><tbody>
  <tr><th>SIC</th><th>Office</th><th>Industry title</th></tr>
  <tr><td>2834</td><td>Office of Life Sciences</td><td>Pharmaceutical Preparations</td></tr>
  <tr><td>3571</td><td>Office of Technology</td><td>Electronic Computers</td></tr>
  <tr><td>7372</td><td>Office of Technology</td><td>Prepackaged Software</td></tr>
</tbody></table></body></html>`;

export function adviserPayload(
  prefix: string,
  count: number,
  total = count,
  options: { descending?: boolean } = {}
) {
  const indexes = Array.from({ length: count }, (_, index) => index + 1);
  if (options.descending) indexes.reverse();
  return {
    hits: {
      total,
      hits: indexes.map(index => ({
        _source: {
          firm_source_id: String(70_000 + index),
          firm_ia_full_sec_number: `801-${String(index).padStart(5, '0')}`,
          firm_name: `${prefix} ${String(index).padStart(2, '0')}`,
          firm_ia_scope: index % 2 === 0 ? 'SEC registered' : 'State registered',
          firm_ia_disclosure_fl: index % 3 === 0 ? 'Y' : 'N',
          firm_ia_address_details: JSON.stringify({
            officeAddress: { city: `City ${index}`, state: 'CA', country: 'United States' },
          }),
        },
      })),
    },
  };
}

export async function fulfillAdviserPayload(
  route: Route,
  prefix: string,
  count: number,
  total = count,
  options: { descending?: boolean } = {}
) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(adviserPayload(prefix, count, total, options)),
  });
}

/**
 * Install the two official directories used by all four lookup archetypes.
 * Search endpoints are answered empty so opening a specialist page never
 * reaches live EDGAR while the test is exercising only its combobox.
 */
export async function installLookupFixtures(page: Page) {
  await page.route('**/api/sec-proxy**', async route => {
    const path = new URL(route.request().url()).searchParams.get('path') || '';
    if (path.includes('company_tickers.json')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(COMPANY_DIRECTORY),
      });
      return;
    }
    if (path.includes('standard-industrial-classification-sic-code-list')) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: SIC_DIRECTORY_HTML });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/sec-efts**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hits: { total: { value: 0, relation: 'eq' }, hits: [] } }),
    });
  });
  await page.route('**/api/es-search**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hits: { total: { value: 0, relation: 'eq' }, hits: [] } }),
    });
  });
  await page.route('**/api/enrich**', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ companies: {} }) });
  });
}

export const COMMENT_LETTER = {
  accession: '0000000900-26-000900',
  cik: 900,
  company_name: 'Evidence Ledger Industries',
  form: 'UPLOAD',
  date_filed: '2026-03-04',
  thread_id: 'thread-evidence-ledger-1',
  filename: 'edgar/data/900/0000000900-26-000900.txt',
  headline: 'The Staff requested support for <b>revenue recognition</b> judgments.',
  rank: 0.97,
};

export async function installCopilotFixtures(page: Page) {
  await page.route('**/api/letters**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 1, matches: [COMMENT_LETTER] }),
      });
      return;
    }
    if (url.searchParams.get('thread')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ thread: COMMENT_LETTER.thread_id, letters: [COMMENT_LETTER] }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total: 0, threads: [], letters: [] }),
    });
  });

  await page.route('**/api/stream', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ text: 'The result is grounded in the cited SEC evidence packet.' }),
    });
  });
}
