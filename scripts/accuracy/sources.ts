/**
 * Throttled SEC access for the accuracy gate.
 *
 * The gate scores our behaviour against SEC's own data, so it talks to
 * sec.gov directly rather than through the app — a harness that measured the
 * app against itself would prove nothing.
 */

import { extractDocumentTextFromHtmlServer } from '../../src/lib/filingTextServer';
import { containsFinancialStatementNotes } from '../../src/services/secApi';

const USER_AGENT =
  process.env.SEC_USER_AGENT ||
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT ||
  'Uniqus Research Center accuracy-gate contact@uniqus.com';

/** SEC asks for <=10 requests/second. Stay well under it. */
const MIN_INTERVAL_MS = 130;
let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export async function secFetch(url: string, attempt = 0): Promise<Response> {
  await throttle();
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
  });

  // 429/503 are SEC asking us to slow down, not a failure of the thing we are
  // measuring — retry so throttling never shows up as an accuracy miss.
  if ((response.status === 429 || response.status === 503) && attempt < 4) {
    await sleep(1_000 * 2 ** attempt);
    return secFetch(url, attempt + 1);
  }
  return response;
}

export async function secJson<T>(url: string): Promise<T | null> {
  const response = await secFetch(url);
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export async function secText(url: string): Promise<string | null> {
  const response = await secFetch(url);
  if (!response.ok) return null;
  return response.text();
}

export interface CompanyFactUnit {
  end: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
  frame?: string;
}

/**
 * Authoritative XBRL value as the registrant tagged it. This is ground truth
 * by construction: it is the number in the filing.
 */
export async function fetchCompanyConcept(
  cik: string,
  taxonomy: string,
  tag: string
): Promise<CompanyFactUnit[] | null> {
  const padded = cik.padStart(10, '0');
  const data = await secJson<{ units?: Record<string, CompanyFactUnit[]> }>(
    `https://data.sec.gov/api/xbrl/companyconcept/CIK${padded}/${taxonomy}/${tag}.json`
  );
  const units = data?.units;
  if (!units) return null;
  return units.USD ?? Object.values(units)[0] ?? null;
}

export interface EftsHit {
  _source: { adsh: string; ciks: string[]; file_type: string; file_date: string };
}

/** EDGAR full-text search — the retrieval upstream the app builds on. */
export async function eftsSearch(
  query: string,
  extra: Record<string, string> = {}
): Promise<{ total: number; hits: EftsHit[] }> {
  const params = new URLSearchParams({ q: query, ...extra });
  const data = await secJson<{
    hits?: { total?: { value?: number }; hits?: EftsHit[] };
  }>(`https://efts.sec.gov/LATEST/search-index?${params}`);

  return {
    total: data?.hits?.total?.value ?? 0,
    hits: data?.hits?.hits ?? [],
  };
}

export interface SubmissionsRecent {
  accessionNumber: string[];
  form: string[];
  filingDate: string[];
  primaryDocument: string[];
}

export async function fetchSubmissions(cik: string): Promise<SubmissionsRecent | null> {
  const padded = cik.padStart(10, '0');
  const data = await secJson<{ filings?: { recent?: SubmissionsRecent } }>(
    `https://data.sec.gov/submissions/CIK${padded}.json`
  );
  return data?.filings?.recent ?? null;
}

/** Newest filing of a given form, with the document path needed to read it. */
export async function latestFiling(
  cik: string,
  form: string
): Promise<{ accession: string; document: string; filed: string } | null> {
  const recent = await fetchSubmissions(cik);
  if (!recent) return null;
  for (let i = 0; i < recent.form.length; i += 1) {
    if (recent.form[i] === form) {
      return {
        accession: recent.accessionNumber[i].replace(/-/g, ''),
        document: recent.primaryDocument[i],
        filed: recent.filingDate[i],
      };
    }
  }
  return null;
}

export async function fetchFilingHtml(
  cik: string,
  accession: string,
  document: string
): Promise<string | null> {
  return secText(
    `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${document}`
  );
}

/**
 * The document that actually holds the accounting policies, following the
 * statements exhibit when the 10-K body incorporates them by reference.
 *
 * Mirrors `fetchAnnualDisclosureText` in the product, using the same
 * `containsFinancialStatementNotes` predicate, so the gate measures the
 * document a reader would actually be shown rather than a stricter one.
 */
export async function fetchDisclosureHtml(
  cik: string,
  accession: string,
  primaryDocument: string
): Promise<{ html: string; document: string } | null> {
  const primary = await fetchFilingHtml(cik, accession, primaryDocument);
  if (!primary) return null;
  if (containsFinancialStatementNotes(extractDocumentTextFromHtmlServer(primary))) {
    return { html: primary, document: primaryDocument };
  }

  const listing = await secJson<{ directory?: { item?: Array<{ name?: string; size?: string }> } }>(
    `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/index.json`
  );
  const candidates = (listing?.directory?.item || [])
    .filter(item => {
      const name = item.name || '';
      return /\.htm$/i.test(name) && !/^R\d+\.htm$/i.test(name) && name !== primaryDocument;
    })
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))
    .slice(0, 3);

  for (const candidate of candidates) {
    const html = await fetchFilingHtml(cik, accession, candidate.name || '');
    if (html && containsFinancialStatementNotes(extractDocumentTextFromHtmlServer(html))) {
      return { html, document: candidate.name || '' };
    }
  }

  return { html: primary, document: primaryDocument };
}

/**
 * The auditor as the registrant itself tagged it.
 *
 * `dei:AuditorName` and `dei:AuditorFirmId` have been required iXBRL tags on
 * annual reports since 2021, so this is the filing's own structured
 * declaration — ground truth that is completely independent of the name
 * matching our detector performs on prose, and needs no hand-maintained
 * per-issuer fixture.
 *
 * Reads the RAW html: text extraction strips the tags this depends on.
 */
export function auditorFromIxbrl(html: string): { name: string | null; firmId: string | null } {
  const grab = (tag: string): string | null => {
    const patterns = [
      new RegExp(`name=["']dei:${tag}["'][^>]*>([\\s\\S]{0,200}?)</ix:nonNumeric>`, 'i'),
      new RegExp(`<ix:nonNumeric[^>]*name=["']dei:${tag}["'][^>]*>([\\s\\S]{0,200}?)<`, 'i'),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match) continue;
      const value = match[1]
        .replace(/<[^>]*>/g, '')
        // Filings use numeric entities freely: SPG tags "Ernst&#160;& Young&#160;LLP".
        // Leaving those raw made a correct detection look like a mismatch.
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, ' ')
        .trim();
      if (value) return value;
    }
    return null;
  };

  return { name: grab('AuditorName'), firmId: grab('AuditorFirmId') };
}
