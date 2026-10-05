/**
 * Section-path breadcrumbs for search hits (Intelligize parity, benchmark A2).
 *
 * A researcher reading `... identified a material weakness in its icfr ...`
 * wants to know WHERE in the filing that sentence lives — Item 9A is a
 * remediation disclosure, Item 8 is the auditor's report, an 8-K Item 2.02 is
 * an earnings release. Their result list shows a section breadcrumb on every
 * snippet; ours showed none.
 *
 * Derived from the filing text already fetched for Boolean validation — no
 * extra requests. The match snippet is a join of engine-normalized tokens, so
 * it is located inside the SAME normalization of the full text, then the
 * nearest preceding Item heading names the section.
 *
 * Honesty rules:
 * - Cross-references ("see Item 1A", "in Part II, Item 5") never count as
 *   headings — occurrences preceded by referring words are skipped.
 * - The canonical title is used ONLY when the filing's own words after the
 *   item number agree with it (first word match). Otherwise the filing's own
 *   following words are shown. A 10-Q "Item 2" (Unregistered Sales) is never
 *   labelled with the 10-K's "Properties".
 * - No heading before the match → no breadcrumb, never a guess.
 */

import { normalizeForMatch } from './booleanSearch';

/** Canonical annual-report item titles (10-K); shared numbers self-validate. */
const ITEM_TITLES: Record<string, string> = {
  '1': 'Business',
  '1a': 'Risk Factors',
  '1b': 'Unresolved Staff Comments',
  '1c': 'Cybersecurity',
  '2': 'Properties',
  '3': 'Legal Proceedings',
  '4': 'Mine Safety Disclosures',
  '5': 'Market for Registrant’s Common Equity',
  '7': 'Management’s Discussion and Analysis',
  '7a': 'Quantitative and Qualitative Disclosures About Market Risk',
  '8': 'Financial Statements and Supplementary Data',
  '9': 'Changes in and Disagreements with Accountants',
  '9a': 'Controls and Procedures',
  '9b': 'Other Information',
  '9c': 'Disclosure Regarding Foreign Jurisdictions',
  '10': 'Directors, Executive Officers and Corporate Governance',
  '11': 'Executive Compensation',
  '12': 'Security Ownership of Certain Beneficial Owners',
  '13': 'Certain Relationships and Related Transactions',
  '14': 'Principal Accountant Fees and Services',
  '15': 'Exhibits and Financial Statement Schedules',
  // Common 8-K items (normalized "2.02" keeps its decimal under engine v3).
  '1.01': 'Entry into a Material Definitive Agreement',
  '2.01': 'Completion of Acquisition or Disposition of Assets',
  '2.02': 'Results of Operations and Financial Condition',
  '2.05': 'Costs Associated with Exit or Disposal Activities',
  '2.06': 'Material Impairments',
  '4.01': 'Changes in Registrant’s Certifying Accountant',
  '4.02': 'Non-Reliance on Previously Issued Financial Statements',
  '5.02': 'Departure of Directors or Certain Officers',
  '7.01': 'Regulation FD Disclosure',
  '8.01': 'Other Events',
  '9.01': 'Financial Statements and Exhibits',
};

/** Words that mark an "item N" occurrence as a cross-reference, not a heading. */
const REFERRING_WORDS = new Set(['see', 'refer', 'in', 'under', 'to', 'of', 'per', 'and', 'through', 'with', 'within']);

const ITEM_RE = /(?:^| )item (\d{1,2}(?:\.\d{2})?[abc]?)(?= |$)/g;

interface ItemHeading {
  number: string;
  index: number;
}

/**
 * Every Item heading in engine-normalized text, in document order, with
 * cross-references ("see Item 1A", "in Part II, Item 5") excluded. Shared by
 * the breadcrumb deriver and the section slicer so the two can never disagree
 * about where a section starts.
 */
function findItemHeadings(normalizedText: string): ItemHeading[] {
  const headings: ItemHeading[] = [];
  ITEM_RE.lastIndex = 0;
  for (let hit = ITEM_RE.exec(normalizedText); hit; hit = ITEM_RE.exec(normalizedText)) {
    if (isItemCrossReference(normalizedText, hit.index, hit[0].length)) continue;
    headings.push({ number: hit[1], index: hit.index });
  }
  return headings;
}

/**
 * Words that, right AFTER an item number, mark a reference rather than a
 * heading: "Part I, Item 1A of this Form 10-K", "Item 7 and Item 8". A real
 * heading is followed by its title.
 */
