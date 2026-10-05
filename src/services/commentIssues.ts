/**
 * Comment letters at the issue level.
 *
 * A Staff letter (UPLOAD) numbers its comments "1.", "2.", ... each under a
 * heading naming the filing section ("Notes to Consolidated Financial
 * Statements / Note 2 - Revenue, page 35"). The company's response (CORRESP)
 * repeats each comment, by number and usually verbatim, and answers it. A
 * later Staff letter either follows up ("We note your response to prior
 * comment 2 ...") or states that the review is complete.
 *
 * This module turns an episode's letters into that structure:
 *   issue = { number, Staff comment, filing section, the response excerpt,
 *             later Staff follow-ups, status }
 *
 * Status is evidence-based and deliberately conservative:
 *   - resolved   only when a later Staff letter in the episode says the
 *                review is complete (or that it has no further comments)
 *                AND a response to the comment is on file;
 *   - responded  a response is on file, but no completion letter is;
 *   - open       the Staff letter is the latest word: no response letter is
 *                on file after it;
 *   - unclear    response or completion letters exist but this comment
 *                could not be paired with a response (text missing, the
 *                response does not repeat the number or text, ...).
 * Every status carries a one-sentence basis naming the letters it rests on.
 *
 * Pure and dependency-free (no Node APIs) so the UI, the route, and tests
 * share one implementation. Storage concerns live in
 * services/commentLetterIssueStore.ts.
 */

export const COMMENT_ISSUES_PARSER_VERSION = 1;

/** Stored response excerpts are capped; the cap is flagged, never silent. */
export const MAX_RESPONSE_EXCERPT_CHARS = 20_000;

export interface IssueLetter {
  accession: string;
  cik: number | string;
  form: string;
  date_filed: string;
  content: string | null;
}

export interface StaffComment {
  number: number;
  /** Comment text, whitespace-normalised (paragraphs kept). */
  text: string;
  /** Heading lines above the comment, joined with " / ". */
  filingSectionRef: string | null;
  /** True when the comment had no heading of its own and sits under the previous one. */
  filingSectionInherited: boolean;
  /** "prior comment 2", "comments 3 and 4" — the numbers referenced. */
  priorCommentRefs: number[];
}

export type IssueStatus = 'responded' | 'open' | 'unclear' | 'resolved';

export interface IssueResponse {
  accession: string;
  cik: string;
  date_filed: string;
  /** The response text as filed, whitespace-normalised. */
  excerpt: string;
  excerptTruncated: boolean;
  /** How the response was located in the letter. */
  matchedBy: 'comment-number' | 'comment-text';
  /** Where the excerpt begins. */
  excerptStart: 'response-label' | 'after-repeated-comment' | 'at-match';
}

export interface IssueFollowUp {
  staffAccession: string;
  staffDate: string;
  issueNumber: number;
  staffComment: string;
}

export interface CommentIssue {
  key: string;
  issueNumber: number;
  round: number;
  staffAccession: string;
  staffDate: string;
  cik: string;
  staffComment: string;
  filingSectionRef: string | null;
  filingSectionInherited: boolean;
  response: IssueResponse | null;
  followUp: IssueFollowUp[];
  /** Earlier issues this comment continues (resolved from "prior comment N"). */
  followsUp: Array<{ staffAccession: string; staffDate: string; issueNumber: number }>;
  status: IssueStatus;
  statusBasis: string;
}

export type StaffLetterKind =
  | 'comments'
  | 'review-complete'
  | 'no-review'
  | 'no-comments-found'
  | 'text-missing';

export interface StaffLetterIssues {
  staffAccession: string;
  staffDate: string;
  cik: string;
  round: number;
  kind: StaffLetterKind;
  issues: CommentIssue[];
}

export interface EpisodeIssuesCoverage {
  staffLetters: number;
  staffLettersWithText: number;
  responseLetters: number;
  responseLettersWithText: number;
  issues: number;
  issuesWithResponse: number;
}

export interface EpisodeIssues {
  parserVersion: number;
  letters: StaffLetterIssues[];
  closedBy: { accession: string; date_filed: string } | null;
  coverage: EpisodeIssuesCoverage;
}

// ── Text clean-up ───────────────────────────────────────────────────────────

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATE_LINE = new RegExp(`^(?:${MONTHS})\\s+\\d{1,2},\\s+\\d{4}$`);
const PAGE_MARKER_LINE = /^(?:Page\s*\d*|.*\b\d{4}\s*Page\s*\d+|Page\s+\d+\s+of\s+\d+)$/i;
// Template residue the SEC's letter generator leaves at page breaks.
const TEMPLATE_NOISE = /(?:First|Last)Name|Comapany|\bName[A-Z][a-z]/;
const DATE_FRAGMENT_LINE = /^\d{1,2},\s*\d{4}$/;

function normaliseLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
}

