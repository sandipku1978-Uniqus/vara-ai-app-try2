/**
 * EDGAR full-index (master.idx) fetching and parsing.
 *
 * master.idx is pipe-delimited: CIK|Company Name|Form Type|Date Filed|Filename.
 * Delimited parsing keeps multi-word forms (DEF 14A, SCHEDULE 13D, SC TO-T)
 * that fixed-width regex parsing historically dropped.
 */

const EDGAR_BASE = 'https://www.sec.gov';

const SEC_USER_AGENT =
  process.env.EDGAR_USER_AGENT ||
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT ||
  'Uniqus Research Center contact@uniqus.com';

export interface EdgarIndexEntry {
  cik: number;
  companyName: string;
  formType: string;
  dateFiled: string; // YYYY-MM-DD
  filename: string;
  accessionNumber: string;
}

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchText(url: string, timeoutMs = 90_000, retries = 3): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          headers: { 'User-Agent': SEC_USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
          signal: controller.signal,
        });
        if (response.status === 404) return '';
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await delay(Math.min(1000 * 2 ** attempt, 8000));
    }
  }
  throw lastError || new Error(`Failed to fetch ${url}`);
}

export function parseMasterIndex(text: string): EdgarIndexEntry[] {
  const entries: EdgarIndexEntry[] = [];
  let headerDone = false;
  for (const line of text.split('\n')) {
    if (!headerDone) {
      if (line.startsWith('---')) headerDone = true;
      continue;
    }
    const parts = line.split('|');
    if (parts.length !== 5) continue;
    const [cikRaw, companyName, formType, dateFiled, filename] = parts.map(part => part.trim());
    if (!/^\d+$/.test(cikRaw)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFiled)) continue;
    if (!filename.startsWith('edgar/data/')) continue;
    const accMatch = filename.match(/(\d{10}-\d{2}-\d{6})/);
    if (!accMatch) continue;
    entries.push({
      cik: Number(cikRaw),
      companyName,
      formType,
      dateFiled,
      filename,
      accessionNumber: accMatch[1],
    });
  }
  return entries;
}

export async function fetchQuarterIndex(year: number, quarter: number): Promise<EdgarIndexEntry[]> {
  const url = `${EDGAR_BASE}/Archives/edgar/full-index/${year}/QTR${quarter}/master.idx`;
  const text = await fetchText(url);
  if (!text.trim()) return [];
  return parseMasterIndex(text);
}

export function getQuartersInRange(startDate: string, endDate: string): Array<{ year: number; quarter: number }> {
  const startYear = Number(startDate.slice(0, 4));
  const startQuarter = Math.ceil(Number(startDate.slice(5, 7)) / 3);
  const endYear = Number(endDate.slice(0, 4));
  const endQuarter = Math.ceil(Number(endDate.slice(5, 7)) / 3);

  const quarters: Array<{ year: number; quarter: number }> = [];
  let year = startYear;
  let quarter = startQuarter;
  while (year < endYear || (year === endYear && quarter <= endQuarter)) {
    quarters.push({ year, quarter });
    quarter++;
    if (quarter > 4) { quarter = 1; year++; }
  }
  return quarters;
}

/** Forms the research product actually surfaces — both pre- and post-rename
 *  spellings of the Schedule 13 family. */
export const CORE_FORMS = new Set([
  '10-K', '10-K/A', '10-KT',
  '10-Q', '10-Q/A',
  '8-K', '8-K/A',
  'DEF 14A', 'DEFA14A', 'DFAN14A', 'PRE 14A', 'PRER14A',
  'S-1', 'S-1/A', 'S-3', 'S-3/A', 'S-4', 'S-4/A',
  '20-F', '20-F/A', '6-K', '6-K/A',
  'CORRESP', 'UPLOAD',
  'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A',
  'SCHEDULE 13D', 'SCHEDULE 13D/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A',
  'SC TO-T', 'SC TO-T/A', 'SC 14D9', 'SC 14D9/A',
  '424B1', '424B2', '424B3', '424B4', '424B5',
  'N-CSR', 'N-CSRS',
  '11-K',
  'SD',
  // Foreign private issuers + ADR programs — 993 listed ADRs had real EDGAR
  // filings but zero facet rows because none of their form types were here
  // (found by scripts/ticker-coverage-test.ts full-directory run 2026-07-20)
  '40-F', '40-F/A', '18-K', '18-K/A', 'SUPPL',
  'F-1', 'F-1/A', 'F-3', 'F-3/A', 'F-4', 'F-4/A', 'F-10', 'F-10/A',
  'F-X', '40FR12B', '20FR12B',
  'F-6', 'F-6/A', 'F-6EF', 'F-6 POS',
  // Deal communications and cross-border tenders
  '425', 'CB', 'CB/A', 'DEFM14A', 'DEFR14A',
  // Reg D private placements (Exempt Offerings page searches these)
  'D', 'D/A',
  // Draft registration statements
  'DRS', 'DRS/A',
  // Securities registrations, Reg A / crowdfunding offerings, closed-end fund
  // registrations, and deregistrations — 7 issuers' only post-2010 EDGAR
  // activity was in these forms (ticker-coverage sweep 2026-07-20)
  '10-12G', '10-12G/A', '10-12B', '10-12B/A',
  '8-A12B', '8-A12B/A', '8-A12G', '8-A12G/A',
  '1-A', '1-A/A', '1-K', '1-K/A', '1-SA', '1-Z',
  'C', 'C/A', 'C-U',
  'N-2', 'N-2/A', 'N-8A', 'N-8A/A',
  '15-12B', '15-12G', '15-15D', 'RW',
]);
