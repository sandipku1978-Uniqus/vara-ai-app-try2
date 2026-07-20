export interface CandidateCoverageNotice {
  examined: number;
  upstreamTotal: number;
  complete: boolean;
}

export function buildResearchEmptyResultMessage(
  errorMessage: string,
  degradedNotice: string,
  coverage: CandidateCoverageNotice | null
): string {
  // A generic empty-state string must not mask a known partial scan. Preserve
  // operational failures, but prefer the explicit uncertainty notice over the
  // routine "No filings matched" copy used by completed sessions.
  if (errorMessage && !/^No filings matched\b/i.test(errorMessage)) return errorMessage;
  if (coverage && !coverage.complete) {
    return `No verified filings were found within the partial candidate window (${coverage.examined.toLocaleString()} of ${coverage.upstreamTotal.toLocaleString()} upstream candidates examined). This is not an authoritative zero; narrow or retry the search.`;
  }
  if (degradedNotice) {
    return 'No verified filings were found while the enriched source was degraded. Retry if you need confirmation from the primary search path.';
  }
  if (errorMessage) return errorMessage;
  return 'No filings matched your search.';
}
