'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import SicSearchInput from '../filters/SicSearchInput';
import { formatFinancialValue, getCompanyDirectory } from '../../services/secApi';
import {
  classifyAgainstSeed,
  DEFAULT_SIZE_BAND,
  formatMultiple,
  loadCompanySizes,
  rankByBand,
  type BandVerdict,
  type CompanySize,
  type SizeBand,
  type SizeFact,
  type SizeMetric,
} from '../../services/peerSizing';
import { fetchSicCandidates, nextSizingBatch, type SicCandidate, type SicCandidateList } from '../../services/sicPeerCandidates';
import type { PeerSourceTag } from '../../services/peerProvenance';
import type { PeerColumnProps } from './PeerGroupTypes';
import styles from './PeerGroupBuilder.module.css';

/** Company-facts reads per pass; each is one paced SEC request through the proxy. */
const SIZING_BATCH = 24;

const BANDS: Array<{ label: string; low: number; high: number }> = [
  { label: '0.5x–2x', low: 0.5, high: 2 },
  { label: '0.33x–3x', low: 1 / 3, high: 3 },
  { label: '0.25x–4x', low: 0.25, high: 4 },
];

const METRIC_LABEL: Record<SizeMetric, string> = { publicFloat: 'public float', revenue: 'revenue' };

function describeFact(fact: SizeFact): string {
  const filing = fact.accession ? `${fact.form ?? 'filing'} ${fact.accession}` : 'company facts';
  return `${formatFinancialValue(fact.value, fact.currency, fact.currency)} as of ${fact.asOf} (${fact.concept}, ${filing})`;
}

function verdictCell(verdict: BandVerdict | null, size: CompanySize | undefined, metric: SizeMetric): { text: string; title: string; inBand: boolean } {
  if (!verdict) {
    const fact = size ? (metric === 'publicFloat' ? size.publicFloat : size.revenue) : null;
    return fact
      ? { text: formatFinancialValue(fact.value, fact.currency, fact.currency), title: describeFact(fact), inBand: false }
      : { text: size ? 'not tagged' : 'not read', title: '', inBand: false };
  }
  switch (verdict.kind) {
    case 'in-band':
    case 'out-of-band':
      return { text: formatMultiple(verdict.ratio), title: describeFact(verdict.fact), inBand: verdict.kind === 'in-band' };
    case 'not-comparable':
      return {
        text: verdict.reason === 'currency' ? verdict.fact.currency : 'n/a',
        title: `${describeFact(verdict.fact)} — ${verdict.reason === 'currency' ? 'reported in a different currency; not converted' : 'zero or negative; no ratio'}`,
        inBand: false,
      };
    case 'not-reported':
      return { text: 'not tagged', title: `No ${METRIC_LABEL[metric]} in this registrant's XBRL company facts.`, inBand: false };
    case 'unsized':
      return { text: size?.status === 'facts-unavailable' ? 'unavailable' : 'not read', title: size?.status === 'facts-unavailable' ? 'Company facts could not be read from SEC; read again to retry.' : '', inBand: false };
  }
}

interface PeerGroupSicColumnProps extends PeerColumnProps {
  seedTicker: string | null;
  seedCik: string | null;
  sicCode: string;
  onSicChange: (code: string) => void;
}

