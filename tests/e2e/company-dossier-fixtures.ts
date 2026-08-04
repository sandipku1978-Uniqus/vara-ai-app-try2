import type { Page, Route } from '@playwright/test';
import {
  LOCAL_E2E_DOSSIER_ACCESSION,
  LOCAL_E2E_DOSSIER_CIK,
  LOCAL_E2E_DOSSIER_COMPANY,
  LOCAL_E2E_DOSSIER_DOCUMENT,
} from '../../src/app/company/[ticker]/dossierE2eFixture';

/** Client-side boundaries used by the issuer dossier interaction journeys. */

export const DOSSIER_THREAD_ID = '1000003:review-2026';
export const DOSSIER_THREAD = {
  thread_id: DOSSIER_THREAD_ID,
  letters: 3,
  uploads: 1,
  corresps: 2,
  first_letter: '2026-01-08',
  last_letter: '2026-02-19',
};

export const DOSSIER_SOURCE_URL = `https://www.sec.gov/Archives/edgar/data/${Number(LOCAL_E2E_DOSSIER_CIK)}/${LOCAL_E2E_DOSSIER_ACCESSION.replace(/-/g, '')}/${LOCAL_E2E_DOSSIER_DOCUMENT}`;

const ANNUAL_FACT = {
  accn: LOCAL_E2E_DOSSIER_ACCESSION,
  fy: 2025,
  fp: 'FY',
  form: '10-K',
  filed: '2026-03-18',
  start: '2025-01-01',
  end: '2025-12-31',
};

export const DOSSIER_COMPANY_FACTS = {
  cik: Number(LOCAL_E2E_DOSSIER_CIK),
  entityName: LOCAL_E2E_DOSSIER_COMPANY,
  facts: {
    'us-gaap': {
      Revenues: {
        label: 'Revenue',
        description: 'Revenue recognized from customers.',
        units: { USD: [{ ...ANNUAL_FACT, val: 1_250_000_000 }] },
      },
      Assets: {
        label: 'Assets',
        description: 'Total assets.',
        units: { USD: [{ ...ANNUAL_FACT, start: undefined, val: 2_900_000_000 }] },
      },
      Liabilities: {
        label: 'Liabilities',
        description: 'Total liabilities.',
        units: { USD: [{ ...ANNUAL_FACT, start: undefined, val: 1_100_000_000 }] },
      },
      StockholdersEquity: {
        label: 'Stockholders equity',
        description: 'Total stockholders equity.',
        units: { USD: [{ ...ANNUAL_FACT, start: undefined, val: 1_800_000_000 }] },
      },
      NetIncomeLoss: {
        label: 'Net income',
        description: 'Net income attributable to the issuer.',
        units: { USD: [{ ...ANNUAL_FACT, val: 210_000_000 }] },
      },
    },
  },
};

export interface CompanyDossierFixtureOptions {
  letterFailuresBeforeSuccess?: number;
  factsFailuresBeforeSuccess?: number;
}

export interface CompanyDossierFixtureStats {
  letterRequests: string[];
  factsRequests: string[];
  filingSourceRequests: string[];
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

export async function installCompanyDossierFixtures(
  page: Page,
  options: CompanyDossierFixtureOptions = {},
): Promise<CompanyDossierFixtureStats> {
  const stats: CompanyDossierFixtureStats = {
    letterRequests: [],
    factsRequests: [],
    filingSourceRequests: [],
  };
  let remainingLetterFailures = options.letterFailuresBeforeSuccess ?? 0;
  let remainingFactsFailures = options.factsFailuresBeforeSuccess ?? 0;

  await page.context().route('https://www.sec.gov/**', async route => {
    stats.filingSourceRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: `<html><body><h1>${LOCAL_E2E_DOSSIER_COMPANY}</h1><p>Exact filing fixture: ${LOCAL_E2E_DOSSIER_ACCESSION}</p></body></html>`,
    });
  });

  await page.route(url => new URL(url).pathname === '/api/letters', async route => {
    stats.letterRequests.push(new URL(route.request().url()).search);
    if (remainingLetterFailures > 0) {
      remainingLetterFailures -= 1;
      await fulfillJson(route, { error: 'fixture comment-letter outage' }, 503);
      return;
    }
    await fulfillJson(route, { total: 1, threads: [DOSSIER_THREAD] });
  });

  await page.route('**/api/sec-proxy**', async route => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.searchParams.get('path') || '';
    if (!path.includes(`/companyfacts/CIK${LOCAL_E2E_DOSSIER_CIK}.json`)) {
      await route.fallback();
      return;
    }

    stats.factsRequests.push(requestUrl.search);
    if (remainingFactsFailures > 0) {
      remainingFactsFailures -= 1;
      await fulfillJson(route, { error: 'fixture XBRL outage' }, 503);
      return;
    }
    await fulfillJson(route, DOSSIER_COMPANY_FACTS);
  });

  return stats;
}
