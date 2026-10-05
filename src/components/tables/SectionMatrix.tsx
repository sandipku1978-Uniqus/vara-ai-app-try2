'use client';

import { CircleCheck, CircleDashed, CircleHelp, CircleMinus, CircleOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import {
  sectionMatrixCellLabels,
  type SectionMatrixCell,
  type SectionMatrixForm,
  type SectionMatrixRowGroup,
  type SectionMatrixState,
} from '../../utils/sectionMatrix';
import CartToggle from '../cart/CartToggle';
import { buildSecDocumentUrl } from '../../services/secApi';
import './SectionMatrix.css';

interface SectionMatrixProps {
  form: SectionMatrixForm;
  sections: readonly string[];
  /**
   * Optional grouping of `sections` (Items / Notes / Proxy). Each group
   * renders under its own header row so a long list stays scannable.
   */
  groups?: readonly SectionMatrixRowGroup[];
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
  { state: 'absent', label: 'Not disclosed', meaning: 'the filing text was read and the section heading is not in it' },
  { state: 'unlocated', label: 'Could not extract', meaning: 'the filing mentions the section but no heading bounds it — open the filing' },
  { state: 'not-checked', label: 'Not checked', meaning: 'the filing text has not been read yet' },
  { state: 'no-filing', label: 'No filing', meaning: 'no filing of this form on record' },
  { state: 'failed', label: 'Failed', meaning: 'the filing could not be read — retry' },
];

function MarkIcon({ state, checking }: { state: SectionMatrixState; checking?: boolean }) {
  if (checking) return <LoaderCircle size={16} className="sm-spin" aria-hidden="true" />;
  switch (state) {
    case 'present': return <CircleCheck size={16} aria-hidden="true" />;
    case 'absent': return <CircleMinus size={16} aria-hidden="true" />;
    case 'unlocated': return <CircleHelp size={16} aria-hidden="true" />;
    case 'no-filing': return <CircleOff size={16} aria-hidden="true" />;
    case 'failed': return <TriangleAlert size={16} aria-hidden="true" />;
    default: return <CircleDashed size={16} aria-hidden="true" />;
  }
}

/** The filing a company's column was read from, if any cell names one. */
function columnSource(sections: readonly string[], data: SectionMatrixProps['data'], ticker: string) {
  for (const section of sections) {
    const source = data[section]?.[ticker]?.source;
    if (source) return source;
  }
  return undefined;
}

export default function SectionMatrix({ form, sections, groups, companies, data, loading }: SectionMatrixProps) {
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
              {companies.map(c => {
                const source = columnSource(sections, data, c.ticker);
                return (
                  <th key={c.ticker} scope="col" className="sm-company-col">
                    {c.ticker}
                    {source && (
                      <div>
                        <CartToggle
                          className="matrix-column-select"
                          filing={{
                            cik: source.cik,
                            accessionNumber: source.accession,
                            company: c.name || c.ticker,
                            form: source.form,
                            fileDate: source.filingDate,
                            ticker: c.ticker,
                            primaryDocument: source.primaryDocument,
                            sourceUrl: buildSecDocumentUrl(source.cik, source.accession, source.primaryDocument),
                            origin: 'section-matrix',
                          }}
                        />
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {(groups && groups.length > 0 ? groups : [{ group: 'items' as const, label: '', rows: sections }]).map(group => (
            <tbody key={group.group}>
              {group.label && (groups?.length ?? 0) > 1 && (
                <tr className="sm-group-row">
                  <th scope="colgroup" colSpan={companies.length + 1} className="sm-group-label">{group.label}</th>
                </tr>
              )}
              {group.rows.map(section => (
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
          ))}
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
