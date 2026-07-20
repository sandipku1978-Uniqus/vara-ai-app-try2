'use client';

import { CheckCircle2, MinusCircle } from 'lucide-react';
import './SectionMatrix.css';

export interface MatrixCell {
  present: boolean;
  url?: string;
  snippet?: string;
}

interface SectionMatrixProps {
  sections: string[];
  companies: { ticker: string; name: string }[];
  data: Record<string, Record<string, MatrixCell>>; // data[section][ticker]
  onCellClick?: (section: string, ticker: string) => void;
  loading?: boolean;
}

export default function SectionMatrix({ sections, companies, data, onCellClick, loading }: SectionMatrixProps) {
  if (loading) {
    return (
      <div className="sm-loading" role="status">
        Building section matrix...
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="sm-empty">
        Add companies to build the disclosure matrix.
      </div>
    );
  }

  return (
    <div className="section-matrix-container">
      <table className="section-matrix">
        <caption className="sr-only">Disclosure section availability by company</caption>
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
                const cellLabel = cell?.present
                  ? `Open ${section} disclosure for ${c.ticker}`
                  : `${section} disclosure not found for ${c.ticker}`;
                return (
                  <td key={c.ticker} className={`sm-cell ${cell?.present ? 'present' : 'absent'}`} title={cell?.snippet || (cell?.present ? 'Section found' : 'Not found')}>
                    {cell?.present && onCellClick ? (
                      <button type="button" className="sm-cell-action" aria-label={cellLabel} onClick={() => onCellClick(section, c.ticker)}>
                        <CheckCircle2 size={16} className="sm-check" aria-hidden="true" />
                      </button>
                    ) : cell?.present ? (
                      <CheckCircle2 size={16} className="sm-check" aria-label={cellLabel} />
                    ) : (
                      <MinusCircle size={14} className="sm-absent" aria-label={cellLabel} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
