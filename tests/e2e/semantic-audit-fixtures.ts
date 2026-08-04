import type { Page, Route } from '@playwright/test';
import { SEC_DOCUMENT_CSP } from '../../src/lib/sec-upstream';
import { buildCompleteSecCompanyDirectory } from './sec-company-directory-fixture';

const DATA_STATS = {
  filings: { count: 2_400_000, through: '2026-07-31', source: 'SEC EDGAR master index' },
  auditors: { count: 18_000, source: 'PCAOB Form AP' },
  letters: {
    count: 42_000,
    withText: 39_000,
    through: '2026-07-31',
    lastTextFetch: '2026-07-31T12:00:00.000Z',
    retryPending: 0,
    source: 'SEC EDGAR (UPLOAD/CORRESP)',
  },
};

const APPLE_SUBMISSIONS = {
  cik: '0000320193',
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  exchanges: ['Nasdaq'],
  ein: '',
  description: 'Deterministic semantic route audit issuer.',
  sic: '3571',
  sicDescription: 'Electronic Computers',
  entityType: 'operating',
  filings: {
    recent: {
      accessionNumber: ['0000320193-24-000123'],
      filingDate: ['2024-11-01'],
      reportDate: ['2024-09-28'],
      acceptanceDateTime: ['2024-11-01T06:01:36.000Z'],
      act: ['34'],
      form: ['10-K'],
      fileNumber: ['001-36743'],
      filmNumber: ['241414688'],
      items: [''],
      size: [12_400_000],
      isXBRL: [1],
      isInlineXBRL: [1],
      primaryDocument: ['aapl-20240928.htm'],
      primaryDocDescription: ['10-K'],
    },
    files: [],
  },
};

