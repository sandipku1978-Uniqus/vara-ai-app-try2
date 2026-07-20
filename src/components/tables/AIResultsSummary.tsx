'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { askAi } from '../../services/aiApi';
import { renderMarkdown } from '../../utils/markdownRenderer';

interface AIResultsSummaryProps {
  /** The search query the user ran */
  query: string;
  /** Summary data about the results to feed to AI */
  resultsSummary: string;
  /** Number of results found */
  resultCount: number;
  /** Module context label (e.g., "comment letters", "insider filings") */
  moduleLabel: string;
  /** Unique key to prevent re-analysis on re-renders (query + count) */
  cacheKey: string;
}

// Module-level cache to avoid re-calling Claude on re-renders
const summaryCache = new Map<string, string>();

/**
 * AI-powered summary card that appears below search results.
 * Calls Claude to produce a 3-4 sentence insight summary of the result set.
 */
export default function AIResultsSummary({ query, resultsSummary, resultCount, moduleLabel, cacheKey }: AIResultsSummaryProps) {
  const [summary, setSummary] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const cached = summaryCache.get(cacheKey);
    setSummary(cached || '');
    setCollapsed(false);
    setError(false);
  }, [cacheKey]);

  async function analyze() {
    if (loading || resultCount === 0 || !query.trim()) return;

    setLoading(true);
    setError(false);
    try {
      const prompt = `You are analyzing a metadata snapshot from SEC ${moduleLabel} search results. The user searched for "${query}" and got ${resultCount} results.

Here is the available metadata for the top results:
${resultsSummary}

Provide a concise 3-4 sentence insight summary for a practitioner:
1. Describe only patterns directly supported by this metadata snapshot
2. Identify records worth investigating without inferring filing contents
3. A practical next-step suggestion

State that source filings must be reviewed before relying on the analysis. Be direct and specific. No preamble.`;

      const text = (await askAi(prompt, undefined, { throwOnError: true })).trim();
      if (!text) throw new Error('AI insight was empty.');
      setSummary(text);
      summaryCache.set(cacheKey, text);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  if (resultCount === 0 || !query.trim()) return null;

  return (
    <section aria-label={`AI insight for ${moduleLabel}`} aria-busy={loading} style={{
      background: 'linear-gradient(135deg, rgba(72,40,121,0.08), rgba(178,30,125,0.08))',
      border: '1px solid rgba(214,108,174,0.15)',
      borderRadius: '10px',
      padding: '14px 18px',
      marginBottom: '16px',
      fontSize: '0.85rem',
      lineHeight: 1.6,
    }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          userSelect: 'none', gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-primary)', fontWeight: 600, fontSize: '0.8rem' }}>
          <Sparkles size={14} aria-hidden="true" />
          AI Insight
        </div>
        {summary && !loading ? (
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand AI insight' : 'Collapse AI insight'}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
          >
            {collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
          </button>
        ) : !loading ? (
          <button
            type="button"
            onClick={analyze}
            style={{
              border: '1px solid var(--border-color)', borderRadius: '6px', padding: '5px 10px',
              background: 'var(--surface-panel-strong)', color: 'var(--accent-primary)', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: 600,
            }}
          >
            {error ? 'Retry insight' : 'Generate insight'}
          </button>
        ) : null}
      </div>

      {loading && (
        <div role="status" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', marginTop: '8px' }}>
          <Loader2 size={14} className="spinner" aria-hidden="true" />
          <span>Analyzing {resultCount} {moduleLabel}...</span>
        </div>
      )}

      {error && (
        <div role="alert" style={{ color: 'var(--text-secondary)', marginTop: '8px', fontStyle: 'italic' }}>
          AI summary unavailable. Results are displayed below.
        </div>
      )}

      {summary && !collapsed && (
        <div
          className="md-content"
          style={{ color: 'var(--text-primary)', marginTop: '8px' }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
        />
      )}
      {summary && !collapsed && (
        <p style={{ color: 'var(--text-muted)', marginTop: '8px', fontSize: '0.72rem' }}>
          Generated from the displayed result metadata. Review the source filings before relying on it.
        </p>
      )}
    </section>
  );
}