const MONTH_LINE = new RegExp(`^(?:${MONTHS})$`);

/** Lines and words of the letter header (addressee, title, company, date) up to "Re:". */
function letterHeader(lines: string[]): { lines: Set<string>; words: Set<string> } {
  const header = new Set<string>();
  const headerWords = new Set<string>();
  for (const line of lines.slice(0, 40)) {
    const trimmed = line.trim();
    if (/^R[Ee]\s*:/.test(trimmed)) break;
    if (!trimmed) continue;
    header.add(trimmed);
    for (const word of trimmed.toLowerCase().match(/[a-z0-9]+/g) || []) headerWords.add(word);
  }
  return { lines: header, words: headerWords };
}

function isRunningHeaderLine(line: string, header: { lines: Set<string>; words: Set<string> }): boolean {
  if (header.lines.has(line) || DATE_LINE.test(line) || MONTH_LINE.test(line) || DATE_FRAGMENT_LINE.test(line) || TEMPLATE_NOISE.test(line)) {
    return true;
  }
  // A short line made only of header words ("Amazon.com, Inc.", "2021 Inc.").
  const lineWords = line.toLowerCase().match(/[a-z0-9]+/g) || [];
  return lineWords.length > 0 && lineWords.length <= 6 && lineWords.every(word => header.words.has(word));
}

/**
 * Remove the page furniture PDF extraction leaves inside comment text: the
 * running header (addressee, company, date, "Page N") and the letter
 * template's merge-field residue. Only lines within six lines above a page
 * marker are candidates, and only when they repeat the letter's own header.
 */
export function cleanLetterText(raw: string): string {
  const lines = normaliseLineEndings(raw).split('\n');
  const header = letterHeader(lines);
  const drop = new Set<number>();
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (TEMPLATE_NOISE.test(trimmed)) { drop.add(index); return; }
    if (!PAGE_MARKER_LINE.test(trimmed) || trimmed.length > 60) return;
    drop.add(index);
    for (let back = index - 1, seen = 0; back >= 0 && seen < 6; back -= 1) {
      const previous = lines[back].trim();
      if (!previous || drop.has(back) || TEMPLATE_NOISE.test(previous)) {
        if (previous) drop.add(back);
        continue;
      }
      seen += 1;
      if (isRunningHeaderLine(previous, header)) drop.add(back);
    }
  });
  return lines.filter((_, index) => !drop.has(index)).join('\n');
}

/** Collapse whitespace inside paragraphs; keep blank-line paragraph breaks. */
export function normaliseParagraphs(text: string): string {
  return text
    .split(/\n[ \t]*\n+/)
    .map(paragraph => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

// ── Tokens ──────────────────────────────────────────────────────────────────

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[A-Za-z0-9]+/g)) {
    const start = match.index ?? 0;
    tokens.push({ word: match[0].toLowerCase(), start, end: start + match[0].length });
  }
  return tokens;
}

function words(text: string): string[] {
  return tokenize(text).map(token => token.word);
}

