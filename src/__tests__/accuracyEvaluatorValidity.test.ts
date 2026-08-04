import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildE2eQuotaPlan,
  completeFilingSearchPageProblem,
  deriveRawAuditorTruth,
  hitMatchesExpectedFiling,
  inspectFilingSearchPage,
  isDisjointEntityNameControl,
  missingBoundedAccessions,
  quotaShortfalls,
  validateCompanyEnrichment,
  validateFilingSearchPagePrecision,
  validateIndependentFilingText,
  validateThreadDetails,
  validateTopicSearchResult,
  type TopicSearchTruth,
} from '../../scripts/accuracy/evaluator-validity';

function topicTruth(
  total: number,
  matches: TopicSearchTruth['matches'],
  pageSize = 10,
): TopicSearchTruth {
  return {
    total,
    pageSize,
    poolDepth: matches.length,
    matches,
    countSource: 'urc_comment_letters.direct-fts-count',
    rankSource: 'candidate-rank-order-with-independent-fts-pool',
    predicateSource: 'urc_comment_letters.direct-fts-identity',
    predicateEvidenceSha256: createHash('sha256').update(JSON.stringify(matches)).digest('hex'),
  };
}

function testAccession(index: number, cik = 1, year = 26): string {
  return `${String(cik).padStart(10, '0')}${String(year).padStart(2, '0')}${String(index).padStart(6, '0')}`;
}

