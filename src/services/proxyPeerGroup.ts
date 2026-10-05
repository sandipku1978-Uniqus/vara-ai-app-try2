/**
 * The compensation peer group an issuer discloses in its latest DEF 14A,
 * resolved to SEC registrants.
 *
 *   submissions → latest DEF 14A → document HTML → blocks
 *     → deterministic extraction (table or list)        method 'table' | 'list'
 *     → otherwise the model, checked against the text    method 'ai'
 *     → names resolved against SEC's company directory
 *
 * Every resolved peer carries the accession of the proxy that named it. A
 * name that does not resolve — a foreign or private company, or a short name
 * that fits several registrants — comes back in `unresolved` with the reason,
 * never dropped. A name the model returned that the proxy text does not
 * contain is discarded and counted, because it was not read from the filing.
 */

import { askAi } from './aiApi';
import {
  aliasTickerFor,
  buildSecDocumentUrl,
  buildSecFilingIndexUrl,
  buildSecProxyUrl,
  fetchCompanySubmissions,
  getCompanyDirectory,
  type CompanyDirectoryEntry,
} from './secApi';
import { describeRecentFilingWindow, findLatestProxyFiling, type ProxyProvenance, type RecentFilingWindow } from '../lib/boardProxy';
import { stripSgmlEnvelope } from '../lib/filingText';
import {
  blocksToText,
  extractPeerGroupFromBlocks,
  parsePeerName,
  proxyBlocksFromNode,
  type MinimalNode,
  type ParsedPeerName,
  type ProxyBlock,
} from './proxyPeerExtract';

export type PeerGroupMethod = 'table' | 'list' | 'ai';

// ---------------------------------------------------------------------------
// Name → registrant
// ---------------------------------------------------------------------------

export type PeerMatch = 'printed-ticker' | 'exact-name' | 'brand-alias' | 'acronym' | 'name-prefix' | 'name-words';

export interface ResolvedPeerName {
  ticker: string;
  cik: string;
  title: string;
  match: PeerMatch;
}

export interface PeerNameCandidate {
  ticker: string;
  cik: string;
  title: string;
}

export type PeerNameResolution =
  | { ok: true; entry: ResolvedPeerName }
  | { ok: false; reason: 'no-match' | 'ambiguous'; candidates: PeerNameCandidate[] };

/** Legal-form words that differ between how a proxy and EDGAR print one company. */
const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'cos', 'companies', 'ltd', 'limited',
  'llc', 'lp', 'plc', 'nv', 'sa', 'se', 'ag', 'oyj', 'asa', 'ab', 'as', 'sab', 'cv', 'de', 'the',
]);

/**
 * "The Procter & Gamble Company" and "PROCTER & GAMBLE Co" → "procter and gamble";
 * "QUALCOMM INC/DE" → "qualcomm"; "McDonald's" → "mcdonalds"; "J.M. Smucker"
 * → "j m smucker"; "Intl Business Machines Corp." → "international business machines".
 */
export function normalizeRegistrantName(name: string): string {
  const words = name
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\/[a-z]{2,3}\/?$/, ' ')
    .replace(/['\u2018\u2019`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => (word === 'intl' ? 'international' : word));
  if (words[0] === 'the') words.shift();
  // "Merck & Co., Inc." loses "inc", "co" and then the dangling "and".
  while (words.length > 1 && (LEGAL_SUFFIXES.has(words[words.length - 1]) || words[words.length - 1] === 'and')) words.pop();
  return words.join(' ');
}

export interface PeerNameIndex {
  byTicker: Map<string, CompanyDirectoryEntry>;
  byName: Map<string, CompanyDirectoryEntry[]>;
  entries: Array<{ norm: string; words: Set<string>; entry: CompanyDirectoryEntry }>;
  /** Position in SEC's file (roughly market-cap order), first ticker per CIK. */
  rankByCik: Map<string, number>;
}

/** Index the directory once; entries keep SEC's file order (roughly largest first). */
export function buildPeerNameIndex(directory: CompanyDirectoryEntry[]): PeerNameIndex {
  const byTicker = new Map<string, CompanyDirectoryEntry>();
  const byName = new Map<string, CompanyDirectoryEntry[]>();
  const entries: PeerNameIndex['entries'] = [];
  const rankByCik = new Map<string, number>();
  directory.forEach((entry, position) => {
    if (!byTicker.has(entry.ticker)) byTicker.set(entry.ticker, entry);
    if (!rankByCik.has(entry.cik)) rankByCik.set(entry.cik, position);
    const norm = normalizeRegistrantName(entry.title);
    if (!norm) return;
    const list = byName.get(norm);
    if (list) list.push(entry); else byName.set(norm, [entry]);
    entries.push({ norm, words: new Set(norm.split(' ')), entry });
  });
  return { byTicker, byName, entries, rankByCik };
}

/** One entry per registrant: GOOGL and GOOG are one CIK, first ticker wins. */
function distinctByCik(entries: CompanyDirectoryEntry[]): CompanyDirectoryEntry[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    if (seen.has(entry.cik)) return false;
    seen.add(entry.cik);
    return true;
  });
}

