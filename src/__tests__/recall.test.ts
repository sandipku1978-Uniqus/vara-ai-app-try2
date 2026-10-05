// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RECALL_SETS_DIR, loadRecallSets, recallPassesFloor, scoreRecall,
  suiteRecall, validateRecallSet, type RecallGateHelpers, type RecallSet,
} from '../../scripts/accuracy/recall';
import { booleanQueryMatches } from '../utils/booleanSearch';
import { evidenceFromText } from '../../scripts/accuracy/recall-sets/build-recall-set';

const productSearch = vi.hoisted(() => vi.fn());
vi.mock('../services/filingResearch', () => ({ executeFilingResearchSearch: productSearch }));

const temporaryDirs: string[] = [];
function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'urc-recall-test-'));
  temporaryDirs.push(dir);
  return dir;
}
function sample(): RecallSet { return structuredClone(loadRecallSets()[0]); }
function writeSet(value: unknown, dir = temporaryDir()): string {
  writeFileSync(join(dir, 'sample.json'), JSON.stringify(value));
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});
beforeEach(() => { productSearch.mockReset(); });

describe('verified topic recall corpus', () => {
  it('validates every JSON file, the five exact topics, and 75 verified sample entries', () => {
    const files = readdirSync(DEFAULT_RECALL_SETS_DIR).filter(file => file.endsWith('.json')).sort();
    const sets = loadRecallSets();
    expect(files).toHaveLength(5);
    expect(sets.map(set => set.id)).toEqual([
      'critical-audit-matter-goodwill-impairment-10k-fy2024',
      'going-concern-10k-fy2024',
      'material-weakness-revenue-recognition-10k-fy2024',
      'non-gaap-adjusted-ebitda-reconciliation-10k-fy2024',
      'segment-asu-2023-07-10k-fy2024',
    ]);
    expect(sets.reduce((count, set) => count + set.expected.length, 0)).toBe(75);
    for (const file of files) {
      const raw: unknown = JSON.parse(readFileSync(join(DEFAULT_RECALL_SETS_DIR, file), 'utf8'));
      const set = validateRecallSet(raw);
      expect(set.expected).toHaveLength(15);
      expect(new Set(set.expected.map(entry => entry.accession)).size).toBe(15);
      expect(set.recallFloor).toBeGreaterThanOrEqual(0);
      expect(set.recallFloor).toBeLessThanOrEqual(1);
      expect(set.filters.fiscalYear).toBe(2024);
      expect(set.notes).toContain('Verified SAMPLE, not the complete true-positive universe');
      for (const entry of set.expected) {
        expect(entry.accession).toMatch(/^\d{10}-\d{2}-\d{6}$/);
        expect(entry.evidence.trim().length).toBeGreaterThan(0);
        expect(entry.evidence.length).toBeLessThanOrEqual(200);
        expect(new Date(entry.verifiedAt).toISOString().slice(0, 10)).toBe(entry.verifiedAt);
        expect(entry.form).toBe('10-K');
      }
    }
  });

  it('binds exact accession/document/date/evidence values from the official Gold Rock 10-K', () => {
    const set = loadRecallSets().find(set => set.id === 'going-concern-10k-fy2024')!;
    const first = set.expected[0];
    expect(first.accession).toBe('0001091818-25-000017');
    expect(first.cik).toBe('0000894501');
    expect(first.companyName).toBe('GOLD ROCK HOLDINGS, INC.  (GRHI)  (CIK 0000894501)');
    expect(first.document).toBe('grhi12312410k.htm');
    expect(first.fileDate).toBe('2025-03-25');
    expect(first.verifiedUrl).toBe('https://www.sec.gov/Archives/edgar/data/894501/000109181825000017/grhi12312410k.htm');
    expect(first.evidence).toContain('substantial doubt about our ability to continue as a going concern');
    expect(booleanQueryMatches(set.query, first.evidence)).toBe(true);
  });

  it('returns verbatim evidence despite filing line breaks, and null when no phrase occurs', () => {
    const set = loadRecallSets().find(set => set.id === 'going-concern-10k-fy2024')!;
    const text = set.expected[1].evidence;
    const excerpt = evidenceFromText(set.query, text, 'substantial doubt');
    expect(excerpt).not.toBeNull();
    expect(text.includes(excerpt!)).toBe(true);
    expect(excerpt).toContain('substantial\ndoubt');
    expect(booleanQueryMatches(set.query, excerpt!)).toBe(true);
    expect(evidenceFromText(set.query, 'No matching disclosure in this text.', 'substantial doubt')).toBeNull();
  });
});

