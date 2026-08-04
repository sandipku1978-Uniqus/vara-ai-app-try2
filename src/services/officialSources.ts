import { buildSecIapdUrl, buildSecProxyUrl } from './secApi';

export interface OfficialSecItem {
  id: string;
  title: string;
  date: string;
  type: string;
  status: string;
  fileNumber: string;
  effectiveDate: string;
  description: string;
  division: string;
  url: string;
  source: string;
}

export interface AdviserFirmResult {
  crdNumber: string;
  secNumber: string;
  name: string;
  registrationScope: string;
  hasDisclosures: boolean;
  city: string;
  state: string;
  country: string;
  url: string;
}

function absoluteSecUrl(href: string): string {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  return `https://www.sec.gov${href.startsWith('/') ? href : `/${href}`}`;
}

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

function normalizeText(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireOfficialIndexItems<T>(items: T[], source: string): T[] {
  if (items.length === 0) {
    throw new Error(`${source} returned no parseable entries; the official page contract may have changed.`);
  }
  return items;
}

async function fetchSecHtml(path: string, params?: URLSearchParams): Promise<string> {
  const response = await fetch(buildSecProxyUrl(path, params));
  if (!response.ok) throw new Error(`SEC source returned ${response.status}`);
  return response.text();
}

export async function searchInvestmentAdvisers(query: string, limit = 50): Promise<{
  total: number;
  firms: AdviserFirmResult[];
}> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return { total: 0, firms: [] };
  const params = new URLSearchParams({
    query: normalizedQuery,
    hl: 'true',
    nrows: '12',
    start: '0',
    r: String(Math.min(Math.max(limit, 1), 100)),
    sort: 'score desc',
    wt: 'json',
  });
  const response = await fetch(buildSecIapdUrl('search/firm', params));
  if (!response.ok) throw new Error(`IAPD search returned ${response.status}`);
  const payload = record(await response.json());
  const hitContainer = record(payload?.hits);
  const total = hitContainer?.total;
  const rawHits = hitContainer?.hits;
  if (!Number.isSafeInteger(total) || Number(total) < 0 || !Array.isArray(rawHits)) {
    throw new Error('IAPD search response was malformed.');
  }

  const firms = rawHits.map(rawHit => {
    const source = record(record(rawHit)?._source);
    if (!source) throw new Error('IAPD search response was malformed.');
    let address: { city?: string; state?: string; country?: string } = {};
    try {
      const parsed = JSON.parse(String(source.firm_ia_address_details || '{}')) as { officeAddress?: typeof address };
      address = parsed.officeAddress || {};
    } catch {
      // The official response occasionally omits or malforms address JSON.
    }
    const crdNumber = String(source.firm_source_id || '');
    return {
      crdNumber,
      secNumber: String(source.firm_ia_full_sec_number || source.firm_ia_sec_number || ''),
      name: String(source.firm_name || ''),
      registrationScope: String(source.firm_ia_scope || 'Unknown'),
      hasDisclosures: String(source.firm_ia_disclosure_fl || '').toUpperCase() === 'Y',
      city: address.city || '',
      state: address.state || '',
      country: address.country || '',
      url: `https://adviserinfo.sec.gov/firm/summary/${encodeURIComponent(crdNumber)}`,
    };
  });
  return { total: Number(total), firms };
}

export function parseRulemakingIndex(html: string): OfficialSecItem[] {
  const doc = parseHtml(html);
  return Array.from(doc.querySelectorAll('tbody tr')).flatMap((row, index) => {
    const link = row.querySelector<HTMLAnchorElement>('a.info-button[href]');
    if (!link) return [];
    const cells = row.querySelectorAll('td');
    const title = normalizeText(row.querySelector('.regulation-node-title')?.textContent || cells[2]?.childNodes[0]?.textContent);
    if (!title) return [];
    const date = normalizeText(row.querySelector('time')?.textContent);
    const fileNumber = normalizeText(cells[1]?.textContent);
    const status = normalizeText(row.querySelector('.info-button__top')?.textContent).replace(/\s+Rule$/i, '');
    return [{
      id: link.getAttribute('href') || `rule-${index}`,
      title,
      date,
      type: 'Rulemaking',
      status,
      fileNumber,
      effectiveDate: '',
      description: normalizeText(row.querySelector('.regulation-node-metadata')?.textContent),
      division: normalizeText(row.querySelector('.division')?.textContent),
      url: absoluteSecUrl(link.getAttribute('href') || ''),
      source: 'SEC Rulemaking Activity',
    }];
  });
}

function parseEffectiveDate(html: string): string {
  const text = normalizeText(parseHtml(html).body?.textContent);
  return text.match(/Effective Date\s*:?\s*([^.;]{3,100})/i)?.[1]?.trim() || '';
}

