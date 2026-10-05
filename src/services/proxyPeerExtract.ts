/**
 * Deterministic extraction of the compensation peer group a DEF 14A discloses.
 *
 * Proxies publish the peer group in one of two shapes: a table of company
 * names (often several names per row, sometimes beside revenue and market-cap
 * columns), or a list — one name per paragraph or bullet, or a sentence
 * ("Our peer group consists of the following companies: A, B, C and D.").
 * Filing text flattens table cells onto one line separated by single spaces,
 * which makes "Cisco Systems Intel Oracle" unsplittable, so this works on the
 * document's structure (prose blocks and tables with their cells intact), not
 * on the extracted text.
 *
 * Everything here is pure: DOM in, names out. The loader in proxyPeerGroup
 * fetches the document and resolves the names to registrants.
 */

export type ProxyBlock =
  | { kind: 'text'; text: string }
  | { kind: 'table'; rows: string[][] };

export interface MinimalNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MinimalNode>;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
  'li', 'main', 'ol', 'p', 'pre', 'section', 'ul',
]);
const DROPPED_TAGS = new Set(['script', 'style', 'noscript', 'template', 'ix:header', 'ix:hidden']);
const BULLET_ONLY = /^[\s•●▪■◦○◆♦➢►\-–—*·ü]+$/u;

