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
    if (resultCount === 0 || !query.trim()) {
      setSummary('');
      return;
    }

    const cached = summaryCache.get(cacheKey);
    if (cached) {
      setSummary(cached);
      return;
    }

    let cancelled = false;

    async function analyze() {
      setLoading(true);
      setError(false);
      try {
        const prompt = `You are analyzing SEC ${moduleLabel} search results. The user searched for "${query}" and got ${resultCount} results.

Here is a summary of the top results:
${resultsSummary}

Provide a concise 3-4 sentence insight summary for a practitioner:
1. What the results collectively indicate (patterns, trends, concentrations by company/topic/time)
2. Any notable outliers or signals worth investigating
3. A practical next-step suggestion

Be direct and specific. No preamble.`;

        const text = await askAi(prompt);
        if (!cancelled) {
          setSummary(text);
          summaryCache.set(cacheKey, text);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    analyze();
    return () => { cancelled = true; };
  }, [cacheKey, query, resultCount, resultsSummary, moduleLabel]);

  if (resultCount === 0 || (!summary && !loading)) return null;

  return (
    <div style={{
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
          cursor: 'pointer', userSelect: 'none',
        }}
        onClick={() => !loading && setSummary(s => s ? (setCollapsed(c => !c), s) : s)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#D66CAE', fontWeight: 600, fontSize: '0.8rem' }}>
          <Sparkles size={14} />
          AI Insight
        </div>
        {summary && !loading && (
          <button
            onClick={(e) => { e.stopPropagation(); setCollapsed(c => !c); }}
            style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '2px' }}
          >
            {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        )}
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94A3B8', marginTop: '8px' }}>
          <Loader2 size={14} className="spinner" />
          <span>Analyzing {resultCount} {moduleLabel}...</span>
        </div>
      )}

      {error && (
        <div style={{ color: '#94A3B8', marginTop: '8px', fontStyle: 'italic' }}>
          AI summary unavailable. Results are displayed below.
        </div>
      )}

      {summary && !collapsed && (
        <div
          className="md-content"
          style={{ color: '#CBD5E1', marginTop: '8px' }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
        />
      )}
    </div>
  );
}
