import { describe, it, expect, beforeEach } from 'vitest';
import { computeSectionChange } from '../utils/sectionDiff';
import { deletePeerSet, listPeerSets, savePeerSet } from '../services/peerSets';
import { buildStorageScope, setActiveBrowserStorageScope } from '../services/storageNamespace';

/**
 * C4 deepening: changed-passage counts (subsection granularity without
 * pretending to know the filer's subsection names) and saved peer sets.
 */

const WORDS = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');

describe('changed-passage counting', () => {
  it('one contiguous edit is one passage', () => {
    const base = WORDS('w', 200);
    const edited = base.replace('w50 w51 w52', 'x50 x51 x52');
    expect(computeSectionChange(base, edited).changedPassages).toBe(1);
  });

  it('edits far apart are separate passages', () => {
    const base = WORDS('w', 200);
    const edited = base.replace('w10 ', 'x10 ').replace('w100 ', 'x100 ').replace('w190', 'x190');
    expect(computeSectionChange(base, edited).changedPassages).toBe(3);
  });

  it('edits separated by a short gap merge into one passage', () => {
    const base = WORDS('w', 200);
    // Two edits 5 tokens apart — same passage under the 30-token gap rule.
    const edited = base.replace('w50 ', 'x50 ').replace('w55 ', 'x55 ');
    expect(computeSectionChange(base, edited).changedPassages).toBe(1);
  });

  it('appearance and disappearance count as a single passage', () => {
    expect(computeSectionChange('', WORDS('w', 50)).changedPassages).toBe(1);
    expect(computeSectionChange(WORDS('w', 50), '').changedPassages).toBe(1);
    expect(computeSectionChange('', '').changedPassages).toBe(0);
  });

  it('identical sections have zero passages', () => {
    const base = WORDS('w', 100);
    expect(computeSectionChange(base, base).changedPassages).toBe(0);
  });
});

describe('saved peer sets', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('saves, lists, overwrites by name, and deletes', () => {
    savePeerSet('Chip makers', ['nvda', 'AMD', 'nvda']);
    expect(listPeerSets()).toHaveLength(1);
    expect(listPeerSets()[0].tickers).toEqual(['NVDA', 'AMD']);

    savePeerSet('chip makers', ['NVDA', 'AMD', 'INTC']);
    expect(listPeerSets()).toHaveLength(1);
    expect(listPeerSets()[0].tickers).toContain('INTC');

    deletePeerSet('Chip Makers');
    expect(listPeerSets()).toHaveLength(0);
  });

  it('ignores empty names and empty ticker lists', () => {
    savePeerSet('   ', ['AAPL']);
    savePeerSet('Real name', []);
    expect(listPeerSets()).toHaveLength(0);
  });

  it('survives corrupted storage', () => {
    window.localStorage.setItem('urc.benchmark.peersets.v1', '{not json');
    expect(listPeerSets()).toEqual([]);
    savePeerSet('Recovered', ['MSFT']);
    expect(listPeerSets()).toHaveLength(1);
  });

  it('isolates saved sets per signed-in identity', () => {
    setActiveBrowserStorageScope(buildStorageScope('user_a', null));
    savePeerSet('Analyst A peers', ['AAPL', 'MSFT']);
    expect(listPeerSets()).toHaveLength(1);

    // A different identity on the same machine sees nothing of A's.
    setActiveBrowserStorageScope(buildStorageScope('user_b', null));
    expect(listPeerSets()).toEqual([]);
    savePeerSet('Analyst B peers', ['NVDA']);
    expect(listPeerSets()).toHaveLength(1);

    setActiveBrowserStorageScope(buildStorageScope('user_a', null));
    expect(listPeerSets()[0].name).toBe('Analyst A peers');
    setActiveBrowserStorageScope(null);
  });
});
