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
const REFERRING_WORDS = new Set(['see', 'refer', 'in', 'under', 'to', 'of', 'per', 'and', 'through']);

const ITEM_RE = /(?:^| )item (\d{1,2}(?:\.\d{2})?[abc]?)(?= |$)/g;

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
  let heading: { number: string; index: number } | null = null;

  ITEM_RE.lastIndex = 0;
  for (let hit = ITEM_RE.exec(prefix); hit; hit = ITEM_RE.exec(prefix)) {
    const before = prefix.slice(0, hit.index).trimEnd().split(' ');
    const wordBefore = before[before.length - 1] || '';
    if (REFERRING_WORDS.has(wordBefore)) continue;
    heading = { number: hit[1], index: hit.index };
  }
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