/** First token index whose start is at or after a character offset. */
function tokenIndexAt(tokens: Token[], offset: number): number {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (tokens[middle].start < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function findPhrase(tokens: Token[], phrase: string[], fromToken: number, toToken = tokens.length): number {
  if (phrase.length === 0) return -1;
  const last = Math.min(toToken, tokens.length) - phrase.length;
  outer: for (let index = Math.max(0, fromToken); index <= last; index += 1) {
    for (let offset = 0; offset < phrase.length; offset += 1) {
      if (tokens[index + offset].word !== phrase[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

// ── Staff letters ───────────────────────────────────────────────────────────

const REVIEW_COMPLETE = /\b(?:we|the staff)\s+(?:have|has)\s+completed\s+(?:our|its)\s+review\b|\bno\s+further\s+comments\b/i;
const NO_REVIEW = /\b(?:have\s+not\s+reviewed\s+and\s+)?will\s+not\s+review\s+(?:your|the)\b|\bdo\s+not\s+intend\s+to\s+review\b/i;
const STAFF_CLOSING = /\n[ \t]*(?:In closing, we remind you|We remind you that (?:the company|you)|We urge all persons who are responsible|Please contact\b|You may contact\b|Please direct (?:any )?questions|Sincerely,?\s*$|If you have (?:any )?questions)/im;
// "1. We note ..." — a number at the start of a line followed by a sentence.
const STAFF_MARKER = /(?:^|\n)[ \t]*(\d{1,2})\.(?!\d)[ \t]*\n?[ \t]*(?=["“'(\[]?[A-Z])/g;
const SALUTATION = /(?:^|\n)[ \t]*(?:Dear\b[^\n]*|Ladies and Gentlemen[^\n]*)\n/i;

export function isReviewCompleteLetter(text: string | null | undefined): boolean {
  return Boolean(text && REVIEW_COMPLETE.test(text));
}

export function isNoReviewLetter(text: string | null | undefined): boolean {
  return Boolean(text && NO_REVIEW.test(text));
}

function isSentenceEnd(line: string): boolean {
  return /[.;:?!,]["”’)]*$/.test(line);
}

const FILING_HEADING_START = /^(?:Form\s|Amendment\s|Amended\s|Registration Statement|Draft Registration|Offering Statement|Schedule\s|Current Report|Annual Report|Quarterly Report|Response dated|Preliminary|Definitive|Item\s+\d|Note\s+\d|\d{1,2}\.\s+[A-Z])/;

/**
 * A line above a comment that names where in the filing it applies:
 * "Note 2 - Revenue, page 35", "Critical Accounting Estimates",
 * "Form 10-K for the fiscal year ended ...". Comment prose is rejected by
 * its sentence punctuation or its lower-case words.
 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 170) return false;
  if (/,\s*pages?\s+[\dA-Z-]+(?:\s*(?:-|–|and|through)\s*[\dA-Z-]+)?$/i.test(trimmed)) return true;
  if (isSentenceEnd(trimmed)) return false;
  if (FILING_HEADING_START.test(trimmed)) return trimmed.split(/\s+/).length <= 24;
  const significant = trimmed.split(/\s+/).filter(word => word.replace(/[^A-Za-z]/g, '').length > 3);
  if (trimmed.split(/\s+/).length > 16) return false;
  if (significant.length === 0) return /^[A-Z]/.test(trimmed);
  const capitalised = significant.filter(word => /^[A-Z“"'(]/.test(word)).length;
  return capitalised / significant.length >= 0.5;
}

/**
 * The heading stack directly above a comment marker: heading-like lines,
 * read bottom-up, stopping at a sentence end (the previous comment's last
 * line) or after six lines. Returns the lines and the character offset (in
 * the region) where the stack starts.
 */
function headingBlock(region: string): { lines: string[]; start: number } {
  const lines = region.split('\n');
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  const collected: string[] = [];
  let start = region.length;
  for (let index = lines.length - 1; index >= 0 && collected.length < 6; index -= 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (!isHeadingLine(line)) break;
    collected.unshift(line.trim());
    start = offsets[index];
  }
  return { lines: collected, start };
}

function joinHeading(lines: string[]): string | null {
  const merged: string[] = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    // A wrapped heading: a hyphen at the break, or a line ending or starting
    // mid-phrase ("... and Results" / "of Operations").
    if (previous !== undefined && /[-–]$/.test(previous)) merged[merged.length - 1] = `${previous}${line}`;
    else if (previous !== undefined && (/^[a-z(]/.test(line) || /\b(?:and|or|of|the|on|for|to|in|a|an|with|by|from)$/.test(previous))) {
      merged[merged.length - 1] = `${previous} ${line}`;
    } else merged.push(line);
  }
  const value = merged.map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' / ');
  return value || null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
};
const NUMBER_WORD = Object.keys(NUMBER_WORDS).join('|');
const PRIOR_REFERENCE = new RegExp(
  `\\b(?:prior|previous|original|earlier)?\\s*comments?\\s+(?:(?:no\\.?|number)\\s*)?((?:\\d{1,2}|${NUMBER_WORD})(?:\\s*(?:,|and|&|through|-)\\s*(?:\\d{1,2}|${NUMBER_WORD}))*)\\b`,
  'gi'
);

function priorCommentRefs(text: string): number[] {
  const refs = new Set<number>();
  const numberOf = (token: string) => NUMBER_WORDS[token.toLowerCase()] ?? Number(token);
  for (const match of text.matchAll(PRIOR_REFERENCE)) {
    // Only references framed as earlier correspondence count: "response to
    // comment 2", "prior comment 2", "we reissue comment 3".
    const window = text.slice(Math.max(0, (match.index ?? 0) - 40), (match.index ?? 0) + match[0].length);
    if (!/\b(?:prior|previous|original|earlier|response|reissue|repeat|reiterate)\b/i.test(window)) continue;
    const numbers = (match[1].match(new RegExp(`\\d{1,2}|${NUMBER_WORD}`, 'gi')) || []).map(numberOf);
    const range = /through|-/.test(match[1]) && numbers.length === 2;
    if (range) {
      const [from, to] = numbers;
      for (let value = from; value <= to && value - from < 20; value += 1) refs.add(value);
    } else {
      numbers.forEach(value => refs.add(value));
    }
  }
  return [...refs].sort((a, b) => a - b);
}

/**
 * Split a Staff letter into its numbered comments. Numbering is accepted
 * strictly in sequence (1, 2, 3, ...), so a stray "4." in a sentence or a
 * nested list cannot start a comment out of order.
 */
export function splitStaffComments(rawText: string | null | undefined): StaffComment[] {
  if (!rawText) return [];
  const text = cleanLetterText(rawText);
  const salutation = SALUTATION.exec(text);
  const bodyStart = salutation ? salutation.index + salutation[0].length : 0;

  const markers: Array<{ number: number; lineStart: number; contentStart: number }> = [];
  let expected = 1;
  STAFF_MARKER.lastIndex = bodyStart;
  for (const match of text.matchAll(STAFF_MARKER)) {
    const at = match.index ?? 0;
    if (at < bodyStart) continue;
    const number = Number(match[1]);
    if (number !== expected) continue;
    const lineStart = match[0].startsWith('\n') ? at + 1 : at;
    markers.push({ number, lineStart, contentStart: at + match[0].length });
    expected += 1;
  }
  if (markers.length === 0) return [];

  const lastMarker = markers[markers.length - 1];
  STAFF_CLOSING.lastIndex = 0;
  const closingMatch = STAFF_CLOSING.exec(text.slice(lastMarker.contentStart));
  const bodyEnd = closingMatch ? lastMarker.contentStart + closingMatch.index : text.length;

  // Heading stack above each marker; it also ends the previous comment.
  const headings = markers.map((marker, index) => {
    const regionStart = index === 0 ? bodyStart : markers[index - 1].contentStart;
    const block = headingBlock(text.slice(regionStart, marker.lineStart));
    return { lines: block.lines, start: block.lines.length > 0 ? regionStart + block.start : marker.lineStart };
  });

  const comments: StaffComment[] = [];
  let inheritedSection: string | null = null;
  markers.forEach((marker, index) => {
    const end = index + 1 < markers.length ? headings[index + 1].start : bodyEnd;
    const commentText = normaliseParagraphs(text.slice(marker.contentStart, Math.max(marker.contentStart, end)));
    const own = joinHeading(headings[index].lines);
    const section = own ?? inheritedSection;
    if (own) inheritedSection = own;
    comments.push({
      number: marker.number,
      text: commentText,
      filingSectionRef: section,
      filingSectionInherited: !own && Boolean(section),
      priorCommentRefs: priorCommentRefs(commentText),
    });
  });
  return comments;
}

/** "Unless we note otherwise, any references to prior comments are to comments in our March 6, 2024 letter." */
export function priorLetterDate(rawText: string | null | undefined): string | null {
  if (!rawText) return null;
  const flat = rawText.replace(/\s+/g, ' ');
  const match = flat.match(new RegExp(`references to prior comments are to comments in our (${MONTHS}) (\\d{1,2}), (\\d{4}) letter`, 'i'));
  if (!match) return null;
  const month = MONTHS.split('|').findIndex(name => name.toLowerCase() === match[1].toLowerCase()) + 1;
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
}

// ── Responses ───────────────────────────────────────────────────────────────

const RESPONSE_MARKER = /(?:^|\n)[ \t]*(?:(?:Staff\s+)?Comment\s*(?:No\.?|Number|#)?\s*)?(\d{1,2})\s*[.:)](?!\d)/gi;
// A label line: "Response", "Response:", "Company Response:", "RESPONSE",
// "Response to Comment No. 1:". Case-sensitive on purpose — "response"
// opening a wrapped line of prose ("Your\nresponse should ...") is not one.
// The label must end the line or be followed by a colon or dash.
const RESPONSE_LABEL = /(?:^|\n)[ \t]*(?:(?:Company|Our|Registrant(?:'|’)s|The Company(?:'|’)s|COMPANY|OUR)\s+)?(?:Response|RESPONSE)(?:\s+(?:to|TO)\s+(?:the\s+|THE\s+)?(?:Staff(?:'|’)s\s+|STAFF(?:'|’)S\s+)?(?:Comment|COMMENT)(?:\s*(?:No\.?|NO\.?|Number|#))?\s*\d{0,2})?[ \t]*(?:[:\-–—][ \t]*|\.?[ \t]*(?=\n))/;
const RESPONSE_CLOSING = /\n[ \t]*(?:\*[ \t]*\*[ \t]*\*[ \t]*(?=\n|$)|Sincerely|Very truly yours|Respectfully(?: submitted)?,|Yours (?:truly|sincerely)|If you have any (?:further )?questions|Should you have any (?:further )?questions|Please do not hesitate)/i;

interface ResponseAnchor {
  number: number;
  /** Character offset where the comment's repetition (or number) begins. */
  start: number;
  /** Character offset just after the number marker. */
  contentStart: number;
  matchedBy: 'comment-number' | 'comment-text';
  repeated: boolean;
}

function repetitionScore(staffWords: string[], tokens: Token[], fromToken: number): number {
  const sample = staffWords.slice(0, 20);
  if (sample.length === 0) return 0;
  const window = new Set(tokens.slice(fromToken, fromToken + sample.length * 2 + 15).map(token => token.word));
  const hits = sample.filter(word => window.has(word)).length;
  return hits / sample.length;
}

function locateAnchors(responseText: string, comments: StaffComment[]): Map<number, ResponseAnchor> {
  const tokens = tokenize(responseText);
  const candidates: Array<{ number: number; start: number; contentStart: number }> = [];
  RESPONSE_MARKER.lastIndex = 0;
  for (const match of responseText.matchAll(RESPONSE_MARKER)) {
    const at = match.index ?? 0;
    candidates.push({
      number: Number(match[1]),
      start: match[0].startsWith('\n') ? at + 1 : at,
      contentStart: at + match[0].length,
    });
  }

  const anchors = new Map<number, ResponseAnchor>();
  let floor = 0;
  // Pass 1: the comment's number followed by its repeated text.
  for (const comment of comments) {
    const staffWords = words(comment.text);
    const candidate = candidates.find(item => (
      item.number === comment.number
      && item.start >= floor
      && repetitionScore(staffWords, tokens, tokenIndexAt(tokens, item.contentStart)) >= 0.6
    ));
    if (candidate) {
      anchors.set(comment.number, { ...candidate, matchedBy: 'comment-number', repeated: true });
      floor = candidate.contentStart;
      continue;
    }
    // Pass 1b: the comment's opening words, wherever they are repeated.
    const fromToken = tokenIndexAt(tokens, floor);
    for (const skip of [0, 3, 6, 10]) {
      const phrase = staffWords.slice(skip, skip + 8);
      if (phrase.length < 6) break;
      const found = findPhrase(tokens, phrase, fromToken);
      if (found >= 0) {
        const start = tokens[found].start;
        anchors.set(comment.number, {
          number: comment.number, start, contentStart: start,
          matchedBy: 'comment-text', repeated: true,
        });
        floor = start + 1;
        break;
      }
    }
  }

  // Pass 2: numbered answers that do not repeat the comment. Only when every
  // comment number appears in order, so a stray "2." cannot be taken alone.
  const unmatched = comments.filter(comment => !anchors.has(comment.number));
  if (unmatched.length > 0) {
    let cursor = 0;
    const ordered: Array<{ number: number; start: number; contentStart: number }> = [];
    for (const comment of comments) {
      const known = anchors.get(comment.number);
      const candidate = known
        ? { number: comment.number, start: known.start, contentStart: known.contentStart }
        : candidates.find(item => item.number === comment.number && item.start >= cursor);
      if (!candidate) { ordered.length = 0; break; }
      ordered.push(candidate);
      cursor = candidate.contentStart;
    }
    if (ordered.length === comments.length) {
      for (const candidate of ordered) {
        if (!anchors.has(candidate.number)) {
          anchors.set(candidate.number, { ...candidate, matchedBy: 'comment-number', repeated: false });
        }
      }
    }
  }
  return anchors;
}

function flatLower(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*[-–—]\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Running headers and footers a response repeats on every page (the
 * addressee, the date, "Confidential Treatment Requested by ...", page
 * numbers). Short lines seen three or more times in the letter are page
 * furniture, not response text.
 */
function pageFurniture(responseText: string): Set<string> {
  const counts = new Map<string, number>();
  for (const line of responseText.split('\n')) {
    const key = flatLower(line);
    if (!key || key.length > 100) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count >= 3).map(([key]) => key));
}

function stripFurniture(excerpt: string, furniture: Set<string>): string {
  return excerpt
    .split('\n')
    .filter(line => {
      const key = flatLower(line);
      if (!key) return true;
      if (furniture.has(key)) return false;
      // Page numbers and Bates-style page codes ("AI-003").
      return !/^(?:page\s*\d+(?:\s+of\s+\d+)?|\d{1,3}|-\s*\d{1,3}\s*-|[a-z]{1,5}-\d{3,6})$/.test(key);
    })
    .join('\n');
}

/** Drop heading lines at the end of an excerpt that belong to the next comment. */
function trimTrailingHeadings(excerpt: string, headings: string): string {
  const lines = excerpt.split('\n');
  while (lines.length > 0) {
    const last = flatLower(lines[lines.length - 1]);
    if (!last) { lines.pop(); continue; }
    if (headings && last.length >= 8 && headings.includes(last)) { lines.pop(); continue; }
    break;
  }
  return lines.join('\n');
}

function responseFor(
  responseText: string,
  comment: StaffComment,
  anchor: ResponseAnchor,
  segmentEnd: number,
  headings: string,
  furniture: Set<string>
): { excerpt: string; excerptStart: IssueResponse['excerptStart'] } | null {
  const segment = responseText.slice(anchor.contentStart, segmentEnd);
  let start = 0;
  let excerptStart: IssueResponse['excerptStart'] = 'at-match';

  const label = RESPONSE_LABEL.exec(segment);
  if (label) {
    start = label.index + label[0].length;
    excerptStart = 'response-label';
  } else if (anchor.repeated) {
    // Find where the repeated comment ends: the furthest 5-word run of the
    // comment's closing words that appears near the top of the segment.
    const tokens = tokenize(segment);
    const staffWords = words(comment.text);
    const horizon = Math.min(tokens.length, Math.ceil(staffWords.length * 1.4) + 40);
    let endChar = -1;
    const tail = staffWords.slice(-40);
    for (let offset = tail.length - 5; offset >= 0; offset -= 1) {
      const found = findPhrase(tokens, tail.slice(offset, offset + 5), 0, horizon);
      if (found >= 0) {
        endChar = Math.max(endChar, tokens[found + 4].end);
        if (offset >= tail.length - 12) break;
      }
    }
    if (endChar >= 0) {
      // Skip the sentence's closing punctuation and quotes.
      const after = segment.slice(endChar).match(/^[\s.;:,"”’)\]]*/);
      start = endChar + (after ? after[0].length : 0);
      excerptStart = 'after-repeated-comment';
    }
  }

  const excerpt = normaliseParagraphs(trimTrailingHeadings(stripFurniture(segment.slice(start), furniture), headings));
  if (excerpt.length < 20) return null;
  return { excerpt, excerptStart };
}

function pairResponses(
  comments: StaffComment[],
  letter: IssueLetter
): Map<number, IssueResponse> {
  const result = new Map<number, IssueResponse>();
  if (!letter.content || comments.length === 0) return result;
  const responseText = normaliseLineEndings(letter.content);
  const anchors = locateAnchors(responseText, comments);
  const furniture = pageFurniture(responseText);
  // Every heading of the Staff letter: a response repeats them above each
  // comment, and they must not trail the previous answer.
  const headings = comments.map(comment => flatLower((comment.filingSectionRef || '').replace(/ \/ /g, ' '))).join('\n');
  const ordered = comments
    .map(comment => ({ comment, anchor: anchors.get(comment.number) }))
    .filter((item): item is { comment: StaffComment; anchor: ResponseAnchor } => Boolean(item.anchor))
    .sort((a, b) => a.anchor.start - b.anchor.start);

  ordered.forEach(({ comment, anchor }, index) => {
    let segmentEnd = index + 1 < ordered.length ? ordered[index + 1].anchor.start : responseText.length;
    if (index + 1 === ordered.length) {
      const closing = RESPONSE_CLOSING.exec(responseText.slice(anchor.contentStart + 200));
      if (closing) segmentEnd = anchor.contentStart + 200 + closing.index;
    }
    const found = responseFor(responseText, comment, anchor, segmentEnd, headings, furniture);
    if (!found) return;
    const truncated = found.excerpt.length > MAX_RESPONSE_EXCERPT_CHARS;
    result.set(comment.number, {
      accession: letter.accession,
      cik: String(letter.cik),
      date_filed: letter.date_filed,
      excerpt: truncated ? found.excerpt.slice(0, MAX_RESPONSE_EXCERPT_CHARS) : found.excerpt,
      excerptTruncated: truncated,
      matchedBy: anchor.matchedBy,
      excerptStart: found.excerptStart,
    });
  });
  return result;
}

// ── Episodes ────────────────────────────────────────────────────────────────

function isStaff(letter: IssueLetter): boolean {
  return letter.form.toUpperCase() === 'UPLOAD';
}

function isResponse(letter: IssueLetter): boolean {
  return letter.form.toUpperCase() === 'CORRESP';
}

/** Reading order: date, then Staff letter before a same-day response. */
export function orderEpisodeLetters<T extends IssueLetter>(letters: T[]): T[] {
  return [...letters].sort((a, b) => (
    a.date_filed.localeCompare(b.date_filed)
    || (isStaff(b) ? 1 : 0) - (isStaff(a) ? 1 : 0)
    || a.accession.localeCompare(b.accession)
  ));
}

function shortDate(value: string): string {
  return value.slice(0, 10);
}

export function buildEpisodeIssues(input: IssueLetter[]): EpisodeIssues {
  const letters = orderEpisodeLetters(input);
  const staffLetters = letters.filter(isStaff);

  const parsed = staffLetters.map((letter, index) => {
    const position = letters.indexOf(letter);
    const comments = splitStaffComments(letter.content);
    let kind: StaffLetterKind = 'comments';
    if (!letter.content) kind = 'text-missing';
    else if (comments.length === 0) {
      kind = isNoReviewLetter(letter.content)
        ? 'no-review'
        : isReviewCompleteLetter(letter.content) ? 'review-complete' : 'no-comments-found';
    }
    return { letter, position, comments, kind, round: index + 1, priorDate: priorLetterDate(letter.content) };
  });

  // Responses to a Staff letter are the CORRESP letters filed after it and
  // before the next Staff letter.
  const responsesFor = (position: number): IssueLetter[] => {
    const out: IssueLetter[] = [];
    for (let index = position + 1; index < letters.length; index += 1) {
      if (isStaff(letters[index])) break;
      if (isResponse(letters[index])) out.push(letters[index]);
    }
    return out;
  };

  const closing = parsed.find(item => item.kind === 'review-complete');
  const closedBy = closing ? { accession: closing.letter.accession, date_filed: shortDate(closing.letter.date_filed) } : null;

  // Build issues with responses first.
  const result: StaffLetterIssues[] = parsed.map(item => {
    const responses = responsesFor(item.position);
    const paired = new Map<number, IssueResponse>();
    for (const response of responses) {
      const found = pairResponses(item.comments.filter(comment => !paired.has(comment.number)), response);
      found.forEach((value, key) => paired.set(key, value));
    }
    const cik = String(item.letter.cik);
    return {
      staffAccession: item.letter.accession,
      staffDate: shortDate(item.letter.date_filed),
      cik,
      round: item.round,
      kind: item.kind,
      issues: item.comments.map(comment => ({
        key: `${item.letter.accession}#${comment.number}`,
        issueNumber: comment.number,
        round: item.round,
        staffAccession: item.letter.accession,
        staffDate: shortDate(item.letter.date_filed),
        cik,
        staffComment: comment.text,
        filingSectionRef: comment.filingSectionRef,
        filingSectionInherited: comment.filingSectionInherited,
        response: paired.get(comment.number) ?? null,
        followUp: [],
        followsUp: [],
        status: 'unclear' as IssueStatus,
        statusBasis: '',
      })),
    };
  });

  // Resolve "prior comment N" references to an earlier Staff letter's issue.
  parsed.forEach((item, index) => {
    if (item.comments.length === 0) return;
    const earlier = parsed.slice(0, index).filter(candidate => candidate.comments.length > 0);
    const byDate = item.priorDate ? earlier.find(candidate => shortDate(candidate.letter.date_filed) === item.priorDate) : undefined;
    item.comments.forEach(comment => {
      for (const reference of comment.priorCommentRefs) {
        const target = byDate && byDate.comments.some(c => c.number === reference)
          ? byDate
          : [...earlier].reverse().find(candidate => candidate.comments.some(c => c.number === reference));
        if (!target) continue;
        const targetIssues = result[parsed.indexOf(target)].issues;
        const targetIssue = targetIssues.find(issue => issue.issueNumber === reference);
        const thisIssue = result[index].issues.find(issue => issue.issueNumber === comment.number);
        if (!targetIssue || !thisIssue) continue;
        if (!targetIssue.followUp.some(follow => follow.staffAccession === thisIssue.staffAccession && follow.issueNumber === thisIssue.issueNumber)) {
          targetIssue.followUp.push({
            staffAccession: thisIssue.staffAccession,
            staffDate: thisIssue.staffDate,
            issueNumber: thisIssue.issueNumber,
            staffComment: thisIssue.staffComment,
          });
        }
        thisIssue.followsUp.push({ staffAccession: targetIssue.staffAccession, staffDate: targetIssue.staffDate, issueNumber: targetIssue.issueNumber });
      }
    });
  });

  // Status, from the evidence on file.
  result.forEach((staff, index) => {
    const item = parsed[index];
    const responses = responsesFor(item.position);
    const later = parsed.slice(index + 1);
    const completion = later.find(candidate => candidate.kind === 'review-complete');
    const nextRound = later.find(candidate => candidate.comments.length > 0);
    const laterStaff = later[0];
    for (const issue of staff.issues) {
      const followed = issue.followUp.filter(follow => nextRound && follow.staffAccession === nextRound.letter.accession);
      if (issue.response) {
        const responded = `Response filed ${issue.response.date_filed}`;
        if (completion) {
          issue.status = 'resolved';
          issue.statusBasis = `${responded}; the Staff letter of ${shortDate(completion.letter.date_filed)} states the review is complete${issue.followUp.length > 0 ? ` (after the follow-up${issue.followUp.length > 1 ? 's' : ''} below)` : ''}.`;
        } else if (nextRound && followed.length > 0) {
          issue.status = 'responded';
          issue.statusBasis = `${responded}; the Staff followed up in its letter of ${shortDate(nextRound.letter.date_filed)} (comment ${followed.map(f => f.issueNumber).join(', ')}). No completion letter is on file.`;
        } else if (nextRound) {
          issue.status = 'responded';
          issue.statusBasis = `${responded}; not repeated in the Staff letter of ${shortDate(nextRound.letter.date_filed)}, but no completion letter is on file for this episode.`;
        } else {
          issue.status = 'responded';
          issue.statusBasis = `${responded}; no later Staff letter is on file.`;
        }
        continue;
      }
      const withoutText = responses.filter(letter => !letter.content).length;
      if (responses.length === 0 && !laterStaff) {
        issue.status = 'open';
        issue.statusBasis = 'No company response is on file after this Staff letter.';
      } else if (responses.length === 0) {
        issue.status = 'unclear';
        issue.statusBasis = `No response letter is on file between this Staff letter and the next one (${shortDate(laterStaff.letter.date_filed)}).`;
      } else if (withoutText > 0) {
        issue.status = 'unclear';
        issue.statusBasis = `${withoutText} of ${responses.length} response letter${responses.length === 1 ? '' : 's'} on file ${withoutText === 1 ? 'has' : 'have'} no extracted text, so this comment could not be paired.`;
      } else {
        issue.status = 'unclear';
        issue.statusBasis = `The response letter${responses.length === 1 ? '' : 's'} on file (${responses.map(letter => shortDate(letter.date_filed)).join(', ')}) do${responses.length === 1 ? 'es' : ''} not repeat this comment's number or text, so no response could be paired.`;
      }
    }
  });

  const allIssues = result.flatMap(staff => staff.issues);
  const responseLetters = letters.filter(isResponse);
  return {
    parserVersion: COMMENT_ISSUES_PARSER_VERSION,
    letters: result,
    closedBy,
    coverage: {
      staffLetters: staffLetters.length,
      staffLettersWithText: staffLetters.filter(letter => Boolean(letter.content)).length,
      responseLetters: responseLetters.length,
      responseLettersWithText: responseLetters.filter(letter => Boolean(letter.content)).length,
      issues: allIssues.length,
      issuesWithResponse: allIssues.filter(issue => issue.response).length,
    },
  };
}

// ── Similar comments ────────────────────────────────────────────────────────

const STOPWORDS = new Set((
  'a about above after again against all also although am an and any are as at be because been before being below between both but by can '
  + 'could did do does doing down during each either few for from further had has have having he her here hers him his how however i if in '
  + 'into is it its itself just may me might more most must my no nor not now of off on once only or other our ours out over own per please '
  + 'same she should so some such than that the their theirs them then there these they this those through to too under until up upon us very '
  + 'was we were what when where whether which while who whom why will with within would you your yours '
  // Staff-letter boilerplate that carries no topic.
  + 'note notes noted disclose disclosed disclosure disclosures revise revised revision future filings filing tell explain provide '
  + 'response respond comment comments prior basis consider considered consideration describe discuss including include includes '
  + 'related relating regarding page pages example references refer referenced reference additional information quantify '
  + 'company registrant staff period periods year years fiscal ended form amount amounts significant certain clarify '
  + 'state states stated analysis support supporting supports applied apply applies determine determined '
  + 'material materially operations operating business change changes changed continuing continue continues evaluate '
  + 'provided report reports reported specifically address addresses opening expressed value values result results '
  + 'impact impacts factors factor conclusions conclusion supplementally development presented present discussion '
  + 'differences difference recognized received understand understanding detail detailed further identify identified '
  + 'policy policies statement statements financial total reasonably item items office '
  + 'january february march april june july august september october november december'
).split(/\s+/));

/** A standards citation worth keeping as a quoted phrase. */
const CITATION = /\b(?:ASC|ASU|SAB|IFRS|IAS)\s+[\d-]+(?:-\d+)*|\bItem\s+\d+(?:\.\d+)?(?:\([a-z0-9]+\))*\s+of\s+Regulation\s+S-[KX]|\bRule\s+\d+-\d+(?:\([a-z0-9]+\))*/gi;

export interface SimilarCommentQuery {
  /** Postgres websearch_to_tsquery syntax: quoted phrases and terms, AND-ed. */
  query: string;
  /** The phrases and terms shown to the user. */
  terms: string[];
}

/**
 * Key phrases for a bounded full-text search over Staff letters: at most one
 * standards citation (as a quoted phrase) and the three most distinctive
 * content words. This is a text search, not a semantic match, and the UI
 * labels it so.
 */
export function similarCommentQuery(
  commentText: string,
  sectionRef?: string | null,
  companyName?: string | null
): SimilarCommentQuery | null {
  const terms: string[] = [];
  const citation = commentText.match(CITATION)?.[0]?.replace(/\s+/g, ' ').trim();
  if (citation) terms.push(`"${citation}"`);

  const counts = new Map<string, number>();
  const sectionWords = new Set(words(sectionRef || ''));
  // The registrant's own name would only find its own letters.
  const companyWords = new Set(words(companyName || ''));
  for (const word of words(commentText)) {
    if (word.length < 4 || STOPWORDS.has(word) || companyWords.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) || 0) + (sectionWords.has(word) ? 2 : 1));
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .map(([word]) => word)
    .filter(word => !citation || !citation.toLowerCase().includes(word));
  terms.push(...ranked.slice(0, citation ? 2 : 3));
  // One generic word is not a usable search; a citation alone is.
  if (terms.length === 0 || (!citation && terms.length < 2)) return null;
  return { query: terms.join(' '), terms };
}
