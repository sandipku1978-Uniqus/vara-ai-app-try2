/**
 * npx tsx scripts/accuracy/recall-sets/build-recall-set.ts [--set <id>] [--refresh] [--reverify]
 * Sequential official SEC downloads, cached outside the repository. No entry
 * is written without checking the full primary document and exact evidence.
 * --refresh bypasses cached responses; --reverify requires every saved target.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import {
  assertSecDocumentResponse, buildSecTargetUrl, fetchSecResponse,
  looksLikeSecErrorResponse, parseSecJsonResponse, readResponseWithLimit,
  type SecUpstream,
} from '../../../src/lib/sec-upstream';
import { extractDocumentTextFromHtmlServer } from '../../../src/lib/filingTextServer';
import { booleanQueryMatches } from '../../../src/utils/booleanSearch';
import { DEFAULT_RECALL_SETS_DIR, loadRecallSets, validateRecallSet, type RecallSet, type RecallExpectedFiling } from '../recall';

interface Topic {
  id: string;
  description: string;
  query: string;
  eftsQuery: string;
  dateFrom: string;
  dateTo: string;
  evidencePhrase: string;
}

const TOPICS: Topic[] = [
  {
    id: 'material-weakness-revenue-recognition-10k-fy2024',
    description: 'Material weakness and revenue recognition in FY2024 primary 10-Ks filed March 25, 2025.',
    query: '"material weakness" AND "revenue recognition"',
    eftsQuery: '"material weakness" AND "revenue recognition"',
    dateFrom: '2025-03-25', dateTo: '2025-03-25', evidencePhrase: 'material weakness',
  },
  {
    id: 'segment-asu-2023-07-10k-fy2024',
    description: 'Segment within ten words of ASU 2023-07 in FY2024 primary 10-Ks filed March 24–25, 2025.',
    query: '"segment" W/10 "ASU 2023-07"',
    eftsQuery: '"segment" AND "ASU 2023-07"',
    dateFrom: '2025-03-24', dateTo: '2025-03-25', evidencePhrase: 'ASU 2023',
  },
  {
    id: 'going-concern-10k-fy2024',
    description: 'Substantial doubt within fifteen words of going concern in FY2024 primary 10-Ks filed March 25, 2025.',
    query: '"substantial doubt" W/15 "going concern"',
    eftsQuery: '"substantial doubt" AND "going concern"',
    dateFrom: '2025-03-25', dateTo: '2025-03-25', evidencePhrase: 'substantial doubt',
  },
  {
    id: 'critical-audit-matter-goodwill-impairment-10k-fy2024',
    description: 'Critical audit matter, goodwill and impairment in FY2024 primary 10-Ks filed March 24–25, 2025.',
    query: '"critical audit matter" AND "goodwill" AND "impairment"',
    eftsQuery: '"critical audit matter" AND "goodwill" AND "impairment"',
    dateFrom: '2025-03-24', dateTo: '2025-03-25', evidencePhrase: 'critical audit matter',
  },
  {
    id: 'non-gaap-adjusted-ebitda-reconciliation-10k-fy2024',
    description: 'Non-GAAP, adjusted EBITDA and reconciliation in FY2024 primary 10-Ks filed March 24–28, 2025 (no exhibits).',
    query: '"non-GAAP" AND "adjusted EBITDA" AND "reconciliation"',
    eftsQuery: '"non-GAAP" AND "adjusted EBITDA" AND "reconciliation"',
    dateFrom: '2025-03-24', dateTo: '2025-03-28', evidencePhrase: 'adjusted EBITDA',
  },
];

interface Candidate {
  accession: string;
  cik: string;
  companyName: string;
  form: string;
  fileDate: string;
  document: string;
  periodEnding: string;
}

/** EFTS primary hits only; exhibit snippets can never certify a primary. */
function candidateFromHit(value: unknown): Candidate | null {
  if (!value || typeof value !== 'object') return null;
  const hit = value as Record<string, unknown>;
  if (!hit._source || typeof hit._source !== 'object') return null;
  const source = hit._source as Record<string, unknown>;
  if (source.file_type !== '10-K' || source.form !== '10-K' || Number(source.sequence) !== 1
    || source.period_ending !== '2024-12-31') return null;
  const accession = String(source.adsh || '');
  const id = String(hit._id || '');
  const document = id.slice(id.indexOf(':') + 1);
  const cik = Array.isArray(source.ciks) ? source.ciks[0] : '';
  const companyName = Array.isArray(source.display_names) ? source.display_names[0] : '';
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !id.startsWith(`${accession}:`)
    || !/^[A-Za-z0-9._-]+\.html?$/i.test(document) || typeof cik !== 'string' || !/^\d{1,10}$/.test(cik)
    || typeof companyName !== 'string' || !companyName.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(String(source.file_date))) return null;
  return { accession, cik, companyName, document, form: '10-K', fileDate: String(source.file_date), periodEnding: '2024-12-31' };
}

/** Prefer a single verbatim window that proves the whole query. When AND
 * terms are distant, evidence is a focal phrase; the full document, not this
 * <=200-character excerpt, remains the Boolean witness (recorded in notes). */