export function cleanCellText(value: string): string {
  return value
    .replace(/[   ​﻿]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cell text keeps its internal lines; each line is whitespace-normalized. */
function cleanCellLines(value: string): string {
  return value.split('\n').map(cleanCellText).filter(Boolean).join('\n');
}

function collectText(node: MinimalNode, parts: string[]): void {
  if (node.nodeType === TEXT_NODE) {
    parts.push(node.textContent || '');
    return;
  }
  if (node.nodeType !== ELEMENT_NODE) return;
  const tag = node.nodeName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) return;
  // Inside a cell, a line break or block separates entries: Microsoft's peer
  // table puts two companies in each cell, one per line.
  if (tag === 'br') { parts.push('\n'); return; }
  const isBoundary = BLOCK_TAGS.has(tag) || tag === 'tr' || tag === 'table';
  const separator = isBoundary ? '\n' : (tag === 'td' || tag === 'th') ? ' ' : '';
  if (separator) parts.push(separator);
  for (let i = 0; i < node.childNodes.length; i += 1) collectText(node.childNodes[i], parts);
  if (separator) parts.push(separator);
}

/** Rows of this table only; a nested table's cells stay inside their parent cell's text. */
function tableRows(table: MinimalNode): string[][] {
  const rows: string[][] = [];
  const visit = (node: MinimalNode): void => {
    for (let i = 0; i < node.childNodes.length; i += 1) {
      const child = node.childNodes[i];
      if (child.nodeType !== ELEMENT_NODE) continue;
      const tag = child.nodeName.toLowerCase();
      if (tag === 'tr') {
        const cells: string[] = [];
        for (let j = 0; j < child.childNodes.length; j += 1) {
          const cell = child.childNodes[j];
          const cellTag = cell.nodeName.toLowerCase();
          if (cell.nodeType !== ELEMENT_NODE || (cellTag !== 'td' && cellTag !== 'th')) continue;
          const parts: string[] = [];
          collectText(cell, parts);
          cells.push(cleanCellLines(parts.join('')));
        }
        rows.push(cells);
      } else if (tag !== 'table') {
        visit(child);
      }
    }
  };
  visit(table);
  return rows;
}

/**
 * Flatten a document into prose blocks and tables, in reading order. Line
 * breaks inside a paragraph split it, because bullet lists of peers are often
 * one <p> or one <br> per company.
 */
export function proxyBlocksFromNode(root: MinimalNode): ProxyBlock[] {
  const blocks: ProxyBlock[] = [];
  let buffer: string[] = [];
  const flush = () => {
    const text = cleanCellText(buffer.join(''));
    buffer = [];
    if (text) blocks.push({ kind: 'text', text });
  };
  const walk = (node: MinimalNode): void => {
    if (node.nodeType === TEXT_NODE) {
      buffer.push(node.textContent || '');
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const tag = node.nodeName.toLowerCase();
    if (DROPPED_TAGS.has(tag)) return;
    if (tag === 'br') { flush(); return; }
    if (tag === 'table') {
      flush();
      const rows = tableRows(node).filter(row => row.some(cell => cell.length > 0));
      if (rows.length > 0) blocks.push({ kind: 'table', rows });
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) flush();
    for (let i = 0; i < node.childNodes.length; i += 1) walk(node.childNodes[i]);
    if (isBlock) flush();
  };
  walk(root);
  flush();
  return blocks;
}

// ---------------------------------------------------------------------------
// Peer-group anchors
// ---------------------------------------------------------------------------

const PEER_PHRASE = /\b(?:peer\s+groups?|comparator\s+groups?|peer\s+companies|compensation\s+peers|peer\s+sets?|benchmarking\s+groups?|reference\s+groups?|primary\s+peers)\b/i;
const COMPENSATION_CONTEXT = /\bcompensation\b|\bbenchmark|\bpay\b|\bexecutive talent\b/i;
const LISTING_CUE = /\b(?:consist(?:s|ed)?|comprised|compris(?:es|ed)|includ(?:es|ed|ing)|following|listed|below|table|chart)\b|:\s*$/i;
const PERFORMANCE_CONTEXT = /\bTSR\b|total\s+shareholder\s+return|relative\s+(?:TSR|performance)|performance\s+peer|\bPSUs?\b|\bLTIP\b|performance\s+graph|evaluating\s+performance|\bindex\b/i;
const DIRECTOR_PAY_CONTEXT = /non-employee\s+director/i;

/**
 * How strongly a block reads as introducing the compensation peer group.
 * 0 means it is not an anchor at all. A TSR/performance peer group is a
 * different list (it measures performance, not pay levels), so it only
 * anchors weakly unless compensation is named as well.
 */
export function peerAnchorScore(text: string): number {
  if (!PEER_PHRASE.test(text)) return 0;
  let score = 1;
  const performance = PERFORMANCE_CONTEXT.test(text);
  if (COMPENSATION_CONTEXT.test(text)) score += performance ? 1 : 2;
  else if (performance) score -= 1;
  if (LISTING_CUE.test(text)) score += 1;
  if (text.length <= 90) score += 1;
  if (DIRECTOR_PAY_CONTEXT.test(text)) score -= 1;
  return Math.max(score, 0);
}

// ---------------------------------------------------------------------------
// Company-name recognition
// ---------------------------------------------------------------------------

const LEADING_MARKERS = /^[\s•●▪■◦○◆♦➢►\-–—*·]+/u;
// Each repetition consumes exactly one footnote mark (or one parenthesised
// reference), so a run of marks is matched by the outer `+` alone: a nested
// `\*+` inside the group let a long run of `*` or `§` backtrack exponentially
// (CodeQL js/redos).
const TRAILING_FOOTNOTE = /(?:\s*(?:\(\s*(?:\d{1,2}|[a-z])\s*\)|[*†‡§]))+$/u;
const TRAILING_PUNCTUATION = /[\s,;:]+$/;

/** Words that end a company name but are never one on their own. */
const SUFFIX_ONLY = /^(?:inc\.?|incorporated|corp\.?|corporation|co\.?|company|ltd\.?|limited|llc|l\.l\.c\.|l\.?p\.?|plc|p\.l\.c\.|n\.?v\.?|s\.?a\.?|s\.?e\.?|ag|se|nv|sa|ab|asa|oyj|a\/s)$/i;

/** Lower-case words a company name may carry. */
const NAME_CONNECTORS = new Set([
  'of', 'and', 'the', 'de', 'del', 'la', 'le', 'du', 'des', 'y', 'und', 'et', 'for', 'in', 'on',
  '&', 'a', 'an', 'plc', 'inc', 'inc.', 'co.', 'corp.', 'ltd.', 'n.v.', 's.a.', 'com',
]);

const HEADER_VOCABULARY = /\b(?:percentile|median|average|revenues?|capitali[sz]ation|market\s+cap|net\s+income|employees|headcount|enterprise\s+value|ticker|industry|sector|rank(?:ing)?|fiscal|total|criteria|screen|ratio|headquarters|gics|summary|governance|proposals?|compensation|directors?|annex(?:es)?|appendi(?:x|ces)|meeting|committee|matters|officers?)\b/i;
const HEADER_EXACT = /^(?:company|companies|company\s+name|name|peer|peers|peer\s+compan(?:y|ies)|members?|added|removed|new|current|prior|other|none|n\/a|our\s+company|threshold|maximum|minimum|goals?|payouts?|actual|achievement|weight(?:ing)?|below|above|yes|no|base|bonus|salary|year|period|estimated|future|under|units?|stock|awards?|options?|securities|underlying|price|closing|market|grant|date|value|equity|incremental|fair|all\s+other|grant\s+date|non-equity|plan\s+awards)$/i;
const SENTENCE_WORDS = /\b(?:is|are|was|were|we|our|us|its|their|has|have|had|which|that|this|these|those|with|by|from|as|at|to|will|would|may|not|than|also|such|each)\b/;

export interface ParsedPeerName {
  /** The name as the proxy printed it, cleaned of bullets and footnote marks. */
  name: string;
  /** A ticker the proxy printed beside the name, e.g. "eBay (EBAY)". */
  tickerHint: string | null;
}

export function isCompanyNameLike(value: string): boolean {
  if (value.length < 2 || value.length > 70) return false;
  if (/[$%:;]/.test(value)) return false;
  if (/^[\d\s.,()$%x-]+$/i.test(value)) return false;
  if (HEADER_EXACT.test(value) || HEADER_VOCABULARY.test(value)) return false;
  if (PEER_PHRASE.test(value)) return false;
  if (/^(?:19|20)\d{2}\b/.test(value) || /^\d+(?:st|nd|rd|th)$/i.test(value)) return false;
  // A sentence fragment, not a name: a full stop followed by more words that
  // is not an abbreviation ("U.S. Bancorp", "E.W. Scripps", "Amazon.com").
  if (/[a-z]{4,}\.\s+[A-Z][a-z]/.test(value)) return false;
  const words = value.split(/\s+/);
  if (words.length > 8) return false;
  // A wrapped heading fragment ("BOARD OF", "BE VOTED ON DURING") ends on a connector.
  if (words.length > 1 && /^(?:of|and|the|for|to|in|on|a|an|&|during|about)$/i.test(words[words.length - 1])) return false;
  if (SENTENCE_WORDS.test(value)) return false;
  if (!/^(?:[A-Z0-9]|[a-z]{1,3}[A-Z.])/.test(words[0])) return false;
  for (const word of words.slice(1)) {
    if (/^[a-z]/.test(word) && !NAME_CONNECTORS.has(word.toLowerCase()) && !/^[a-z]+[A-Z]/.test(word)) return false;
  }
  return true;
}

/** Strip bullets, footnote marks and a printed ticker; null when nothing name-like remains. */
export function parsePeerName(raw: string): ParsedPeerName | null {
  let value = cleanCellText(raw).replace(LEADING_MARKERS, '');
  value = value.replace(TRAILING_PUNCTUATION, '').replace(TRAILING_FOOTNOTE, '').replace(TRAILING_PUNCTUATION, '');
  value = value.replace(/^and\s+/i, '').replace(/\.$/, (dot, offset, whole) =>
    // Keep the period of "Inc." / "Co." / "S.A."; drop a sentence's full stop.
    /\b(?:Inc|Corp|Co|Ltd|Bros|Cos|[A-Z])$/.test(whole.slice(0, offset)) ? dot : '');
  let tickerHint: string | null = null;
  const tickerMatch = value.match(/\s*\((?:(?:NYSE|NASDAQ|Nasdaq|NYSE\s+American)\s*:\s*)?([A-Z][A-Z0-9.-]{0,6})\)$/);
  if (tickerMatch && tickerMatch.index !== undefined) {
    tickerHint = tickerMatch[1];
    value = value.slice(0, tickerMatch.index).trim();
  }
  value = value.replace(TRAILING_FOOTNOTE, '').replace(TRAILING_PUNCTUATION, '').trim();
  return isCompanyNameLike(value) ? { name: value, tickerHint } : null;
}

// ---------------------------------------------------------------------------
// Containers: a table, a run of one-name lines, or a sentence list
// ---------------------------------------------------------------------------

export interface ExtractedPeer extends ParsedPeerName {
  /** The caption the proxy gave the group this name sits under. */
  group: string;
}

export type PeerExtractionMethod = 'table' | 'list';

export interface PeerGroupExtraction {
  method: PeerExtractionMethod;
  peers: ExtractedPeer[];
  /** The proxy's own words that introduce the group, bounded for display. */
  anchorText: string;
}

interface Anchor {
  index: number;
  score: number;
  text: string;
}

interface Candidate {
  method: PeerExtractionMethod;
  start: number;
  end: number;
  anchor: Anchor;
  /** A caption inside the table itself ("2025 Primary Peer Group"). */
  caption: string;
  peers: ExtractedPeer[];
}

const MIN_PEERS = 5;
const ANCHOR_LOOKBACK = 5;
const MAX_TABLE_ANCHOR_CHARS = 200;

/** Words that mark a registrant's legal or trading name. */
const CORPORATE_MARKER = /\b(?:inc|incorporated|corp|corporation|co|company|companies|cos|ltd|limited|llc|l\.?p|plc|n\.?v|s\.?a|se|ag|group|holdings?|technologies|technology|systems|international|industries|brands|bancorp|bancshares|financial|foods|enterprises|partners|laboratories|pharmaceuticals|therapeutics|networks|solutions|resources|energy|platforms)\b|\.com\b/i;

function blockText(block: ProxyBlock): string {
  return block.kind === 'text' ? block.text : block.rows.map(row => row.join(' ')).join(' ');
}

function bounded(text: string, max = 240): string {
  const clean = cleanCellText(text);
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Page furniture: running headers, page numbers, section tabs. Never an anchor, never a list. */
function isFurniture(block: ProxyBlock): boolean {
  const text = blockText(block);
  if (block.kind === 'table' && block.rows.length === 1 && isSectionTabs(block.rows[0])) return true;
  if (text.length >= 140) return false;
  return /proxy statement|table of contents/i.test(text)
    || /^\d{1,3}$/.test(text.trim())
    || (block.kind === 'table' && block.rows.length === 1 && isSectionTabs(block.rows[0]));
}

/** The running section tabs at the top of each page: "Summary | Governance | …" or "1 | BOARD OF… | 2 | …". */
function isSectionTabs(row: string[]): boolean {
  const text = row.join(' ');
  return /\bsummary\b.*\bgovernance\b/i.test(text)
    || row.filter(cell => /^\d$/.test(cell.trim())).length >= 3;
}

function nearestAnchor(blocks: ProxyBlock[], index: number): Anchor | null {
  let best: Anchor | null = null;
  let seen = 0;
  // Prose between a candidate anchor and the list continues its sentence
  // (PDF-converted proxies break "…the peer group used to help establish
  // 2025 target" / "compensation levels for our NEOs:" across two blocks).
  let following = '';
  for (let i = index - 1; i >= 0 && seen < ANCHOR_LOOKBACK; i -= 1) {
    const block = blocks[i];
    if (isFurniture(block)) continue;
    seen += 1;
    const own = blockText(block);
    // A table is an anchor only when it is a caption; a substantial table
    // between the anchor and the candidate is its own content, and the
    // anchor does not reach past it.
    if (block.kind === 'table') {
      if (block.rows.length > 3) break;
      following = '';
      if (own.length > MAX_TABLE_ANCHOR_CHARS) continue;
    }
    // Keep the end: the words nearest the list are the ones that introduce it.
    const text = following ? `${own} ${following}`.slice(-900) : own;
    const score = peerAnchorScore(text);
    // A short heading directly above the list captions it ("Primary Peer
    // Group – Technology"); nothing farther back outranks it.
    if (seen === 1 && block.kind === 'text' && own.length <= 90 && score > 0) return { index: i, score, text: own };
    if (score > 0 && (!best || score > best.score)) best = { index: i, score, text };
    if (block.kind === 'text') following = text;
  }
  return best;
}

function dedupe(peers: ExtractedPeer[]): ExtractedPeer[] {
  const seen = new Set<string>();
  return peers.filter(peer => {
    const key = peer.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function carriesIdentity(peer: ParsedPeerName): boolean {
  return peer.tickerHint !== null || CORPORATE_MARKER.test(peer.name);
}

/** Share of names that carry a legal-name marker or a printed ticker. */
function identityShare(peers: ParsedPeerName[]): number {
  return peers.length === 0 ? 0 : peers.filter(carriesIdentity).length / peers.length;
}

/**
 * Does the proxy announce a list here? A caption ("Primary Peer Group –
 * Technology") or a sentence that says the list follows ("consisted of the
 * following companies:", "the chart below lists"). A paragraph that merely
 * mentions the peer group in passing does not qualify on its own.
 */
function announcesList(candidate: Candidate): boolean {
  if (candidate.caption) return true;
  // The sentence that names the group must itself point at a list.
  const sentence = anchorExcerpt(candidate.anchor.text);
  if (PERFORMANCE_CONTEXT.test(sentence) && !COMPENSATION_CONTEXT.test(sentence)) return false;
  if (sentence.length <= 90) return true;
  return ANNOUNCES_LIST.test(sentence);
}

const ANNOUNCES_LIST = /\b(?:following|below|listed|lists?|consist(?:s|ed)?\s+of|comprised\s+of|as\s+follows)\b|(?:are|were|include[sd]?)\s*:\s*$|:\s*$/i;

/** Lines of one table row that are worth judging (not bullets, not figures). */
function rowLines(row: string[]): string[] {
  return row.flatMap(cell => cell.split('\n'))
    .map(line => line.trim())
    .filter(line => line && !BULLET_ONLY.test(line) && !/^[\d\s.,()$%x-]+$/i.test(line));
}

interface CellNames {
  lines: number;
  /** Names with the category heading they sit under inside the cell, if any. */
  peers: Array<ParsedPeerName & { heading: string | null }>;
}

function cellNames(cell: string): CellNames {
  const lines = rowLines([cell]);
  return {
    lines: lines.length,
    peers: lines.flatMap(line => {
      const peer = parsePeerName(line);
      return peer ? [{ ...peer, heading: null }] : [];
    }),
  };
}

/**
 * Cells that open with a bare category heading above a body of legal names
 * ("Consumer Staples / The Coca-Cola Company / Colgate-Palmolive Company …").
 * Only when at least two cells share that layout is it treated as one, so a
 * lone unsuffixed name ("Sanofi") is never mistaken for a heading. Within an
 * established layout, every bare line followed by legal names opens a new
 * category — Starbucks stacks two categories in one cell.
 */
function liftCellHeadings(cells: CellNames[]): void {
  const opensWithHeading = (cell: CellNames) => cell.peers.length >= 3
    && !carriesIdentity(cell.peers[0])
    && identityShare(cell.peers.slice(1)) >= 0.6;
  if (cells.filter(opensWithHeading).length < 2) return;
  for (const cell of cells) {
    const kept: CellNames['peers'] = [];
    let heading: string | null = null;
    cell.peers.forEach((peer, position) => {
      const next = cell.peers[position + 1];
      if (!carriesIdentity(peer) && next && carriesIdentity(next)) {
        heading = peer.name;
        cell.lines -= 1;
        return;
      }
      kept.push({ ...peer, heading });
    });
    cell.peers = kept;
  }
}

function namesFromRows(rows: string[][], group: string): { peers: ExtractedPeer[]; lines: number } {
  const perRow = rows.map(row => row.map(cellNames));
  liftCellHeadings(perRow.flat());
  // A leading row of bare segment headings ("Innovative Medicine | MedTech")
  // above a body of legal names is a header, not two more peers.
  const rowPeers = (row: CellNames[]) => row.flatMap(cell => cell.peers);
  if (perRow.length > 2 && rowPeers(perRow[0]).length > 0 && identityShare(rowPeers(perRow[0])) === 0
    && identityShare(perRow.slice(1).flatMap(rowPeers)) >= 0.6) {
    perRow.shift();
  }
  const cells = perRow.flat();
  return {
    peers: cells.flatMap(cell => cell.peers.map(({ heading, ...peer }) => ({ ...peer, group: heading ? `${group} — ${heading}` : group }))),
    lines: cells.reduce((sum, cell) => sum + cell.lines, 0),
  };
}

/**
 * Names in a table. When a row inside the table captions the group ("2025
 * Primary Peer Group", "Technology Peer Group"), only rows after it count —
 * the rows above are the issuer's own figures or the selection criteria. With
 * several caption rows, the one followed by the cleanest list wins.
 */
function tableCandidate(blocks: ProxyBlock[], index: number): Candidate | null {
  const block = blocks[index];
  if (block.kind !== 'table') return null;
  const rows = block.rows;
  const outside = nearestAnchor(blocks, index);

  const options: Array<{ row: number; score: number; caption: string }> = [];
  if (outside) options.push({ row: -1, score: outside.score, caption: '' });
  rows.forEach((row, r) => {
    const filled = row.filter(Boolean);
    if (filled.length !== 1 || filled[0].length > 120) return;
    const score = peerAnchorScore(filled[0]);
    if (score > 0) options.push({ row: r, score, caption: filled[0] });
  });

  let best: Candidate | null = null;
  let bestRatio = 0;
  for (const option of options) {
    const group = bounded(option.caption || outside?.text || '', 120);
    const { peers, lines } = namesFromRows(rows.slice(option.row + 1), group);
    const ratio = peers.length / Math.max(lines, 1);
    if (peers.length < MIN_PEERS || ratio < 0.6) continue;
    if (best && ratio <= bestRatio) continue;
    bestRatio = ratio;
    const anchor: Anchor = option.row >= 0 && option.score >= (outside?.score ?? 0)
      ? { index, score: option.score, text: option.caption }
      : outside!;
    best = {
      method: 'table',
      start: index,
      end: index,
      anchor,
      caption: option.caption,
      peers: dedupe(peers),
    };
  }
  if (best && outside && best.anchor !== outside) {
    best.anchor = { ...best.anchor, text: `${outside.text} — ${best.caption}` };
  }
  return best;
}

/** A one-row, one-name table: some filers lay out each bullet as its own table. */
function singleItemText(block: ProxyBlock): string | null {
  if (block.kind === 'text') return block.text;
  if (block.rows.length !== 1) return null;
  const lines = rowLines(block.rows[0]);
  return lines.length === 1 ? lines[0] : null;
}

/** One name per paragraph, line or bullet, as Workiva layouts print them. */
function lineRunCandidate(blocks: ProxyBlock[], index: number): Candidate | null {
  if (singleItemText(blocks[index]) === null) return null;
  const anchor = nearestAnchor(blocks, index);
  if (!anchor) return null;
  const group = bounded(anchor.text, 120);
  const peers: ExtractedPeer[] = [];
  let end = index;
  for (let i = index; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (isFurniture(block)) continue;
    const text = singleItemText(block);
    if (text === null) break;
    if (BULLET_ONLY.test(text)) continue;
    const parsed = parsePeerName(text);
    if (!parsed) break;
    peers.push({ ...parsed, group });
    end = i;
  }
  if (peers.length < MIN_PEERS) return null;
  return { method: 'list', start: index, end, anchor, caption: '', peers: dedupe(peers) };
}

const LIST_INTRO = /(?:consist(?:s|ed)?\s+of|comprised\s+of|compris(?:es|ed)|includ(?:es|ed)|(?:are|were))(?:\s+(?:the\s+)?following(?:\s+\d+)?(?:\s+(?:companies|peers|issuers))?)?\s*:?\s*/i;

/** Split "A, B, C, and D" into names, re-attaching ", Inc." and friends. */
export function splitNameList(list: string): string[] {
  const separator = (list.match(/;/g)?.length ?? 0) >= 3 ? ';' : ',';
  const parts = list.split(separator).map(part => part.trim()).filter(Boolean);
  const names: string[] = [];
  for (const part of parts) {
    const cleaned = part.replace(/^and\s+/i, '').trim();
    if (names.length > 0 && SUFFIX_ONLY.test(cleaned.replace(/\.$/, ''))) {
      names[names.length - 1] = `${names[names.length - 1]}, ${cleaned}`;
      continue;
    }
    // "X Inc. and Y Corp." — the final pair is joined by "and", not a comma.
    const pair = cleaned.match(/^(.+?)\s+and\s+(.+)$/);
    if (pair && isCompanyNameLike(pair[1]) && isCompanyNameLike(pair[2].replace(/\.$/, ''))) {
      names.push(pair[1], pair[2]);
      continue;
    }
    names.push(cleaned);
  }
  return names;
}

/** The list ends at the first sentence break that is not an abbreviation's period. */
const SENTENCE_STARTERS = /^\s+(?:The|These|This|Those|We|Our|In|For|Each|All|As|Since|When|While|Although|Because|Its|It|They|Their|Peer|Companies)\b/;

function cutAtSentenceEnd(text: string): string {
  const pattern = /\.(?=\s+[A-Z][a-z]|\s*$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + 1);
    const abbreviation = /\b(?:Inc|Corp|Co|Ltd|L\.P|N\.V|S\.A|Bros|Mfg|Intl|U\.S|St|Cos|Jr|No)$/i.test(before) || /\b[A-Z]$/.test(before);
    // "…and Wesfarmers Ltd. The peer companies were selected…": the period
    // closes the abbreviation and the sentence at once.
    if (abbreviation && !SENTENCE_STARTERS.test(after)) continue;
    return abbreviation ? `${before}.` : before;
  }
  return text;
}

/** "Our peer group consists of the following companies: A, B, C and D." */
function sentenceListCandidate(blocks: ProxyBlock[], index: number): Candidate | null {
  const block = blocks[index];
  if (block.kind !== 'text' || block.text.length < 40 || (block.text.match(/,/g)?.length ?? 0) < 3) return null;
  const ownScore = peerAnchorScore(block.text);
  const anchor: Anchor | null = ownScore > 0 ? { index, score: ownScore, text: block.text } : nearestAnchor(blocks, index);
  if (!anchor) return null;

  let listText = block.text;
  let introText = anchor.text;
  if (anchor.index === index) {
    const peerAt = block.text.search(PEER_PHRASE);
    const rest = block.text.slice(peerAt);
    // "…for the following peer companies: Walmart Inc., The Home Depot, Inc., …"
    const colon = rest.slice(0, 200).indexOf(':');
    const intro = rest.match(LIST_INTRO);
    let listStart: number;
    if (colon >= 0) listStart = colon + 1;
    else if (intro && intro.index !== undefined) listStart = intro.index + intro[0].length;
    else return null;
    listText = rest.slice(listStart);
    introText = block.text.slice(0, peerAt + listStart);
  }
  const names = splitNameList(cutAtSentenceEnd(listText));
  const accepted = names.map(parsePeerName).filter((item): item is ParsedPeerName => item !== null);
  if (accepted.length < MIN_PEERS || accepted.length / names.length < 0.8) return null;
  const group = bounded(anchorExcerpt(introText), 120);
  return {
    method: 'list',
    start: index,
    end: index,
    anchor: { ...anchor, text: introText },
    caption: '',
    peers: dedupe(accepted.map(item => ({ ...item, group }))),
  };
}

/**
 * A list counts when either the names read as registrants (legal suffixes or
 * printed tickers) or the proxy explicitly announces the list. Bare words
 * under a passing mention ("Threshold | Target | Maximum" beside "our peer
 * group of companies with median revenue of $12 billion") fail both.
 */
function isCredible(candidate: Candidate): boolean {
  return identityShare(candidate.peers) >= 0.3 || announcesList(candidate);
}

/**
 * The sentence that introduces the list: the last one in the anchor that
 * names the peer group, which is the one nearest the names.
 */
export function anchorExcerpt(text: string): string {
  const sentences = cleanCellText(text).split(/(?<=[.:;])\s+(?=[A-Z("])/);
  const naming = sentences.filter(sentence => PEER_PHRASE.test(sentence));
  return bounded(naming.length > 0 ? naming[naming.length - 1] : text);
}

function rank(candidate: Candidate): number {
  return (candidate.anchor.score + 3 * identityShare(candidate.peers)) * 100 + Math.min(candidate.peers.length, 40);
}

/**
 * Find the compensation peer group. Returns null when no announced list of at
 * least five company names exists — the caller decides whether to fall back.
 *
 * When the proxy discloses more than one compensation group side by side
 * (Microsoft's primary technology and secondary general-industry groups),
 * the captioned groups that follow the best one are returned with it, each
 * name keeping its own group caption.
 */
export function extractPeerGroupFromBlocks(blocks: ProxyBlock[]): PeerGroupExtraction | null {
  const candidates: Candidate[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const found = tableCandidate(blocks, i) ?? sentenceListCandidate(blocks, i) ?? lineRunCandidate(blocks, i);
    if (found && isCredible(found)) {
      candidates.push(found);
      i = found.end;
    }
  }
  if (candidates.length === 0) return null;

  const best = candidates.reduce((winner, candidate) => (rank(candidate) > rank(winner) ? candidate : winner));
  const chosen = [best];
  for (const candidate of candidates) {
    const last = chosen[chosen.length - 1];
    const ownCaption = candidate.caption || (candidate.anchor.index > last.end && candidate.anchor.text.length <= 120);
    if (
      candidate.start > last.end
      && candidate.start - last.end <= 4
      && candidate.method === best.method
      && ownCaption
      && candidate.anchor.score >= 2
    ) chosen.push(candidate);
  }
  return {
    method: best.method,
    peers: dedupe(chosen.flatMap(candidate => candidate.peers)),
    anchorText: anchorExcerpt(best.anchor.text),
  };
}

/** Plain text of the blocks, for the model fallback and for checking its answer. */
export function blocksToText(blocks: ProxyBlock[]): string {
  return blocks.map(block => (block.kind === 'text'
    ? block.text
    : block.rows.map(row => row.map(cell => cell.replace(/\n/g, '; ')).join(' | ')).join('\n'))).join('\n');
}
