'use client';

import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { aliasTickerFor, buildSecProxyUrl, loadTickerMap } from '../../services/secApi';
import './CompanySearchInput.css';

interface CompanySearchInputProps {
  onSelect: (ticker: string, cik: string) => void;
  placeholder?: string;
  className?: string;
  /** Fires on every keystroke so hosts can also accept free text. */
  onTextChange?: (text: string) => void;
  /** 'title' passes the registrant name to onSelect instead of the ticker —
   *  for corpora keyed by company names (e.g. comment letters). */
  selectValue?: 'ticker' | 'title';
  /** Host-driven value sync (deep links, external resets). */
  initialValue?: string;
}

export default function CompanySearchInput({ onSelect, placeholder = 'Search ticker or company...', className = '', onTextChange, selectValue = 'ticker', initialValue }: CompanySearchInputProps) {
  const [query, setQuery] = useState(initialValue || '');

  useEffect(() => {
    if (initialValue !== undefined) {
      setQuery(current => (initialValue === current ? current : initialValue));
    }
  }, [initialValue]);
  const [results, setResults] = useState<{ ticker: string; cik: string; title?: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [tickerMap, setTickerMap] = useState<Record<string, string> | null>(null);
  const [titleMap, setTitleMap] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const map = await loadTickerMap();
      setTickerMap(map);
      // Also load titles for display
      try {
        const resp = await fetch(buildSecProxyUrl('files/company_tickers.json'));
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
    onTextChange?.(q);
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

    // Household brand → registrant ("google" files as Alphabet Inc.)
    const aliasTicker = aliasTickerFor(upper);
    if (aliasTicker && tickerMap[aliasTicker] && !matches.find(m => m.ticker === aliasTicker)) {
      matches.push({ ticker: aliasTicker, cik: tickerMap[aliasTicker], title: titleMap[aliasTicker] });
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
    setActiveIndex(matches.length > 0 ? 0 : -1);
  }, [tickerMap, titleMap, onTextChange]);

  const chooseResult = useCallback((result: { ticker: string; cik: string; title?: string }) => {
    const value = selectValue === 'title' ? (result.title || result.ticker) : result.ticker;
    onSelect(value, result.cik);
    setQuery(value);
    onTextChange?.(value);
    setShowDropdown(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }, [onSelect, onTextChange, selectValue]);

  return (
    <div className={`company-search-input ${className}`}>
      <div className="company-search-control">
        {loading ? <Loader2 size={14} className="spinner" aria-label="Loading company directory" /> : <Search size={14} aria-hidden="true" />}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          onFocus={() => results.length > 0 && setShowDropdown(true)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' && results.length > 0) {
              event.preventDefault();
              setShowDropdown(true);
              setActiveIndex(index => Math.min(index + 1, results.length - 1));
            } else if (event.key === 'ArrowUp' && results.length > 0) {
              event.preventDefault();
              setShowDropdown(true);
              setActiveIndex(index => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && showDropdown && activeIndex >= 0) {
              event.preventDefault();
              chooseResult(results[activeIndex]);
            } else if (event.key === 'Escape') {
              setShowDropdown(false);
              setActiveIndex(-1);
            }
          }}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls={showDropdown && results.length > 0 ? listboxId : undefined}
          aria-activedescendant={showDropdown && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          aria-label={placeholder}
          placeholder={placeholder}
          className="company-search-field"
        />
        {query && (
          <button type="button" className="company-search-clear" aria-label="Clear company search" onClick={() => { setQuery(''); setResults([]); setShowDropdown(false); setActiveIndex(-1); inputRef.current?.focus(); }}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {showDropdown && results.length > 0 && (
        <div ref={dropdownRef} id={listboxId} role="listbox" aria-label="Company matches" className="company-search-listbox">
          {results.map((r, index) => (
            <button
              key={r.ticker}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              tabIndex={-1}
              onClick={() => chooseResult(r)}
              className={`company-search-option${index === activeIndex ? ' is-active' : ''}`}
              onMouseMove={() => setActiveIndex(index)}
            >
              <span className="company-search-option-label">
                <strong>{r.ticker}</strong>
                {r.title && <span>{r.title}</span>}
              </span>
              <span className="company-search-option-cik">CIK: {r.cik}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
