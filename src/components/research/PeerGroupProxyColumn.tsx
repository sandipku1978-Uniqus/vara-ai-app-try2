'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import {
  describeProxyPeerFailure,
  loadProxyPeerGroup,
  type PeerMatch,
  type ProxyPeer,
  type ProxyPeerGroup,
  type ProxyPeerGroupOutcome,
} from '../../services/proxyPeerGroup';
import type { PeerSourceTag } from '../../services/peerProvenance';
import type { PeerColumnProps } from './PeerGroupTypes';
import styles from './PeerGroupBuilder.module.css';

const MATCH_NOTE: Partial<Record<PeerMatch, string>> = {
  'brand-alias': 'matched by brand name',
  acronym: 'matched by acronym',
  'name-prefix': 'matched by shortened name',
  'name-words': 'matched by name words',
};

const METHOD_LABEL: Record<ProxyPeerGroup['method'], string> = {
  table: "Read from the proxy's peer table",
  list: "Read from the proxy's peer list",
  ai: 'Read by AI; every name checked against the filing text',
};

function proxyTag(
  group: ProxyPeerGroup,
  subjectTicker: string,
  peer: Pick<ProxyPeer, 'disclosedName' | 'group' | 'accession'>,
  match: PeerMatch | 'analyst-choice',
): PeerSourceTag {
  return {
    kind: 'proxy',
    subjectTicker,
    accession: peer.accession,
    filingDate: group.filing.filingDate,
    disclosedName: peer.disclosedName,
    group: peer.group,
    method: group.method,
    match,
  };
}

interface PeerGroupProxyColumnProps extends PeerColumnProps {
  seedTicker: string | null;
  seedCik: string | null;
}

/** "From proxy": the compensation peer group the seed's latest DEF 14A names. */
export default function PeerGroupProxyColumn({ seedTicker, seedCik, selected, capacity, onAdd }: PeerGroupProxyColumnProps) {
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<ProxyPeerGroupOutcome | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // A different seed company invalidates what was read for the last one.
  useEffect(() => {
    if (seedCik !== loadedFor) setOutcome(null);
  }, [seedCik, loadedFor]);

  const read = async () => {
    if (!seedCik) return;
    setLoading(true);
    const result = await loadProxyPeerGroup(seedCik);
    setOutcome(result);
    setLoadedFor(seedCik);
    setLoading(false);
  };

  const group = outcome?.ok ? outcome.group : null;
  const addable = group ? group.peers.filter(peer => !selected.has(peer.ticker)) : [];
  const count = group ? `${group.peers.length} resolved, ${group.unresolved.length} unresolved` : '';

  return (
    <section className={styles.column} aria-labelledby="peer-proxy-title">
      <header className={styles.columnHeader}>
        <h4 id="peer-proxy-title" className={styles.columnTitle}>From proxy</h4>
        {group && <span className={styles.columnCount}>({count})</span>}
      </header>
      <div className={styles.columnBody}>
        <div className={styles.controls}>
          <button type="button" className={styles.button} onClick={() => void read()} disabled={!seedCik || loading}>
            {loading ? <Loader2 size={13} className="spinner" /> : <FileText size={13} />}
            {group ? 'Re-read' : `Read ${seedTicker ?? 'the first company'}'s DEF 14A`}
          </button>
          {group && (
            <button
              type="button"
              className={styles.button}
              disabled={addable.length === 0 || capacity === 0}
              onClick={() => onAdd(addable.slice(0, capacity).map(peer => ({
                ticker: peer.ticker,
                source: proxyTag(group, seedTicker ?? '', peer, peer.match),
              })))}
            >
              Add all ({Math.min(addable.length, capacity)})
            </button>
          )}
        </div>

        {!seedCik && <p className={styles.note}>Add a company first; its latest proxy names the peers.</p>}
        {outcome && !outcome.ok && <p className={styles.error} role="status">{describeProxyPeerFailure(outcome.failure)}</p>}

        {group && (
          <>
            <div className={styles.citation}>
              <a className={styles.link} href={group.filing.documentUrl} target="_blank" rel="noreferrer">
                DEF 14A filed {group.filing.filingDate} · {group.filing.accessionNumber}
              </a>{' '}
              <span className={`${styles.badge} ${group.method === 'ai' ? styles.badgeAi : ''}`}>{METHOD_LABEL[group.method]}</span>
            </div>
            {group.anchorText && <p className={styles.quote}>{group.anchorText}</p>}
            {group.listsSubject && <p className={styles.note}>The proxy lists {seedTicker} itself; it is not offered as its own peer.</p>}
            {group.discardedModelNames.length > 0 && (
              <p className={styles.note}>
                The AI also returned {group.discardedModelNames.length} name{group.discardedModelNames.length === 1 ? '' : 's'} that the filing text does not contain; discarded.
              </p>
            )}
            {group.peers.length > 0 && (
              <ul className={styles.list} aria-label="Peers named in the proxy">
                {group.peers.map(peer => {
                  const isSelected = selected.has(peer.ticker);
                  const why = [peer.disclosedName !== peer.title ? `"${peer.disclosedName}"` : '', MATCH_NOTE[peer.match] ?? '', peer.group]
                    .filter(Boolean).join(' · ');
                  return (
                    <li key={peer.cik} className={styles.row} title={`${peer.title} (CIK ${peer.cik}). Named in DEF 14A ${peer.accession}${peer.group ? ` under "${peer.group}"` : ''}.`}>
                      <button
                        type="button"
                        className={`${styles.addButton} ${isSelected ? styles.addButtonSelected : ''}`}
                        disabled={isSelected || capacity === 0}
                        aria-label={isSelected ? `${peer.ticker} is in the peer set` : `Add ${peer.ticker} to the peer set`}
                        onClick={() => onAdd([{ ticker: peer.ticker, source: proxyTag(group, seedTicker ?? '', peer, peer.match) }])}
                      >
                        {isSelected ? '✓' : '+'}
                      </button>
                      <span className={styles.rowText}>
                        <span><span className={styles.ticker}>{peer.ticker}</span> {peer.title}</span>
                        <span className={styles.why}>{why}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {group.unresolved.length > 0 && (
              <details className={styles.details}>
                <summary>{group.unresolved.length} named but not matched to a listed registrant</summary>
                <ul className={styles.unresolved}>
                  {group.unresolved.map(peer => (
                    <li key={`${peer.disclosedName}|${peer.group}`}>
                      <span className={styles.ticker}>{peer.disclosedName}</span>{' '}
                      <span className={styles.note}>
                        {peer.reason === 'ambiguous' ? '— several registrants fit; pick one:' : '— no SEC-listed registrant by this name (foreign, private, or renamed)'}
                      </span>
                      {peer.candidates.length > 0 && (
                        <div>
                          {peer.candidates.map(candidate => (
                            <button
                              key={candidate.cik}
                              type="button"
                              className={`${styles.button} ${styles.pick}`}
                              disabled={selected.has(candidate.ticker) || capacity === 0}
                              title={`${candidate.title} (CIK ${candidate.cik})`}
                              onClick={() => onAdd([{
                                ticker: candidate.ticker,
                                source: proxyTag(group, seedTicker ?? '', peer, 'analyst-choice'),
                              }])}
                            >
                              {candidate.ticker}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