describe('release evaluator validity', () => {
  it('requires the expected accession and issuer, not merely a non-empty filing page', () => {
    const wrongIssuer = {
      _id: '0000320193-26-000001:doc.htm',
      _source: { adsh: '0000320193-26-000001', ciks: ['0000789019'] },
    };
    const expected = { accession: '0000320193-26-000001', cik: 320193 };

    expect(hitMatchesExpectedFiling(wrongIssuer, expected)).toBe(false);
    expect(inspectFilingSearchPage({
      hits: { total: { value: 500, relation: 'eq' }, hits: [wrongIssuer] },
    }, expected)).toMatchObject({ found: false, received: 1, total: 500, relation: 'eq', invalidHits: 0 });
  });

  it('recognizes the exact filing across padded CIK and accession formats', () => {
    expect(hitMatchesExpectedFiling({
      _id: '0000320193-26-000001:document.htm',
      _source: { ciks: ['0000320193'] },
    }, { accession: '000032019326000001', cik: '320193' })).toBe(true);
  });

  it('does not accept a large total as a substitute for a missing accession', () => {
    const inspection = inspectFilingSearchPage({
      hits: {
        total: { value: 10_000, relation: 'gte' },
        hits: [{ _id: '0000000001-26-000001', _source: { ciks: ['1'] } }],
      },
    }, { accession: '0000320193-26-000001', cik: 320193 });

    expect(inspection.found).toBe(false);
    expect(inspection.total).toBe(10_000);
    expect(inspection.relation).toBe('gte');
  });

  it('requires an exact complete and unique page before proving a negative-control absence', () => {
    const target = { accession: '0000320193-26-999999', cik: 320193 };
    const page = (hits: unknown[], total = 2, relation: 'eq' | 'gte' = 'eq') => (
      inspectFilingSearchPage({ hits: { total: { value: total, relation }, hits } }, target)
    );
    const first = { _source: { adsh: '0000320193-26-000001', ciks: ['0000320193'] } };
    const second = { _source: { adsh: '0000320193-26-000002', ciks: ['0000320193'] } };

    expect(completeFilingSearchPageProblem(page([first, second]), 0, 100)).toBeNull();
    expect(completeFilingSearchPageProblem(page([first], 2), 0, 100)).toContain('returned 1/2');
    expect(completeFilingSearchPageProblem(page([first, first], 2), 0, 100)).toContain('duplicate');
    expect(completeFilingSearchPageProblem(page([first], 2, 'gte'), 0, 100)).toContain('exact finite total');
    expect(completeFilingSearchPageProblem(page([{
      _source: { adsh: 'malformed', ciks: ['0000320193'] },
    }], 1), 0, 100)).toContain('malformed');
  });

  it('rejects an ignored-filter mixed page even when the expected filing is present', () => {
    const expected = {
      _source: {
        adsh: '0000320193-26-000001', ciks: ['0000320193'], form: '10-K',
        file_date: '2026-01-01', display_names: ['Example Holdings Inc.'], auditor: 'Example LLP',
      },
    };
    const mixed = {
      _source: {
        adsh: '0000789019-26-000002', ciks: ['0000789019'], form: '8-K',
        file_date: '2026-01-02', display_names: ['Unrelated Corp.'], auditor: 'Wrong LLP',
      },
    };
    const constraints = {
      cik: 320193, form: '10-K', dateFiled: '2026-01-01',
      entityName: 'Example Holdings', auditor: 'Example LLP',
    };
    expect(validateFilingSearchPagePrecision({
      hits: { hits: [expected], total: { value: 1, relation: 'eq' } },
    }, constraints)).toBeNull();
    expect(validateFilingSearchPagePrecision({
      hits: { hits: [expected, mixed], total: { value: 2, relation: 'eq' } },
    }, constraints)).toContain('hit 2');
    expect(validateFilingSearchPagePrecision({
      hits: { hits: [expected, { ...expected, _source: { ...expected._source, display_names: ['Other Corp.'] } }] },
    }, { form: '10-K', dateFiled: '2026-01-01', queryToken: 'Example' })).toContain('query-token');
  });

  it('binds every projected filing-page accession to its CIK and filing year', () => {
    const constraints = { cik: 789019, form: '10-K', dateFiled: '2026-01-01' };
    const projectedClassAHit = {
      _source: {
        adsh: '0000320193-26-000001',
        ciks: ['0000789019'],
        form: '10-K',
        file_date: '2026-01-01',
      },
    };
    expect(validateFilingSearchPagePrecision({
      hits: { hits: [projectedClassAHit], total: { value: 1, relation: 'eq' } },
    }, constraints)).toMatch(/accession\/(?:form\/date scope|CIK\/date identity)/);

    const wrongYear = {
      _source: {
        ...projectedClassAHit._source,
        adsh: '0000789019-25-000001',
      },
    };
    expect(validateFilingSearchPagePrecision({
      hits: { hits: [wrongYear], total: { value: 1, relation: 'eq' } },
    }, constraints)).toContain('accession/CIK/date identity');
    const coRegistrant = {
      _source: {
        ...projectedClassAHit._source,
        adsh: '0000320193-26-000001',
        ciks: ['0000320193', '0000789019'],
      },
    };
    expect(validateFilingSearchPagePrecision({
      hits: {
        hits: [coRegistrant],
        total: { value: 1, relation: 'eq' },
      },
    }, constraints)).toBeNull();
    expect(validateFilingSearchPagePrecision({
      hits: {
        hits: [{ ...coRegistrant, _source: { ...coRegistrant._source, cik: '999999' } }],
        total: { value: 1, relation: 'eq' },
      },
    }, constraints)).toContain('accession/CIK/date identity');
    expect(validateFilingSearchPagePrecision({
      hits: {
        hits: [{ ...coRegistrant, _id: '0000789019-26-000001:filing.htm' }],
        total: { value: 1, relation: 'eq' },
      },
    }, constraints)).toContain('accession/CIK/date identity');
    expect(hitMatchesExpectedFiling(wrongYear, {
      accession: '0000789019-25-000001',
      cik: 789019,
      form: '10-K',
      dateFiled: '2026-01-01',
    })).toBe(false);
  });

  it('requires returned comment-letter evidence to contain the requested topic terms', () => {
    const match = {
      accession: testAccession(1), cik: 1, form: 'UPLOAD',
      date_filed: '2026-01-01', rank: 1,
      headline: 'Revenue was recognized in a fragment whose other lexeme may be elided.',
    };
    const truth = topicTruth(1, [{
      accession: match.accession,
      cik: match.cik,
      form: match.form,
      date_filed: match.date_filed,
    }]);
    expect(validateTopicSearchResult('revenue recognition', {
      total: 1,
      totalIsFloor: false,
      matches: [match],
    }, undefined, truth)).toBeNull();

    expect(validateTopicSearchResult('revenue recognition', {
      total: 1,
      totalIsFloor: false,
      matches: [{ ...match, accession: testAccession(999999) }],
    }, undefined, truth)).toContain('absent from the independent direct-FTS pool');

    expect(validateTopicSearchResult('revenue recognition', {
      total: 2,
      totalIsFloor: false,
      matches: [
        match,
        { ...match, accession: testAccession(999999), rank: 0.5 },
      ],
    }, undefined, topicTruth(2, [
      truth.matches[0], { accession: testAccession(2), cik: 1, form: 'UPLOAD', date_filed: '2026-01-01' },
    ]))).toContain('topic match 2/2');
  });

  it('detects a dropped rare-branch accession within an independently bounded window', () => {
    expect(missingBoundedAccessions(
      ['0001-26-000001', '0002-26-000002'],
      ['000126000001'],
    )).toEqual(['0002-26-000002']);
    expect(missingBoundedAccessions(
      ['0001-26-000001', '0001-26-000001'],
      ['000126000001'],
    )).toEqual([]);
  });

  it('rejects a different long filing before deployed Boolean verdicts can self-confirm it', () => {
    const official = 'Official target filing revenue assets cash flow. '.repeat(200);
    const wrong = 'Different legitimate filing revenue assets cash flow. '.repeat(200);
    expect(validateIndependentFilingText(official, official.replace(/\s+/g, '  '))).toBeNull();
    expect(validateIndependentFilingText(official, wrong)).toBe(
      'deployed filing text digest does not match the independently fetched SEC target',
    );
  });

  it('requires a filtered topic response to honor the requested letter form', () => {
    const accession = testAccession(1);
    const truth = topicTruth(1, [{ accession, cik: 1, form: 'UPLOAD', date_filed: '2026-01-01' }]);
    expect(validateTopicSearchResult('revenue recognition', {
      total: 1, totalIsFloor: false,
      matches: [{ accession, cik: 1, form: 'UPLOAD', date_filed: '2026-01-01', rank: 1, headline: '<b>Revenue</b> policy' }],
    }, 'UPLOAD', truth)).toBeNull();

    expect(validateTopicSearchResult('revenue recognition', {
      total: 1, totalIsFloor: false,
      matches: [{ accession, cik: 1, form: 'CORRESP', date_filed: '2026-01-01', rank: 1, headline: '<b>Revenue</b> policy' }],
    }, 'UPLOAD', truth)).toBe('topic response ignored requested form UPLOAD');
  });

  it('requires topic totals to match direct truth including the documented floor', () => {
    const pool = Array.from({ length: 1_000 }, (_, index) => ({
      accession: testAccession(index + 1), cik: 1, form: 'UPLOAD', date_filed: '2026-01-01',
    }));
    const matches = pool.slice(0, 10).map((match, index) => ({
      ...match, rank: 10 - index, headline: 'evidence',
    }));
    const truth = topicTruth(10_005, pool);
    expect(validateTopicSearchResult('fair value', {
      total: 10_000, totalIsFloor: true, matches,
    }, undefined, truth)).toBeNull();
    expect(validateTopicSearchResult('fair value', {
      total: 10_000, totalIsFloor: false, matches,
    }, undefined, truth)).toContain('topic count');
  });

  it('rejects a short or duplicated topic page even when its total is correct', () => {
    const truth = topicTruth(2, [
        { accession: testAccession(1), cik: 1, form: 'UPLOAD', date_filed: '2026-01-01' },
        { accession: testAccession(2), cik: 1, form: 'UPLOAD', date_filed: '2026-01-01' },
    ]);
    const first = {
      accession: testAccession(1), cik: 1, form: 'UPLOAD', date_filed: '2026-01-01', rank: 1, headline: 'evidence',
    };
    expect(validateTopicSearchResult('fair value', {
      total: 2, totalIsFloor: false, matches: [first],
    }, undefined, truth)).toContain('topic page returned 1/2');
    expect(validateTopicSearchResult('fair value', {
      total: 2, totalIsFloor: false, matches: [first, first],
    }, undefined, truth)).toContain('duplicates an earlier identity');
  });

  it('rejects self-consistent topic truth with a foreign CIK prefix or filing-year mismatch', () => {
    const result = (accession: string, cik: number) => ({
      total: 1,
      totalIsFloor: false,
      matches: [{
        accession, cik, form: 'UPLOAD', date_filed: '2026-01-01', rank: 1, headline: 'evidence',
      }],
    });
    const foreignPrefix = {
      accession: testAccession(1, 320193), cik: 789019, form: 'UPLOAD', date_filed: '2026-01-01',
    };
    expect(validateTopicSearchResult(
      'fair value', result(foreignPrefix.accession, Number(foreignPrefix.cik)), undefined,
      topicTruth(1, [foreignPrefix]),
    )).toContain('malformed');

    const wrongYear = {
      accession: testAccession(1, 789019, 25), cik: 789019, form: 'UPLOAD', date_filed: '2026-01-01',
    };
    expect(validateTopicSearchResult(
      'fair value', result(wrongYear.accession, Number(wrongYear.cik)), undefined,
      topicTruth(1, [wrongYear]),
    )).toContain('malformed');
  });

  it('rejects duplicate or overlapping legal names as wrong-entity controls', () => {
    expect(isDisjointEntityNameControl('Example Holdings, Inc.', 'Example Holdings LLC')).toBe(false);
    expect(isDisjointEntityNameControl('Alphabet Inc.', 'Microsoft Corporation')).toBe(true);
    expect(isDisjointEntityNameControl('Acme International, Inc.', 'Other International PLC')).toBe(false);
  });

  it('requires the complete independently counted comment-letter thread', () => {
    const letters = [
      { accession: testAccession(1), cik: 1, form: 'UPLOAD', date_filed: '2026-01-01', filename: 'a.txt' },
      { accession: testAccession(2), cik: 1, form: 'CORRESP', date_filed: '2026-01-02', filename: 'b.txt' },
    ];
    expect(validateThreadDetails('1:2026-01-01', letters, { thread: '1:2026-01-01', letters })).toBeNull();
    expect(validateThreadDetails('1:2026-01-01', letters, {
      thread: '1:2026-01-02', letters,
    })).toBe('thread 1:2026-01-02 != expected 1:2026-01-01');
    expect(validateThreadDetails('1:2026-01-01', letters, {
      thread: '1:2026-01-01',
      letters: [letters[0], { ...letters[1], accession: testAccession(999999) }],
    })).toContain('letter identity set does not match');
    expect(validateThreadDetails('1:2099-01-01', letters, {
      thread: '1:2099-01-01', letters,
    })).toBe('invalid independent thread identity');
    const keyedLetters = letters.map(letter => ({ ...letter, review_key: 'review-1' }));
    expect(validateThreadDetails('1:review-1', keyedLetters, {
      thread: '1:review-1', letters,
    })).toBeNull();
    expect(validateThreadDetails('1:date:2026-01-01', keyedLetters, {
      thread: '1:date:2026-01-01', letters,
    })).toBe('invalid independent thread identity');
  });

  it('rejects self-consistent thread letters with a foreign CIK prefix or filing-year mismatch', () => {
    const foreignPrefix = [{
      accession: testAccession(1, 320193), cik: 789019, form: 'UPLOAD',
      date_filed: '2026-01-01', filename: 'foreign.txt',
    }];
    expect(validateThreadDetails('789019:2026-01-01', foreignPrefix, {
      thread: '789019:2026-01-01', letters: foreignPrefix,
    })).toBe('invalid independent thread letter identity');

    const wrongYear = [{
      accession: testAccession(1, 789019, 25), cik: 789019, form: 'UPLOAD',
      date_filed: '2026-01-01', filename: 'wrong-year.txt',
    }];
    expect(validateThreadDetails('789019:2026-01-01', wrongYear, {
      thread: '789019:2026-01-01', letters: wrongYear,
    })).toBe('invalid independent thread letter identity');
  });

  it('validates company enrichment against independent SEC ticker truth', () => {
    expect(validateCompanyEnrichment([{ cik: 320193, tickers: ['AAPL'] }], {
      companies: { 320193: { tickers: ['AAPL'] } },
    })).toBeNull();
    expect(validateCompanyEnrichment([{ cik: 320193, tickers: ['AAPL'] }], {
      companies: { 320193: { tickers: ['MSFT'] } },
    })).toBe('cik 320193 ticker set ["MSFT"] != official ["AAPL"]');
    expect(validateCompanyEnrichment([{ cik: 320193, tickers: ['AAPL'] }], {
      companies: { 320193: { tickers: ['AAPL', 'FAKE'] } },
    })).toBe('cik 320193 ticker set ["AAPL","FAKE"] != official ["AAPL"]');
  });

  it('derives historical auditor truth from raw Form AP rows without leaking a future firm', () => {
    const ordinary = 'Issuer, other than Employee Benefit Plan or Investment Company';
    const rows = [
      { audit_report_date: '2021-02-01', audit_report_type: ordinary, firm_canonical: 'KPMG' },
      { audit_report_date: '2022-02-01', audit_report_type: ordinary, firm_canonical: 'Deloitte' },
    ];

    expect(deriveRawAuditorTruth('2021-12-31', rows)).toEqual({
      auditor: 'KPMG', resolutionStatus: 'resolved',
    });
    expect(deriveRawAuditorTruth('2022-12-31', rows)).toEqual({
      auditor: 'Deloitte', resolutionStatus: 'resolved',
    });
  });

  it('keeps ambiguous raw Form AP evidence unresolved instead of self-certifying a firm', () => {
    const ordinary = 'Issuer, other than Employee Benefit Plan or Investment Company';
    expect(deriveRawAuditorTruth('2022-12-31', [
      { audit_report_date: '2022-02-01', audit_report_type: ordinary, firm_canonical: 'KPMG' },
      { audit_report_date: '2022-02-01', audit_report_type: ordinary, firm_canonical: 'Deloitte' },
    ])).toEqual({ auditor: null, resolutionStatus: 'ambiguous' });
  });

  it('fails exact class and critical-path quota shortfalls', () => {
    const plan = buildE2eQuotaPlan(1_000);
    expect(plan.classes).toEqual({ A: 450, B: 150, C: 150, D: 150, E: 20, F: 80 });
    expect(quotaShortfalls(plan, {
      A: 449, B: 150, C: 150, D: 149, E: 20, F: 80,
    }, { auditor: 149, topic: 50 })).toEqual([
      'class A generated 449/450 required points',
      'class D generated 149/150 required points',
      'auditor path generated 149/150 required points',
    ]);
  });
});
