import { describe, expect, it } from 'vitest';
import { nextSizingBatch, toSicCandidates, type SicCandidate } from '../services/sicPeerCandidates';
import { sicPeerFixtures } from './peerGroupBuilderFixtures';

describe('toSicCandidates', () => {
  it("uses the directory's ticker and rank for each registrant, and keeps store-only registrants last-ranked", () => {
    const candidates = toSicCandidates([
      ...sicPeerFixtures.route.companies,
      { cik: '2097163', name: 'Xanadu Quantum Technologies Ltd', tickers: ['xndu'], sic: '3571', sicDescription: null },
      { cik: '42', name: 'No Ticker Co', tickers: [], sic: '3571', sicDescription: null },
    ], sicPeerFixtures.directory);
    expect(candidates.map(candidate => [candidate.ticker, candidate.directoryRank])).toEqual([
      ['AAPL', 0], ['OMCL', 3], ['SMCI', 2], ['DELL', 1], ['XNDU', null],
    ]);
  });
});

describe('nextSizingBatch', () => {
  const candidate = (cik: string, directoryRank: number | null): SicCandidate => ({
    cik, name: cik, ticker: cik, sic: '7372', sicDescription: null, directoryRank,
  });
  const pool = [candidate('a', 900), candidate('b', 120), candidate('c', null), candidate('d', 95), candidate('e', 2_000), candidate('f', 105)];

  it('reads the registrants nearest the seed in directory order first, unranked last', () => {
    expect(nextSizingBatch(pool, 100, () => false, 4).map(item => item.cik)).toEqual(['d', 'f', 'b', 'a']);
    expect(nextSizingBatch(pool, 100, () => false, 10).map(item => item.cik)).toEqual(['d', 'f', 'b', 'a', 'e', 'c']);
  });

  it('skips what has been read', () => {
    expect(nextSizingBatch(pool, 100, cik => ['d', 'f'].includes(cik), 2).map(item => item.cik)).toEqual(['b', 'a']);
  });
});
