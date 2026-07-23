import type { Page, Route } from '@playwright/test';

/**
 * Deterministic Boolean corpus. Chosen to reproduce the audit's headline defect:
 * a disjoint OR must return the UNION, not the intersection. F1 and F2 each
 * carry only one side of the disjunction, so an executor that searches the
 * intersection first and stops can only return F3.
 */
export interface FixtureFiling {
  cik: string;
  company: string;
  accession: string;
  document: string;
  form: string;
  filed: string;
  text: string;
}

export const FILINGS: FixtureFiling[] = [
  {
    cik: '1000001', company: 'Mezz Only Corp', accession: '0001000001-26-000001',
    document: 'f1.htm', form: '10-K', filed: '2026-02-10',
    text: 'The Company classifies these shares as mezzanine equity on the balance sheet.',
  },
  {
    cik: '1000002', company: 'Temp Only Inc', accession: '0001000002-26-000002',
    document: 'f2.htm', form: '10-K', filed: '2026-02-11',
    text: 'These instruments are reported within temporary equity under ASC 480.',
  },
  {
    cik: '1000003', company: 'Both Holdings Ltd', accession: '0001000003-26-000003',
    document: 'f3.htm', form: '10-K', filed: '2026-02-12',
    text: 'Amounts shown as mezzanine equity are presented as temporary equity in the notes.',
  },
];

function tokenize(query: string): string[] {
  return query
    .replace(/"/g, ' ')
    .split(/\s+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t && !['and', 'or', 'not', '(', ')'].includes(t))
    .map(t => t.replace(/[()]/g, ''))
    .filter(Boolean);
}

/** Mirrors EFTS semantics: space = AND of terms, explicit OR = union. */
function matchesEfts(query: string, filing: FixtureFiling): boolean {
  const haystack = filing.text.toLowerCase();
  const trimmed = query.trim();
  if (!trimmed) return true;

  if (/\bOR\b/i.test(trimmed)) {
    return trimmed
      .split(/\bOR\b/i)
      .some(branch => {
        const tokens = tokenize(branch);
        return tokens.length > 0 && tokens.every(t => haystack.includes(t));
      });
  }

  const tokens = tokenize(trimmed);
  return tokens.length > 0 && tokens.every(t => haystack.includes(t));
}

function eftsHit(filing: FixtureFiling) {
  return {
    _id: `${filing.accession}:${filing.document}`,
    _score: 1,
    _source: {
      display_names: [`${filing.company}  (CIK ${filing.cik})`],
      file_date: filing.filed,
      file_type: filing.form,
      root_form: filing.form,
      adsh: filing.accession,
      ciks: [filing.cik],
    },
  };
}

export interface FixtureStats {
  /** Every EFTS query string the app issued, in order. */
  eftsQueries: string[];
}

/**
 * Routes every SEC-facing call to committed fixtures so the suite never depends
 * on the live SEC corpus, and records the queries actually issued so a test can
 * assert that invalid syntax performs zero retrieval.
 */
export async function installBooleanFixtures(page: Page): Promise<FixtureStats> {
  const stats: FixtureStats = { eftsQueries: [] };

  // EDGAR full-text search
  await page.route('**/api/sec-efts**', async (route: Route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') || '';
    stats.eftsQueries.push(query);
    const hits = FILINGS.filter(f => matchesEfts(query, f)).map(eftsHit);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hits: { total: { value: hits.length, relation: 'eq' }, hits } }),
    });
  });

  // Enriched lane (should not be used for Boolean, but stub it deterministically)
  await page.route('**/api/es-search**', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ hits: { total: { value: 0, relation: 'eq' }, hits: [] } }),
    });
  });

  // Facet-store enrichment
  await page.route('**/api/enrich**', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ companies: {} }),
    });
  });

  // Filing documents + company directory, both served through the SEC proxy
  await page.route('**/api/sec-proxy**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') || '';

    if (path.includes('company_tickers.json')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
      return;
    }

    const filing = FILINGS.find(f => path.includes(f.document));
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><p>${filing ? filing.text : ''}</p></body></html>`,
    });
  });

  return stats;
}
