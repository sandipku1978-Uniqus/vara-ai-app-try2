/**
 * Why a company is in a peer set.
 *
 * Every peer the builder adds carries one of these, so the analyst (and a
 * reviewer reading the saved set later) can see where it came from: the
 * proxy that names it, the SIC code and size band that admitted it, or a
 * manual pick. The shape is additive and serializable, ready for the saved
 * peer-set store to persist beside the tickers.
 */

import type { PeerGroupMethod, PeerMatch } from './proxyPeerGroup';
import type { SizeMetric } from './peerSizing';

export type PeerSourceTag =
  | {
      kind: 'proxy';
      /** Ticker of the issuer whose DEF 14A names this peer. */
      subjectTicker: string;
      accession: string;
      filingDate: string;
      disclosedName: string;
      group: string;
      method: PeerGroupMethod;
      /** How the disclosed name was matched; 'analyst-choice' when the analyst picked among ambiguous registrants. */
      match: PeerMatch | 'analyst-choice';
    }
  | {
      kind: 'sic';
      sic: string;
      seedTicker: string;
      /** Present when the peer was admitted on size; absent when added from the unsized list. */
      band?: {
        metric: SizeMetric;
        low: number;
        high: number;
        ratio: number;
        asOf: string;
        accession: string | null;
      };
    }
  | { kind: 'manual' };

const METRIC_LABEL: Record<SizeMetric, string> = {
  publicFloat: 'public float',
  revenue: 'revenue',
};

/** One line for a tooltip or an export column. */
export function describePeerSource(tag: PeerSourceTag | undefined): string {
  // Loaded from a saved set or a link: the tickers were kept, the reason was not.
  if (!tag) return 'Source not recorded';
  if (tag.kind === 'manual') return 'Added manually';
  if (tag.kind === 'proxy') {
    const how = tag.method === 'ai' ? ', read by AI and checked against the filing text' : '';
    return `Named in ${tag.subjectTicker}'s DEF 14A filed ${tag.filingDate} (${tag.accession}) as "${tag.disclosedName}"${how}`;
  }
  const band = tag.band
    ? `; ${METRIC_LABEL[tag.band.metric]} ${tag.band.ratio.toFixed(2)}x ${tag.seedTicker} (band ${Number(tag.band.low.toFixed(2))}x–${Number(tag.band.high.toFixed(2))}x, as of ${tag.band.asOf}${tag.band.accession ? `, ${tag.band.accession}` : ''})`
    : '; size not read';
  return `Same SIC ${tag.sic} as ${tag.seedTicker}${band}`;
}

export function sourceKindLabel(tag: PeerSourceTag | undefined): string {
  if (!tag) return 'Not recorded';
  if (tag.kind === 'manual') return 'Manual';
  return tag.kind === 'proxy' ? 'Proxy' : 'SIC';
}
