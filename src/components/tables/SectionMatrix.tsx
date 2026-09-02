'use client';

import { CircleCheck, CircleDashed, CircleMinus, CircleOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import {
  sectionMatrixCellLabels,
  type SectionMatrixCell,
  type SectionMatrixForm,
  type SectionMatrixState,
} from '../../utils/sectionMatrix';
import './SectionMatrix.css';

interface SectionMatrixProps {
  form: SectionMatrixForm;
  sections: readonly string[];
  companies: { ticker: string; name: string }[];
  /** data[section][ticker] */
  data: Record<string, Record<string, SectionMatrixCell>>;
  loading?: boolean;
}

/**
 * Every state the grid can show, in the words the legend uses. The marks are
 * deliberately distinct shapes, not only colours, and each cell names its
 * evidence in its accessible label (see sectionMatrixCellLabels).
 */
const LEGEND: ReadonlyArray<{ state: SectionMatrixState; label: string; meaning: string }> = [
  { state: 'present', label: 'Found', meaning: 'the section heading was found in the filing text' },
  { state: 'absent', label: 'Not found', meaning: 'the heading was not found in the filing text' },
  { state: 'not-checked', label: 'Not checked', meaning: 'the filing text has not been read yet' },
  { state: 'no-filing', label: 'No filing', meaning: 'no filing of this form on record' },
  { state: 'failed', label: 'Failed', meaning: 'the filing could not be read — retry' },
];

function MarkIcon({ state, checking }: { state: SectionMatrixState; checking?: boolean }) {
  if (checking) return <LoaderCircle size={16} className="sm-spin" aria-hidden="true" />;
  switch (state) {
    case 'present': return <CircleCheck size={16} aria-hidden="true" />;
    case 'absent': return <CircleMinus size={16} aria-hidden="true" />;
    case 'no-filing': return <CircleOff size={16} aria-hidden="true" />;
    case 'failed': return <TriangleAlert size={16} aria-hidden="true" />;
    default: return <CircleDashed size={16} aria-hidden="true" />;
  }
}

export default function SectionMatrix({ form, sections, companies, data, loading }: SectionMatrixProps) {
  if (loading) {
    return (
      <div className="sm-loading" role="status">
        Loading company filing indexes...
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="sm-empty">
        Add companies to build the section matrix.
      </div>
    );
  }

  return (
    <div className="section-matrix-wrap">
      <div className="section-matrix-container">
        <table className="section-matrix">
          <caption className="sr-only">Section presence by company</caption>
          <thead>
            <tr>
              <th scope="col" className="sm-section-col">Section</th>
              {companies.map(c => (
                <th key={c.ticker} scope="col" className="sm-company-col">{c.ticker}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sections.map(section => (
              <tr key={section}>
                <th scope="row" className="sm-section-label">{section}</th>
                {companies.map(c => {
                  const cell = data[section]?.[c.ticker];
                  const state = cell?.state ?? 'not-checked';
                  const { label, title } = sectionMatrixCellLabels(section, c.ticker, form, cell);
                  return (
                    <td key={c.ticker} className={`sm-cell ${state}`}>
                      <span
                        role="img"
                        className={`sm-mark ${state}${cell?.checking ? ' checking' : ''}`}
                        aria-label={label}
                        title={title}
                      >
                        <MarkIcon state={state} checking={cell?.checking} />
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="sm-legend" aria-label="Section matrix legend">
        {LEGEND.map(entry => (
          <li key={entry.state}>
            <span className={`sm-mark ${entry.state}`} aria-hidden="true"><MarkIcon state={entry.state} /></span>
            <span><strong>{entry.label}</strong> — {entry.meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
