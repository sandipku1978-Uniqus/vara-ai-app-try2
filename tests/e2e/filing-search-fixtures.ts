import type { Page, Route } from '@playwright/test';

/**
 * A form-aware EDGAR full-text-search corpus.
 *
 * Several research surfaces (exempt offerings, exhibits, earnings releases,
 * M&A) reach EDGAR through the same pipeline but ask for DIFFERENT form
 * types: `D,D/A`, `8-K,8-K/A,6-K`, `10-K,...,425`. The Boolean fixtures
 * answer `/api/sec-efts` from a four-filing corpus that carries none of those
 * forms, so every one of these views renders an empty table — which is why
 * they show no source links, and why a probe of all six found nothing.
 *
 * This corpus spans the forms those views request and filters on the `forms`
 * request parameter the app actually sends, so each surface receives rows it
 * recognises. Hit shape follows parseSearchHit() in src/hooks/useEdgarSearch:
 * entityName comes from display_names, formType from `form`, documentType
 * from `file_type` (an exhibit type where applicable), and primaryDocument
 * from `primary_document`.
 */

export interface SearchFixtureFiling {
  entity: string;
  cik: string;
  accession: string;
  document: string;
  /** Parent form — matched against the request's `forms` parameter. */
  form: string;
  /** Exhibit/document type; equals `form` for a primary document. */
  fileType: string;
  description: string;
  /** Filing date, expressed as an age so the corpus never ages out. */
  daysAgo: number;
  /** Resolved ISO date, filled in at module load. */
  filed: string;
}

/**
 * Dates are RELATIVE. Several of these surfaces bound their "recent" load to
 * a trailing window (exhibits 60 days, earnings likewise), so a corpus with
 * hard-coded dates silently returns nothing once it drifts past the window —
 * which is exactly what a first probe of /earnings showed.
 */
function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

const CORPUS_SEED: Omit<SearchFixtureFiling, 'filed'>[] = [
  // Regulation D exempt offerings. Both are form `D` because the app requests
  // `D` alone; a `D/A` row would never be asked for.
  { entity: 'Northgate Capital Partners LLC', cik: '2000001', accession: '0002000001-26-000001', document: 'primary_doc.xml', form: 'D', fileType: 'D', description: 'Notice of Exempt Offering of Securities', daysAgo: 9 },
  { entity: 'Southbank Ventures Fund III', cik: '2000002', accession: '0002000002-26-000002', document: 'primary_doc.xml', form: 'D', fileType: 'D', description: 'Amended Notice of Exempt Offering of Securities', daysAgo: 21 },

  // Material-contract and merger exhibits
  { entity: 'Halloway Industries Inc', cik: '2000003', accession: '0002000003-26-000003', document: 'ex21-merger.htm', form: '8-K', fileType: 'EX-2.1', description: 'Agreement and Plan of Merger', daysAgo: 12 },
  { entity: 'Trenton Ridge Corporation', cik: '2000004', accession: '0002000004-26-000004', document: 'ex101-credit.htm', form: '10-K', fileType: 'EX-10.1', description: 'Amended and Restated Credit Agreement', daysAgo: 27 },

  // Earnings-release exhibits. BOTH are EX-99.1: EarningsTranscripts filters
  // to that prefix exactly, and its query is "earnings results", so the
  // descriptions must carry those words or the rows are filtered out twice
  // over — the failure a first probe of /earnings showed.
  { entity: 'Cascadia Foods Corporation', cik: '2000005', accession: '0002000005-26-000005', document: 'ex991-earnings.htm', form: '8-K', fileType: 'EX-99.1', description: 'Earnings press release — fourth quarter and full year results', daysAgo: 6 },
  { entity: 'Meridian Logistics Group', cik: '2000006', accession: '0002000006-26-000006', document: 'ex991-supplemental.htm', form: '8-K', fileType: 'EX-99.1', description: 'Earnings results presentation and supplemental financial information', daysAgo: 17 },
];

export const SEARCH_CORPUS: SearchFixtureFiling[] = CORPUS_SEED.map(entry => ({
  ...entry,
  filed: isoDaysAgo(entry.daysAgo),
}));

/** `forms` arrives as a comma-separated list; empty means "no restriction". */
function requestedForms(params: URLSearchParams): string[] {
  return (params.get('forms') || '')
    .split(',')
    .map(f => f.trim())
    .filter(Boolean);
}

function matchesQuery(query: string, filing: SearchFixtureFiling): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = `${filing.entity} ${filing.description} ${filing.fileType} ${filing.form}`.toLowerCase();
  // Whole-token containment is enough here; Boolean semantics are proven by
  // the Boolean fixtures, not by these surfaces.
  return trimmed.split(/\s+/).every(token => haystack.includes(token));
}

function hit(filing: SearchFixtureFiling) {
  return {
    _id: `${filing.accession}:${filing.document}`,
    _score: 1,
    _source: {
      display_names: [`${filing.entity}  (CIK ${filing.cik})`],
      entity_name: filing.entity,
      file_date: filing.filed,
      form: filing.form,
      root_forms: [filing.form],
      file_type: filing.fileType,
      file_description: filing.description,
      adsh: filing.accession,
      ciks: [filing.cik],
      primary_document: filing.document,
    },
  };
}

export interface SearchFixtureStats {
  /** Every `forms` value the app asked for, in order. */
  formRequests: string[];
}

/**
 * Layer over installBooleanFixtures. Registered afterwards so it answers
 * `/api/sec-efts` first; anything it cannot serve falls back to the Boolean
 * corpus so existing journeys are untouched.
 */
export async function installFilingSearchFixtures(page: Page): Promise<SearchFixtureStats> {
  const stats: SearchFixtureStats = { formRequests: [] };

  await page.route('**/api/sec-efts**', async (route: Route) => {
    const params = new URL(route.request().url()).searchParams;
    const forms = requestedForms(params);
    stats.formRequests.push(forms.join(','));

    const query = params.get('q') || '';
    const matches = SEARCH_CORPUS.filter(
      f => (forms.length === 0 || forms.includes(f.form)) && matchesQuery(query, f)
    );

    // A request for forms this corpus does not carry is left to the Boolean
    // fixtures rather than answered with a misleading empty result.
    if (matches.length === 0 && forms.length > 0 && !forms.some(form => SEARCH_CORPUS.some(f => f.form === form))) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hits: {
          total: { value: matches.length, relation: 'eq' },
          hits: matches.map(hit),
        },
      }),
    });
  });

  return stats;
}
