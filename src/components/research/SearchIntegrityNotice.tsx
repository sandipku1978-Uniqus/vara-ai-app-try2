'use client';

/**
 * Shared degraded-run plumbing for every view that calls
 * executeFilingResearchSearch outside the Research Workbench.
 *
 * The search service reports when a run was truncated — time budget, request
 * budget, SEC rate limiting, unreadable documents — through onDegraded and
 * onCoverage. SearchPage has always surfaced these; the other research
 * surfaces passed neither callback, so a budget-truncated run rendered as an
 * authoritative zero ("No matching filings found"). This hook + banner close
 * that gap everywhere with the same three lines of wiring.
 */

import { useCallback, useMemo, useState } from 'react';
import type { SearchCandidateCoverage } from '../../services/secApi';
import { formatUpstreamTotal } from '../../services/searchCoverage';

export interface SearchIntegrity {
  degraded: string;
  coverage: SearchCandidateCoverage | null;
  /** Pass these straight into executeFilingResearchSearch. */
  callbacks: {
    onDegraded: (reason: string) => void;
    onCoverage: (coverage: SearchCandidateCoverage) => void;
  };
  /** Call at the start of each new run. */
  reset: () => void;
}

export function useSearchIntegrity(): SearchIntegrity {
  const [degraded, setDegraded] = useState('');
  const [coverage, setCoverage] = useState<SearchCandidateCoverage | null>(null);

  const onDegraded = useCallback((reason: string) => setDegraded(reason), []);
  const onCoverage = useCallback((value: SearchCandidateCoverage) => setCoverage(value), []);
  const reset = useCallback(() => {
    setDegraded('');
    setCoverage(null);
  }, []);

  return useMemo(
    () => ({ degraded, coverage, callbacks: { onDegraded, onCoverage }, reset }),
    [degraded, coverage, onDegraded, onCoverage, reset]
  );
}

/**
 * The banner. Renders nothing when the run completed cleanly — it exists to
 * explain partial windows, never to add noise to healthy results.
 */
export default function SearchIntegrityNotice({
  integrity,
  resultCount,
}: {
  integrity: SearchIntegrity;
  resultCount: number;
}) {
  const { degraded, coverage } = integrity;
  const partial = coverage != null && !coverage.complete;
  if (!degraded && !partial) return null;

  const coverageLine = partial
    ? `Verified ${resultCount.toLocaleString()} of ${coverage!.examined.toLocaleString()} examined candidates (${formatUpstreamTotal(coverage!)} matched upstream).`
    : '';
  const zeroCaveat = resultCount === 0 && partial
    ? ' This is not an authoritative zero — narrow the query or retry.'
    : '';

  return (
    <div
      role="status"
      style={{
        display: 'flex', gap: '8px', alignItems: 'baseline', padding: '8px 12px', margin: '0 0 8px',
        borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)',
        background: 'color-mix(in srgb, var(--status-warning, #d69a45) 10%, transparent)',
        border: '1px solid color-mix(in srgb, var(--status-warning, #d69a45) 30%, transparent)',
      }}
    >
      <span>
        {degraded ? `${degraded} ` : 'This run verified a partial candidate window, not the full corpus. '}
        {coverageLine}
        {zeroCaveat}
      </span>
    </div>
  );
}
