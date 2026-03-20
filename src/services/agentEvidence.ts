import { defaultSearchFilters, type SearchFilters } from '../components/filters/SearchFilterBar';
import {
  buildSecDocumentUrl,
  buildSecProxyUrl,
  fetchCompanySubmissions,
  fetchCompanySubmissionsBatch,
  fetchFilingText,
  findLatestFiling,
  loadTickerMap,
  lookupCIK,
  type SecSubmission,
} from './secApi';
import type {
  AgentCitation,
  FilingLocator,
  FilingSectionReference,
  FilingSectionSnippet,
  ResolvedCompany,
} from '../types/agent';

interface CompanyDirectoryEntry {
  cik: string;
  ticker: string;
  title: string;
}

const SECTION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'Item 1. Business', re: /^item\s+1[^a-z0-9]/i },
  { label: 'Item 1A. Risk Factors', re: /^item\s+1a/i },
  { label: 'Item 1B. Unresolved Staff Comments', re: /^item\s+1b/i },
  { label: 'Item 1C. Cybersecurity', re: /^item\s+1c/i },
  { label: 'Item 2. Properties', re: /^item\s+2[^0-9]/i },
  { label: 'Item 3. Legal Proceedings', re: /^item\s+3[^0-9]/i },
  { label: 'Item 4. Mine Safety', re: /^item\s+4[^0-9]/i },
  { label: 'Item 5. Market for Registrant', re: /^item\s+5[^0-9]/i },
  { label: 'Item 6. Reserved', re: /^item\s+6[^0-9]/i },
  { label: 'Item 7. MD&A', re: /^item\s+7[^a-z0-9]/i },
  { label: 'Item 7A. Quantitative Disclosures', re: /^item\s+7a/i },
  { label: 'Item 8. Financial Statements', re: /^item\s+8[^0-9]/i },
  { label: 'Item 9. Changes in Accountants', re: /^item\s+9[^a-z0-9]/i },
  { label: 'Item 9A. Controls & Procedures', re: /^item\s+9a/i },
  { label: 'Item 9B. Other Information', re: /^item\s+9b/i },
  { label: 'Item 10. Directors & Governance', re: /^item\s+10[^0-9]/i },
  { label: 'Item 11. Executive Compensation', re: /^item\s+11[^0-9]/i },
  { label: 'Item 12. Security Ownership', re: /^item\s+12[^0-9]/i },
  { label: 'Item 13. Related Transactions', re: /^item\s+13[^0-9]/i },
  { label: 'Item 14. Principal Accountant Fees', re: /^item\s+14[^0-9]/i },
  { label: 'Item 15. Exhibits', re: /^item\s+15[^0-9]/i },
  { label: 'Signatures', re: /signatures?/i },
  { label: 'Prospectus Summary', re: /^prospectus summary/i },
  { label: 'Risk Factors', re: /^risk factors/i },
  { label: 'Use of Proceeds', re: /^use of proceeds/i },
  { label: 'Dividend Policy', re: /^dividend policy/i },
  { label: 'Capitalization', re: /^capitalization/i },
  { label: 'Dilution', re: /^dilution/i },
  { label: 'Business', re: /^business$/i },
  { label: 'Management', re: /^management/i },
  { label: 'Underwriting', re: /^underwriting/i },
  { label: 'Financial Statements', re: /^financial statements/i },
];

const DEFAULT_10K_IMPORTANT_SECTIONS = [
  'Item 1. Business',
  'Item 1A. Risk Factors',
  'Item 7. MD&A',
  'Item 8. Financial Statements',
  'Item 9. Changes in Accountants',
  'Item 9A. Controls & Procedures',
];

let companyDirectoryCache: CompanyDirectoryEntry[] | null = null;
let companyDirectoryPromise: Promise<CompanyDirectoryEntry[]> | null = null;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createCitationId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildFilingRoute(locator: Pick<FilingLocator, 'cik' | 'accessionNumber' | 'primaryDocument'>): string {
  return `/filing/${locator.cik}_${locator.accessionNumber}_${locator.primaryDocument}`;
}

function getSectionPattern(label: string): RegExp | null {
  const match = SECTION_PATTERNS.find(pattern => pattern.label.toLowerCase() === label.toLowerCase());
  return match?.re || null;
}