const COMPANY_DIRECTORY = buildCompleteSecCompanyDirectory([
  { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corporation' },
]);
const COMPANY_DIRECTORY_JSON = JSON.stringify(COMPANY_DIRECTORY);

const EMPTY_EFTS = {
  hits: {
    total: { value: 0, relation: 'eq' },
    hits: [],
  },
};

const COMPANY_FACTS = {
  cik: 320193,
  entityName: 'Apple Inc.',
  facts: {
    'us-gaap': {
      Revenues: {
        label: 'Revenue',
        description: 'Deterministic semantic-audit revenue.',
        units: {
          USD: [{
            val: 100_000_000_000,
            accn: '0000320193-26-000001',
            fy: 2025,
            fp: 'FY',
            form: '10-K',
            filed: '2026-02-01',
            start: '2025-01-01',
            end: '2025-12-31',
          }],
        },
      },
    },
  },
};

const SIC_DIRECTORY_HTML = `<!doctype html><html><body><table><tbody>
  <tr><th>SIC</th><th>Office</th><th>Industry title</th></tr>
  <tr><td>3571</td><td>Office of Technology</td><td>Electronic Computers</td></tr>
</tbody></table></body></html>`;

const RULEMAKING_HTML = `<!doctype html><html><body><table><tbody><tr>
  <td><time>2026-03-02</time></td><td>S7-10-26</td><td>
    <span class="regulation-node-title">Semantic audit rulemaking fixture</span>
    <a class="info-button" href="/rules-regulations/semantic-audit-rule">
      <span class="info-button__top">Proposed Rule</span>
    </a>
    <span class="regulation-node-metadata">Release under the Securities Exchange Act.</span>
    <span class="division">Corporation Finance</span>
  </td>
</tr></tbody></table></body></html>`;

const NO_ACTION_HTML = `<!doctype html><html><body><div class="field--name-body"><ul>
  <li><a href="/files/no-action/semantic-audit.pdf">Semantic Audit Requestor</a> August 1, 2026</li>
</ul></div></body></html>`;

const LITIGATION_HTML = `<!doctype html><html><body><table><tbody><tr>
  <td><time>2026-05-11</time></td><td>
    <span class="view-table_subfield_release_number"><span class="view-table_subfield_value">LR-26101</span></span>
    <a href="/enforcement-litigation/litigation-releases/lr-26101">SEC v. Semantic Audit Fixture</a>
  </td>
</tr></tbody></table></body></html>`;

const FILING_HTML = `<!doctype html>
<html lang="en">
  <head><title>Apple Inc. 2024 Form 10-K</title></head>
  <body>
    <h1>Apple Inc.</h1>
    <h2>Part I</h2>
    <h3>Item 1. Business</h3>
    <p>Representative SEC filing content used by the deterministic semantic route audit.</p>
    <h3>Item 1A. Risk Factors</h3>
    <p>Risk-factor disclosure remains visible in the embedded filing viewer.</p>
  </body>
</html>`;

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

/**
 * The semantic census audits rendered application states, not the availability
 * of Supabase or EDGAR. Give the three data-backed route contracts stable,
 * structurally valid responses so a missing CI secret or SEC throttle cannot
 * masquerade as a UI defect. API behavior and failure states remain covered by
 * their unit and interaction suites.
 */
export async function installSemanticAuditFixtures(page: Page, path: string): Promise<void> {
  await page.route(url => new URL(url).pathname === '/api/stats', route => fulfillJson(route, DATA_STATS));

  await page.route(url => new URL(url).pathname === '/api/letters', route => fulfillJson(route, {
    total: 0,
    threads: [],
    letters: [],
    matches: [],
  }));

  await page.route(url => new URL(url).pathname === '/api/sec-efts', route => fulfillJson(route, EMPTY_EFTS));

  await page.route(url => new URL(url).pathname === '/api/sec-proxy', async route => {
    const requestUrl = new URL(route.request().url());
    const requestedPath = requestUrl.searchParams.get('path') || '';

    if (requestedPath.includes('company_tickers.json')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: COMPANY_DIRECTORY_JSON,
      });
      return;
    }

    if (requestedPath.includes('standard-industrial-classification-sic-code-list')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SIC_DIRECTORY_HTML });
      return;
    }

    const submissions = requestedPath.match(/submissions\/CIK(\d+)\.json/i);
    if (submissions) {
      const cik = String(Number(submissions[1]));
      const ticker = cik === '789019' ? 'MSFT' : 'AAPL';
      const company = ticker === 'MSFT' ? 'Microsoft Corporation' : 'Apple Inc.';
      const accession = `${cik.padStart(10, '0')}-24-000123`;
      await fulfillJson(route, {
        ...APPLE_SUBMISSIONS,
        cik,
        name: company,
        tickers: [ticker],
        filings: {
          ...APPLE_SUBMISSIONS.filings,
          recent: {
            ...APPLE_SUBMISSIONS.filings.recent,
            accessionNumber: [accession],
            primaryDocument: [`${ticker.toLowerCase()}-20240928.htm`],
          },
        },
      });
      return;
    }

    const facts = requestedPath.match(/companyfacts\/CIK(\d+)\.json/i);
    if (facts) {
      const cik = Number(facts[1]);
      await fulfillJson(route, {
        ...COMPANY_FACTS,
        cik,
        entityName: cik === 789019 ? 'Microsoft Corporation' : 'Apple Inc.',
      });
      return;
    }

    if (requestedPath.includes('rulemaking-activity')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: RULEMAKING_HTML });
      return;
    }

    if (/no-action|noaction/i.test(requestedPath)) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: NO_ACTION_HTML });
      return;
    }

    if (requestedPath.includes('litigation-releases')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: LITIGATION_HTML });
      return;
    }

    if (path.startsWith('/filing/')) {
      if (requestedPath.endsWith('/index.json')) {
        await fulfillJson(route, {
          directory: {
            item: [{ name: 'aapl-20240928.htm', type: 'text/html', size: FILING_HTML.length }],
          },
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: {
          'Content-Security-Policy': SEC_DOCUMENT_CSP,
          'Cross-Origin-Resource-Policy': 'same-origin',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
        body: FILING_HTML,
      });
      return;
    }

    // Rulemaking follows each index entry for its effective date. Other
    // passive census pages only need a successful, inert official document.
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body><p>Effective Date: June 1, 2026.</p></body></html>',
    });
  });
}