export function evidenceFromText(query: string, text: string, focalPhrase: string): string | null {
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const needles = [focalPhrase, ...phrases];
  let fallback: string | null = null;
  for (const needle of needles) {
    const pattern = needle.split(/[\s-]+/).map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\p{Pd}-]+');
    const regex = new RegExp(pattern, 'giu');
    for (const match of text.matchAll(regex)) {
      const start = Math.max(0, (match.index ?? 0) - 45);
      const snippet = text.slice(start, start + 200).trim();
      if (!text.includes(snippet)) continue;
      fallback ??= snippet;
      if (booleanQueryMatches(query, snippet)) return snippet;
    }
  }
  return fallback;
}

function fiscalYearFocus(html: string): string[] {
  const { document } = parseHTML(html);
  return Array.from(document.querySelectorAll('[name]'))
    .filter(node => node.tagName.toLowerCase() === 'ix:nonnumeric'
      && node.getAttribute('name')?.toLowerCase() === 'dei:documentfiscalyearfocus')
    .map(node => (node.textContent || '').trim());
}

const USER_AGENT = process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';
const CACHE_DIR = join(tmpdir(), 'urc-recall-sec-documents-v1');
let lastStartAt = 0;

async function officialBytes(upstream: SecUpstream, path: string, params: URLSearchParams, refresh: boolean, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted();
  const url = buildSecTargetUrl(upstream, path, params);
  const cachePath = join(CACHE_DIR, `${createHash('sha256').update(url.href).digest('hex')}.json`);
  if (!refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8')) as { url: string; body: string; sha256: string };
      if (cached.url !== url.href || typeof cached.body !== 'string'
        || createHash('sha256').update(cached.body).digest('hex') !== cached.sha256) throw new Error('invalid cache');
      signal.throwIfAborted();
      return new TextEncoder().encode(cached.body);
    } catch (error) { if (signal.aborted) throw error; }
  }
  await delay(Math.max(0, lastStartAt + 300 - Date.now()), undefined, { signal });
  lastStartAt = Date.now();
  // Redirects are rejected here: a redirect must not sneak an additional
  // request inside this generator's stricter 300ms courtesy interval.
  let attempts = 0;
  const response = await fetchSecResponse(url, upstream, signal, USER_AGENT, () => ++attempts === 1);
  if (upstream === 'proxy') assertSecDocumentResponse(response);
  if (!response.ok) throw new Error(`SEC ${response.status} ${url.href}`);
  const bytes = await readResponseWithLimit(response, 25 * 1024 * 1024, signal);
  // Measure courtesy spacing from body completion, so even a slow central
  // pacing reservation cannot compress actual starts below 300ms apart.
  lastStartAt = Date.now();
  if (looksLikeSecErrorResponse(bytes)) throw new Error(`SEC error page: ${url.href}`);
  if (upstream === 'efts') parseSecJsonResponse(bytes, response.headers.get('content-type'));
  const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath, JSON.stringify({ url: url.href, body, sha256: createHash('sha256').update(body).digest('hex') }));
  return bytes;
}

async function collectCandidates(topic: Topic, refresh: boolean, signal: AbortSignal): Promise<{ candidates: Candidate[]; total: number }> {
  const candidates = new Map<string, Candidate>();
  let total = 0;
  // Bounded windows keep the source universe near the sample. Hard cap avoids
  // an accidental corpus crawl when somebody widens a topic's date range.
  for (let from = 0; from < 500; from += 100) {
    const params = new URLSearchParams({ q: topic.eftsQuery, forms: '10-K', dateRange: 'custom', startdt: topic.dateFrom, enddt: topic.dateTo, from: String(from), size: '100' });
    const bytes = await officialBytes('efts', 'LATEST/search-index', params, refresh, signal);
    const data = JSON.parse(new TextDecoder().decode(bytes)) as { hits?: { total?: { value?: number }; hits?: unknown[] }; timed_out?: boolean };
    if (data.timed_out || !Array.isArray(data.hits?.hits) || typeof data.hits.total?.value !== 'number') throw new Error('Invalid/incomplete EFTS page');
    total = data.hits.total.value;
    for (const hit of data.hits.hits) {
      const candidate = candidateFromHit(hit);
      if (candidate) candidates.set(candidate.accession, candidate);
    }
    if (from + 100 >= total || data.hits.hits.length < 100) break;
  }
  return { candidates: [...candidates.values()], total };
}