function resolved(entry: CompanyDirectoryEntry, match: PeerMatch): PeerNameResolution {
  return { ok: true, entry: { ticker: entry.ticker, cik: entry.cik, title: entry.title, match } };
}

function candidatesOf(entries: CompanyDirectoryEntry[]): PeerNameCandidate[] {
  return entries.slice(0, 3).map(entry => ({ ticker: entry.ticker, cik: entry.cik, title: entry.title }));
}

/**
 * Several registrants share a short name ("Meta" → Meta Platforms, Meta
 * Materials). When one of them sits among SEC's largest filers and every
 * other sits far down the size-ordered directory, the proxy's short name
 * means the large one. Anything closer than that stays ambiguous.
 */
const DOMINANT_RANK = 500;
const DISTANT_RANK = 3000;

function dominant(index: PeerNameIndex, entries: CompanyDirectoryEntry[]): CompanyDirectoryEntry | null {
  const ranked = [...entries].sort((a, b) => (index.rankByCik.get(a.cik) ?? Infinity) - (index.rankByCik.get(b.cik) ?? Infinity));
  const first = index.rankByCik.get(ranked[0].cik) ?? Infinity;
  const second = index.rankByCik.get(ranked[1]?.cik ?? '') ?? Infinity;
  return first < DOMINANT_RANK && second >= DISTANT_RANK ? ranked[0] : null;
}

function initials(norm: string): string {
  return norm.split(' ').filter(word => !['and', 'of'].includes(word)).map(word => word[0]).join('');
}

/**
 * Resolve one disclosed name. Order of evidence: a ticker the proxy printed
 * beside the name, the exact legal name, a known brand alias, an acronym
 * that is both a ticker and that registrant's initials ("IBM"), then a name
 * that is the unique prefix of one registrant ("Cisco" → Cisco Systems) or
 * whose words appear in exactly one registrant's name ("Disney" → Walt
 * Disney Co, "A.O. Smith" → SMITH A O CORP). Several registrants fitting
 * equally is "ambiguous" with the candidates listed — the analyst picks.
 */
export function resolvePeerName(index: PeerNameIndex, peer: ParsedPeerName): PeerNameResolution {
  if (peer.tickerHint) {
    const hint = peer.tickerHint.toUpperCase();
    const entry = index.byTicker.get(hint) ?? index.byTicker.get(hint.replace(/\./g, '-'));
    if (entry) return resolved(entry, 'printed-ticker');
  }

  const norm = normalizeRegistrantName(peer.name);
  if (!norm) return { ok: false, reason: 'no-match', candidates: [] };

  const exact = distinctByCik(index.byName.get(norm) ?? []);
  if (exact.length === 1) return resolved(exact[0], 'exact-name');
  if (exact.length > 1) {
    const pick = dominant(index, exact);
    return pick ? resolved(pick, 'exact-name') : { ok: false, reason: 'ambiguous', candidates: candidatesOf(exact) };
  }

  const alias = aliasTickerFor(peer.name);
  const aliased = alias ? index.byTicker.get(alias) : undefined;
  if (aliased) return resolved(aliased, 'brand-alias');

  const acronym = peer.name.replace(/\s+(?:Corporation|Corp\.?|Inc\.?|Company|Co\.?)$/i, '').trim();
  if (/^[A-Z]{2,5}$/.test(acronym)) {
    const entry = index.byTicker.get(acronym);
    if (entry && initials(normalizeRegistrantName(entry.title)) === acronym.toLowerCase()) return resolved(entry, 'acronym');
  }

  const prefix = distinctByCik(index.entries.filter(item => item.norm.startsWith(`${norm} `)).map(item => item.entry));
  if (prefix.length === 1) return resolved(prefix[0], 'name-prefix');
  if (prefix.length > 1) {
    const pick = dominant(index, prefix);
    return pick ? resolved(pick, 'name-prefix') : { ok: false, reason: 'ambiguous', candidates: candidatesOf(prefix) };
  }

  const words = norm.split(' ');
  if (words.join('').length >= 4) {
    const containing = distinctByCik(index.entries
      .filter(item => words.every(word => item.words.has(word)))
      .map(item => item.entry));
    if (containing.length === 1) return resolved(containing[0], 'name-words');
    if (containing.length > 1) {
      const pick = dominant(index, containing);
      return pick ? resolved(pick, 'name-words') : { ok: false, reason: 'ambiguous', candidates: candidatesOf(containing) };
    }
  }
  return { ok: false, reason: 'no-match', candidates: [] };
}

