/** Verified topic samples measure sample recall, not exhaustive corpus recall. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeAccession } from './evaluator-validity';
import { compileBooleanQuery } from '../../src/utils/booleanSearch';
import { defaultSearchFilters } from '../../src/domain/searchFilters';
import type { SearchCandidateCoverage } from '../../src/services/secApi';

export interface RecallExpectedFiling {
  accession: string;
  cik: string;
  companyName: string;
  form: string;
  fileDate: string;
  document: string;
  evidence: string;
  verifiedAt: string;
  verifiedUrl: string;
}

export interface RecallSet {
  id: string;
  description: string;
  query: string;
  mode: 'boolean';
  filters: { formTypes: string[]; dateFrom: string; dateTo: string; fiscalYear?: number };
  expected: RecallExpectedFiling[];
  recallFloor: number;
  floorRationale: string;
  notes: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected object`);
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: expected non-empty string`);
}

function isoDate(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}: expected valid ISO date`);
  }
}

/** Fail closed on malformed or unscoped ground truth before running the product. */
export function validateRecallSet(value: unknown): RecallSet {
  const set = object(value, 'recall set');
  for (const field of ['id', 'description', 'query', 'floorRationale', 'notes']) nonempty(set[field], field);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(set.id))) throw new Error('id: expected kebab-case');
  if (set.mode !== 'boolean') throw new Error('mode: expected boolean');
  const compiled = compileBooleanQuery(String(set.query));
  if (!compiled.ok) throw new Error(`query: ${compiled.message}`);
  if (typeof set.recallFloor !== 'number' || !Number.isFinite(set.recallFloor)
    || set.recallFloor < 0 || set.recallFloor > 1) throw new Error('recallFloor: expected 0..1');
  const filters = object(set.filters, 'filters');
  if (!Array.isArray(filters.formTypes) || filters.formTypes.length === 0
    || filters.formTypes.some(form => typeof form !== 'string' || !form.trim())
    || new Set(filters.formTypes).size !== filters.formTypes.length) throw new Error('formTypes: expected distinct forms');
  isoDate(filters.dateFrom, 'dateFrom');
  isoDate(filters.dateTo, 'dateTo');
  if (filters.dateFrom > filters.dateTo) throw new Error('dateFrom: exceeds dateTo');
  if (filters.fiscalYear !== undefined && (typeof filters.fiscalYear !== 'number'
    || !Number.isInteger(filters.fiscalYear) || filters.fiscalYear < 1994 || filters.fiscalYear > 9999)) {
    throw new Error('fiscalYear: expected year');
  }
  if (!Array.isArray(set.expected) || set.expected.length < 15 || set.expected.length > 25) {
    throw new Error('expected: requires 15..25 verified accessions');
  }
  const seen = new Set<string>();
  for (const [index, raw] of set.expected.entries()) {
    const entry = object(raw, `expected[${index}]`);
    for (const field of ['accession', 'cik', 'companyName', 'form', 'document', 'evidence', 'verifiedUrl']) {
      nonempty(entry[field], `expected[${index}].${field}`);
    }
    const accession = String(entry.accession);
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) throw new Error('accession: expected SEC dashed format');
    if (seen.has(normalizeAccession(accession))) throw new Error(`duplicate accession: ${accession}`);
    seen.add(normalizeAccession(accession));
    if (!/^\d{1,10}$/.test(String(entry.cik)) || Number(entry.cik) === 0) throw new Error('cik: invalid');
    if (!/^[A-Za-z0-9._-]+$/.test(String(entry.document))) throw new Error('document: invalid filename');
    if (String(entry.evidence).length > 200) throw new Error('evidence: exceeds 200 characters');
    isoDate(entry.fileDate, 'fileDate');
    isoDate(entry.verifiedAt, 'verifiedAt');
    if (entry.fileDate < filters.dateFrom || entry.fileDate > filters.dateTo
      || !filters.formTypes.includes(entry.form)) throw new Error('expected filing outside filters');
    const expectedUrl = `https://www.sec.gov/Archives/edgar/data/${Number(entry.cik)}/${normalizeAccession(accession)}/${entry.document}`;
    if (entry.verifiedUrl !== expectedUrl) throw new Error('verifiedUrl: does not bind exact SEC document');
  }
  return set as unknown as RecallSet;
}

export const DEFAULT_RECALL_SETS_DIR = fileURLToPath(new URL('./recall-sets/', import.meta.url));

