/**
 * Heading-block slicing: the part of the section taxonomy that is not an Item.
 *
 * Item slicing (sectionPath) finds "Item 1A" and reads to the next Item. That
 * cannot reach the disclosures researchers benchmark most: a lease note, the
 * critical audit matters in the auditor's report, the CD&A of a proxy, the
 * human-capital discussion inside Item 1. None of those carries an item
 * number; each is a HEADING on its own line, followed by its body, followed
 * by the next heading of the same kind.
 *
 * So this slicer works on the extracted text's LINES (the shared extractor
 * puts every block element on its own line), and treats a line as a heading
 * only when the whole line names the section — "Note 8 – Leases", "8. Leases",
 * "LEASES", "Compensation Discussion and Analysis", "Director Compensation—2025".
 * A sentence that merely mentions leases is never a heading.
 *
 * Honesty rules, same spirit as the Item slicer:
 * - A line that is a table-of-contents entry (trailing page number) is never a
 *   start; a running page header (a line repeated on page after page) is never
 *   a boundary, so it cannot chop a section into page-sized fragments.
 * - A numbered note runs to the next numbered note. An unnumbered heading runs
 *   to the next heading of its vocabulary. A missing boundary makes a slice
 *   coarser (it overshoots); it is capped and reported as truncated.
 * - When no heading is found, the caller is told WHY: the phrase never occurs
 *   (not disclosed), the phrase occurs but no heading line names it (could not
 *   extract), or a note was asked of a document with no notes at all.
 */

import { normalizeForMatch } from './booleanSearch';

export interface BlockSpec {
  /** Heading aliases that start the block, most specific first. */
  headings: readonly string[];
  /** Other headings of the same vocabulary — each one ends the block. */
  boundaries: readonly string[];
  /** Restrict starts to the notes to the financial statements. */
  region?: 'notes';
  /** Raw-line patterns that end the block (e.g. the auditor's signature). */
  endPatterns?: readonly RegExp[];
  /** Hard cap on a slice; a capped slice is reported as truncated. */
  maxChars?: number;
  /**
   * Vocabulary a WEAK start (an unnumbered or run-in heading inside the notes)
   * must use before it counts: "Revenue" also titles a revenue table inside
   * the segment note. A numbered note is the registrant's own title and needs
   * no confirmation.
   */
  confirmTerms?: readonly string[];
}

export interface BlockMatch {
  /** Offsets into the raw text. */
  start: number;
  end: number;
  /** The heading line exactly as the filing wrote it. */
  heading: string;
  truncated: boolean;
}

export type BlockNotFoundCause =
  /** Neither a heading nor the phrase occurs: the filing does not disclose it. */
  | 'heading-absent'
  /** The phrase occurs, but no heading line names it — the slicer could not bound it. */
  | 'mentioned-without-heading'
  /** A note was requested from a document with no notes to financial statements. */
  | 'no-notes-region';

export type BlockLocateResult =
  | { ok: true; match: BlockMatch }
  | { ok: false; cause: BlockNotFoundCause };

const DEFAULT_MAX_CHARS = 60_000;
/** A line seen this often is a running page header, not a section boundary. */
const RUNNING_HEADER_REPEATS = 4;
/** A heading names a subject: a long remainder after the alias is prose. */
const MAX_REMAINDER_TOKENS = 6;
/** Distinct topic terms a weak note heading's body must use. */
const CONFIRMING_TERMS = 2;

/** Heading comparison form: lowercase, apostrophes dropped, punctuation to spaces. */
export function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface Designator {
  kind: 'note' | 'item' | 'proposal' | 'letter';
  number: string;
}

interface ParsedLine {
  start: number;
  end: number;
  raw: string;
  /** Normalized heading text with any designator removed. */
  core: string;
  designator: Designator | null;
  headingLike: boolean;
  /** Ends in a bare page number: a table-of-contents entry. */
  tocEntry: boolean;
  /** A run-in heading's lead ("Leases. The Company…" → "leases"), normalized. */
  runIn: string | null;
}

