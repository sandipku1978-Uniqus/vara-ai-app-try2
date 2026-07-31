/**
 * Issuer-freshness notice for scoped searches.
 *
 * The Research Workbench shows disclosure documents (the research form
 * scope); the Dashboard and Insider Trading pages show everything, live.
 * When an issuer's most recent EDGAR filing is an ownership form, the
 * workbench's newest result is older than what the Dashboard shows — which
 * is CORRECT for both surfaces, but reads as staleness unless the product
 * says so. Observed live: Alphabet's dashboard row said Form 4 2026-07-30
 * while the workbench's newest hit was the 7/23 10-Q, and the difference
 * looked like a data bug.
 *
 * This helper turns that silent gap into one honest sentence: which form,
 * filed when, and where to see it.
 */

import type { SecSubmission } from './secApi';
import { describeForm } from '../lib/formLabels';

/** Ownership forms live on the Insider Trading page, not in research results. */
const INSIDER_FORMS = new Set(['3', '4', '5', '144', '3/A', '4/A', '5/A', '144/A']);

export interface IssuerFreshnessNotice {
  message: string;
  /** True when the newer filing is an ownership form — link to /insiders. */
  insider: boolean;
}

/**
 * A notice when the issuer's newest EDGAR filing (ANY form) is newer than
 * the newest result on screen — otherwise null. Null on missing data too:
 * this exists to explain a difference, never to manufacture one.
 */
export function buildIssuerFreshnessNotice(
  submission: SecSubmission | null | undefined,
  newestShownDate: string,
  issuerLabel: string
): IssuerFreshnessNotice | null {
  const recent = submission?.filings?.recent;
  if (!recent || !recent.form?.length || !newestShownDate) return null;

  const form = recent.form[0];
  const filed = recent.filingDate?.[0] || '';
  if (!form || !filed || filed <= newestShownDate) return null;

  // Result rows carry the ticker list in the display name — "Alphabet Inc.
  // (GOOG, GOOGL, …)" — which reads badly in a possessive. The company name
  // alone is the subject.
  const cleanIssuer = issuerLabel.replace(/\s*\([^)]*\)\s*$/, '').trim() || issuerLabel;

  const label = describeForm(form);
  const formPhrase = label ? `Form ${form} (${label})` : `Form ${form}`;
  const insider = INSIDER_FORMS.has(form.toUpperCase());
  const destination = insider
    ? 'See Insider Trading for ownership forms, or add the form type in Filters.'
    : 'Adjust Form Types or date filters to include it.';

  return {
    message: `${cleanIssuer}’s most recent EDGAR filing is a ${formPhrase} filed ${filed}, outside this search’s scope. ${destination}`,
    insider,
  };
}
