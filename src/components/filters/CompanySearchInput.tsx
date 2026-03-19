import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { loadTickerMap } from '../../services/secApi';

interface CompanySearchInputProps {
  onSelect: (ticker: string, cik: string) => void;
  placeholder?: string;
  className?: string;
}

export default function CompanySearchInput({ onSelect, placeholder = 'Search ticker or company...', className = '' }: CompanySearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ ticker: string; cik: string; title?: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tickerMap, setTickerMap] = useState<Record<string, string> | null>(null);
  const [titleMap, setTitleMap] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const map = await loadTickerMap();
      setTickerMap(map);
      // Also load titles for display
      try {
        const resp = await fetch('/files/company_tickers.json');
        if (resp.ok) {
          const data = await resp.json();
          const titles: Record<string, string> = {};
          for (const entry of Object.values(data) as any[]) {
            titles[entry.ticker.toUpperCase()] = entry.title;
          }
          setTitleMap(titles);
        }
      } catch { /* ignore */ }
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (!tickerMap || q.trim().length < 1) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    const upper = q.toUpperCase().trim();
    const matches: { ticker: string; cik: string; title?: string }[] = [];

    // Exact ticker match first
    if (tickerMap[upper]) {
      matches.push({ ticker: upper, cik: tickerMap[upper], title: titleMap[upper] });
    }

    // Prefix ticker matches
    for (const [ticker, cik] of Object.entries(tickerMap)) {
      if (ticker.startsWith(upper) && ticker !== upper) {
        matches.push({ ticker, cik, title: titleMap[ticker] });
      }
      if (matches.length >= 20) break;
    }

    // Title matches if few results
    if (matches.length < 10) {
      for (const [ticker, title] of Object.entries(titleMap)) {
        if (title?.toUpperCase().includes(upper) && !matches.find(m => m.ticker === ticker)) {
          matches.push({ ticker, cik: tickerMap[ticker], title });
        }
        if (matches.length >= 20) break;
      }
    }

    setResults(matches.slice(0, 15));
    setShowDropdown(matches.length > 0);
  }, [tickerMap, titleMap]);

  return (
    <div className={`company-search-input ${className}`} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '6px 12px' }}>
        {loading ? <Loader2 size={14} className="spinner" /> : <Search size={14} style={{ color: '#94A3B8' }} />}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          placeholder={placeholder}
          style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'white', fontSize: '0.85rem' }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); setShowDropdown(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <X size={14} style={{ color: '#64748B' }} />
          </button>
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div ref={dropdownRef} style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#1E293B', border: '1px solid #334155', borderRadius: '8px',
          marginTop: '4px', maxHeight: '300px', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
        }}>
          {results.map(r => (
            <div
              key={r.ticker}
              onClick={() => {
                onSelect(r.ticker, r.cik);
                setQuery(r.ticker);
                setShowDropdown(false);
              }}
              style={{
                padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', borderBottom: '1px solid rgba(51,65,85,0.3)',
                fontSize: '0.85rem', transition: 'background 0.1s'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span>
                <strong style={{ color: '#60A5FA' }}>{r.ticker}</strong>
                {r.title && <span style={{ color: '#94A3B8', marginLeft: '8px' }}>{r.title}</span>}
              </span>
              <span style={{ color: '#64748B', fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }}>CIK: {r.cik}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