const NOTE_DESIGNATOR_RE = /^note\s+(\d{1,2}[a-z]?)\b\s*[.:)–—-]*\s*/i;
const NUMBERED_DESIGNATOR_RE = /^(\d{1,2})\s*(?:[.)]|\s[–—-])\s*(?=[A-Za-z])/;
const ITEM_DESIGNATOR_RE = /^(?:part\s+[ivx]+\s*[,.–—-]?\s*)?item\s+(\d{1,2}[a-z]?)\b\s*[.:–—-]*\s*/i;
const PROPOSAL_DESIGNATOR_RE = /^proposal\s+(?:no\.?\s*)?(\d{1,2})\b\s*[.:–—-]*\s*/i;
const LETTER_DESIGNATOR_RE = /^([a-h])\.\s+(?=[A-Z])/;

function parseDesignator(trimmed: string): { designator: Designator | null; rest: string } {
  const patterns: Array<[RegExp, Designator['kind']]> = [
    [NOTE_DESIGNATOR_RE, 'note'],
    [ITEM_DESIGNATOR_RE, 'item'],
    [PROPOSAL_DESIGNATOR_RE, 'proposal'],
    [NUMBERED_DESIGNATOR_RE, 'note'],
    [LETTER_DESIGNATOR_RE, 'letter'],
  ];
  for (const [pattern, kind] of patterns) {
    const match = trimmed.match(pattern);
    if (match) return { designator: { kind, number: match[1].toLowerCase() }, rest: trimmed.slice(match[0].length) };
  }
  return { designator: null, rest: trimmed };
}

function parseLines(text: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  let cursor = 0;
  for (const raw of text.split('\n')) {
    const start = cursor;
    cursor += raw.length + 1;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const { designator, rest } = parseDesignator(trimmed);
    const core = normalizeHeading(rest);
    const words = trimmed.split(/\s+/).length;
    // A heading starts with a capital, a digit or a quote — prose that the
    // extractor wrapped onto its own line starts lowercase ("summary
    // compensation table values, which reflect…").
    const capitalised = /^[A-Z0-9“"(]/.test(trimmed);
    const sentence = /[.;,]$/.test(trimmed) && words > 6;
    const headingLike = capitalised && trimmed.length <= 150 && words <= 16 && !sentence && core.length > 0;
    const tocEntry = /\s\d{1,3}$/.test(trimmed) && !/\b(19|20)\d{2}$/.test(trimmed);
    const lead = trimmed.length > 20 ? rest.match(/^([^.:\u2013\u2014]{2,90})\s*[.:\u2013\u2014]\s+[A-Z]/) : null;
    const runIn = lead ? normalizeHeading(lead[1]) : null;
    lines.push({ start, end: start + raw.length, raw: trimmed, core, designator, headingLike, tocEntry, runIn });
  }
  return lines;
}

type AliasFit = 'exact' | 'prefix';

/**
 * Does a heading's core text name this alias? Exact, or the alias followed by
 * a short qualifier ("Segment Information and Geographic Data", "Director
 * Compensation—2025"). A qualifier carrying a non-year number is a table row
 * or a TOC page reference, never a heading.
 */
function aliasFit(core: string, alias: string): AliasFit | null {
  if (!alias) return null;
  if (core === alias) return 'exact';
  if (!core.startsWith(`${alias} `)) return null;
  const remainder = core.slice(alias.length + 1).split(' ').filter(Boolean);
  if (remainder.length > MAX_REMAINDER_TOKENS) return null;
  if (remainder.some(token => /\d/.test(token) && !/^(19|20)\d{2}$/.test(token))) return null;
  if (remainder[0] === 'continued') return null;
  return 'prefix';
}

/*
 * A run-in heading — "Leases. The Company leases…" or "Revenue Recognition —
 * Revenue is recognized…" — is read once per line in parseLines (runIn):
 * policy notes are routinely written this way.
 */

interface Alias {
  text: string;
  /** Written with a trailing "$": the line must equal it, no qualifier. */
  exactOnly: boolean;
}

function toAliases(values: readonly string[]): Alias[] {
  return values
    .map(value => ({ text: normalizeHeading(value), exactOnly: value.trim().endsWith('$') }))
    .filter(alias => alias.text);
}

function matchAliases(line: ParsedLine, aliases: readonly Alias[]): { fit: AliasFit | 'run-in'; rank: number } | null {
  if (line.headingLike) {
    // An exact title outranks a qualified one whatever their order:
    // "Goodwill and Intangible Assets" is that alias exactly, not "Goodwill"
    // with a qualifier.
    for (const [rank, alias] of aliases.entries()) {
      if (line.core === alias.text) return { fit: 'exact', rank };
    }
    for (const [rank, alias] of aliases.entries()) {
      if (!alias.exactOnly && aliasFit(line.core, alias.text) === 'prefix') return { fit: 'prefix', rank };
    }
  }
  if (line.runIn) {
    for (const [rank, alias] of aliases.entries()) {
      if (!alias.exactOnly && line.runIn === alias.text) return { fit: 'run-in', rank };
    }
  }
  return null;
}

const NOTES_MARKER_RE = /^notes?\s+to\s+(?:the\s+)?(?:(?:19|20)\d{2}\s+)?(?:condensed\s+|unaudited\s+|interim\s+|consolidated\s+|combined\s+|carve.out\s+)*financial\s+statements\b/i;
const FINANCIAL_STATEMENTS_ITEM_RE = /financial statements|financial information/;
const REGION_END_LINES = new Set(['signatures', 'exhibit index', 'index to exhibits', 'exhibits', 'part ii', 'part iii', 'part iv']);

/**
 * The notes to the financial statements, as [start, end) line ranges: from
 * each "Notes to (Consolidated) Financial Statements" heading to the next
 * Item that is not itself the financial statements (or the signatures /
 * exhibit index). Table-of-contents mentions yield tiny ranges that hold no
 * note headings, so they are harmless.
 */
function notesRegions(lines: ParsedLine[]): Array<[number, number]> {
  const regions: Array<[number, number]> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.raw.length > 140 || !NOTES_MARKER_RE.test(line.raw)) continue;
    let end = lines.length;
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next];
      if (candidate.designator?.kind === 'item' && candidate.core && !FINANCIAL_STATEMENTS_ITEM_RE.test(candidate.core)) {
        end = next;
        break;
      }
      if (!candidate.designator && REGION_END_LINES.has(candidate.core) && candidate.raw.length < 40) {
        end = next;
        break;
      }
    }
    const last = regions[regions.length - 1];
    if (last && index < last[1]) last[1] = Math.max(last[1], end);
    else regions.push([index, end]);
  }
  return regions;
}

