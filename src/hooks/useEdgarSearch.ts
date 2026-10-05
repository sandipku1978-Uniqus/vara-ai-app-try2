'use client';

import { useState, useCallback } from 'react';
import { searchEdgarFilings, type EdgarSearchHit } from '../services/secApi';

interface UseEdgarSearchResult {
  results: EdgarSearchHit[];
  loading: boolean;
  error: string;
  totalResults: number;
  search: (query?: string) => Promise<void>;
  reset: () => void;
}

export default function useEdgarSearch(
  defaultForms: string = '10-K',
  defaultDateFrom?: string,
  defaultDateTo?: string
): UseEdgarSearchResult {
  const [results, setResults] = useState<EdgarSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [totalResults, setTotalResults] = useState(0);

  const search = useCallback(async (query: string = '') => {
    setLoading(true);
    setError('');
    try {
      const hits = await searchEdgarFilings(
        query,
        defaultForms,
        defaultDateFrom,
        defaultDateTo
      );
      setResults(hits);
      setTotalResults(hits.length);
    } catch (err) {
      console.error('EDGAR search error:', err);
      setError('Search failed. Please try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [defaultForms, defaultDateFrom, defaultDateTo]);

  const reset = useCallback(() => {
    setResults([]);
    setError('');
    setTotalResults(0);
  }, []);

  return { results, loading, error, totalResults, search, reset };
}

// Hit parsing lives in a framework-neutral module so server code can map
// hits too; re-exported here for existing callers.
export { parseSearchHit } from '../utils/edgarSearchHit';
