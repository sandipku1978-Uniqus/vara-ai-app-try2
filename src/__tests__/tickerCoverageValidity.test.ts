import { describe, expect, it } from 'vitest';
import {
  buildCoverageEvidenceManifest,
  buildDirectoryUniverseEvidence,
  buildPassEvidenceManifest,
  buildResolutionPlan,
  coverageCompletenessProblems,
  completeSecSubmissionsTruth,
  evaluateCikSearch,
  isRealIsoDate,
  parseSecSubmissionsTruth,
  SecRequestPacer,
  type DirectoryRow,
  type ProductSearchHit,
  type TickerResult,
} from '../../scripts/ticker-coverage-test';

const cik = '320193';

function submissions(rows: Array<{ accession: string; date: string; form: string }>) {
  return parseSecSubmissionsTruth({
    cik: Number(cik),
    filings: {
      recent: {
        accessionNumber: rows.map(row => row.accession),
        filingDate: rows.map(row => row.date),
        form: rows.map(row => row.form),
      },
      files: [],
    },
  }, cik);
}

function hit(
  accession: string,
  date: string,
  form: string,
  hitCik = cik,
): ProductSearchHit {
  return {
    _id: `${accession}:document.txt`,
    _source: {
      adsh: accession,
      ciks: [hitCik.padStart(10, '0')],
      display_names: ['Apple Inc.'],
      form,
      file_date: date,
    },
  };
}

function coverageResult(row: DirectoryRow, status: 'PASS' | 'EMPTY_VERIFIED' = 'PASS'): TickerResult {
  const accession = `${row.cik.padStart(10, '0')}-26-000001`;
  return {
    ticker: row.ticker,
    title: row.title,
    cik: row.cik,
    resolvedCik: row.cik.padStart(10, '0'),
    status,
    detail: status === 'EMPTY_VERIFIED'
      ? 'SEC submissions confirms no eligible post-2010 filings'
      : '',
    filings: status === 'PASS' ? 1 : 0,
    newest: status === 'PASS' ? '2026-07-31' : '',
    newestAccession: status === 'PASS' ? accession : '',
    secNewest: status === 'PASS' ? '2026-07-31' : '',
    secNewestAccessions: status === 'PASS' ? [accession] : [],
    secEligibleFilings: status === 'PASS' ? 1 : 0,
    secSubmissionsEvidenceSha256: 'a'.repeat(64),
    secSourceCik: row.cik,
    secRecentRawFilings: status === 'PASS' ? 1 : 0,
    secArchivePlanComplete: true,
    secArchiveDescriptorCount: 0,
    secRelevantArchiveCount: 0,
    secArchivePlanSha256: 'b'.repeat(64),
    secArchiveEvidence: [],
    candidatePage: status === 'PASS'
      ? [{ accession: accession.replace(/-/g, ''), form: '8-K', filingDate: '2026-07-31' }]
      : [],
    secExpectedPage: status === 'PASS'
      ? [{ accession: accession.replace(/-/g, ''), form: '8-K', filingDate: '2026-07-31' }]
      : [],
    ms: 12,
    serverErrorResponses: 0,
  };
}

function fullDirectory(size = 10_000): DirectoryRow[] {
  return Array.from({ length: size }, (_, index) => ({
    ticker: `T${index.toString(36).toUpperCase().padStart(4, '0')}`,
    cik: String(index + 1),
    title: `Issuer ${index}`,
  }));
}

function directoryEvidence(rows: DirectoryRow[]) {
  return buildDirectoryUniverseEvidence(rows, {
    responseStatus: 200,
    contentType: 'application/json; charset=utf-8',
    fetchedAt: '2026-08-03T00:00:00.000Z',
    payloadBytes: 1_000_000,
    payloadSha256: 'c'.repeat(64),
  });
}