const FOLLOWING_REFERENCE_WORDS = new Set(['of', 'in', 'and', 'or', 'to', 'above', 'below', 'herein', 'hereof', 'thereof', 'which']);

/**
 * Is the "item N" at this offset a cross-reference? The word before it
 * decides ("see Item 1A"); when that word is a part number, the word before
 * the PART decides — "in conjunction with Part II, Item 7, “Management’s
 * Discussion…”" carries the title right after the number and still is not
 * the section (observed live: it cut Apple's Risk Factors to one paragraph).
 * The word after the number catches the rest ("Part I, Item 1A of this Form
 * 10-K").
 */
function isItemCrossReference(normalizedText: string, index: number, matchLength: number): boolean {
  const before = normalizedText.slice(Math.max(0, index - 80), index).trimEnd().split(' ');
  let wordBefore = before[before.length - 1] || '';
  if (/^(i|ii|iii|iv)$/.test(wordBefore) && before[before.length - 2] === 'part') {
    wordBefore = before[before.length - 3] || '';
  }
  if (REFERRING_WORDS.has(wordBefore)) return true;
  const after = normalizedText.slice(index + matchLength, index + matchLength + 24).trimStart().split(' ')[0] || '';
  return FOLLOWING_REFERENCE_WORDS.has(after);
}

/** "Item 1A" / "1a" / "9A" / "2.02" → the normalized heading number, or ''. */
export function normalizeItemNumber(raw: string): string {
  const match = raw.trim().toLowerCase().match(/^(?:item\s*)?(\d{1,2}(?:\.\d{2})?[abc]?)$/);
  return match ? match[1] : '';
}

/**
 * Where "Part I" / "Part II" begin and end in the normalized text — needed
 * because a 10-Q reuses item numbers across parts (Part I Item 2 is MD&A,
 * Part II Item 2 is Unregistered Sales). Cross-references ("in part ii,
 * item 1") are excluded the same way item cross-references are.
 *
 * Markers come in runs: the table of contents lists both parts, the body
 * opens Part I, and many filers repeat "PART I" as a running page header on
 * every page until Part II begins. A part's body is the run of its own
 * markers that spans the most text before the other part's next marker. The
 * old rule — the LAST occurrence — landed on the final running header of the
 * part and lost every item before it (observed live on Microsoft's 10-Q,
 * where Risk Factors and MD&A both read as absent).
 */
const PART_RE = /(?:^| )part (i{1,3}|iv)(?= |$)/g;

function findPartRange(normalizedText: string, part: 1 | 2): { start: number; end: number } | null {
  const markers: Array<{ part: string; index: number }> = [];
  PART_RE.lastIndex = 0;
  for (let hit = PART_RE.exec(normalizedText); hit; hit = PART_RE.exec(normalizedText)) {
    const before = normalizedText.slice(Math.max(0, hit.index - 40), hit.index).trimEnd().split(' ');
    const wordBefore = before[before.length - 1] || '';
    if (REFERRING_WORDS.has(wordBefore)) continue;
    // "(Part II, Item 1A of this Form 10-Q)" mid-MD&A is a reference too: a
    // part marker that leads straight into a referenced item, or into "of
    // this report", is not where the part begins.
    const after = normalizedText.slice(hit.index + hit[0].length, hit.index + hit[0].length + 60).trimStart();
    if (/^of /.test(after)) continue;
    const itemAfter = after.match(/^item \d{1,2}(?:\.\d{2})?[abc]? (\S+)/);
    if (itemAfter && FOLLOWING_REFERENCE_WORDS.has(itemAfter[1])) continue;
    markers.push({ part: hit[1], index: hit.index });
  }
  const roman = part === 1 ? 'i' : 'ii';
  let best: { start: number; end: number } | null = null;
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    // Only the first marker of a run opens a candidate body.
    if (marker.part !== roman || (index > 0 && markers[index - 1].part === roman)) continue;
    const next = markers.slice(index + 1).find(other => other.part !== roman);
    const end = next ? next.index : normalizedText.length;
    if (!best || end - marker.index > best.end - best.start) best = { start: marker.index, end };
  }
  return best;
}

export interface SectionSliceOptions {
  /** Restrict the search to a filing part (10-Q reuses item numbers). */
  part?: 1 | 2;
}

