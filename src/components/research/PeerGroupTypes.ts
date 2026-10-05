import type { PeerSourceTag } from '../../services/peerProvenance';

export interface PeerAddition {
  ticker: string;
  source: PeerSourceTag;
}

/** What every source column of the peer builder needs from the host. */
export interface PeerColumnProps {
  /** Tickers already in the peer set. */
  selected: Set<string>;
  /** Slots left under the comparison cap. */
  capacity: number;
  onAdd: (additions: PeerAddition[]) => void;
}