describe('full-directory ticker gate validity', () => {
  it('rejects the right ticker symbol when the resolver maps it to the wrong official CIK', () => {
    const directory: DirectoryRow[] = [{ ticker: 'AAPL', cik, title: 'Apple Inc.' }];
    const plan = buildResolutionPlan(directory, () => ({
      ticker: 'AAPL',
      cik: '789019',
      title: 'Wrong issuer under the same symbol',
    }));

    expect(plan.resolvedRows).toEqual([]);
    expect(plan.retrievalCiks).toEqual([]);
    expect(plan.failures).toHaveLength(1);
    expect(plan.failures[0]).toMatchObject({
      ticker: 'AAPL',
      cik,
      resolvedCik: '789019',
      status: 'FAIL',
    });
    expect(plan.failures[0].detail).toContain('mapped to CIK 789019, expected 320193');
  });

  it('carries the actual resolver CIK into the Stage-2 retrieval plan', () => {
    const directory: DirectoryRow[] = [{ ticker: 'AAPL', cik, title: 'Apple Inc.' }];
    const resolverCik = cik.padStart(10, '0');
    const plan = buildResolutionPlan(directory, () => ({
      ticker: 'AAPL',
      cik: resolverCik,
      title: 'Apple Inc.',
    }));

    expect(plan.failures).toEqual([]);
    expect(plan.resolvedRows[0].resolvedCik).toBe(resolverCik);
    expect(plan.retrievalCiks).toEqual([resolverCik]);
    expect(plan.retrievalCiks[0]).not.toBe(directory[0].cik);
  });

  it.each([
    {
      label: 'accession',
      candidate: hit('not-an-accession', '2026-07-31', '8-K'),
      message: 'malformed accession',
    },
    {
      label: 'form',
      candidate: hit('0000320193-26-000002', '2026-07-31', ''),
      message: 'malformed form',
    },
    {
      label: 'calendar date',
      candidate: hit('0000320193-26-000002', '2026-02-30', '8-K'),
      message: 'malformed filing date',
    },
  ])('fails a result with a malformed $label field', ({ candidate, message }) => {
    const truth = submissions([
      { accession: '0000320193-26-000002', date: '2026-07-31', form: '8-K' },
    ]);

    const result = evaluateCikSearch(cik, [candidate], truth);

    expect(result.status).toBe('FAIL');
    expect(result.detail).toContain(message);
  });

  it('rejects a stale first result even when every hit is real, same-issuer, and internally sorted', () => {
    const truth = submissions([
      { accession: '0000320193-26-000002', date: '2026-07-31', form: '8-K' },
      { accession: '0000320193-26-000001', date: '2026-07-20', form: '10-Q' },
    ]);
    const staleButOtherwiseValid = [
      hit('0000320193-26-000001', '2026-07-20', '10-Q'),
    ];

    const result = evaluateCikSearch(cik, staleButOtherwiseValid, truth);

    expect(result.status).toBe('FAIL');
    expect(result.detail).toContain('stale newest filing');
    expect(result.newestAccession).toBe('0000320193-26-000001');
    expect(result.secNewestAccessions).toEqual(['0000320193-26-000002']);
  });

  it('accepts a newest result only when its accession, form, date, and CIK match SEC truth', () => {
    const truth = submissions([
      { accession: '0000320193-26-000002', date: '2026-07-31', form: '8-K' },
      { accession: '0000320193-26-000001', date: '2026-07-20', form: '10-Q' },
    ]);

    const result = evaluateCikSearch(cik, [
      hit('0000320193-26-000002', '2026-07-31', '8-K'),
      hit('0000320193-26-000001', '2026-07-20', '10-Q'),
    ], truth);

    expect(result).toMatchObject({
      status: 'PASS',
      filings: 2,
      newest: '2026-07-31',
      newestAccession: '0000320193-26-000002',
      secNewest: '2026-07-31',
    });
  });

  it('rejects one genuine newest hit when SEC truth requires a five-hit page', () => {
    const truthRows = Array.from({ length: 5 }, (_, index) => ({
      accession: `0000320193-26-${String(5 - index).padStart(6, '0')}`,
      date: `2026-07-${String(31 - index).padStart(2, '0')}`,
      form: index === 0 ? '8-K' : '10-Q',
    }));
    const truth = submissions(truthRows);
    const newest = truthRows[0];

    const result = evaluateCikSearch(cik, [hit(newest.accession, newest.date, newest.form)], truth);

    expect(result.status).toBe('FAIL');
    expect(result.detail).toBe('candidate returned 1/5 independently expected page hits');
  });

  it('requires the exact independently ordered five-hit page, not five arbitrary official filings', () => {
    const truthRows = Array.from({ length: 6 }, (_, index) => ({
      accession: `0000320193-26-${String(6 - index).padStart(6, '0')}`,
      date: `2026-07-${String(31 - index).padStart(2, '0')}`,
      form: index === 0 ? '8-K' : '10-Q',
    }));
    const truth = submissions(truthRows);
    const wrongPage = [truthRows[0], truthRows[1], truthRows[2], truthRows[3], truthRows[5]];

    const result = evaluateCikSearch(cik, wrongPage.map(row => hit(row.accession, row.date, row.form)), truth);

    expect(result.status).toBe('FAIL');
    expect(result.detail).toContain('candidate page hit 5');
  });

  it('fails closed when independent submissions evidence is missing or malformed', () => {
    const malformedTruth = parseSecSubmissionsTruth({
      filings: {
        recent: {
          accessionNumber: ['0000320193-26-000002'],
          filingDate: [],
          form: ['8-K'],
        },
      },
    });

    expect(malformedTruth.ok).toBe(false);
    expect(evaluateCikSearch(cik, [], malformedTruth)).toMatchObject({ status: 'FAIL' });
  });

  it('rejects a submissions payload whose declared CIK is not the requested issuer', () => {
    const truth = parseSecSubmissionsTruth({
      cik: 789019,
      filings: {
        recent: { accessionNumber: [], filingDate: [], form: [] },
        files: [],
      },
    }, cik);

    expect(truth.ok).toBe(false);
    expect(truth.detail).toContain('!= requested 320193');
  });

  it('rejects an archive whose accession belongs to a different CIK', async () => {
    const truth = await completeSecSubmissionsTruth({
      cik: Number(cik),
      filings: {
        recent: { accessionNumber: [], filingDate: [], form: [] },
        files: [{
          name: 'CIK0000320193-submissions-001.json',
          filingTo: '2015-03-01',
          filingCount: 1,
        }],
      },
    }, async () => ({
      accessionNumber: ['0000789019-15-000001'],
      filingDate: ['2015-03-01'],
      form: ['10-K'],
    }), cik);

    expect(truth.ok).toBe(false);
    expect(truth.detail).toContain('belongs to another CIK');
  });

  it('does not certify empty without a complete archive plan, but accepts an explicit empty plan', () => {
    const unbounded = parseSecSubmissionsTruth({
      cik: Number(cik),
      filings: { recent: { accessionNumber: [], filingDate: [], form: [] } },
    }, cik);
    const complete = parseSecSubmissionsTruth({
      cik: Number(cik),
      filings: {
        recent: { accessionNumber: [], filingDate: [], form: [] },
        files: [],
      },
    }, cik);

    expect(evaluateCikSearch(cik, [], unbounded)).toMatchObject({
      status: 'FAIL',
      detail: 'SEC ground truth did not prove a complete post-2010 archive plan',
    });
    expect(evaluateCikSearch(cik, [], complete)).toMatchObject({
      status: 'EMPTY_VERIFIED',
      secSourceCik: cik,
      secArchivePlanComplete: true,
      secArchiveDescriptorCount: 0,
      secRelevantArchiveCount: 0,
    });
  });

  it('loads archives before certifying empty when recent contains only excluded forms', async () => {
    const archiveName = 'CIK0000320193-submissions-001.json';
    const archiveFetches: string[] = [];
    const truth = await completeSecSubmissionsTruth({
      cik: Number(cik),
      filings: {
        recent: {
          accessionNumber: ['0000320193-26-000003'],
          filingDate: ['2026-07-31'],
          form: ['13F-HR'],
        },
        files: [{
          name: archiveName,
          filingTo: '2015-03-01',
          filingCount: 1,
        }],
      },
    }, async name => {
      archiveFetches.push(name);
      return {
        accessionNumber: ['0000320193-15-000001'],
        filingDate: ['2015-03-01'],
        form: ['10-K'],
      };
    }, cik);

    expect(archiveFetches).toEqual([archiveName]);
    expect(truth).toMatchObject({
      ok: true,
      newestDate: '2015-03-01',
      filings: [{ accession: '000032019315000001', form: '10-K', filingDate: '2015-03-01' }],
    });
  });

  it('merges archives when recent cannot validate the complete five-hit candidate page', async () => {
    const recent = { accession: '0000320193-26-000005', date: '2026-07-31', form: '8-K' };
    const archived = [
      { accession: '0000320193-25-000004', date: '2025-07-31', form: '10-K' },
      { accession: '0000320193-24-000003', date: '2024-07-31', form: '10-K' },
      { accession: '0000320193-23-000002', date: '2023-07-31', form: '10-K' },
      { accession: '0000320193-22-000001', date: '2022-07-31', form: '10-K' },
    ];
    const truth = await completeSecSubmissionsTruth({
      cik: Number(cik),
      filings: {
        recent: {
          accessionNumber: [recent.accession],
          filingDate: [recent.date],
          form: [recent.form],
        },
        files: [{
          name: 'CIK0000320193-submissions-001.json',
          filingTo: archived[0].date,
          filingCount: archived.length,
        }],
      },
    }, async () => ({
      accessionNumber: archived.map(filing => filing.accession),
      filingDate: archived.map(filing => filing.date),
      form: archived.map(filing => filing.form),
    }), cik);

    expect(truth.ok).toBe(true);
    expect(truth.filings).toHaveLength(5);
    expect(evaluateCikSearch(cik, [recent, ...archived].map(filing => (
      hit(filing.accession, filing.date, filing.form)
    )), truth).status).toBe('PASS');
  });

  it('does not certify empty from a truncated archive with valid parallel arrays', async () => {
    const truth = await completeSecSubmissionsTruth({
      cik: Number(cik),
      filings: {
        recent: { accessionNumber: [], filingDate: [], form: [] },
        files: [{
          name: 'CIK0000320193-submissions-001.json',
          filingTo: '2015-03-01',
          filingCount: 2,
        }],
      },
    }, async () => ({
      accessionNumber: ['0000320193-15-000001'],
      filingDate: ['2015-03-01'],
      form: ['10-K'],
    }), cik);

    expect(truth.ok).toBe(false);
    expect(truth.detail).toContain('returned 1/2 declared filings');
    expect(evaluateCikSearch(cik, [], truth).status).toBe('FAIL');
  });

  it('uses strict calendar validation rather than accepting normalized impossible dates', () => {
    expect(isRealIsoDate('2024-02-29')).toBe(true);
    expect(isRealIsoDate('2026-02-29')).toBe(false);
    expect(isRealIsoDate('2026-02-30')).toBe(false);
    expect(isRealIsoDate('2026-2-03')).toBe(false);
  });

  it('paces concurrent SEC requests through one deterministic host-level schedule', async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const dispatches: number[] = [];
    const pacer = new SecRequestPacer(
      125,
      () => now,
      async ms => {
        sleeps.push(ms);
        now += ms;
      },
    );

    await Promise.all(Array.from({ length: 4 }, async () => {
      dispatches.push(await pacer.waitTurn());
    }));

    expect(dispatches).toEqual([1_000, 1_125, 1_250, 1_375]);
    expect(sleeps).toEqual([125, 125, 125]);
  });

  it('rejects an undersized or duplicate official directory universe', () => {
    expect(() => directoryEvidence(fullDirectory(9_999))).toThrow('official directory is incomplete');
    const duplicate = fullDirectory();
    duplicate[9_999] = { ...duplicate[0] };
    expect(() => directoryEvidence(duplicate)).toThrow('duplicate ticker');
  });

  it('binds coverage to every canonical directory key and rejects subset, all-empty, duplicate, or reordered rows', () => {
    const directory = fullDirectory();
    const universe = directoryEvidence(directory);
    const passing = directory.map(row => coverageResult(row));
    expect(coverageCompletenessProblems(universe, buildCoverageEvidenceManifest(passing))).toEqual([]);

    const subset = buildCoverageEvidenceManifest(passing.slice(0, -1));
    expect(coverageCompletenessProblems(universe, subset)).toContain(
      'coverage manifest contains 9999/10000 directory rows',
    );

    const allEmpty = buildCoverageEvidenceManifest(directory.map(row => coverageResult(row, 'EMPTY_VERIFIED')));
    expect(coverageCompletenessProblems(universe, allEmpty)).toContain(
      'coverage manifest cannot certify the entire directory as empty',
    );

    const duplicate = buildCoverageEvidenceManifest([...passing.slice(0, -1), passing[0]]);
    expect(coverageCompletenessProblems(universe, duplicate)).toContain(
      'coverage manifest has duplicate directory keys',
    );

    const reordered = buildCoverageEvidenceManifest(passing);
    reordered.rows.reverse();
    expect(coverageCompletenessProblems(universe, reordered)).toContain(
      'coverage manifest rows are not in canonical key order',
    );
  });

  it('emits a deterministic, inspectable manifest for every passing comparison', () => {
    const passing = (ticker: string, accession: string): TickerResult => ({
      ticker,
      title: `${ticker} Corp`,
      cik,
      resolvedCik: cik.padStart(10, '0'),
      status: 'PASS',
      detail: '',
      filings: 2,
      newest: '2026-07-31',
      newestAccession: accession,
      secNewest: '2026-07-31',
      secNewestAccessions: [accession],
      secEligibleFilings: 2,
      secSubmissionsEvidenceSha256: 'a'.repeat(64),
      secSourceCik: cik,
      secRecentRawFilings: 2,
      secArchivePlanComplete: true,
      secArchiveDescriptorCount: 0,
      secRelevantArchiveCount: 0,
      secArchivePlanSha256: 'b'.repeat(64),
      secArchiveEvidence: [],
      candidatePage: [],
      secExpectedPage: [],
      ms: 12,
      serverErrorResponses: 0,
    });
    const a = passing('AAA', '0000320193-26-000001');
    const z = passing('ZZZ', '0000320193-26-000002');

    const forward = buildPassEvidenceManifest([z, a]);
    const reverse = buildPassEvidenceManifest([a, z]);

    expect(forward).toEqual(reverse);
    expect(forward.rows.map(row => row.ticker)).toEqual(['AAA', 'ZZZ']);
    expect(forward.rows[0]).toMatchObject({
      officialCik: cik,
      resolvedCik: cik.padStart(10, '0'),
      candidateNewestAccession: '0000320193-26-000001',
      secNewestAccessions: ['0000320193-26-000001'],
    });
    expect(forward.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
