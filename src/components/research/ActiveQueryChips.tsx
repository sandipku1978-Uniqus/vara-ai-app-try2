'use client';

import './ActiveQueryChips.css';

/**
 * The search as it actually ran.
 *
 * What you type and what executes are not always the same thing: the engine
 * promotes a leading company name into an issuer scope, lifts `auditor:` out
 * of the expression into a structured filter, and applies a default form set
 * you never chose. When those rewrites are invisible, a wrong one is
 * undetectable — a quoted phrase was being split into an issuer plus a text
 * fragment and the only symptom was a short result list.
 *
 * So this states the executed search, one chip per active condition, and
 * flags any part of it the engine decided for you.
 */

export interface ActiveQueryChip {
  label: string;
  value: string;
  /** True when the engine inferred this rather than the user choosing it. */
  derived?: boolean;
}

export interface ActiveQueryChipsProps {
  mode: 'semantic' | 'boolean';
  /** The text predicate as executed, after any rewriting. */
  query: string;
  /** Issuer scope the engine promoted out of the query, if any. */
  entityName?: string;
  auditor?: string;
  forms: string[];
  dateFrom?: string;
  dateTo?: string;
  /** Everything else worth stating, already labelled. */
  extra?: ActiveQueryChip[];
}

export default function ActiveQueryChips({
  mode, query, entityName, auditor, forms, dateFrom, dateTo, extra = [],
}: ActiveQueryChipsProps) {
  const chips: ActiveQueryChip[] = [];

  if (query.trim()) chips.push({ label: mode === 'boolean' ? 'Boolean' : 'Keywords', value: query.trim() });
  // Marked derived: the user typed this as part of the query, not as a filter.
  if (entityName) chips.push({ label: 'Issuer', value: entityName, derived: true });
  if (auditor) chips.push({ label: 'Auditor', value: auditor, derived: true });
  if (forms.length > 0) chips.push({ label: 'Forms', value: forms.join(', ') });
  if (dateFrom || dateTo) {
    chips.push({ label: 'Filed', value: `${dateFrom || 'earliest'} – ${dateTo || 'latest'}` });
  }
  chips.push(...extra);

  if (chips.length === 0) return null;

  return (
    <div className="query-chips" role="group" aria-label="Search as executed">
      <span className="query-chips__lead">Searched:</span>
      {chips.map(chip => (
        <span
          key={`${chip.label}:${chip.value}`}
          className={`query-chips__chip${chip.derived ? ' query-chips__chip--derived' : ''}`}
          title={chip.derived ? `${chip.label} was inferred from your query` : undefined}
        >
          <span className="query-chips__label">{chip.label}</span>
          <span className="query-chips__value">{chip.value}</span>
          {chip.derived && <span className="sr-only"> (inferred from your query)</span>}
        </span>
      ))}
    </div>
  );
}