// ---------------------------------------------------------------------------
// The loaded peer group
// ---------------------------------------------------------------------------

export interface ProxyPeer extends ResolvedPeerName {
  /** The name exactly as the proxy printed it. */
  disclosedName: string;
  /** The caption of the group it was listed under. */
  group: string;
  /** Accession of the DEF 14A that names this peer. */
  accession: string;
}

export interface UnresolvedProxyPeer {
  disclosedName: string;
  group: string;
  tickerHint: string | null;
  reason: 'no-match' | 'ambiguous';
  candidates: PeerNameCandidate[];
  accession: string;
}

export interface ProxyPeerGroup {
  subject: { cik: string; name: string };
  filing: ProxyProvenance;
  method: PeerGroupMethod;
  /** The proxy's words introducing the group (deterministic methods only). */
  anchorText: string;
  peers: ProxyPeer[];
  unresolved: UnresolvedProxyPeer[];
  /** The proxy lists the issuer itself (common in tables of percentile ranks). */
  listsSubject: boolean;
  /** Names the model returned that do not occur in the proxy text (method 'ai' only). */
  discardedModelNames: string[];
}

export type ProxyPeerFailure =
  | { kind: 'submissions-unavailable'; cik: string }
  | { kind: 'no-proxy'; cik: string; companyName: string; window: RecentFilingWindow }
  | { kind: 'proxy-unreadable'; cik: string; companyName: string; filing: ProxyProvenance; status?: number }
  | { kind: 'directory-unavailable'; cik: string; companyName: string; filing: ProxyProvenance }
  | { kind: 'no-peer-group'; cik: string; companyName: string; filing: ProxyProvenance; modelConsulted: boolean; modelFailed: boolean };

export type ProxyPeerGroupOutcome =
  | { ok: true; group: ProxyPeerGroup }
  | { ok: false; failure: ProxyPeerFailure };

/** Pure: resolve extracted names and split them into peers and unresolved. */
export function resolveExtractedPeers(
  index: PeerNameIndex,
  names: Array<ParsedPeerName & { group: string }>,
  subjectCik: string,
  accession: string,
): Pick<ProxyPeerGroup, 'peers' | 'unresolved' | 'listsSubject'> {
  const subject = String(Number(subjectCik));
  const peers: ProxyPeer[] = [];
  const unresolved: UnresolvedProxyPeer[] = [];
  const seenCiks = new Set<string>();
  let listsSubject = false;
  for (const name of names) {
    const resolution = resolvePeerName(index, name);
    if (!resolution.ok) {
      unresolved.push({
        disclosedName: name.name,
        group: name.group,
        tickerHint: name.tickerHint,
        reason: resolution.reason,
        candidates: resolution.candidates,
        accession,
      });
      continue;
    }
    if (resolution.entry.cik === subject) { listsSubject = true; continue; }
    if (seenCiks.has(resolution.entry.cik)) continue;
    seenCiks.add(resolution.entry.cik);
    peers.push({ ...resolution.entry, disclosedName: name.name, group: name.group, accession });
  }
  return { peers, unresolved, listsSubject };
}

// ---------------------------------------------------------------------------
// Model fallback
// ---------------------------------------------------------------------------

const PEER_MENTION = /peer\s+group|comparator\s+group|peer\s+compan|compensation\s+peers/gi;
const MODEL_CONTEXT_CHARS = 24_000;