function phraseOccurs(normalizedText: string, aliases: readonly string[]): boolean {
  return aliases.some(alias => {
    const phrase = normalizeForMatch(alias);
    return phrase.length > 2 && ` ${normalizedText} `.includes(` ${phrase} `);
  });
}

/**
 * Locate one heading block. Candidates are ranked by how strongly their line
 * reads as the section's own heading — a numbered note beats an unnumbered
 * subheading, an exact title beats a qualified one, a run-in heading is
 * weakest — then by alias specificity, then by length (a TOC entry or a
 * running header is short; the section body is long).
 */
export function locateHeadingBlock(text: string, spec: BlockSpec): BlockLocateResult {
  const lines = parseLines(text || '');
  const aliases = toAliases(spec.headings);
  const targetTexts = new Set(aliases.map(alias => alias.text));
  const boundaryAliases = toAliases(spec.boundaries).filter(alias => !targetTexts.has(alias.text));
  const maxChars = spec.maxChars ?? DEFAULT_MAX_CHARS;

  let regions: Array<[number, number]> | null = null;
  if (spec.region === 'notes') {
    regions = notesRegions(lines);
    if (regions.length === 0) return { ok: false, cause: 'no-notes-region' };
  }
  const inRegion = (index: number) => !regions || regions.some(([from, to]) => index > from && index < to);
  const regionEndFor = (index: number) => {
    if (!regions) return lines.length;
    const region = regions.find(([from, to]) => index > from && index < to);
    return region ? region[1] : lines.length;
  };

  // Running headers: the same short line on page after page.
  const repeats = new Map<string, number>();
  for (const line of lines) {
    if (line.raw.length <= 80) repeats.set(line.raw, (repeats.get(line.raw) ?? 0) + 1);
  }
  const isRunningHeader = (line: ParsedLine) => (repeats.get(line.raw) ?? 0) >= RUNNING_HEADER_REPEATS;

  const isTitledItem = (line: ParsedLine) =>
    line.designator?.kind === 'item' && /[a-z]{3}/.test(line.core) && line.headingLike && !isRunningHeader(line);
  const isNumberedNote = (line: ParsedLine) =>
    line.designator?.kind === 'note' && line.headingLike && /[a-z]{3}/.test(line.core) && !line.tocEntry;
  const isEndPattern = (line: ParsedLine) => (spec.endPatterns ?? []).some(pattern => pattern.test(line.raw));

  interface Candidate { index: number; score: number; rank: number; match: BlockMatch }
  let best: Candidate | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const target = matchAliases(line, aliases);
    if (!target || line.tocEntry) continue;
    if (!inRegion(index)) continue;

    // Note numbering only means something inside the notes; elsewhere a
    // "1." line is a list item.
    const numbered = Boolean(regions) && line.designator?.kind === 'note';
    // Base strength of the heading line, then where it sits.
    let score = target.fit === 'exact' ? 3 : target.fit === 'prefix' ? 2 : 1;
    if (numbered) score += 3;
    if (regions && !numbered) score += 1;

    const limit = regionEndFor(index);
    let endIndex = limit;
    for (let next = index + 1; next < limit; next += 1) {
      const candidate = lines[next];
      if (isEndPattern(candidate) || isTitledItem(candidate)) { endIndex = next; break; }
      if (regions && isNumberedNote(candidate) && candidate.designator!.number !== line.designator?.number) {
        // "Note 8 – Leases (continued)" restates the same note; a different
        // number is the next note.
        endIndex = next;
        break;
      }
      // A proposal, or a lettered 20-F subsection ("D. Employees" → "E. Share
      // Ownership"), ends at the next of its own kind.
      // A bare "Proposal No. 3" line (the title on the next line) counts too.
      const bareProposal = candidate.designator?.kind === 'proposal' && !candidate.core && candidate.raw.length <= 24;
      if (
        bareProposal
        || (candidate.headingLike
          && !matchAliases(candidate, aliases)
          && (candidate.designator?.kind === 'proposal'
            || (candidate.designator?.kind === 'letter' && line.designator?.kind === 'letter')))
      ) {
        endIndex = next;
        break;
      }
      // A numbered note runs to the next numbered note: its own subheadings
      // ("Goodwill" inside an acquisitions note) are not boundaries.
      if (numbered) continue;
      if (isRunningHeader(candidate) || matchAliases(candidate, aliases)) continue;
      if (matchAliases(candidate, boundaryAliases)) { endIndex = next; break; }
    }

    const start = line.start;
    let end = endIndex < lines.length ? lines[endIndex].start : text.length;
    if (regions && !numbered && spec.confirmTerms && spec.confirmTerms.length > 0) {
      const body = ` ${normalizeForMatch(text.slice(start, Math.min(end, start + maxChars)))} `;
      const used = spec.confirmTerms.filter(term => {
        const phrase = normalizeForMatch(term);
        return phrase && body.includes(` ${phrase} `);
      });
      if (used.length < CONFIRMING_TERMS) continue;
    }
    let truncated = false;
    if (end - start > maxChars) {
      end = start + maxChars;
      truncated = true;
    }
    const candidate: Candidate = {
      index,
      score,
      rank: target.rank,
      match: { start, end, heading: line.raw, truncated },
    };
    const length = end - start;
    const bestLength = best ? best.match.end - best.match.start : -1;
    if (
      !best
      || score > best.score
      || (score === best.score && target.rank < best.rank)
      || (score === best.score && target.rank === best.rank && length > bestLength)
    ) {
      best = candidate;
    }
  }

  if (best) return { ok: true, match: best.match };
  const phrases = spec.headings.map(heading => heading.replace(/\$$/, ''));
  return { ok: false, cause: phraseOccurs(normalizeForMatch(text || ''), phrases) ? 'mentioned-without-heading' : 'heading-absent' };
}
