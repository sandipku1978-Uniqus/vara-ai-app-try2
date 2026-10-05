/**
 * The filing form a comment letter concerns, read from the letter's own
 * "Re:" block — never guessed from the issuer or the letter body.
 *
 * Staff letters (UPLOAD) and company responses (CORRESP) both open with a
 * reference block naming the filing under review:
 *
 *   Re: Apple Inc.
 *       Form 10-K for the fiscal year ended September 30, 2023
 *       File No. 001-36743
 *
 * The body routinely mentions other forms ("In the December 30, 2023 Form
 * 10-Q, you state ..."), so only the reference block is read. A letter
 * without a recognisable block yields an empty list, which the facet table
 * stores as "read, no form named" — distinct from a letter not yet read.
 *
 * Pure: used by the ingest pipeline (data-pipeline/fetch-letter-text.ts)
 * to populate urc_letter_facets (migration 027) and by the filter UI for
 * its option list.
 */

/** Bump when the reader changes so the pipeline re-derives stored facets. */
export const REVIEWED_FORMS_DERIVATION_VERSION = 1;

/** Canonical values stored in urc_letter_facets.reviewed_forms. */
export const REVIEWED_FORM_OPTIONS = [
  '10-K', '10-Q', '8-K', '20-F', '40-F', '6-K',
  'S-1', 'S-3', 'S-4', 'S-11', 'F-1', 'F-3', 'F-4',
  '10', '1-A', 'Schedule 14A', 'Schedule TO', 'Schedule 13E-3', '11-K',
] as const;

export type ReviewedForm = (typeof REVIEWED_FORM_OPTIONS)[number] | string;

export interface ReviewedFormsResult {
  forms: string[];
  /** The whitespace-normalised reference block the forms were read from. */
  basis: string | null;
}

const MAX_BASIS_CHARS = 300;
const HEADER_WINDOW_CHARS = 8_000;
const MAX_BLOCK_CHARS = 700;

/** "Re:" (or "RE:") opening the reference block, at the start of a line. */
const RE_LINE = /(?:^|\n)[ \t]*R[Ee][ \t]*:[ \t]*/;
/** Where the reference block ends: the salutation. */
const BLOCK_END = /\n[ \t]*(?:Dear\b|Ladies and Gentlemen|Gentlemen|To Whom It May Concern|Mesdames|Sirs)/i;

// Longest alternatives first: JavaScript alternation takes the first match,
// and the trailing (?![\w-]) refuses "Form 10" inside "Form 10-K".
const FORM_PATTERN = /\bForms?\s+(10-K|10-Q|10-12G|10-12B|8-K|20-F|40-F|6-K|11-K|S-11|S-1|S-3|S-4|S-8|F-1|F-3|F-4|1-A|N-2|DEF\s*14A|PRE\s*14A|DEFM\s*14A|PREM\s*14A|DEFA\s*14A|PRER\s*14A|DEFR\s*14A|10)(?:\/A)?(?![\w-])/gi;
const SCHEDULE_PATTERN = /\bSchedule\s+(14A|TO(?:-[TIC])?|13E-3|14D-9)(?:\/A)?(?![\w-])/gi;
const PROXY_PATTERN = /\b(?:Preliminary|Definitive|Revised)\s+(?:Merger\s+)?Proxy\s+Statement/gi;

function canonicalForm(raw: string): string {
  const value = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  if (/^(?:DEF|PRE|DEFM|PREM|DEFA|PRER|DEFR) ?14A$/.test(value) || value === '14A') return 'Schedule 14A';
  if (value === '10-12G' || value === '10-12B') return '10';
  if (/^TO(?:-[TIC])?$/.test(value)) return 'Schedule TO';
  if (value === '13E-3') return 'Schedule 13E-3';
  if (value === '14D-9') return 'Schedule 14D-9';
  return value;
}

/** The reference block of a letter, whitespace-normalised, or null. */
export function letterReferenceBlock(text: string): string | null {
  const head = text.slice(0, HEADER_WINDOW_CHARS);
  const start = RE_LINE.exec(head);
  if (!start) return null;
  const from = start.index + start[0].length;
  const rest = head.slice(from, from + MAX_BLOCK_CHARS + 200);
  const end = BLOCK_END.exec(rest);
  const block = (end ? rest.slice(0, end.index) : rest.slice(0, MAX_BLOCK_CHARS))
    .replace(/\s+/g, ' ')
    .trim();
  return block || null;
}

export function deriveReviewedForms(text: string | null | undefined): ReviewedFormsResult {
  if (!text) return { forms: [], basis: null };
  const block = letterReferenceBlock(text);
  if (!block) return { forms: [], basis: null };

  const found: Array<{ index: number; form: string }> = [];
  for (const pattern of [FORM_PATTERN, SCHEDULE_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of block.matchAll(pattern)) {
      found.push({ index: match.index ?? 0, form: canonicalForm(match[1]) });
    }
  }
  PROXY_PATTERN.lastIndex = 0;
  for (const match of block.matchAll(PROXY_PATTERN)) {
    found.push({ index: match.index ?? 0, form: 'Schedule 14A' });
  }
  found.sort((a, b) => a.index - b.index);

  const forms: string[] = [];
  for (const item of found) {
    if (!forms.includes(item.form)) forms.push(item.form);
  }
  return {
    forms: forms.slice(0, 12),
    basis: block.length > MAX_BASIS_CHARS ? `${block.slice(0, MAX_BASIS_CHARS - 1)}…` : block,
  };
}