/**
 * Heading-based slicing for documents without item numbers (registration
 * statements: S-1, F-1, 424B prospectuses). Sections are bounded by a fixed
 * vocabulary of prospectus headings rather than "Item N".
 *
 * Precision comes from three rules working together:
 * - an occurrence preceded by a referring word ("see Risk Factors", "under
 *   Business") is prose, not a heading;
 * - a slice ends at the next occurrence of ANY vocabulary heading (other
 *   than the target itself — prospectuses repeat running heads too);
 * - among surviving occurrences the LONGEST slice is the body, since table
 *   of contents entries sit one line apart.
 *
 * The phrase "risk factors" also appears mid-sentence constantly; those
 * occurrences produce short or referring-word-guarded slices and lose to the
 * real section. Returns '' when no occurrence survives — never a guess.
 */
export function extractHeadingSection(
  filingText: string,
  targetAliases: string[],
  boundaryVocabulary: string[]
): string {
  const range = headingSectionRange(filingText, targetAliases, boundaryVocabulary);
  return range ? range.normalizedText.slice(range.start, range.end) : '';
}

/**
 * Where a normalized slice sits: offsets into the engine-normalized text,
 * already trimmed. Callers that need the filing's own words map these back
 * through normalizedTokenOffsets (sectionOriginalText).
 */
export interface NormalizedSliceRange {
  normalizedText: string;
  start: number;
  end: number;
}

function trimmedRange(normalizedText: string, start: number, end: number): NormalizedSliceRange | null {
  let from = start;
  let to = end;
  while (from < to && normalizedText[from] === ' ') from += 1;
  while (to > from && normalizedText[to - 1] === ' ') to -= 1;
  return to > from ? { normalizedText, start: from, end: to } : null;
}

/** extractHeadingSection, as offsets into the normalized text. */
export function headingSectionRange(
  filingText: string,
  targetAliases: string[],
  boundaryVocabulary: string[],
  normalized?: string
): NormalizedSliceRange | null {
  if (!filingText || targetAliases.length === 0) return null;
  const normalizedText = normalized ?? normalizeForMatch(filingText);
  if (!normalizedText) return null;

  const targets = targetAliases.map(alias => normalizeForMatch(alias)).filter(Boolean);
  const boundaries = boundaryVocabulary
    .map(heading => normalizeForMatch(heading))
    .filter(heading => heading && !targets.includes(heading));

  const wordBefore = (index: number): string => {
    const before = normalizedText.slice(0, index).trimEnd().split(' ');
    return before[before.length - 1] || '';
  };

  const findOccurrences = (phrase: string, stopWords: Set<string>): number[] => {
    const indices: number[] = [];
    let cursor = normalizedText.indexOf(phrase);
    while (cursor !== -1) {
      // Token boundaries: the phrase must not be the tail/head of a longer token.
      const beforeChar = cursor === 0 ? ' ' : normalizedText[cursor - 1];
      const afterChar = normalizedText[cursor + phrase.length] ?? ' ';
      if (beforeChar === ' ' && (afterChar === ' ' || afterChar === '') && !stopWords.has(wordBefore(cursor))) {
        indices.push(cursor);
      }
      cursor = normalizedText.indexOf(phrase, cursor + phrase.length);
    }
    return indices;
  };

  // Guard asymmetry, on purpose. A prose "the use of proceeds" accepted as a
  // BOUNDARY truncates the target section early — the bad failure — so
  // boundaries also stop on determiners and possessives. Over-guarding a
  // real boundary merely lets the slice overshoot into the next section,
  // which is coarse but never loses target content. Targets keep the lighter
  // cross-reference guard: their false negatives lose whole sections.
  const boundaryStops = new Set([
    ...REFERRING_WORDS,
    'the', 'a', 'an', 'our', 'its', 'their', 'this', 'that', 'such', 'any',
    'with', 'from', 'regarding', 'about', 'on', 'for', 'as', 'or',
  ]);

  const boundaryStarts = boundaries
    .flatMap(phrase => findOccurrences(phrase, boundaryStops))
    .sort((a, b) => a - b);

  let best: { start: number; end: number } | null = null;
  for (const target of targets) {
    for (const start of findOccurrences(target, REFERRING_WORDS)) {
      const end = boundaryStarts.find(index => index > start) ?? normalizedText.length;
      if (!best || end - start > best.end - best.start) best = { start, end };
    }
  }
  if (!best) return null;

  return trimmedRange(normalizedText, best.start, best.end);
}

/**
 * The slice of a filing's text that belongs to one Item section, in
 * engine-normalized form — from the section's own heading to the next Item
 * heading (or end of document). Returns '' when the filing has no such
 * section, so "Item 1A contains X" can never silently fall back to matching
 * the whole document.
 *
 * A filing usually mentions each Item several times — table of contents,
 * body heading, sometimes a running header. Among the candidate occurrences
 * the one with the LONGEST following slice is the body: TOC entries are one
 * line apart, real sections run for pages. (Position alone is not enough —
 * "last occurrence" breaks the moment an item number repeats across parts.)
 */
