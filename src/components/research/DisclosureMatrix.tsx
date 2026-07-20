'use client';

import { useState } from 'react';
import { Loader2, AlertCircle, FileText, FileDown, Columns } from 'lucide-react';
import { renderMarkdown } from '../../utils/markdownRenderer';
import styles from './DisclosureMatrix.module.css';

/* ------------------------------------------------------------------ */
/*  Filing-type → section mapping                                     */
/* ------------------------------------------------------------------ */

const FILING_TYPE_SECTIONS: Record<string, string[]> = {
  '10-K': [
    'Item 1. Business',
    'Item 1A. Risk Factors',
    'Item 7. MD&A',
    'Item 8. Financial Statements',
    'Item 9A. Controls & Procedures',
  ],
  '10-Q': [
    'Part I, Item 1. Financial Statements',
    'Part I, Item 2. MD&A',
    'Part I, Item 4. Controls & Procedures',
  ],
  'DEF 14A': [
    'Executive Compensation',
    'Board Composition',
    'Say-on-Pay Results',
    'Shareholder Proposals',
    'Corporate Governance',
  ],
};

const SUPPORTED_FILING_TYPES = Object.keys(FILING_TYPE_SECTIONS);

interface DisclosureMatrixProps {
  tickers: string[];
  section: string;
  filingType?: string;
  className?: string;
  filingContexts: Array<{ ticker: string; companyName: string; text: string }>;
  onExportDocx?: (analysis: string, tickers: string[], section: string) => void;
  onExportPdf?: (analysis: string, tickers: string[], section: string) => void;
  onFilingTypeChange?: (filingType: string) => void;
  onSectionChange?: (section: string) => void;
}

export function DisclosureMatrix({ tickers, section, filingType = '10-K', className = '', filingContexts, onExportDocx, onExportPdf, onFilingTypeChange, onSectionChange }: DisclosureMatrixProps) {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateComparison = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tickers,
          section,
          filingContexts
        })
      });
      
      const payload = await response.json();
      
      if (!response.ok) {
        throw new Error(payload.error || 'Comparison API failed');
      }
      
      setAnalysis(payload.analysis);
    } catch (e: any) {
      setError(e.message || 'Failed to generate comparison. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={`${styles.matrix} ${className}`} aria-labelledby="disclosure-matrix-title">
      <div className={styles.header}>
        <div>
          <h3 id="disclosure-matrix-title" className={styles.title}>
            <Columns size={18} aria-hidden="true" />
            Disclosure Matrix
          </h3>
          <p className={styles.subtitle}>Comparing {section} across: {tickers.join(', ')}</p>

          {/* Filing type + section selectors */}
          <div className={styles.selectors}>
            {onFilingTypeChange && (
              <label className={styles.selectLabel}>
                <span>Filing type</span>
              <select
                value={filingType}
                onChange={e => onFilingTypeChange(e.target.value)}
                className={styles.select}
              >
                {SUPPORTED_FILING_TYPES.map(ft => (
                  <option key={ft} value={ft}>{ft}</option>
                ))}
              </select>
              </label>
            )}
            {onSectionChange && FILING_TYPE_SECTIONS[filingType] && (
              <label className={styles.selectLabel}>
                <span>Disclosure section</span>
              <select
                value={section}
                onChange={e => onSectionChange(e.target.value)}
                className={styles.select}
              >
                {FILING_TYPE_SECTIONS[filingType].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              </label>
            )}
          </div>
        </div>

        <div className={styles.actions}>
          {!analysis && !loading && (
            <button
              type="button"
              onClick={generateComparison}
              disabled={tickers.length < 2 || filingContexts.length < 2}
              className={styles.primaryButton}
            >
              Generate AI Comparison
            </button>
          )}

          {analysis && onExportDocx && (
            <button
              type="button"
              onClick={() => onExportDocx(analysis, tickers, section)}
              className={styles.secondaryButton}
            >
              <FileText size={16} aria-hidden="true" />
              Export Word
            </button>
          )}

          {analysis && onExportPdf && (
            <button
              type="button"
              onClick={() => onExportPdf(analysis, tickers, section)}
              className={styles.secondaryButton}
            >
              <FileDown size={16} aria-hidden="true" />
              Export PDF
            </button>
          )}
        </div>
      </div>
      
      <div className={styles.body}>
        {loading ? (
          <div className={styles.loading} role="status">
            <Loader2 size={32} className={styles.spinner} aria-hidden="true" />
            <p>Analyzing disclosures for {tickers.length} companies...</p>
            <p className={styles.loadingHint}>This may take 10–15 seconds for complex comparisons.</p>
          </div>
        ) : error ? (
          <div className={styles.errorCard} role="alert">
            <AlertCircle size={20} className={styles.errorIcon} aria-hidden="true" />
            <div>
              <h4>Comparison failed</h4>
              <p>{error}</p>
            </div>
          </div>
        ) : analysis ? (
          <div 
            className={`md-content ${styles.analysis}`}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(analysis) }} 
          />
        ) : (
          <div className={styles.emptyState}>
            <Columns size={48} className={styles.emptyIcon} aria-hidden="true" />
            <p className={styles.emptyTitle}>Ready to compare {section}</p>
            <p>Click Generate to build an AI-powered comparison matrix.</p>
          </div>
        )}
      </div>
    </section>
  );
}