describe('sample recall arithmetic', () => {
  const expected = [
    { accession: '0000000001-25-000001' },
    { accession: '0000000002-25-000002' },
    { accession: '0000000003-25-000003' },
  ];
  it('scores all found, accepting dashed/undashed accessions without inflating duplicate results', () => {
    expect(scoreRecall(expected, [
      { accessionNumber: '000000000125000001' },
      { accessionNumber: expected[0].accession },
      { accessionNumber: expected[1].accession },
      { accessionNumber: expected[2].accession },
    ])).toEqual({ recall: 1, expectedCount: 3, found: expected.map(entry => entry.accession), missed: [], extraResultsCount: 0 });
  });
  it('scores partial recall and counts distinct extra accessions without judging precision', () => {
    expect(scoreRecall(expected, [
      { accessionNumber: expected[1].accession },
      { accessionNumber: '000000000425000004' },
      { accessionNumber: '0000000004-25-000004' },
    ])).toEqual({ recall: 1 / 3, expectedCount: 3, found: [expected[1].accession], missed: [expected[0].accession, expected[2].accession], extraResultsCount: 1 });
  });
  it('scores none and excludes malformed result identities', () => {
    expect(scoreRecall(expected, [{ accessionNumber: 'missing' }])).toEqual({ recall: 0, expectedCount: 3, found: [], missed: expected.map(entry => entry.accession), extraResultsCount: 0 });
  });
  it('deduplicates expected format variants and rejects an empty/invalid denominator', () => {
    expect(scoreRecall([expected[0], { accession: '000000000125000001' }], [{ accessionNumber: expected[0].accession }]).expectedCount).toBe(1);
    expect(() => scoreRecall([], [])).toThrow('Invalid recall denominator');
    expect(() => scoreRecall([{ accession: '123' }], [])).toThrow('Invalid recall denominator');
  });
  it('passes exactly at the floor, passes above, and fails immediately below', () => {
    const score = scoreRecall(expected, [{ accessionNumber: expected[0].accession }, { accessionNumber: expected[1].accession }]);
    expect(recallPassesFloor(score, 2 / 3)).toBe(true);
    expect(recallPassesFloor(score, 0.65)).toBe(true);
    expect(recallPassesFloor(score, 0.67)).toBe(false);
    expect(recallPassesFloor(scoreRecall(expected, []), 0)).toBe(true);
    for (const floor of [-0.01, 1.01, Number.NaN]) expect(() => recallPassesFloor(score, floor)).toThrow('Invalid recall floor');
  });
});

describe('loader rejects defective ground truth', () => {
  it.each([
    ['fewer than 15', (set: RecallSet) => { set.expected.pop(); }, '15..25'],
    ['more than 25', (set: RecallSet) => { set.expected = [...set.expected, ...set.expected]; }, '15..25'],
    ['duplicate accession', (set: RecallSet) => { set.expected[1] = { ...set.expected[0] }; }, 'duplicate accession'],
    ['negative floor', (set: RecallSet) => { set.recallFloor = -0.01; }, 'recallFloor'],
    ['floor above one', (set: RecallSet) => { set.recallFloor = 1.01; }, 'recallFloor'],
    ['missing verifiedAt', (set: RecallSet) => { Reflect.deleteProperty(set.expected[0], 'verifiedAt'); }, 'verifiedAt'],
    ['impossible verifiedAt', (set: RecallSet) => { set.expected[0].verifiedAt = '2026-02-30'; }, 'verifiedAt'],
    ['empty evidence', (set: RecallSet) => { set.expected[0].evidence = ' '; }, 'evidence'],
    ['long evidence', (set: RecallSet) => { set.expected[0].evidence = 'x'.repeat(201); }, 'evidence'],
    ['undashed corpus accession', (set: RecallSet) => { set.expected[0].accession = set.expected[0].accession.replace(/-/g, ''); }, 'accession'],
    ['foreign evidence URL', (set: RecallSet) => { set.expected[0].verifiedUrl = 'https://example.com/filing'; }, 'verifiedUrl'],
    ['wrong document URL', (set: RecallSet) => { set.expected[0].document = 'different.htm'; }, 'verifiedUrl'],
    ['date outside filters', (set: RecallSet) => { set.expected[0].fileDate = '2026-01-01'; }, 'outside filters'],
    ['form outside filters', (set: RecallSet) => { set.expected[0].form = '8-K'; }, 'outside filters'],
    ['reversed dates', (set: RecallSet) => { set.filters.dateFrom = '2025-12-31'; }, 'dateFrom'],
    ['invalid Boolean', (set: RecallSet) => { set.query = 'goodwill AND'; }, 'query'],
  ])('%s', (_name, mutate, error) => {
    const set = sample();
    mutate(set);
    expect(() => loadRecallSets(writeSet(set))).toThrow(error);
  });
  it('rejects an empty directory, invalid JSON and duplicate set ids; ignores the build script', () => {
    expect(() => loadRecallSets(temporaryDir())).toThrow('No recall sets');
    const malformedDir = temporaryDir();
    writeFileSync(join(malformedDir, 'bad.json'), '{');
    expect(() => loadRecallSets(malformedDir)).toThrow('bad.json');
    const dir = writeSet(sample());
    writeFileSync(join(dir, 'build-recall-set.ts'), 'not JSON');
    expect(loadRecallSets(dir)).toHaveLength(1);
    writeFileSync(join(dir, 'duplicate.json'), JSON.stringify(sample()));
    expect(() => loadRecallSets(dir)).toThrow('duplicate set id');
  });
});

