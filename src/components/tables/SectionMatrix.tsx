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
      <div className="sm-loading">
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
        <thead>
          <tr>
            <th className="sm-section-col">Section</th>
            {companies.map(c => (
              <th key={c.ticker} className="sm-company-col">{c.ticker}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map(section => (
            <tr key={section}>
              <td className="sm-section-label">{section}</td>
              {companies.map(c => {
                const cell = data[section]?.[c.ticker];
                return (
                  <td
                    key={c.ticker}
                    className={`sm-cell ${cell?.present ? 'present' : 'absent'} ${onCellClick ? 'clickable' : ''}`}
                    onClick={() => cell?.present && onCellClick?.(section, c.ticker)}
                    title={cell?.snippet || (cell?.present ? 'Section found' : 'Not found')}
                  >
                    {cell?.present ? (
                      <CheckCircle2 size={16} className="sm-check" />
                    ) : (
                      <MinusCircle size={14} className="sm-absent" />
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