export async function fetchSecRulemaking(query = ''): Promise<OfficialSecItem[]> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('search', query.trim());
  const items = parseRulemakingIndex(await fetchSecHtml('rules-regulations/rulemaking-activity', params)).slice(0, 50);
  if (!query.trim()) requireOfficialIndexItems(items, 'SEC Rulemaking Activity');
  const enriched: OfficialSecItem[] = [];
  for (let index = 0; index < items.length; index += 5) {
    const batch = items.slice(index, index + 5);
    const rows = await Promise.all(batch.map(async item => {
      try {
        const path = new URL(item.url).pathname.replace(/^\/+/, '');
        return { ...item, effectiveDate: parseEffectiveDate(await fetchSecHtml(path)) };
      } catch {
        return item;
      }
    }));
    enriched.push(...rows);
  }
  return enriched;
}

export function parseStaffGuidanceIndex(html: string): OfficialSecItem[] {
  const doc = parseHtml(html);
  const guidanceBody = doc.querySelector('.field--name-field-text')
    || doc.querySelector('.field--name-body');
  if (!guidanceBody) return [];
  const seen = new Set<string>();
  return Array.from(guidanceBody.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((link, index) => {
    const href = link.getAttribute('href') || '';
    const title = normalizeText(link.textContent);
    if (!href || !title || href === '/rules-regulations/staff-guidance') return [];
    const url = absoluteSecUrl(href);
    if (seen.has(url)) return [];
    seen.add(url);
    return [{
      id: href || `guidance-${index}`,
      title,
      date: '',
      type: 'Staff guidance',
      status: 'Staff view — nonbinding',
      fileNumber: '',
      effectiveDate: '',
      description: normalizeText(link.closest('li')?.textContent),
      division: normalizeText(link.closest('h2')?.textContent),
      url,
      source: 'SEC Staff Guidance',
    }];
  });
}

export async function fetchSecStaffGuidance(query = ''): Promise<OfficialSecItem[]> {
  const items = requireOfficialIndexItems(
    parseStaffGuidanceIndex(await fetchSecHtml('rules-regulations/staff-guidance')),
    'SEC Staff Guidance'
  );
  const needle = query.trim().toLowerCase();
  return needle
    ? items.filter(item => `${item.title} ${item.description} ${item.division}`.toLowerCase().includes(needle))
    : items;
}

const NO_ACTION_INDEXES = [
  { path: 'rules-regulations/no-action-interpretive-exemptive-letters/division-corporation-finance-no-action', division: 'Corporation Finance' },
  { path: 'divisions/investment/noaction/noaction.htm', division: 'Investment Management' },
  { path: 'rules-regulations/no-action-interpretive-exemptive-letters/division-trading-markets-no-action', division: 'Trading and Markets' },
];

export function parseNoActionIndex(html: string, division: string): OfficialSecItem[] {
  const doc = parseHtml(html);
  const chronological = doc.querySelector('#wexchron') || doc.querySelector('#chron')?.nextElementSibling || doc.querySelector('.field--name-body');
  const legacyStart = doc.querySelector<HTMLAnchorElement>('a[name="chron"]');
  const legacyEnd = doc.querySelector<HTMLAnchorElement>('a[name="regulation"]');
  const links = chronological
    ? Array.from(chronological.querySelectorAll<HTMLAnchorElement>('li > a[href]'))
    : legacyStart
      ? Array.from(doc.querySelectorAll<HTMLAnchorElement>('li > a[href]')).filter(link => {
          const afterStart = Boolean(legacyStart.compareDocumentPosition(link) & 4);
          const beforeEnd = !legacyEnd || Boolean(link.compareDocumentPosition(legacyEnd) & 4);
          return afterStart && beforeEnd;
        })
      : [];
  const seen = new Set<string>();
  return links.flatMap((link, index) => {
    const href = link.getAttribute('href') || '';
    const title = normalizeText(link.textContent);
    const itemText = normalizeText(link.closest('li')?.textContent);
    const date = itemText.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i)?.[0] || '';
    if (!href || !title || !date) return [];
    const url = absoluteSecUrl(href);
    if (seen.has(url)) return [];
    seen.add(url);
    return [{
      id: `${division}-${href || index}`,
      title,
      date,
      type: /exempt/i.test(title) ? 'Exemptive' : /interpret/i.test(title) ? 'Interpretive' : 'No-action',
      status: 'SEC staff response',
      fileNumber: '',
      effectiveDate: '',
      description: itemText,
      division,
      url,
      source: 'SEC No-Action, Interpretive and Exemptive Letters',
    }];
  });
}

export async function fetchSecNoActionLetters(query = ''): Promise<OfficialSecItem[]> {
  const pages = await Promise.all(NO_ACTION_INDEXES.map(async index => ({
    ...index,
    html: await fetchSecHtml(index.path),
  })));
  const seen = new Set<string>();
  const items = pages
    .flatMap(page => requireOfficialIndexItems(
      parseNoActionIndex(page.html, page.division),
      `SEC ${page.division} No-Action Letter index`
    ))
    .filter(item => !seen.has(item.url) && Boolean(seen.add(item.url)))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const needle = query.trim().toLowerCase();
  return (needle ? items.filter(item => `${item.title} ${item.description} ${item.division}`.toLowerCase().includes(needle)) : items)
    .slice(0, 500);
}
