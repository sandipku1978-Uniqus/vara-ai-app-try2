export interface CandidateCoverageNotice {
  examined: number;
  upstreamTotal: number;
  complete: boolean;
  /** upstreamTotal is a floor (EFTS stops counting at 10,000), not an exact count. */
  upstreamTotalIsFloor?: boolean;
}

/**
 * The corpus total as a display string: exact ("2,340") when upstream counted
 * it exactly, a floor ("10,000+") when upstream stopped counting. Never
 * presents a floor as an exact number.
 */
export function formatUpstreamTotal(coverage: CandidateCoverageNotice): string {
  return `${coverage.upstreamTotal.toLocaleString()}${coverage.upstreamTotalIsFloor ? '+' : ''}`;
}

/**
 * Headline for the results pane: the answer to "how many filings match?"
 * followed by how many of them were validated and shown — e.g.
 * "10,000+ filings match — 403 validated and shown". Falls back to the plain
 * shown-count when upstream never reported a total larger than what is shown.
 */
export function buildResultsHeadline(
  shownCount: number,
  coverage: CandidateCoverageNotice | null,
  shownCap: number
): string {
  const shownLabel = shownCount >= shownCap ? `${shownCap}+` : shownCount.toLocaleString();
  if (coverage && (coverage.upstreamTotal > shownCount || coverage.upstreamTotalIsFloor)) {
    return `${formatUpstreamTotal(coverage)} filings match — ${shownLabel} validated and shown`;
  }
  return `${shownLabel} filings`;
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
    return `No verified filings were found within the partial candidate window (${coverage.examined.toLocaleString()} of ${formatUpstreamTotal(coverage)} upstream candidates examined). This is not an authoritative zero; narrow or retry the search.`;
  }
  if (degradedNotice) {
    return 'No verified filings were found while the enriched source was degraded. Retry if you need confirmation from the primary search path.';
  }
  if (errorMessage) return errorMessage;
  return 'No filings matched your search.';
}