async function verifyCandidate(topic: Topic, candidate: Candidate, refresh: boolean, signal: AbortSignal): Promise<RecallExpectedFiling | null> {
  const path = `Archives/edgar/data/${Number(candidate.cik)}/${candidate.accession.replace(/-/g, '')}/${candidate.document}`;
  const bytes = await officialBytes('proxy', path, new URLSearchParams(), refresh, signal);
  const html = new TextDecoder().decode(bytes);
  const fiscalYears = fiscalYearFocus(html);
  if (!fiscalYears.length || fiscalYears.some(year => year !== '2024')) {
    console.log(`  drop ${candidate.accession}: FY2024 not confirmed by DEI fact`);
    return null;
  }
  const text = extractDocumentTextFromHtmlServer(html);
  if (!text.trim()) { console.log(`  drop ${candidate.accession}: could not parse document text`); return null; }
  if (!booleanQueryMatches(topic.query, text)) {
    console.log(`  drop ${candidate.accession}: Boolean expression not present in primary text`);
    return null;
  }
  const evidence = evidenceFromText(topic.query, text, topic.evidencePhrase);
  if (!evidence || evidence.length > 200 || !text.includes(evidence)) return null;
  console.log(`  verified ${candidate.accession} ${candidate.document} (${text.length} text chars)`);
  return {
    accession: candidate.accession, cik: candidate.cik, companyName: candidate.companyName,
    form: candidate.form, fileDate: candidate.fileDate, document: candidate.document,
    evidence, verifiedAt: new Date().toISOString().slice(0, 10),
    verifiedUrl: buildSecTargetUrl('proxy', path, new URLSearchParams()).href,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const selected = args.includes('--set') ? args[args.indexOf('--set') + 1] : null;
  if (args.includes('--set') && !selected) throw new Error('--set requires a topic id');
  if (selected && !TOPICS.some(topic => topic.id === selected)) throw new Error(`Unknown topic: ${selected}`);
  const refresh = args.includes('--refresh');
  const reverify = args.includes('--reverify');
  const prior = new Map<string, RecallSet>();
  const existingFiles = await readdir(DEFAULT_RECALL_SETS_DIR);
  if (existingFiles.some(file => file.endsWith('.json')) || reverify) {
    // Never silently discard a measured floor because another file is bad.
    for (const set of loadRecallSets()) prior.set(set.id, set);
  }
  for (const topic of TOPICS.filter(topic => !selected || topic.id === selected)) {
    const signal = AbortSignal.timeout(20 * 60_000);
    console.log(`\n${topic.id}: official EFTS candidates`);
    const { candidates, total } = await collectCandidates(topic, refresh, signal);
    console.log(`  ${total} EFTS document hits; ${candidates.length} FY2024 calendar-year primary candidates`);
    const old = prior.get(topic.id);
    if (reverify && !old) throw new Error(`No saved set: ${topic.id}`);
    const targetAccessions = new Set(old?.expected.map(entry => entry.accession));
    const eligible = reverify ? candidates.filter(candidate => targetAccessions.has(candidate.accession)) : candidates;
    const expected: RecallExpectedFiling[] = [];
    for (const candidate of eligible) {
      // A transport failure stops the build rather than inventing data or
      // selecting only the issuers that happen to evade an SEC access block.
      const entry = await verifyCandidate(topic, candidate, refresh, signal);
      if (entry) expected.push(entry);
      if (!reverify && expected.length === 15) break;
    }
    if (reverify && expected.length !== old?.expected.length) throw new Error(`${topic.id}: saved targets failed re-verification; no write`);
    const set = validateRecallSet({
      id: topic.id, description: topic.description, query: topic.query, mode: 'boolean',
      filters: { formTypes: ['10-K'], dateFrom: topic.dateFrom, dateTo: topic.dateTo, fiscalYear: 2024 },
      expected,
      recallFloor: old?.recallFloor ?? 0.5,
      floorRationale: old?.floorRationale ?? `UNMEASURED: conservative placeholder floor 0.50; no immutable candidate product URL available on ${new Date().toISOString().slice(0, 10)}. Set a measured floor only after an actual product sample-recall run; never lower a floor to make a run pass.`,
      notes: `Verified SAMPLE, not the complete true-positive universe. Sample recall = found/sample expected; a lower-bound-type regression check, not a statistical bound or corpus recall estimate. Selected the first 15 distinct matching primary documents in official EFTS relevance order, dropping failures of local verification. Source query ${topic.eftsQuery} returned ${total} document hits in this bounded window, of which ${candidates.length} were calendar-year FY2024 primary candidates; the proximity true-positive universe can be smaller. FY2024 is independently confirmed by the primary document's dei:DocumentFiscalYearFocus=2024 and EFTS period_ending=2024-12-31. Product applies form/date filters, with no fiscal-year filter; only the expected sample is constrained to FY2024. The full extracted primary text satisfies the complete product Boolean expression. Evidence is a verbatim <=200-character local window; when AND terms are distant it shows a focal query phrase, not every operand. These are textual co-occurrences, not assertions that a company has a material weakness, substantial doubt, a goodwill CAM, or any particular accounting outcome. Non-GAAP coverage uses 10-K primary text only, not earnings-release exhibits. Raw official responses are cached with URL and SHA-256 under os.tmpdir()/urc-recall-sec-documents-v1; --refresh downloads anew.`,
    });
    await mkdir(DEFAULT_RECALL_SETS_DIR, { recursive: true });
    await writeFile(join(DEFAULT_RECALL_SETS_DIR, `${topic.id}.json`), `${JSON.stringify(set, null, 2)}\n`);
    console.log(`  wrote ${expected.length} individually verified accessions; sample recall floor=${set.recallFloor}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
