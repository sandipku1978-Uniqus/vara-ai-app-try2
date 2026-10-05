'use client';

import CompanySearchInput from '../filters/CompanySearchInput';
import { describePeerSource, type PeerSourceTag } from '../../services/peerProvenance';
import PeerGroupProxyColumn from './PeerGroupProxyColumn';
import PeerGroupSicColumn from './PeerGroupSicColumn';
import type { PeerAddition } from './PeerGroupTypes';
import styles from './PeerGroupBuilder.module.css';

export type { PeerAddition, PeerColumnProps } from './PeerGroupTypes';

interface PeerGroupBuilderProps {
  seedTicker: string | null;
  /** The seed's CIK as its submissions report it; null until loaded. */
  seedCik: string | null;
  sicCode: string;
  onSicChange: (code: string) => void;
  selectedTickers: string[];
  maxTickers: number;
  sources: Record<string, PeerSourceTag>;
  onAdd: (additions: PeerAddition[]) => void;
}

/**
 * Three sources side by side — the seed's proxy-disclosed peer group, same-SIC
 * registrants banded by size, and manual picks — each candidate saying why it
 * is there. Adding from any column feeds the one Benchmarking selection.
 */
export default function PeerGroupBuilder({
  seedTicker,
  seedCik,
  sicCode,
  onSicChange,
  selectedTickers,
  maxTickers,
  sources,
  onAdd,
}: PeerGroupBuilderProps) {
  const selected = new Set(selectedTickers);
  const capacity = Math.max(0, maxTickers - selectedTickers.length);
  const manual = selectedTickers.filter(ticker => sources[ticker]?.kind === 'manual');
  const fromProxy = selectedTickers.filter(ticker => sources[ticker]?.kind === 'proxy').length;
  const fromSic = selectedTickers.filter(ticker => sources[ticker]?.kind === 'sic').length;
  const unrecorded = selectedTickers.filter(ticker => !sources[ticker]).length;

  return (
    <div className={styles.builder}>
      <div className={styles.summary} role="status">
        <span>
          {selectedTickers.length} of {maxTickers} companies selected
          {selectedTickers.length > 0 ? ` — ${fromProxy} from proxy, ${fromSic} same SIC, ${manual.length} manual` : ''}
          {unrecorded > 0 ? `, ${unrecorded} without a recorded source` : ''}
        </span>
        {capacity === 0 && <span>The comparison is full; remove a company to add another.</span>}
      </div>
      <div className={styles.columns}>
        <PeerGroupProxyColumn seedTicker={seedTicker} seedCik={seedCik} selected={selected} capacity={capacity} onAdd={onAdd} />
        <PeerGroupSicColumn
          seedTicker={seedTicker}
          seedCik={seedCik}
          sicCode={sicCode}
          onSicChange={onSicChange}
          selected={selected}
          capacity={capacity}
          onAdd={onAdd}
        />
        <section className={styles.column} aria-labelledby="peer-manual-title">
          <header className={styles.columnHeader}>
            <h4 id="peer-manual-title" className={styles.columnTitle}>Manual</h4>
            <span className={styles.columnCount}>({manual.length})</span>
          </header>
          <div className={styles.columnBody}>
            <CompanySearchInput
              onSelect={ticker => {
                const clean = ticker.trim().toUpperCase();
                if (clean && !selected.has(clean) && capacity > 0) onAdd([{ ticker: clean, source: { kind: 'manual' } }]);
              }}
              placeholder="Add a company by ticker or name"
              className="benchmark-company-search"
            />
            {selectedTickers.length > 0 && (
              <ul className={styles.list} aria-label="Why each selected company is in the set">
                {selectedTickers.map(ticker => (
                  <li key={ticker} className={styles.row}>
                    <span className={styles.ticker}>{ticker}</span>
                    <span className={styles.rowText}>
                      <span className={styles.why} title={describePeerSource(sources[ticker])}>{describePeerSource(sources[ticker])}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