function parseHtml(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

function locateSectionTarget(doc: Document, entry: FilingSectionReference): Element | null {
  if (entry.anchorName) {
    return doc.querySelector(`a[name="${entry.anchorName}"], a[id="${entry.anchorName}"], [id="${entry.anchorName}"]`);
  }
  if (entry.elementId) {
    return doc.getElementById(entry.elementId);
  }
  return null;
}

function parseFilingSectionsFromDocument(doc: Document): FilingSectionReference[] {
  const entries: FilingSectionReference[] = [];
  const seen = new Set<string>();

  const tocLinks = Array.from(doc.querySelectorAll('a[href^="#"]'));
  for (const link of tocLinks) {
    const href = link.getAttribute('href') || '';
    const anchorTarget = href.replace(/^#/, '');
    if (!anchorTarget) continue;
    const text = (link.textContent || '').trim();
    if (text.length < 3 || text.length > 120) continue;

    for (const pattern of SECTION_PATTERNS) {
      if (pattern.re.test(text) && !seen.has(pattern.label)) {
        seen.add(pattern.label);
        entries.push({ label: pattern.label, elementId: null, anchorName: anchorTarget });
        break;
      }
    }
  }

  if (entries.length === 0) {
    const candidates = Array.from(doc.querySelectorAll('h1, h2, h3, h4, b, strong, p, div'));
    for (const el of candidates) {
      const text = (el.textContent || '').trim();
      if (text.length < 3 || text.length > 120) continue;

      for (const pattern of SECTION_PATTERNS) {
        if (pattern.re.test(text) && !seen.has(pattern.label)) {
          seen.add(pattern.label);
          if (!el.id) el.id = `agent-sec-${entries.length}`;
          entries.push({ label: pattern.label, elementId: el.id, anchorName: null });
          break;
        }
      }
    }
  }

  return entries;
}

function collectTextFromTarget(target: Element | null, maxChars = 1400): string {
  if (!target) return '';

  const chunks: string[] = [];
  let current: Element | null = target;
  while (current && chunks.join(' ').length < maxChars) {
    const text = (current.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) {
      chunks.push(text);
    }

    const next: Element | null = current.nextElementSibling;
    if (!next) break;

    const nextText = (next.textContent || '').trim();
    const isLikelyNextHeading =
      nextText.length > 0 &&
      nextText.length < 140 &&
      SECTION_PATTERNS.some(pattern => pattern.re.test(nextText));
    if (isLikelyNextHeading) {
      break;
    }

    current = next;
  }

  return chunks.join(' ').slice(0, maxChars).trim();
}

function fallbackSnippetFromText(text: string, label: string, maxChars = 1200): string {
  const pattern = getSectionPattern(label);
  if (!pattern) return text.slice(0, maxChars).trim();

  const lines = text.split('\n');
  const startIndex = lines.findIndex(line => pattern.test(line.trim()));
  if (startIndex === -1) return text.slice(0, maxChars).trim();

  const slice = lines.slice(startIndex, startIndex + 40).join(' ').replace(/\s+/g, ' ').trim();
  return slice.slice(0, maxChars).trim();
}

function createSectionCitation(locator: FilingLocator, label: string, excerpt: string): AgentCitation {
  return {
    id: createCitationId('section'),
    kind: 'section',
    title: `${locator.companyName} ${locator.formType} - ${label}`,
    subtitle: `${locator.filingDate}${locator.auditor ? ` | Auditor: ${locator.auditor}` : ''}`,
    route: buildFilingRoute(locator),
    filingRoute: buildFilingRoute(locator),
    externalUrl: buildSecDocumentUrl(locator.cik, locator.accessionNumber, locator.primaryDocument),
    sectionLabel: label,
    excerpt,
  };
}

export function createSearchFilters(): SearchFilters {
  return { ...defaultSearchFilters };
}

export async function loadCompanyDirectory(): Promise<CompanyDirectoryEntry[]> {
  if (companyDirectoryCache) return companyDirectoryCache;
  if (companyDirectoryPromise) return companyDirectoryPromise;

  companyDirectoryPromise = (async () => {
    try {
      const response = await fetch(buildSecProxyUrl('files/company_tickers.json'));
      if (!response.ok) {
        throw new Error(`Failed to load company directory (${response.status})`);
      }
      const payload = await response.json();
      const entries = Object.values(payload as Record<string, { cik_str: number; ticker: string; title: string }>)
        .map(entry => ({
          cik: String(entry.cik_str).padStart(10, '0'),
          ticker: entry.ticker.toUpperCase(),
          title: entry.title,
        }));
      companyDirectoryCache = entries;
      return entries;
    } catch (error) {
      console.error('Failed to load company directory:', error);
      companyDirectoryCache = [];
      return [];
    }
  })();

  return companyDirectoryPromise;
}

export async function resolveCompanyHint(companyHint: string): Promise<ResolvedCompany | null> {
  const trimmed = companyHint.trim();
  if (!trimmed) return null;

  const tickerMatch = trimmed.toUpperCase().match(/^[A-Z.\-]{1,6}$/);
  if (tickerMatch) {
    const cik = await lookupCIK(trimmed.toUpperCase());
    if (cik) {
      const directory = await loadCompanyDirectory();
      const entry = directory.find(item => item.ticker === trimmed.toUpperCase());
      return {
        cik: cik.padStart(10, '0'),
        ticker: trimmed.toUpperCase(),
        title: entry?.title || trimmed.toUpperCase(),
      };
    }
  }

  const normalizedHint = normalize(trimmed);
  const directory = await loadCompanyDirectory();
  const ranked = directory
    .map(entry => {
      const normalizedTitle = normalize(entry.title);
      const normalizedTicker = normalize(entry.ticker);
      let score = 0;
      if (normalizedTitle === normalizedHint || normalizedTicker === normalizedHint) score += 10;
      if (normalizedTitle.startsWith(normalizedHint)) score += 6;
      if (normalizedTitle.includes(normalizedHint)) score += 4;
      if (normalizedTicker.includes(normalizedHint)) score += 3;
      return { entry, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.entry;
  if (!best) return null;

  return {
    cik: best.cik,
    ticker: best.ticker,
    title: best.title,
  };
}

export async function findLatestFilingForCompany(
  company: ResolvedCompany,
  formType: string
): Promise<FilingLocator | null> {
  const submissions = await fetchCompanySubmissions(company.cik);
  if (!submissions) return null;

  const latest = findLatestFiling(submissions, formType);
  if (!latest) return null;

  return {
    cik: company.cik.replace(/^0+/, ''),
    accessionNumber: latest.accessionNumber,
    filingDate: latest.filingDate,
    formType,
    primaryDocument: latest.primaryDocument,
    companyName: submissions.name || company.title,
    ticker: submissions.tickers?.[0] || company.ticker,
  };
}

export async function fetchFilingEvidence(locator: FilingLocator): Promise<{
  html: string;
  text: string;
  sections: FilingSectionReference[];
}> {
  const cleanAccession = locator.accessionNumber.replace(/-/g, '');
  const [html, text] = await Promise.all([
    fetch(buildSecProxyUrl(`Archives/edgar/data/${locator.cik}/${cleanAccession}/${locator.primaryDocument}`)).then(async response => {
      if (!response.ok) {
        throw new Error(`Failed to fetch filing HTML (${response.status})`);
      }
      return response.text();
    }),
    fetchFilingText(locator.cik, locator.accessionNumber, locator.primaryDocument),
  ]);

  const doc = parseHtml(html);
  return {
    html,
    text,
    sections: parseFilingSectionsFromDocument(doc),
  };
}

export function buildSectionSnippet(
  locator: FilingLocator,
  html: string,
  text: string,
  sections: FilingSectionReference[],
  label: string
): FilingSectionSnippet | null {
  const doc = parseHtml(html);
  const entry = sections.find(item => item.label.toLowerCase() === label.toLowerCase()) || null;
  const excerpt = collectTextFromTarget(entry ? locateSectionTarget(doc, entry) : null) || fallbackSnippetFromText(text, label);
  if (!excerpt) return null;

  return {
    label,
    excerpt,
    citation: createSectionCitation(locator, label, excerpt),
  };
}

export function pickDefaultSummarySectionLabels(formType: string): string[] {
  switch (formType.toUpperCase()) {
    case '10-K':
      return DEFAULT_10K_IMPORTANT_SECTIONS;
    case '10-Q':
      return ['Item 2. Properties', 'Item 7. MD&A', 'Item 8. Financial Statements', 'Item 9A. Controls & Procedures'];
    case 'S-1':
      return ['Prospectus Summary', 'Risk Factors', 'Use of Proceeds', 'Business', 'Financial Statements'];
    default:
      return ['Item 1. Business', 'Item 1A. Risk Factors', 'Item 7. MD&A'];
  }
}

export function buildImportantSectionSnippets(
  locator: FilingLocator,
  html: string,
  text: string,
  sections: FilingSectionReference[],
  labels = pickDefaultSummarySectionLabels(locator.formType)
): FilingSectionSnippet[] {
  return labels
    .map(label => buildSectionSnippet(locator, html, text, sections, label))
    .filter((snippet): snippet is FilingSectionSnippet => Boolean(snippet));
}

export async function discoverPeersBySic(
  seed: ResolvedCompany,
  excludeTickers: string[] = [],
  limit = 5
): Promise<{ sic: string; sicDescription: string; tickers: string[] }> {
  const submissions = await fetchCompanySubmissions(seed.cik);
  const targetSic = (submissions as any)?.sic || '';
  const sicDescription = submissions?.sicDescription || '';
  if (!targetSic) {
    return { sic: '', sicDescription, tickers: [] };
  }

  const tickerMap = await loadTickerMap();
  const candidates = Object.entries(tickerMap)
    .map(([ticker, cik]) => ({ ticker, cik: cik.padStart(10, '0') }))
    .filter(candidate => candidate.ticker !== seed.ticker && !excludeTickers.includes(candidate.ticker))
    .slice(0, 400);

  const peers: string[] = [];
  for (let index = 0; index < candidates.length && peers.length < limit; index += 20) {
    const batch = candidates.slice(index, index + 20);
    const batchResults = await fetchCompanySubmissionsBatch(batch.map(candidate => candidate.cik), 5);
    for (let batchIndex = 0; batchIndex < batchResults.length; batchIndex += 1) {
      const candidateSubmission = batchResults[batchIndex];
      const ticker = batch[batchIndex]?.ticker;
      if (!candidateSubmission || !ticker) continue;
      if ((candidateSubmission as any).sic === targetSic) {
        peers.push(ticker);
      }
      if (peers.length >= limit) break;
    }
  }

  return {
    sic: targetSic,
    sicDescription,
    tickers: peers,
  };
}

export function buildSearchResultCitation(result: {
  companyName: string;
  formType: string;
  filingDate: string;
  description: string;
  route: string;
  externalUrl: string;
}): AgentCitation {
  return {
    id: createCitationId('search'),
    kind: 'search-result',
    title: `${result.companyName} ${result.formType}`,
    subtitle: result.filingDate,
    meta: result.description,
    route: result.route,
    externalUrl: result.externalUrl,
  };
}

export function buildCommentLetterCitation(result: {
  companyName: string;
  formType: string;
  filingDate: string;
  route: string;
  externalUrl: string;
  description: string;
}): AgentCitation {
  return {
    id: createCitationId('comment'),
    kind: 'comment-letter',
    title: `${result.companyName} ${result.formType}`,
    subtitle: result.filingDate,
    meta: result.description,
    route: result.route,
    externalUrl: result.externalUrl,
  };
}

export function buildFilingCitation(locator: FilingLocator, note?: string): AgentCitation {
  return {
    id: createCitationId('filing'),
    kind: 'filing',
    title: `${locator.companyName} ${locator.formType}`,
    subtitle: locator.filingDate,
    meta: note,
    route: buildFilingRoute(locator),
    filingRoute: buildFilingRoute(locator),
    externalUrl: buildSecDocumentUrl(locator.cik, locator.accessionNumber, locator.primaryDocument),
  };
}

export function inferSurfaceFromPath(pathname: string): 'research' | 'accounting' | 'comment-letters' {
  if (pathname.startsWith('/accounting')) return 'accounting';
  if (pathname.startsWith('/comment-letters')) return 'comment-letters';
  return 'research';
}

export function resolveSubmissionFilingLocator(
  submissions: SecSubmission,
  accessionNumber: string
): FilingLocator | null {
  const matchIndex = submissions.filings.recent.accessionNumber.findIndex(item => item === accessionNumber);
  if (matchIndex === -1) return null;

  return {
    cik: submissions.cik.replace(/^0+/, ''),
    accessionNumber,
    filingDate: submissions.filings.recent.filingDate[matchIndex] || '',
    formType: submissions.filings.recent.form[matchIndex] || '',
    primaryDocument: submissions.filings.recent.primaryDocument[matchIndex] || '',
    companyName: submissions.name,
    ticker: submissions.tickers?.[0] || '',
  };
}