describe('recall suite product wiring', () => {
  function helpers(): RecallGateHelpers {
    return {
      candidateBase: () => 'https://candidate.example',
      withCandidateProductFetch: vi.fn(async run => run()),
      setCoverageTarget: vi.fn(), record: vi.fn(), skip: vi.fn(),
    };
  }
  it('records measured sample recall at the boundary and preserves product options/coverage evidence', async () => {
    const set = sample();
    set.recallFloor = 0.6;
    const gate = helpers();
    productSearch.mockImplementation(async options => {
      options.onCoverage({ examined: 8, upstreamTotal: 25, complete: false, verifiedMatchTotal: 9 });
      options.onDegraded('document budget exhausted');
      return set.expected.slice(0, 9).map(entry => ({ accessionNumber: entry.accession }));
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await suiteRecall(gate, writeSet(set));
    expect(gate.setCoverageTarget).toHaveBeenCalledWith('recall', 1);
    expect(gate.withCandidateProductFetch).toHaveBeenCalledOnce();
    expect(productSearch).toHaveBeenCalledWith(expect.objectContaining({
      query: set.query, mode: 'boolean', limit: 500, useEnrichedSearch: true,
      hydrateTextSignals: true, deferTextValidation: false, preferFastCandidateCollection: false,
      includeExhibits: false, entityScope: 'off', signal: expect.any(AbortSignal),
      filters: expect.objectContaining(set.filters.fiscalYear ? { dateFrom: set.filters.dateFrom, dateTo: set.filters.dateTo, formTypes: ['10-K'] } : {}),
    }));
    expect(gate.record).toHaveBeenCalledWith('recall', `${set.id} sample recall`, true,
      expect.stringContaining('9/15 = 60.0% (floor 60%) — sample recall over 15 verified accessions'),
      expect.objectContaining({ actual: expect.objectContaining({ recall: 0.6, extraResultsCount: 0, candidateCoverage: { examined: 8, upstreamTotal: 25, complete: false, verifiedMatchTotal: 9 }, degraded: ['document budget exhausted'] }) }));
    const output = stdout.mock.calls.map(call => call[0]).join('');
    expect(output).toContain('product reports fewer examined candidates (8) than matches (9)');
    expect(output).toContain(set.expected[9].accession);
    expect(gate.skip).not.toHaveBeenCalled();
  });
  it('records below-floor search results as failures, not skips', async () => {
    const gate = helpers();
    productSearch.mockResolvedValue([]);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await suiteRecall(gate, writeSet(sample()));
    expect(gate.record).toHaveBeenCalledWith('recall', expect.any(String), false, expect.stringContaining('0/15 = 0.0%'), expect.any(Object));
    expect(gate.skip).not.toHaveBeenCalled();
  });
  it('skips each set only when candidate access is unavailable', async () => {
    const gate = helpers();
    gate.candidateBase = () => null;
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await suiteRecall(gate);
    expect(gate.setCoverageTarget).toHaveBeenCalledWith('recall', 5);
    expect(gate.skip).toHaveBeenCalledTimes(5);
    expect(gate.record).not.toHaveBeenCalled();
    expect(productSearch).not.toHaveBeenCalled();
  });
  it('records executor errors as failures unless the candidate became unavailable', async () => {
    const gate = helpers();
    productSearch.mockRejectedValue(new Error('could not parse search response'));
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await suiteRecall(gate, writeSet(sample()));
    expect(gate.record).toHaveBeenCalledWith('recall', expect.any(String), false, expect.stringContaining('could not parse search response'), expect.any(Object));
    expect(gate.skip).not.toHaveBeenCalled();
    gate.candidateAvailable = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    await suiteRecall(gate, writeSet(sample()));
    expect(gate.skip).toHaveBeenCalledWith('recall', expect.any(String), 'immutable candidate product unavailable during execution');
  });
});