/** "Same SIC, sized like X": the store's whole listed SIC population, banded by each registrant's own XBRL. */
export default function PeerGroupSicColumn({ seedTicker, seedCik, sicCode, onSicChange, selected, capacity, onAdd }: PeerGroupSicColumnProps) {
  const [list, setList] = useState<SicCandidateList | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sizing, setSizing] = useState(false);
  const [sizes, setSizes] = useState<Record<string, CompanySize>>({});
  const [seedRank, setSeedRank] = useState<number | null>(null);
  const [metric, setMetric] = useState<SizeMetric>(DEFAULT_SIZE_BAND.metric);
  const [bandIndex, setBandIndex] = useState(0);
  const runId = useRef(0);

  const seed = seedCik ? String(Number(seedCik)) : null;
  const band: SizeBand = { metric, low: BANDS[bandIndex].low, high: BANDS[bandIndex].high };
  const seedSize = seed ? sizes[seed] : undefined;

  // Results belong to one seed and one SIC; either changing starts over.
  useEffect(() => {
    runId.current += 1;
    setList(null);
    setError('');
    setSizing(false);
  }, [seed, sicCode]);

  const readSizes = async (candidates: SicCandidate[], includeSeed: boolean) => {
    const run = runId.current;
    const ciks = [...(includeSeed && seed ? [seed] : []), ...candidates.map(candidate => candidate.cik)];
    if (ciks.length === 0) return;
    setSizing(true);
    await loadCompanySizes(ciks, {
      onSize: companySize => {
        if (runId.current === run) setSizes(prev => ({ ...prev, [companySize.cik]: companySize }));
      },
    });
    if (runId.current === run) setSizing(false);
  };

  const find = async () => {
    const sic = sicCode.trim();
    if (!/^\d{3,4}$/.test(sic)) {
      setError('Choose a SIC code first.');
      return;
    }
    const run = ++runId.current;
    setLoading(true);
    setError('');
    const directory = await getCompanyDirectory();
    const outcome = await fetchSicCandidates(sic, directory);
    if (runId.current !== run) return;
    setLoading(false);
    if (!outcome.ok) {
      setError(outcome.status === 503
        ? 'The company store is unavailable right now, so the SIC population could not be read. Try again shortly.'
        : outcome.error);
      return;
    }
    const others = { ...outcome.list, candidates: outcome.list.candidates.filter(candidate => candidate.cik !== seed) };
    const rank = seed ? directory.findIndex(entry => entry.cik === seed) : -1;
    setList(others);
    setSeedRank(rank >= 0 ? rank : null);
    await readSizes(nextSizingBatch(others.candidates, rank >= 0 ? rank : null, cik => Boolean(sizes[cik]?.status === 'read'), SIZING_BATCH), true);
  };

  const ranked = useMemo(() => {
    if (!list) return [];
    return rankByBand(list.candidates, candidate => classifyAgainstSeed(seedSize, sizes[candidate.cik], band));
    // band is derived from metric and bandIndex
  }, [list, sizes, seedSize, metric, bandIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const readCount = list ? list.candidates.filter(candidate => sizes[candidate.cik]?.status === 'read').length : 0;
  const unread = list ? list.candidates.length - readCount : 0;
  const seedFact = seedSize ? (metric === 'publicFloat' ? seedSize.publicFloat : seedSize.revenue) : null;
  const hasBand = Boolean(seedFact && seedFact.value > 0);
  const inBand = ranked.filter(entry => entry.verdict?.kind === 'in-band' && !selected.has(entry.item.ticker));

  const sourceFor = (verdict: BandVerdict | null): PeerSourceTag => ({
    kind: 'sic',
    sic: list?.sic ?? sicCode,
    seedTicker: seedTicker ?? '',
    ...(verdict && (verdict.kind === 'in-band' || verdict.kind === 'out-of-band')
      ? { band: { metric, low: band.low, high: band.high, ratio: verdict.ratio, asOf: verdict.fact.asOf, accession: verdict.fact.accession } }
      : {}),
  });

  return (
    <section className={styles.column} aria-labelledby="peer-sic-title">
      <header className={styles.columnHeader}>
        <h4 id="peer-sic-title" className={styles.columnTitle}>Same SIC, sized like {seedTicker ?? 'the first company'}</h4>
        {list && <span className={styles.columnCount}>({list.candidates.length} listed)</span>}
      </header>
      <div className={styles.columnBody}>
        <div className={styles.controls}>
          <SicSearchInput value={sicCode} onChange={onSicChange} ariaLabel="Peer group industry (SIC code or name)" />
          <button type="button" className={styles.button} onClick={() => void find()} disabled={loading || !sicCode.trim()}>
            {loading ? <Loader2 size={13} className="spinner" /> : <Users size={13} />}
            Find
          </button>
        </div>
        <div className={styles.controls}>
          <label className={styles.note}>
            Size by{' '}
            <select className={styles.select} value={metric} onChange={event => setMetric(event.target.value as SizeMetric)} aria-label="Size measure">
              <option value="publicFloat">Public float</option>
              <option value="revenue">Annual revenue</option>
            </select>
          </label>
          <label className={styles.note}>
            Band{' '}
            <select className={styles.select} value={bandIndex} onChange={event => setBandIndex(Number(event.target.value))} aria-label="Size band">
              {BANDS.map((option, index) => <option key={option.label} value={index}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {error && <p className={styles.error} role="status">{error}</p>}

        {list && (
          <>
            <p className={styles.citation}>
              {list.candidates.length} {seedTicker ? 'other ' : ''}registrant{list.candidates.length === 1 ? '' : 's'} with a ticker in SIC {list.sic}
              {list.sicDescription ? ` (${list.sicDescription})` : ''}, from the company store
              {list.capped ? ` (${list.matched} matched; this list is the first read, not the whole industry)` : ''}.{' '}
              {seedTicker && (seedFact
                ? <>{seedTicker} {METRIC_LABEL[metric]}: <span title={describeFact(seedFact)}>{formatFinancialValue(seedFact.value, seedFact.currency, seedFact.currency)} as of {seedFact.asOf}</span>.</>
                : seedSize
                  ? <>{seedTicker} reports no {METRIC_LABEL[metric]} in XBRL, so no band can be drawn; values are shown unbanded.</>
                  : <>Reading {seedTicker}&apos;s size…</>)}
            </p>
            <div className={styles.controls}>
              <span className={styles.note} role="status">
                {sizing ? <><Loader2 size={11} className="spinner" /> Reading sizes from XBRL company facts… </> : null}
                Sized {readCount} of {list.candidates.length}.
              </span>
              {unread > 0 && !sizing && (
                <button
                  type="button"
                  className={styles.button}
                  onClick={() => void readSizes(nextSizingBatch(list.candidates, seedRank, cik => sizes[cik]?.status === 'read', SIZING_BATCH), !seedSize)}
                >
                  Read {Math.min(unread, SIZING_BATCH)} more
                </button>
              )}
              {hasBand && (
                <button
                  type="button"
                  className={styles.button}
                  disabled={inBand.length === 0 || capacity === 0}
                  onClick={() => onAdd(inBand.slice(0, capacity).map(entry => ({ ticker: entry.item.ticker, source: sourceFor(entry.verdict) })))}
                >
                  Add in band ({Math.min(inBand.length, capacity)})
                </button>
              )}
            </div>
            {ranked.length === 0 && <p className={styles.note}>No other listed registrant carries this SIC code in the company store.</p>}
            {ranked.length > 0 && (
              <ul className={styles.list} aria-label="Same-SIC candidates, closest in size first">
                {ranked.map(({ item, verdict }) => {
                  const isSelected = selected.has(item.ticker);
                  const cell = verdictCell(verdict, sizes[item.cik], metric);
                  const muted = verdict !== null && verdict.kind !== 'in-band';
                  return (
                    <li key={item.cik} className={`${styles.row} ${muted ? styles.rowMuted : ''}`} title={`${item.name} (CIK ${item.cik}) — SIC ${item.sic}${cell.title ? `; ${METRIC_LABEL[metric]} ${cell.title}` : ''}`}>
                      <button
                        type="button"
                        className={`${styles.addButton} ${isSelected ? styles.addButtonSelected : ''}`}
                        disabled={isSelected || capacity === 0}
                        aria-label={isSelected ? `${item.ticker} is in the peer set` : `Add ${item.ticker} to the peer set`}
                        onClick={() => onAdd([{ ticker: item.ticker, source: sourceFor(verdict) }])}
                      >
                        {isSelected ? '✓' : '+'}
                      </button>
                      <span className={styles.rowText}>
                        <span><span className={styles.ticker}>{item.ticker}</span> {item.name}</span>
                        <span className={styles.why}>
                          SIC {item.sic}
                          {verdict && (verdict.kind === 'in-band' || verdict.kind === 'out-of-band')
                            ? ` · ${METRIC_LABEL[metric]} ${formatMultiple(verdict.ratio)} ${seedTicker ?? ''} (${verdict.kind === 'in-band' ? 'in' : 'outside'} ${BANDS[bandIndex].label})`
                            : ''}
                        </span>
                      </span>
                      <span className={`${styles.measure} ${cell.inBand ? styles.measureIn : ''}`}>{cell.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}