export function extractItemSection(
  filingText: string,
  itemNumber: string,
  options: SectionSliceOptions = {}
): string {
  const range = itemSectionRange(filingText, itemNumber, options);
  return range ? range.normalizedText.slice(range.start, range.end) : '';
}

/** extractItemSection, as offsets into the normalized text. */
export function itemSectionRange(
  filingText: string,
  itemNumber: string,
  options: SectionSliceOptions = {},
  normalized?: string
): NormalizedSliceRange | null {
  const target = normalizeItemNumber(itemNumber);
  if (!filingText || !target) return null;

  const normalizedText = normalized ?? normalizeForMatch(filingText);
  const headings = findItemHeadings(normalizedText);

  // Part scoping: only occurrences at or after the requested part's own
  // heading count. A part-2 request in a filing with no Part II marker
  // yields nothing rather than a guess from the wrong part.
  let rangeStart = 0;
  let rangeEnd = normalizedText.length;
  if (options.part) {
    const range = findPartRange(normalizedText, options.part);
    if (!range) return null;
    rangeStart = range.start;
    rangeEnd = range.end;
  }

  const inRange = headings.filter(h => h.index >= rangeStart && h.index < rangeEnd);
  let best: { start: number; end: number } | null = null;
  for (const heading of inRange) {
    if (heading.number !== target) continue;
    // A repeated heading for the SAME item never ends its own section — many
    // filers print "Item 1A" as a running page header throughout the section,
    // which otherwise fragments it into page-sized slices (observed live:
    // Microsoft's Risk Factors measured as ~880 of ~15,000 tokens, and the
    // year-over-year comparison diffed two different fragments). The slice
    // runs to the next DIFFERENT item.
    const next = inRange.find(h => h.index > heading.index && h.number !== target);
    const end = next ? next.index : rangeEnd;
    if (!best || end - heading.index > best.end - best.start) {
      best = { start: heading.index, end };
    }
  }
  if (!best) return null;

  return trimmedRange(normalizedText, best.start, best.end);
}

function formatItemNumber(raw: string): string {
  // "9a" → "9A"; "2.02" stays as-is.
  return raw.replace(/([a-c])$/, letter => letter.toUpperCase());
}

function titleCase(words: string): string {
  const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']);
  return words
    .split(' ')
    .map((word, index) =>
      index > 0 && MINOR.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

/**
 * The section breadcrumb for a match snippet within a filing's text, e.g.
 * "Item 9A · Controls and Procedures", or '' when it cannot be derived
 * honestly.
 */
export function deriveSectionPath(filingText: string, matchSnippet: string): string {
  if (!filingText || !matchSnippet) return '';

  const normalizedText = normalizeForMatch(filingText);
  // Snippets carry "... " continuation markers; the core is normalized tokens.
  const core = normalizeForMatch(matchSnippet.replace(/\.\.\./g, ' '));
  if (!core) return '';

  const matchOffset = normalizedText.indexOf(core);
  if (matchOffset < 0) return '';

  // The snippet centres the match inside ~14 words of context either side, so
  // a heading in its LEADING context is still before the match — scan up to
  // the snippet's midpoint. Headings in the trailing half (the section that
  // starts right after the matched sentence) stay excluded.
  const prefix = normalizedText.slice(0, matchOffset + Math.floor(core.length / 2));
  const heading = findItemHeadings(prefix).pop() ?? null;
  if (!heading) return '';

  const itemLabel = `Item ${formatItemNumber(heading.number)}`;

  // The filing's own words after the heading are the title candidate; a
  // bounded window is enough for any title and independent of where the
  // match sits relative to the heading.
  const afterHeading = normalizedText
    .slice(heading.index, heading.index + 120)
    .replace(/^ ?item [^ ]+ ?/, '');
  const followingWords = afterHeading.split(' ').filter(Boolean).slice(0, 8);

  const canonical = ITEM_TITLES[heading.number];
  if (canonical && followingWords[0] && normalizeForMatch(canonical).startsWith(followingWords[0])) {
    return `${itemLabel} · ${canonical}`;
  }

  // No canonical agreement: show the filing's own heading words, cut at the
  // first token that reads as body rather than title (a number, or nothing).
  const inline: string[] = [];
  for (const word of followingWords) {
    if (/^\d/.test(word) || word === 'item') break;
    inline.push(word);
    if (inline.length >= 6) break;
  }
  return inline.length >= 2 ? `${itemLabel} · ${titleCase(inline.join(' '))}` : itemLabel;
}
