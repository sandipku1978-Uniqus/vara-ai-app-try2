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

/**
 * Parse a standard EDGAR search hit into a normalized filing object.
 */
export function parseSearchHit(hit: EdgarSearchHit) {
  const src = hit._source as any;
  const entityName = (src?.display_names?.[0] || src?.entity_name || '').replace(/\s*\(CIK\s+\d+\)/, '').trim();
  const idParts = hit._id.split(':');
  return {
    entityName,
    fileDate: src?.file_date || '',
    formType: src?.file_type || src?.form || '',
    accessionNumber: src?.adsh || '',
    cik: (src?.ciks?.[0] || '').replace(/^0+/, ''),
    primaryDocument: idParts.length > 1 ? idParts[1] : '',
    description: src?.file_description || '',
  };
}