/** Windows of proxy text around each peer-group mention, merged and bounded. */
export function peerMentionExcerpts(text: string, radius = 2_500, limit = MODEL_CONTEXT_CHARS): string {
  const spans: Array<[number, number]> = [];
  for (const match of text.matchAll(PEER_MENTION)) {
    const start = Math.max(0, (match.index ?? 0) - 600);
    const end = Math.min(text.length, (match.index ?? 0) + radius);
    const last = spans[spans.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
  }
  let out = '';
  for (const [start, end] of spans) {
    const piece = text.slice(start, end);
    if (out.length + piece.length > limit) {
      out += `\n…\n${piece.slice(0, Math.max(0, limit - out.length))}`;
      break;
    }
    out += `${out ? '\n…\n' : ''}${piece}`;
  }
  return out;
}

function squash(value: string): string {
  return value.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Keep only model-returned names the proxy text actually contains. The model
 * is a reader of last resort; anything it did not read from the filing is
 * reported as discarded, not shown as a peer.
 */
export function verifyModelNames(raw: unknown, proxyText: string): { accepted: ParsedPeerName[]; discarded: string[] } {
  const list = Array.isArray(raw) ? raw : [];
  const haystack = squash(proxyText);
  const accepted: ParsedPeerName[] = [];
  const discarded: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const parsed = parsePeerName(item);
    if (parsed && haystack.includes(squash(parsed.name))) accepted.push(parsed);
    else discarded.push(item.trim().slice(0, 120));
  }
  return { accepted, discarded };
}

function parseJsonArray(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function askModelForPeerNames(excerpts: string): Promise<unknown> {
  const question = [
    'List the companies this proxy statement names as its compensation peer group',
    '(the companies the compensation committee uses to benchmark executive pay).',
    'Return ONLY a JSON array of strings, each a company name copied exactly as it is written in the text.',
    'Do not add companies that are not written in the text. If the text does not name the companies, return [].',
  ].join(' ');
  const answer = await askAi(question, `DEF 14A EXCERPTS:\n${excerpts}`, { throwOnError: true });
  return parseJsonArray(answer);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function parseDocument(html: string): MinimalNode | null {
  if (typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(stripSgmlEnvelope(html), 'text/html');
  return (document.body as unknown as MinimalNode) ?? null;
}

export interface ProxyPeerLoaderDeps {
  fetchSubmissions: typeof fetchCompanySubmissions;
  fetchDocument: (cik: string, accession: string, primaryDocument: string) => Promise<{ ok: true; html: string } | { ok: false; status?: number }>;
  loadDirectory: () => Promise<CompanyDirectoryEntry[]>;
  askModel: (excerpts: string) => Promise<unknown>;
}

async function fetchProxyDocument(cik: string, accession: string, primaryDocument: string) {
  try {
    const response = await fetch(buildSecProxyUrl(`Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${primaryDocument}`));
    if (!response.ok) return { ok: false as const, status: response.status };
    return { ok: true as const, html: await response.text() };
  } catch {
    return { ok: false as const };
  }
}

const defaultDeps: ProxyPeerLoaderDeps = {
  fetchSubmissions: fetchCompanySubmissions,
  fetchDocument: fetchProxyDocument,
  loadDirectory: getCompanyDirectory,
  askModel: askModelForPeerNames,
};

/** The deterministic and model stages over an already-parsed proxy, without I/O beyond the model. */
export async function peerNamesFromBlocks(
  blocks: ProxyBlock[],
  askModel: ProxyPeerLoaderDeps['askModel'],
): Promise<
  | { method: 'table' | 'list'; names: Array<ParsedPeerName & { group: string }>; anchorText: string; discarded: string[] }
  | { method: 'ai'; names: Array<ParsedPeerName & { group: string }>; anchorText: string; discarded: string[] }
  | { method: null; modelConsulted: boolean; modelFailed: boolean }
> {
  const extraction = extractPeerGroupFromBlocks(blocks);
  if (extraction) {
    return { method: extraction.method, names: extraction.peers, anchorText: extraction.anchorText, discarded: [] };
  }
  const text = blocksToText(blocks);
  const excerpts = peerMentionExcerpts(text);
  // No mention of a peer group anywhere: nothing for the model to read.
  if (!excerpts) return { method: null, modelConsulted: false, modelFailed: false };
  let raw: unknown;
  try {
    raw = await askModel(excerpts);
  } catch {
    return { method: null, modelConsulted: true, modelFailed: true };
  }
  const { accepted, discarded } = verifyModelNames(raw, text);
  if (accepted.length === 0) return { method: null, modelConsulted: true, modelFailed: raw === null };
  return {
    method: 'ai',
    names: accepted.map(name => ({ ...name, group: 'Read by AI from the DEF 14A text' })),
    anchorText: '',
    discarded,
  };
}

const groupCache = new Map<string, ProxyPeerGroup>();
const inFlight = new Map<string, Promise<ProxyPeerGroupOutcome>>();

async function load(cik: string, deps: ProxyPeerLoaderDeps): Promise<ProxyPeerGroupOutcome> {
  const submissions = await deps.fetchSubmissions(cik.padStart(10, '0')).catch(() => null);
  if (!submissions) return { ok: false, failure: { kind: 'submissions-unavailable', cik } };
  const companyName = submissions.name;

  const filing = findLatestProxyFiling(submissions.filings.recent);
  if (!filing) {
    return { ok: false, failure: { kind: 'no-proxy', cik, companyName, window: describeRecentFilingWindow(submissions.filings.recent) } };
  }
  const provenance: ProxyProvenance = {
    ...filing,
    cik,
    documentUrl: buildSecDocumentUrl(cik, filing.accessionNumber, filing.primaryDocument),
    indexUrl: buildSecFilingIndexUrl(cik, filing.accessionNumber),
  };

  const document = await deps.fetchDocument(cik, filing.accessionNumber, filing.primaryDocument);
  const root = document.ok ? parseDocument(document.html) : null;
  if (!document.ok || !root) {
    return { ok: false, failure: { kind: 'proxy-unreadable', cik, companyName, filing: provenance, status: document.ok ? undefined : document.status } };
  }
  const blocks = proxyBlocksFromNode(root);
  if (blocks.length === 0) {
    return { ok: false, failure: { kind: 'proxy-unreadable', cik, companyName, filing: provenance } };
  }

  const names = await peerNamesFromBlocks(blocks, deps.askModel);
  if (names.method === null) {
    return {
      ok: false,
      failure: { kind: 'no-peer-group', cik, companyName, filing: provenance, modelConsulted: names.modelConsulted, modelFailed: names.modelFailed },
    };
  }

  const directory = await deps.loadDirectory().catch(() => [] as CompanyDirectoryEntry[]);
  if (directory.length === 0) {
    return { ok: false, failure: { kind: 'directory-unavailable', cik, companyName, filing: provenance } };
  }
  const resolution = resolveExtractedPeers(buildPeerNameIndex(directory), names.names, cik, filing.accessionNumber);
  return {
    ok: true,
    group: {
      subject: { cik, name: companyName },
      filing: provenance,
      method: names.method,
      anchorText: names.anchorText,
      ...resolution,
      discardedModelNames: names.discarded,
    },
  };
}

/**
 * Load the peer group for a registrant (CIK, padded or not). Successes are
 * cached for the session and concurrent requests share one load; failures
 * are retried on the next call.
 */
export function loadProxyPeerGroup(rawCik: string, deps: ProxyPeerLoaderDeps = defaultDeps): Promise<ProxyPeerGroupOutcome> {
  const cik = String(Number(rawCik));
  if (!/^\d{1,10}$/.test(cik) || cik === '0') {
    return Promise.resolve({ ok: false, failure: { kind: 'submissions-unavailable', cik: rawCik } });
  }
  const cached = groupCache.get(cik);
  if (cached) return Promise.resolve({ ok: true, group: cached });
  const pending = inFlight.get(cik);
  if (pending) return pending;
  const work = load(cik, deps)
    .then(outcome => {
      if (outcome.ok) groupCache.set(cik, outcome.group);
      return outcome;
    })
    .finally(() => {
      if (inFlight.get(cik) === work) inFlight.delete(cik);
    });
  inFlight.set(cik, work);
  return work;
}

/** One sentence per failure, distinct for each way the load can stop. */
export function describeProxyPeerFailure(failure: ProxyPeerFailure): string {
  switch (failure.kind) {
    case 'submissions-unavailable':
      return 'SEC filing index could not be loaded, so the latest proxy could not be located. Try again.';
    case 'no-proxy':
      return `No DEF 14A among ${failure.companyName}'s ${failure.window.count} most recent filings${failure.window.from ? ` (${failure.window.from} to ${failure.window.to})` : ''}.`;
    case 'proxy-unreadable':
      return `The DEF 14A filed ${failure.filing.filingDate} (${failure.filing.accessionNumber}) could not be read${failure.status ? ` (HTTP ${failure.status})` : ''}. Try again.`;
    case 'directory-unavailable':
      return 'SEC\'s company directory could not be loaded, so the disclosed names could not be matched to tickers. Try again.';
    case 'no-peer-group':
      if (failure.modelFailed) {
        return `No peer group table or list was found in the DEF 14A filed ${failure.filing.filingDate}, and the AI reading could not be completed.`;
      }
      return failure.modelConsulted
        ? `The DEF 14A filed ${failure.filing.filingDate} mentions a peer group but does not name its members in text that could be read.`
        : `The DEF 14A filed ${failure.filing.filingDate} does not disclose a compensation peer group.`;
  }
}

/** Test seam. */
export function __clearProxyPeerGroupCache(): void {
  groupCache.clear();
  inFlight.clear();
}
