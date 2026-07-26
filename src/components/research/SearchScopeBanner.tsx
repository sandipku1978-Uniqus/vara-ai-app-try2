'use client';

import { useEffect, useState } from 'react';
import './SearchScopeBanner.css';

/**
 * States what a search was drawn from.
 *
 * A result list on its own cannot be read: fifty rows might be the entire
 * answer or the first slice of thousands. This states the population — how
 * many filings the scope covers, and how they fall across the years we hold —
 * so a bounded answer reads as bounded.
 *
 * The population is NOT a match count. Nothing here reads filing text, so the
 * copy keeps the two apart: "searched against N filings", never "N matches".
 */
export interface SearchScopeBannerProps {
  forms: string[];
  dateFrom?: string;
  dateTo?: string;
  /** Set when the search resolved to a single issuer. */
  cik?: string;
  /** How many the run actually validated, shown as the numerator. */
  shown: number;
}

interface Scope {
  total: number;
  byYear: Array<{ year: number; filings: number }>;
  coverageStart: string;
}

export default function SearchScopeBanner({ forms, dateFrom, dateTo, cik, shown }: SearchScopeBannerProps) {
  const [scope, setScope] = useState<Scope | null>(null);

  useEffect(() => {
    // Asked on every search, scoped or not — a broad search is precisely where
    // the reader most needs to know how large the population was.
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (forms.length > 0) params.set('forms', forms.join(','));
    if (dateFrom) params.set('start', dateFrom);
    if (dateTo) params.set('end', dateTo);
    if (cik) params.set('cik', cik);

    fetch(`/api/filing-scope?${params.toString()}`, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(payload => setScope(payload?.ok ? payload.scope : null))
      // A missing denominator is a smaller problem than a broken result list.
      .catch(() => setScope(null));

    return () => controller.abort();
  }, [forms, dateFrom, dateTo, cik]);

  if (!scope || scope.total === 0) return null;

  const peak = Math.max(...scope.byYear.map(entry => entry.filings), 1);
  const first = scope.byYear[0]?.year;
  const last = scope.byYear[scope.byYear.length - 1]?.year;

  return (
    <div className="search-scope" role="status">
      <p className="search-scope__line">
        Showing <strong>{shown.toLocaleString()}</strong> validated
        {' '}of <strong>{scope.total.toLocaleString()}</strong> filings in scope
        {first && last && first !== last ? <> · {first}–{last}</> : first ? <> · {first}</> : null}
      </p>

      {scope.byYear.length > 1 && (
        <div className="search-scope__years" aria-hidden="true">
          {scope.byYear.map(entry => (
            <span
              key={entry.year}
              className="search-scope__bar"
              style={{ height: `${Math.max(8, Math.round((entry.filings / peak) * 100))}%` }}
              title={`${entry.year}: ${entry.filings.toLocaleString()} filings`}
            />
          ))}
        </div>
      )}

      {/* The bars are decorative; the numbers behind them still have to be
          reachable without a pointer. */}
      {scope.byYear.length > 1 && (
        <span className="sr-only">
          Filings by year: {scope.byYear.map(entry => `${entry.year}, ${entry.filings}`).join('; ')}.
        </span>
      )}
    </div>
  );
}