export function loadRecallSets(dir: string = DEFAULT_RECALL_SETS_DIR): RecallSet[] {
  const files = readdirSync(dir).filter(name => name.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`No recall sets in ${dir}`);
  const ids = new Set<string>();
  return files.map(file => {
    try {
      const set = validateRecallSet(JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown);
      if (ids.has(set.id)) throw new Error(`duplicate set id: ${set.id}`);
      ids.add(set.id);
      return set;
    } catch (error) {
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export interface RecallScore {
  recall: number;
  expectedCount: number;
  found: string[];
  missed: string[];
  /** Distinct returned accessions outside this sample; no precision verdict. */
  extraResultsCount: number;
}

export function scoreRecall(
  expected: ReadonlyArray<Pick<RecallExpectedFiling, 'accession'>>,
  returnedResults: ReadonlyArray<{ accessionNumber: string }>,
): RecallScore {
  const targets = new Map(expected.map(entry => [normalizeAccession(entry.accession), entry.accession]));
  if (!targets.size || [...targets.keys()].some(key => !/^\d{18}$/.test(key))) throw new Error('Invalid recall denominator');
  const returned = new Set(returnedResults.map(entry => normalizeAccession(entry.accessionNumber)).filter(key => /^\d{18}$/.test(key)));
  const found: string[] = [];
  const missed: string[] = [];
  for (const [key, original] of targets) (returned.has(key) ? found : missed).push(original);
  return {
    recall: found.length / targets.size,
    expectedCount: targets.size,
    found,
    missed,
    extraResultsCount: [...returned].filter(key => !targets.has(key)).length,
  };
}

export function recallPassesFloor(score: RecallScore, floor: number): boolean {
  if (!Number.isFinite(floor) || floor < 0 || floor > 1) throw new Error('Invalid recall floor');
  return score.recall >= floor;
}

interface RecallEvidence {
  sourceUrls: string[];
  target: Record<string, unknown>;
  expected: unknown;
  actual: unknown;
}

export interface RecallGateHelpers {
  candidateBase: () => string | null;
  candidateAvailable?: () => boolean;
  withCandidateProductFetch: <T>(run: () => Promise<T>) => Promise<T>;
  setCoverageTarget: (suite: string, target: number) => void;
  record: (suite: string, name: string, passed: boolean, detail: string, evidence?: RecallEvidence) => void;
  skip: (suite: string, name: string, detail: string) => void;
}

/** Match executeProductBoolean's options and adapter, with each sample's scope. */
export async function suiteRecall(helpers: RecallGateHelpers, dir = DEFAULT_RECALL_SETS_DIR): Promise<void> {
  const sets = loadRecallSets(dir);
  helpers.setCoverageTarget('recall', sets.length);
  process.stdout.write('\nTopic sample recall — verified samples, not exhaustive corpus recall\n');
  for (const set of sets) {
    const name = `${set.id} sample recall`;
    if (!helpers.candidateBase() || helpers.candidateAvailable?.() === false) {
      helpers.skip('recall', name, 'immutable candidate product unavailable');
      continue;
    }
    // Product clamps the display limit to 500. The bounded date windows are
    // deliberately small; upstream page/document budgets still affect recall
    // and are reported, never silently treated as complete corpus coverage.
    const limit = 500;
    const state: { coverage: SearchCandidateCoverage | null } = { coverage: null };
    const degraded: string[] = [];
    try {
      const { executeFilingResearchSearch } = await import('../../src/services/filingResearch');
      const results = await helpers.withCandidateProductFetch(() => executeFilingResearchSearch({
        query: set.query,
        filters: { ...defaultSearchFilters, formTypes: set.filters.formTypes, dateFrom: set.filters.dateFrom, dateTo: set.filters.dateTo },
        mode: set.mode,
        defaultForms: '',
        limit,
        useEnrichedSearch: true,
        hydrateTextSignals: true,
        deferTextValidation: false,
        preferFastCandidateCollection: false,
        includeExhibits: false,
        entityScope: 'off',
        signal: AbortSignal.timeout(120_000),
        onCoverage: value => { state.coverage = value; },
        onDegraded: message => { degraded.push(message); },
      }));
      if (helpers.candidateAvailable?.() === false) {
        helpers.skip('recall', name, 'immutable candidate product unavailable during execution');
        continue;
      }
      const score = scoreRecall(set.expected, results);
      const reportedMatches = state.coverage?.verifiedMatchTotal ?? results.length;
      const coverageNote = state.coverage
        ? `examined ${state.coverage.examined}/${state.coverage.upstreamTotalIsFloor ? '≥' : ''}${state.coverage.upstreamTotal} candidates; complete=${state.coverage.complete}`
        : 'candidate coverage not reported';
      const anomaly = state.coverage && state.coverage.examined < reportedMatches
        ? `; product reports fewer examined candidates (${state.coverage.examined}) than matches (${reportedMatches})` : '';
      const detail = `${score.found.length}/${score.expectedCount} = ${(score.recall * 100).toFixed(1)}% (floor ${(set.recallFloor * 100).toFixed(0)}%) — sample recall over ${score.expectedCount} verified accessions; missed: ${score.missed.join(', ') || 'none'}; limit=${limit}; ${coverageNote}${anomaly}${degraded.length ? `; degraded: ${degraded.join('; ')}` : ''}`;
      process.stdout.write(`  ${detail}\n`);
      helpers.record('recall', name, recallPassesFloor(score, set.recallFloor), detail, {
        sourceUrls: [helpers.candidateBase()!, ...set.expected.map(entry => entry.verifiedUrl)],
        target: { kind: 'topic-sample-recall', id: set.id, query: set.query, mode: set.mode, filters: set.filters, limit, fiscalYearScope: 'verified sample only; product has no fiscal-year filter' },
        expected: { accessions: set.expected.map(entry => entry.accession), recallFloor: set.recallFloor, floorRationale: set.floorRationale, notes: set.notes },
        actual: { ...score, resultCount: results.length, returnedAccessions: results.map(result => result.accessionNumber), candidateCoverage: state.coverage, degraded },
      });
    } catch (error) {
      if (helpers.candidateAvailable?.() === false) helpers.skip('recall', name, 'immutable candidate product unavailable during execution');
      else helpers.record('recall', name, false, `sample recall could not be scored: ${error instanceof Error ? error.message : String(error)}; limit=${limit}`, {
        sourceUrls: set.expected.map(entry => entry.verifiedUrl),
        target: { id: set.id, query: set.query, filters: set.filters, limit },
        expected: { recallFloor: set.recallFloor },
        actual: { error: String(error), candidateCoverage: state.coverage, degraded },
      });
    }
  }
}
