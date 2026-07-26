/**
 * ASC / ASU citation filter (Intelligize-benchmark B4).
 *
 * "Find every filing citing ASC 842" cannot be a raw phrase search, because
 * filings cite standards in several house styles: "ASC 842", "ASC Topic 842",
 * "Topic 842", subtopic forms ("ASC 842-10"), and for updates "ASU 2023-07",
 * "ASU No. 2023-07", "Accounting Standards Update No. 2023-07". This module
 * canonicalizes the user's input once and expands it to every citation form,
 * so retrieval fetches candidates under all of them and validation accepts
 * any of them.
 *
 * The corpus carries no full-text index of our own (metadata-only facet
 * store), so this is a text-validated filter like the auditor and section
 * filters — the benchmark's "extract at index time" adapted honestly to this
 * architecture. Enforcement reuses the Boolean engine verbatim: the variants
 * become one OR expression evaluated by booleanQueryMatches, so citation
 * matching can never drift from search matching.
 */

import { booleanQueryMatches } from './booleanSearch';

export interface AccountingReference {
  kind: 'asc' | 'asu';
  /** "842" for ASC; "2023-07" for ASU. */
  identifier: string;
  /** Canonical display form: "ASC 842" / "ASU 2023-07". */
  label: string;
}

/**
 * Parse user input into a canonical reference, or null when it is not a
 * recognizable ASC topic or ASU number. Accepted spellings include
 * "ASC 842", "asc842", "Topic 842", "842", "ASC 842-10",
 * "ASU 2023-07", "asu no. 2023-07", "2023-07".
 */
export function parseAccountingReference(raw: string): AccountingReference | null {
  const input = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!input) return null;

  // ASU: a year-dash-number update, with or without the prefix.
  const asu = input.match(/^(?:asu|accounting standards update)?\s*(?:no\.?\s*)?((?:19|20)\d{2})-(\d{1,2})$/);
  if (asu) {
    const identifier = `${asu[1]}-${asu[2].padStart(2, '0')}`;
    return { kind: 'asu', identifier, label: `ASU ${identifier}` };
  }

  // ASC: a three-digit topic, optionally with subtopic segments the filter
  // deliberately widens to the whole topic — a researcher filtering on
  // "ASC 842-10" wants the topic's filings, not a stricter subtopic slice
  // they can still express in the query itself.
  const asc = input.match(/^(?:asc|topic|asc topic|codification topic)?\s*(\d{3})(?:-\d{1,3})*$/);
  if (asc) {
    const identifier = asc[1];
    return { kind: 'asc', identifier, label: `ASC ${identifier}` };
  }

  return null;
}

/**
 * The citation spellings filings actually use, quoted and ready to serve as
 * EFTS retrieval candidates.
 */
export function buildReferenceSearchTerms(reference: AccountingReference): string[] {
  if (reference.kind === 'asu') {
    return [
      `"ASU ${reference.identifier}"`,
      `"ASU No. ${reference.identifier}"`,
      // Observed in live filings ("the FASB issued ASU Topic 2023-07 ...").
      `"ASU Topic ${reference.identifier}"`,
      `"Accounting Standards Update ${reference.identifier}"`,
      `"Accounting Standards Update No. ${reference.identifier}"`,
    ];
  }
  return [
    `"ASC ${reference.identifier}"`,
    `"ASC Topic ${reference.identifier}"`,
    `"Topic ${reference.identifier}"`,
  ];
}

/** One OR expression over every citation form, for the Boolean engine. */
export function referenceBooleanExpression(reference: AccountingReference): string {
  return buildReferenceSearchTerms(reference).join(' OR ');
}

/** True when the filing text cites the standard in ANY accepted form. */
export function textCitesReference(reference: AccountingReference, filingText: string): boolean {
  if (!filingText) return false;
  return booleanQueryMatches(referenceBooleanExpression(reference), filingText);
}
