import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateReleaseEvidence,
  fetchTrustedCandidateVersion,
  trustedCandidateOriginForFinalRead,
  type ExpectedReleaseIdentity,
  type ReleaseEvidenceInput,
} from '../../scripts/accuracy/consolidate';
import { UI_ACTION_TEST_MAP, UI_CONTENT_TEST_MAP } from './uiActionCoverage';
import {
  UI_ACTION_EVIDENCE_SCHEMA,
  uiActionMappingDigest,
  uiContentMappingDigest,
  type UiActionScope,
} from '../../scripts/ui-actions/evidence';
import { schemaEvidenceSha256 } from '../../scripts/accuracy/schema-contract';
import { validSchemaContractEvidence } from './schemaContractFixture';
import { ISSUERS, TOPIC_CASES } from '../../scripts/accuracy/cases';

const base = 'https://vara-ai-example-team.vercel.app';
const repository = 'example/vara-ai-app';
const databaseFingerprint = `sha256:${'d'.repeat(64)}`;
const expected: ExpectedReleaseIdentity = {
  deploymentId: 'dpl_release_candidate',
  sha: 'a'.repeat(40),
  schemaVersion: '021',
  schemaMigrationCount: 23,
  schemaChainChecksum: 'b'.repeat(64),
  schemaChecksumAlgorithm: 'sha256-v2',
  repositoryId: '123456789',
};

const semanticCheckTargets: Record<string, number> = {
  entity: 64,
  'filing-entity': 60,
  xbrl: 20,
  'boolean-deployed': 1,
  boolean: 5,
  equivalence: 8,
  disclosure: 160,
};

const booleanFixtures = [
  { query: '"mezzanine equity" OR "temporary equity"', category: 'union-superset-of-branches', branches: ['"mezzanine equity"', '"temporary equity"'] },
  { query: '"material weakness" AND "remediation plan"', category: 'intersection-subset-of-each-branch', branches: ['"material weakness"', '"remediation plan"'] },
  { query: '"revenue recognition"', category: 'phrase-stricter-than-tokens', branches: ['revenue recognition'] },
  { query: 'goodwill AND', category: 'rejected-before-retrieval', branches: [] },
  { query: 'NOT impairment', category: 'rejected-before-retrieval', branches: [] },
] as const;
const disclosureTopics = ['revenue-recognition', 'stock-compensation', 'income-taxes', 'leases'] as const;
const xbrlPrimaryTags: Record<string, string> = {
  revenue: 'Revenues', netIncome: 'NetIncomeLoss', assets: 'Assets', equity: 'StockholdersEquity',
};

function passingSubmissionsWitness(cik: string, hasAnnual: boolean) {
  const normalized = String(Number(cik));
  const annualFilings = hasAnnual ? [{
    accession: `${normalized.padStart(10, '0')}-26-000001`,
    form: '10-K',
    filingDate: '2026-01-01',
    primaryDocument: 'filing.htm',
  }] : [];
  return {
    sourceUrl: `https://data.sec.gov/submissions/CIK${normalized.padStart(10, '0')}.json`,
    responseStatus: 200,
    contentType: 'application/json',
    payloadBytes: 1_000,
    payloadSha256: createHash('sha256').update(`submissions-${normalized}`).digest('hex'),
    requestedCik: normalized,
    responseCik: normalized,
    annualFilings,
    annualEvidenceSha256: createHash('sha256').update(JSON.stringify({
      requestedCik: normalized,
      responseCik: normalized,
      annualFilings,
    })).digest('hex'),
  };
}

function passingDisclosureFixture(index: number) {
  const issuerIndex = Math.floor(index / 5);
  const issuer = ISSUERS[issuerIndex];
  const position = index % 5;
  const accession = `${issuer.cik.padStart(10, '0')}26000001`;
  const directory = `https://www.sec.gov/Archives/edgar/data/${Number(issuer.cik)}/${accession}`;
  const document = 'filing.htm';
  const resolvedDocument = 'resolved.htm';
  const primaryUrl = `${directory}/${document}`;
  const resolvedUrl = `${directory}/${resolvedDocument}`;
  const resolvedTextSha256 = createHash('sha256').update(`resolved-text-${issuer.ticker}`).digest('hex');
  const common = {
    ticker: issuer.ticker,
    cik: issuer.cik,
    accession,
    date: '2026-01-01',
    form: '10-K',
    document,
    resolvedDocument,
  };
  if (position === 4) {
    const rawHtmlSha256 = createHash('sha256').update(`resolved-html-${issuer.ticker}`).digest('hex');
    return {
      target: {
        kind: 'disclosure-auditor' as const,
        ...common,
        declaredAuditor: 'Example LLP',
        scoredSource: {
          kind: 'resolved-annual-document', document: resolvedDocument, url: resolvedUrl,
          textLength: 5_000, textSha256: resolvedTextSha256, rawHtmlSha256,
        },
      },
      expected: { auditor: 'Example LLP', pcaobFirmId: '1234' },
      actual: {
        auditor: 'Example LLP', sourceTextLength: 5_000,
        sourceTextSha256: resolvedTextSha256, sourceHtmlSha256: rawHtmlSha256,
      },
      sourceUrls: [primaryUrl, resolvedUrl],
    };
  }
  const topic = disclosureTopics[position];
  const topicCase = TOPIC_CASES.find(item => item.topicId === topic)!;
  const block = position === 0;
  const blockDocument = 'R1.htm';
  const filingSummaryUrl = `${directory}/FilingSummary.xml`;
  const blockUrl = `${directory}/${blockDocument}`;
  const blockTextSha256 = createHash('sha256').update(`block-text-${issuer.ticker}`).digest('hex');
  const scoredSource = block ? {
    kind: 'filing-summary-block',
    document: blockDocument,
    url: blockUrl,
    blockName: 'Revenue Recognition',
    textLength: 500,
    textSha256: blockTextSha256,
    selectorSource: {
      kind: 'filing-summary', document: 'FilingSummary.xml', url: filingSummaryUrl,
      payloadSha256: createHash('sha256').update(`summary-${issuer.ticker}`).digest('hex'),
    },
  } : {
    kind: 'resolved-annual-document',
    document: resolvedDocument,
    url: resolvedUrl,
    textLength: 5_000,
    textSha256: resolvedTextSha256,
  };
  return {
    target: { kind: 'disclosure-topic' as const, ...common, topic, scoredSource },
    expected: { found: true, mustContain: topicCase.mustContain },
    actual: {
      found: true, hit: topicCase.mustContain[0], matchKind: 'heading', textLength: 100,
      sourceTextLength: scoredSource.textLength, sourceTextSha256: scoredSource.textSha256,
    },
    sourceUrls: block
      ? [primaryUrl, resolvedUrl, filingSummaryUrl, blockUrl]
      : [primaryUrl, resolvedUrl],
  };
}

function passingSemanticChecks(replayDigest: string): Array<Record<string, unknown>> {
  return Object.entries(semanticCheckTargets).flatMap(([suite, count]) =>
    Array.from({ length: count }, (_, index) => {
      const disclosureFixture = suite === 'disclosure' ? passingDisclosureFixture(index) : null;
      const target = suite === 'entity'
        ? index % 2 === 0
          ? { kind: 'entity-ticker', ticker: ISSUERS[Math.floor(index / 2)].ticker }
          : { kind: 'entity-name', query: ISSUERS[Math.floor(index / 2)].title.split(/[\s,]+/)[0], ticker: ISSUERS[Math.floor(index / 2)].ticker }
        : suite === 'filing-entity'
          ? {
            kind: 'filing-entity', ticker: `T${String(index + 1).padStart(5, '0')}`,
            officialCik: String(index + 1), expectedCik: String(index + 1),
            resolutionMode: 'official-directory-cik', officialHasAnnual: true,
            officialSubmissions: passingSubmissionsWitness(String(index + 1), true),
            edgarCorrection: {
              required: false, reachable: false, resolvedCik: null, candidateHasAnnual: false,
              atomEvidence: null, candidateSubmissions: null,
            },
            selection: { directoryOrdinal: index, scoredOrdinal: index + 1, replacementCountBefore: 0 },
          }
          : suite === 'xbrl'
            ? { kind: 'xbrl-latest-annual', ticker: ISSUERS[Math.floor(index / 4)].ticker, cik: ISSUERS[Math.floor(index / 4)].cik, concept: ['revenue', 'netIncome', 'assets', 'equity'][index % 4] }
            : suite === 'boolean'
              ? { kind: 'boolean-case', ...booleanFixtures[index] }
              : suite === 'boolean-deployed'
                ? {
                  kind: 'boolean-deployed-canary', cik: '1', accession: '000000000126000001',
                  form: '10-K', dateFiled: '2026-01-01', document: 'filing.htm',
                }
            : suite === 'equivalence'
              ? index % 2 === 0
                ? { kind: 'equivalence-agreement', ticker: ISSUERS[Math.floor(index / 2)].ticker, cik: ISSUERS[Math.floor(index / 2)].cik, accession: `${ISSUERS[Math.floor(index / 2)].cik.padStart(10, '0')}26000001`, date: '2026-01-01', form: '10-K', document: 'filing.htm', selection: { candidateOrdinal: Math.floor(index / 2), scoredOrdinal: Math.floor(index / 2) + 1, replacementCountBefore: 0 } }
                : { kind: 'equivalence-positive', ticker: ISSUERS[Math.floor(index / 2)].ticker, cik: ISSUERS[Math.floor(index / 2)].cik, accession: `${ISSUERS[Math.floor(index / 2)].cik.padStart(10, '0')}26000001`, date: '2026-01-01', form: '10-K', document: 'filing.htm', selection: { candidateOrdinal: Math.floor(index / 2), scoredOrdinal: Math.floor(index / 2) + 1, replacementCountBefore: 0 } }
              : suite === 'disclosure'
                ? disclosureFixture!.target
                : { suite, check: `${suite}-${index + 1}` };
      const expectedActual = target.kind === 'entity-ticker'
        ? [{ ticker: target.ticker }, { ticker: target.ticker }]
        : target.kind === 'entity-name'
          ? [{ visibleTicker: target.ticker }, { visibleTickers: [target.ticker] }]
          : target.kind === 'filing-entity'
            ? [{ resolvedCik: target.expectedCik, deployedAnnual: true }, { resolvedCik: target.expectedCik, deployedAnnual: true }]
            : target.kind === 'xbrl-latest-annual'
              ? [{ candidates: [{ tag: xbrlPrimaryTags[String(target.concept)], val: 1, end: '2026-01-01', form: '10-K', fp: 'FY' }], periodEnd: '2026-01-01', year: 2026 }, { value: 1, periodEnd: '2026-01-01', year: 2026 }]
              : target.kind === 'equivalence-agreement'
                ? [{ agreements: 5 }, { agreements: 5 }]
                : target.kind === 'equivalence-positive'
                  ? [{ minimumHits: 1 }, { hits: 1 }]
                    : target.kind === 'disclosure-topic' || target.kind === 'disclosure-auditor'
                      ? [disclosureFixture!.expected, disclosureFixture!.actual]
                        : target.kind === 'boolean-case' || target.kind === 'boolean-deployed-canary'
                          ? [{ replayPass: true }, { replayEvidenceSha256: replayDigest }]
                    : [{ pass: true }, { pass: true, detail: 'verified' }];
      const targetCik = String(target.cik ?? target.expectedCik ?? '').replace(/^0+/, '');
      const targetAccession = String(target.accession ?? '');
      const sourceUrls = target.kind === 'entity-ticker' || target.kind === 'entity-name'
        ? ['https://www.sec.gov/files/company_tickers.json']
        : target.kind === 'filing-entity'
          ? [
            'https://www.sec.gov/files/company_tickers.json',
            `https://data.sec.gov/submissions/CIK${targetCik.padStart(10, '0')}.json`,
            `${base}/api/es-search?cik=${targetCik}&forms=10-K%2C20-F%2C40-F&size=1`,
          ]
          : target.kind === 'xbrl-latest-annual'
            ? [
              `https://data.sec.gov/api/xbrl/companyfacts/CIK${targetCik.padStart(10, '0')}.json`,
              `https://data.sec.gov/api/xbrl/companyconcept/CIK${targetCik.padStart(10, '0')}/us-gaap/${xbrlPrimaryTags[String(target.concept)]}.json`,
            ]
            : target.kind === 'disclosure-topic' || target.kind === 'disclosure-auditor'
              ? disclosureFixture!.sourceUrls
            : target.kind === 'equivalence-agreement' || target.kind === 'equivalence-positive'
              ? [`https://www.sec.gov/Archives/edgar/data/${Number(targetCik)}/${targetAccession}/filing.htm`]
              : target.kind === 'boolean-deployed-canary'
                ? [`${base}/api/boolean-validate`, `https://www.sec.gov/Archives/edgar/data/${Number(targetCik)}/${targetAccession}/${String(target.document)}`]
              : [base, 'https://www.sec.gov/Archives/edgar/data/'];
      return {
        suite,
        name: `${suite}-${index + 1}`,
        passed: true,
        evidence: {
          sourceUrls,
          target,
          expected: expectedActual[0],
          actual: expectedActual[1],
        },
      };
    }),
  );
}

function passingSemanticReplay() {
  const result = (ordinal: number) => ({
    accession: `${String(ordinal).padStart(10, '0')}26000001`,
    cik: String(ordinal),
    form: '10-K',
    fileDate: '2026-01-01',
    document: `filing-${ordinal}.htm`,
    officialTextSha256: createHash('sha256').update(`text-${ordinal}`).digest('hex'),
  });
  const unionMain = result(1);
  const andMain = result(2);
  const residualMain = result(3);
  const phraseMain = result(4);
  const looseOnly = result(5);
  const coverage = { branches: [{ required: true, pages: 1, examined: 1, matched: 1 }] };
  const boolean = [
    {
      query: booleanFixtures[0].query, requiredQueries: [...booleanFixtures[0].branches],
      results: [unionMain], branchWitnesses: Object.fromEntries(booleanFixtures[0].branches.map(branch => [branch, [unionMain.accession]])),
      coverage, degraded: [],
    },
    ...booleanFixtures[0].branches.map(branch => ({ query: branch, role: 'or-branch-window', results: [unionMain], coverage, degraded: [] })),
    {
      query: booleanFixtures[1].query, requiredQueries: [...booleanFixtures[1].branches],
      results: [andMain], branchWitnesses: {}, coverage, degraded: [],
    },
    ...booleanFixtures[1].branches.map(branch => ({
      query: branch, role: 'and-candidate-window', results: [andMain],
      fullExpressionWitnesses: [andMain.accession], coverage, degraded: [],
    })),
    {
      query: 'lease NOT sublease', results: [residualMain], boundedExpected: [residualMain.accession],
      boundedNegativeControls: [looseOnly.accession], coverage, degraded: [],
    },
    {
      query: booleanFixtures[2].query, requiredQueries: [...booleanFixtures[2].branches],
      results: [phraseMain], branchWitnesses: {}, coverage, degraded: [],
    },
    {
      query: booleanFixtures[2].branches[0], role: 'loose-token-control-window',
      results: [phraseMain, looseOnly], exactPhraseExpected: [phraseMain.accession],
      looseOnlyControls: [looseOnly.accession], coverage, degraded: [],
    },
  ];
  const booleanRejected = booleanFixtures.slice(3).map(item => ({
    query: item.query, category: item.category, compiled: false, planned: false,
    resultCount: 0, requestDelta: 0,
  }));
  const textSha = createHash('sha256').update('canary-text').digest('hex');
  const booleanDeployedCanary = [{
    candidateBase: base,
    target: {
      cik: '1', accession: '000000000126000001', form: '10-K',
      dateFiled: '2026-01-01', document: 'filing.htm',
    },
    officialTextSha256: textSha, deployedTextSha256: textSha,
    positiveQuery: 'revenue NOT zzzsentinel', negativeQuery: 'revenue AND zzzsentinel',
    candidateRequests: 4, secEftsGet: true, filingTextGet: true,
    positiveValidate: true, negativeValidate: true,
  }];
  return { boolean, booleanRejected, booleanDeployedCanary };
}

function passingReplay() {
  const classCounts = { A: 450, B: 150, C: 150, D: 150, E: 20, F: 80 } as const;
  let ordinal = 0;
  const cases = Object.entries(classCounts).flatMap(([cls, count]) =>
    Array.from({ length: count }, (_, classIndex) => {
      ordinal += 1;
      const bWithinYear = cls === 'B' ? classIndex % 15 : -1;
      const bYear = cls === 'B' ? 2017 + Math.floor(classIndex / 15) : 2026;
      const bNegative = cls === 'B' && (bWithinYear === 1 || bWithinYear === 3);
      const bSampleKind = cls === 'B'
        ? bWithinYear < 2 ? 'boundary-before' : bWithinYear < 4 ? 'boundary-after' : 'year-stratum'
        : null;
      const fNegative = cls === 'F' && classIndex < 40 && classIndex % 2 === 1;
      const targetOrdinal = bNegative || fNegative ? ordinal - 1 : ordinal;
      const boundarySide = cls === 'B' && bWithinYear < 4
        ? bWithinYear < 2 ? 'before' : 'after' : null;
      const boundaryCik = 6_000_000 + bYear;
      const boundaryBeforeAccession = `${String(boundaryCik).padStart(10, '0')}${String(bYear % 100).padStart(2, '0')}000001`;
      const boundaryAfterAccession = `${String(boundaryCik).padStart(10, '0')}${String(bYear % 100).padStart(2, '0')}000002`;
      const accession = boundarySide
        ? boundarySide === 'before' ? boundaryBeforeAccession : boundaryAfterAccession
        : `${String(targetOrdinal).padStart(10, '0')}${String(cls === 'B' ? bYear % 100 : 26).padStart(2, '0')}000001`;
      const targetCik = boundarySide ? boundaryCik : targetOrdinal;
      const dateFiled = cls === 'B'
        ? boundarySide === 'before' ? `${bYear}-06-30`
          : boundarySide === 'after' ? `${bYear}-07-01` : `${bYear}-08-01`
        : '2026-01-01';
      const actualAuditor = boundarySide === 'after' ? 'Successor Auditor' : 'Example Auditor';
      const rejectedAuditor = boundarySide === 'after' ? 'Example Auditor' : 'Successor Auditor';
      const boundaryOracle = boundarySide ? (() => {
        const boundaryDate = `${bYear}-07-01`;
        const rawEvent = (date: string, firmName: string, suffix: number) => {
          const rows = [{
            formFilingId: boundaryCik * 10 + suffix,
            issuerCik: boundaryCik,
            auditReportDate: date,
            auditReportType: 'Issuer, other than employee benefit plan or investment company',
            firmCanonical: firmName,
            filingDate: date,
            isLatest: true,
          }];
          return {
            source: 'urc_sec_auditors.direct-event', auditReportDate: date,
            resolvedFirmName: firmName, rows,
            digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
          };
        };
        const predecessorRawEvent = rawEvent(`${bYear - 1}-07-01`, 'Example Auditor', 1);
        const successorRawEvent = rawEvent(boundaryDate, 'Successor Auditor', 2);
        const predecessor = {
          intervalId: `${boundaryCik}:${bYear - 1}-07-01`, issuerCik: boundaryCik,
          firmName: 'Example Auditor', effectiveFromInclusive: `${bYear - 1}-07-01`,
          effectiveToExclusive: boundaryDate,
          rawEvent: predecessorRawEvent,
        };
        const successor = {
          intervalId: `${boundaryCik}:${boundaryDate}`, issuerCik: boundaryCik,
          firmName: 'Successor Auditor', effectiveFromInclusive: boundaryDate,
          effectiveToExclusive: `${bYear + 1}-07-01`,
          rawEvent: successorRawEvent,
        };
        const pair = {
          before: { accession: boundaryBeforeAccession, dateFiled: `${bYear}-06-30`, intervalId: predecessor.intervalId },
          after: { accession: boundaryAfterAccession, dateFiled: `${bYear}-07-01`, intervalId: successor.intervalId },
        };
        const pairId = createHash('sha256').update(JSON.stringify({
          boundaryDate, issuerCik: boundaryCik, predecessorIntervalId: predecessor.intervalId,
          successorIntervalId: successor.intervalId, beforeAccession: boundaryBeforeAccession,
          afterAccession: boundaryAfterAccession,
        })).digest('hex');
        const transitionRows = [...predecessorRawEvent.rows, ...successorRawEvent.rows];
        const nextEventAfterPredecessor = {
          source: 'urc_sec_auditors.direct-next-event',
          afterAuditReportDateExclusive: predecessor.effectiveFromInclusive,
          auditReportDate: successor.effectiveFromInclusive,
          firstFormFilingId: successorRawEvent.rows[0].formFilingId,
        };
        const transitionDigestPayload = {
          issuerCik: boundaryCik,
          fromAuditReportDateInclusive: predecessor.effectiveFromInclusive,
          toAuditReportDateInclusive: successor.effectiveFromInclusive,
          exactRowCount: transitionRows.length,
          returnedRowCount: transitionRows.length,
          complete: true,
          eventDates: [predecessor.effectiveFromInclusive, successor.effectiveFromInclusive],
          rows: transitionRows,
          nextEventAfterPredecessor,
        };
        const rawTransitionWitness = {
          contract: 'urc.raw-form-ap-transition-range.v1',
          source: 'urc_sec_auditors.direct-range+direct-next-event',
          ...transitionDigestPayload,
          digest: createHash('sha256').update(JSON.stringify(transitionDigestPayload)).digest('hex'),
        };
        const selected = boundarySide === 'before' ? predecessor : successor;
        const opposite = boundarySide === 'before' ? successor : predecessor;
        return {
          contract: 'urc.auditor-boundary-selection.v1', intervalIdScheme: 'issuer_cik:effective_from',
          pairId, boundaryDate, issuerCik: boundaryCik, side: boundarySide,
          predecessor, successor, rawTransitionWitness,
          selection: {
            accession, dateFiled, selectedIntervalId: selected.intervalId,
            effectiveFromInclusive: selected.effectiveFromInclusive,
            effectiveToExclusive: selected.effectiveToExclusive,
            selectionWindow: {
              fromInclusive: selected.effectiveFromInclusive < '2017-01-01' ? '2017-01-01' : selected.effectiveFromInclusive,
              toExclusive: selected.effectiveToExclusive > '2027-01-01' ? '2027-01-01' : selected.effectiveToExclusive,
            },
            expectedFirmName: selected.firmName, reciprocalRejectedFirmName: opposite.firmName,
            intervalPredicate: 'effectiveFromInclusive <= dateFiled AND (effectiveToExclusive IS NULL OR dateFiled < effectiveToExclusive)',
            selectionPredicate: 'selectionWindow.fromInclusive <= dateFiled < selectionWindow.toExclusive',
          },
          pair,
        };
      })() : null;
      const topicName = `fair value topic ${classIndex + 1}`;
      const criticalPath = cls === 'B' ? 'auditor' : cls === 'C' && classIndex < 50 ? 'topic' : null;
      const oracleEvidence = cls === 'A' ? {
        kind: 'filing-target', source: 'urc_sec_filings', accession, cik: targetCik,
        form: '10-K', dateFiled: '2026-01-01', companyName: `Company ${ordinal}`,
      } : cls === 'B' ? {
        kind: 'auditor-target', polarity: bNegative ? 'negative' : 'positive', sampleKind: bSampleKind, accession,
        cik: targetCik, form: '10-K', dateFiled, auditor: actualAuditor,
        ...(bNegative ? { rejectedAuditor } : {}),
        resolutionStatus: 'resolved',
        basis: 'latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date',
        ...(boundaryOracle ? { boundaryOracle } : {}),
      } : cls === 'C' && criticalPath === 'topic' ? {
        kind: 'topic-direct-fts', topic: topicName, form: null, total: 1, pageSize: 10,
        poolDepth: 1,
        matches: [{ accession, cik: ordinal, form: 'UPLOAD', date_filed: '2026-01-01' }],
        countSource: 'urc_comment_letters.direct-fts-count',
        rankSource: 'candidate-rank-order-with-independent-fts-pool',
        predicateSource: 'urc_comment_letters.direct-fts-identity',
        predicateEvidenceSha256: createHash('sha256').update(JSON.stringify([
          { accession, cik: ordinal, form: 'UPLOAD', date_filed: '2026-01-01' },
        ])).digest('hex'),
        rankingClaim: {
          contract: 'urc.topic-ranking-claim.v1',
          claimLevel: 'independent-fts-membership-pool',
          topKIdentityClaimed: false,
          rankEquivalenceClaimed: false,
          productRpcUsedAsOracle: false,
          independentSource: 'urc_comment_letters.direct-table-fts',
          directPoolOrder: [
            { field: 'date_filed', direction: 'desc' },
            { field: 'accession', direction: 'asc' },
            { field: 'cik', direction: 'asc' },
          ],
          poolDepth: 1,
        },
      } : cls === 'C' ? {
        kind: 'thread-direct-table', threadId: `${ordinal}:2026-01-01`,
        letters: [{
          accession, cik: ordinal, form: 'UPLOAD', date_filed: '2026-01-01',
          filename: 'letter.txt', review_key: null,
        }],
      } : cls === 'D' ? {
        kind: 'filing-text-target', source: 'urc_sec_filings+SEC_EFTS', accession,
        cik: targetCik, form: '10-K', dateFiled: '2026-01-01', queryToken: 'EXAMPLE',
      } : cls === 'E' ? {
        kind: 'official-sec-ticker-set', source: 'https://www.sec.gov/files/company_tickers.json',
        companies: [{ cik: ordinal, tickers: [`T${ordinal}`] }],
      } : fNegative ? {
        kind: 'entity-target', polarity: 'negative', accession, cik: targetCik,
        form: '10-K', dateFiled: '2026-01-01', targetEntityName: `Company ${targetCik}`,
        disjointControlCik: targetCik + 100_000, disjointControlName: `Unrelated Systems Alpha${classIndex}`,
      } : {
        kind: 'entity-target', polarity: 'positive', accession, cik: targetCik,
        form: '10-K', dateFiled: '2026-01-01', entityName: `Company ${targetCik}`,
      };
      const target = { accession, cik: targetCik, form: '10-K', dateFiled };
      const params = (values: Record<string, string>) => new URLSearchParams(values).toString();
      const requestPath = cls === 'A'
        ? `/api/es-search?${params({ forms: '10-K', startdt: '2026-01-01', enddt: '2026-01-01', entityName: `Company ${ordinal}`.slice(0, 40), size: '100' })}`
        : cls === 'B'
          ? `/api/es-search?${params({ cik: String(targetCik), forms: '10-K', startdt: dateFiled, enddt: dateFiled, auditor: bNegative ? rejectedAuditor : actualAuditor, size: '100' })}`
          : cls === 'C' && criticalPath === 'topic'
            ? `/api/letters?${params({ q: topicName, size: '10' })}`
            : cls === 'C'
              ? `/api/letters?${params({ thread: `${ordinal}:2026-01-01` })}`
              : cls === 'D'
                ? `/api/es-search?${params({ q: '"EXAMPLE"', forms: '10-K', startdt: '2026-01-01', enddt: '2026-01-01', size: '50' })}`
                : cls === 'E'
                  ? `/api/enrich?${params({ ciks: String(ordinal) })}`
                  : `/api/es-search?${params({ entityName: fNegative ? `Unrelated Systems Alpha${classIndex}` : `Company ${targetCik}`, forms: '10-K', startdt: '2026-01-01', enddt: '2026-01-01', size: '100' })}`;
      const negative = bNegative || fNegative;
      const expectedFiling = ['A', 'B', 'D', 'F'].includes(cls) && !negative ? target : null;
      const forbiddenFiling = negative ? target : null;
      const searchProjection = {
        hits: {
          total: { value: negative ? 0 : 1, relation: 'eq' },
          hits: negative ? [] : [{
            _id: accession,
            _source: {
              adsh: accession,
              ciks: [String(targetCik)],
              cik: targetCik,
              form: '10-K',
              file_date: dateFiled,
              display_names: [cls === 'D' ? `Example Company ${ordinal}` : `Company ${targetCik}`],
              auditor: cls === 'B' ? actualAuditor : null,
            },
          }],
        },
      };
      const projection = cls === 'C' && criticalPath === 'topic'
        ? {
          thread: null, total: 1, totalIsFloor: false,
          matches: [{
            accession, cik: ordinal, form: 'UPLOAD', date_filed: '2026-01-01',
            rank: 1, headline: `${topicName} evidence`,
          }],
          letters: undefined,
        }
        : cls === 'C'
          ? {
            thread: `${ordinal}:2026-01-01`, total: null, totalIsFloor: null, matches: undefined,
            letters: [{ accession, cik: ordinal, form: 'UPLOAD', date_filed: '2026-01-01', filename: 'letter.txt' }],
          }
          : cls === 'E'
            ? { companies: { [ordinal]: { tickers: [`T${ordinal}`] } } }
            : searchProjection;
      return {
        caseId: `case-${String(ordinal).padStart(4, '0')}`,
        cls,
        criticalPath,
        label: `${cls} replay ${classIndex + 1}`,
        requestPath,
        expectedFiling,
        forbiddenFiling,
        oracleEvidence,
        outcome: {
          pass: true,
          status: 200,
          statusHistory: [200],
          failure: null,
          pages: 1,
          examined: ['A', 'B', 'D', 'F'].includes(cls) && !negative ? 1 : 0,
          ms: 10,
        },
        observation: {
          pages: [{
            requestPath,
            status: 200,
            contentType: 'application/json',
            payloadBytes: 2,
            payloadSha256: createHash('sha256').update('{}').digest('hex'),
            projection,
            projectionSha256: createHash('sha256').update(JSON.stringify(projection)).digest('hex'),
          }],
        },
      };
    }),
  );
  const selection = cases.map(item => ({
    caseId: item.caseId,
    cls: item.cls,
    criticalPath: item.criticalPath,
    label: item.label,
    requestPath: item.requestPath,
    expectedFiling: item.expectedFiling,
    forbiddenFiling: item.forbiddenFiling,
    oracleEvidence: item.oracleEvidence,
  }));
  return {
    rngSeed: 20260719,
    selectionSha256: createHash('sha256').update(JSON.stringify(selection)).digest('hex'),
    evidenceSha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    databaseWatermark: {
      capturedAt: '2026-08-03T23:50:00.000Z',
      filings: {
        count: 4_000_000,
        latest: { accession: '0000000001-26-000001', cik: 1, date_filed: '2026-08-03' },
      },
      commentLetters: {
        count: 500_000,
        latest: {
          accession: '0000000001-26-000002', cik: 1,
          thread_id: '1:2026-08-03', date_filed: '2026-08-03', review_key: null,
        },
      },
      rawFormAp: { count: 100_000, latest: { form_filing_id: 100_000_001, filing_date: '2026-08-03' } },
    },
    cases,
  };
}

function passingE2eGroundTruth(replay: ReturnType<typeof passingReplay>) {
  const boundaryRows = [...new Map(replay.cases.flatMap(item => {
    const boundary = (item.oracleEvidence as Record<string, unknown>).boundaryOracle as Record<string, unknown> | undefined;
    return boundary ? [[String(boundary.pairId), {
      pairId: boundary.pairId, boundaryDate: boundary.boundaryDate, issuerCik: boundary.issuerCik,
      predecessor: boundary.predecessor, successor: boundary.successor,
      rawTransitionWitness: boundary.rawTransitionWitness, pair: boundary.pair,
    }] as const] : [];
  })).values()].sort((left, right) => String(left.pairId).localeCompare(String(right.pairId)));
  const years = Array.from({ length: 10 }, (_, index) => 2017 + index);
  const yearTargets = Object.fromEntries(years.map(year => [String(year), 15]));
  const yearPositive = Object.fromEntries(years.map(year => [String(year), 13]));
  const yearNegative = Object.fromEntries(years.map(year => [String(year), 2]));
  return {
    filingCandidatesRead: 1_000,
    filingDuplicateReplacements: 0,
    auditorCandidatePages: 10,
    auditorCandidatesExamined: 1_000,
    auditorUnresolvedReplacements: 0,
    auditorDuplicateReplacements: 0,
    auditorCandidateHardCap: 5_000,
    auditorYears: years,
    auditorYearTargets: yearTargets,
    auditorYearGenerated: yearTargets,
    auditorYearPositiveGenerated: yearPositive,
    auditorYearNegativeGenerated: yearNegative,
    auditorPositiveCases: 130,
    auditorNegativeControls: 20,
    auditorRawPages: 10,
    auditorRawRowsRead: 150,
    auditorRawRowHardCapPerChunk: 5_000,
    auditorRawResolverMismatches: 0,
    auditorRawMaxFormFilingId: 100_000_000,
    auditorRawMaxFilingDate: '2026-07-01',
    auditorBoundaryPairTarget: 10,
    auditorBoundaryPairsGenerated: 10,
    auditorBoundaryPredecessorHardCap: 2_000,
    auditorBoundaryPredecessorsExamined: 20,
    auditorBoundaryTransitionHardCap: 500,
    auditorBoundaryTransitionsExamined: 10,
    auditorBoundaryCandidateHardCap: 10_000,
    auditorBoundaryCandidatesExamined: 20,
    auditorBoundaryRejected: 0,
    auditorBoundaryRawEventRowsRead: 20,
    auditorBoundaryRawEventMismatches: 0,
    auditorBoundaryRawRangeRowsRead: 20,
    auditorBoundaryRawRangeMismatches: 0,
    auditorBoundaryRawNextEventProbes: 10,
    auditorBoundarySelectionManifest: {
      source: 'urc_auditor_periods_mat+urc_sec_filings+urc_sec_auditors',
      algorithm: 'sha256', count: boundaryRows.length,
      digest: createHash('sha256').update(JSON.stringify(boundaryRows)).digest('hex'),
      rows: boundaryRows,
    },
  };
}

function passingSecurityHeaders() {
  const definitions = [
    ['public-html', '/support', 200, 'text/html; charset=utf-8'],
    ['public-api', '/api/version', 200, 'application/json'],
    ['not-found', '/_next/static/release-security-header-archetype-missing.js', 404, 'text/html'],
    ['protected-route', '/dashboard', 401, 'text/plain; charset=utf-8'],
    ['typed-bad-request', '/api/es-search?size=0', 400, 'application/json'],
  ] as const;
  const headers = {
    contentSecurityPolicy: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://img.clerk.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.clerk.accounts.dev https://clerk-telemetry.com https://us.i.posthog.com https://us-assets.i.posthog.com",
      "frame-src 'self' https://challenges.cloudflare.com https://*.clerk.accounts.dev",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://*.clerk.accounts.dev",
      "frame-ancestors 'self'",
      'report-uri /api/csp-report',
      'report-to csp-endpoint',
    ].join('; '),
    contentSecurityPolicyReportOnly: null,
    reportingEndpoints: 'csp-endpoint="/api/csp-report"',
    xFrameOptions: 'SAMEORIGIN',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains; preload',
  };
  return {
    generatedAt: '2026-08-04T00:30:00.000Z',
    base,
    policy: {
      enforcedCsp: true,
      responseArchetypes: definitions.map(([name]) => name),
      authBoundary: {
        path: '/dashboard',
        authentication: 'unauthenticated',
        releaseGateToken: 'absent',
        redirectMode: 'manual',
        acceptedStatuses: [301, 302, 303, 307, 308, 401, 403, 404],
      },
    },
    observations: definitions.map(([name, path, status, contentType]) => ({
      name, path, status, contentType, headers: { ...headers }, problems: [], pass: true,
    })),
    problems: [],
    pass: true,
  };
}

function passingTickerManifest(count: number, generatedAt: string) {
  const rows = Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    const page = Array.from({ length: 5 }, (_, pageIndex) => ({
      accession: `${String(ordinal).padStart(10, '0')}26${String(pageIndex + 1).padStart(6, '0')}`,
      cik: String(ordinal),
      form: pageIndex === 0 ? '8-K' : '10-Q',
      filingDate: `2026-07-${String(31 - pageIndex).padStart(2, '0')}`,
    }));
    const accession = page[0].accession;
    const displayAccession = `${accession.slice(0, 10)}-${accession.slice(10, 12)}-${accession.slice(12)}`;
    return {
      ticker: `T${String(ordinal).padStart(5, '0')}`,
      title: `Ticker ${ordinal}`,
      officialCik: String(ordinal),
      resolvedCik: String(ordinal),
      status: 'PASS',
      candidateNewestAccession: displayAccession,
      candidateNewestDate: '2026-07-31',
      secNewestAccessions: [displayAccession],
      secNewestDate: '2026-07-31',
      returnedFilings: 5,
      secEligibleFilings: 5,
      secSubmissionsEvidenceSha256: createHash('sha256').update(`SEC-${ordinal}`).digest('hex'),
      secSourceCik: String(ordinal),
      secRecentRawFilings: 5,
      secArchivePlanComplete: true,
      secArchiveDescriptorCount: 0,
      secRelevantArchiveCount: 0,
      secArchivePlanSha256: createHash('sha256').update(JSON.stringify([])).digest('hex'),
      secArchiveEvidence: [],
      secTruthDetail: '',
      candidatePage: page,
      secExpectedPage: page,
    };
  });
  const keys = rows.map(row => `${row.ticker}\u0000${row.officialCik}`);
  const projection = rows.map(row => ({
    ticker: row.ticker,
    officialCik: row.officialCik,
    title: row.title,
  }));
  const keyDigest = createHash('sha256').update(JSON.stringify(keys)).digest('hex');
  const projectionDigest = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  return {
    generatedAt,
    directorySource: 'https://www.sec.gov/files/company_tickers.json',
    source: 'https://data.sec.gov/submissions/CIK##########.json',
    algorithm: 'sha256',
    digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    keyDigest,
    projectionDigest,
    count,
    complete: true,
    problems: [],
    directoryUniverse: {
      schema: 'urc.sec-company-directory-universe.v1',
      source: 'https://www.sec.gov/files/company_tickers.json',
      responseStatus: 200,
      contentType: 'application/json',
      fetchedAt: '2026-08-04T00:05:00.000Z',
      lastModified: '',
      etag: '"fixture"',
      payloadBytes: 1_000_000,
      payloadSha256: createHash('sha256').update('fixture-directory-payload').digest('hex'),
      algorithm: 'sha256',
      minimumExpectedCount: 10_000,
      complete: true,
      count,
      projectionDigest,
      keyDigest,
    },
    rows,
  };
}

function passingTickerEvidence(manifest: ReturnType<typeof passingTickerManifest>) {
  const rows = manifest.rows;
  const canaryRows = Array.from({ length: 60 }, (_, index) => {
    const row = rows[Math.floor((index * rows.length) / 60)];
    return {
      ticker: row.ticker,
      officialCik: row.officialCik,
      resolvedCik: row.officialCik,
      title: row.title,
      resolvedTitle: row.title,
      deployedStatus: row.status,
      pass: true,
    };
  });
  const sourceFiles = [{
    path: 'src/services/secApi.ts',
    sha256: createHash('sha256')
      .update(readFileSync(resolve(process.cwd(), 'src/services/secApi.ts')))
      .digest('hex'),
  }];
  const canaryDigestFields = {
    expectedSha: expected.sha,
    deploymentId: expected.deploymentId,
    candidateBase: base,
    directoryProjectionDigest: manifest.projectionDigest,
    sourceFiles,
    rows: canaryRows,
  };
  return {
    resolverCikMatches: rows.length,
    candidateSearchInput: 'resolved CIK',
    independentSource: 'SEC submissions',
    independentChecks: rows.length,
    newestFilingMatches: rows.length,
    requiredHitFields: ['accession', 'form', 'file_date', 'ciks'],
    groundTruthErrors: 0,
    resolverCanary: {
      schema: 'urc.ticker-resolver-canary.v1',
      mode: 'exact-sha-product-resolver-with-bound-official-directory',
      productFunction: 'resolveCompanyInput',
      verifyFilingHistory: false,
      expectedSha: expected.sha,
      deploymentId: expected.deploymentId,
      candidateBase: base,
      directDeployedResolverRoute: false,
      dependencyScope: {
        directory: 'direct-sec-cryptographically-bound-payload',
        submissionsTruth: 'direct-sec-complete-submissions',
        search: 'immutable-candidate-api-es-search',
      },
      routeLimitation: '/api/sec-proxy is intentionally outside the staged release-token allowlist; no deployed resolver route is claimed. The exact-SHA product resolver runs locally against the cryptographically bound direct-SEC directory payload, direct-SEC submissions supplies truth, and only /api/es-search is candidate-deployed',
      directoryProjectionDigest: manifest.projectionDigest,
      sampleMethod: 'canonical-even-spread-v1',
      requested: 60,
      tested: 60,
      passed: 60,
      sourceFiles,
      rows: canaryRows,
      algorithm: 'sha256',
      digest: createHash('sha256').update(JSON.stringify(canaryDigestFields)).digest('hex'),
      pass: true,
      problems: [],
    },
  };
}

function passingUiEvidence(scope: UiActionScope) {
  const scoped = Object.entries(UI_ACTION_TEST_MAP)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actionId, references]) => ({
      actionId,
      testReferences: references
        .filter(reference => scope === 'auth'
          ? reference.file.startsWith('tests/e2e-auth/')
          : reference.file.startsWith('tests/e2e/'))
        .map(reference => ({
          ...reference,
          passed: true,
          executions: 1,
          skippedExecutions: 0,
          assertionCount: 1,
          interactionCount: 1,
          problems: [],
        }))
        .sort((left, right) => (
          `${left.file}\u0000${left.title}`.localeCompare(`${right.file}\u0000${right.title}`)
        )),
    }))
    .filter(action => action.testReferences.length > 0)
    .map(action => ({ ...action, pass: true }));
  const references = scoped.reduce((total, action) => total + action.testReferences.length, 0);
  const contentChecks = Object.entries(UI_CONTENT_TEST_MAP)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([contentId, contentReferences]) => ({
      contentId,
      testReferences: contentReferences
        .filter(reference => scope === 'auth'
          ? reference.file.startsWith('tests/e2e-auth/')
          : reference.file.startsWith('tests/e2e/'))
        .map(reference => ({
          ...reference,
          passed: true,
          executions: 1,
          skippedExecutions: 0,
          assertionCount: 1,
          interactionCount: 0,
          problems: [],
        }))
        .sort((left, right) => (
          `${left.file}\u0000${left.title}`.localeCompare(`${right.file}\u0000${right.title}`)
        )),
    }))
    .filter(content => content.testReferences.length > 0)
    .map(content => ({ ...content, pass: true }));
  const contentReferences = contentChecks.reduce(
    (total, content) => total + content.testReferences.length,
    0,
  );
  return {
    schema: UI_ACTION_EVIDENCE_SCHEMA,
    generatedAt: '2026-08-04T00:25:00.000Z',
    commitSha: expected.sha,
    scope,
    mappingDigest: uiActionMappingDigest(),
    scopedMappingDigest: uiActionMappingDigest(scope),
    contentMappingDigest: uiContentMappingDigest(),
    scopedContentMappingDigest: uiContentMappingDigest(scope),
    sourceReports: [{
      name: `${scope}.json`, runLabel: `${scope}-run`, commitSha: expected.sha,
      fullStatus: 'passed', testCount: references,
    }],
    expectedActionCount: scoped.length,
    passedActionCount: scoped.length,
    expectedTestReferenceCount: references,
    passedTestReferenceCount: references,
    actions: scoped,
    expectedContentCheckCount: contentChecks.length,
    passedContentCheckCount: contentChecks.length,
    expectedContentTestReferenceCount: contentReferences,
    passedContentTestReferenceCount: contentReferences,
    contentChecks,
    problems: [],
    pass: true,
  };
}

function passingInput(): ReleaseEvidenceInput {
  const tickerGeneratedAt = '2026-08-04T00:10:00.000Z';
  const tickerManifest = passingTickerManifest(10_000, tickerGeneratedAt);
  const e2eReplay = passingReplay();
  const semanticReplay = passingSemanticReplay();
  const semanticReplayDigest = createHash('sha256').update(JSON.stringify(semanticReplay)).digest('hex');
  const semanticChecks = passingSemanticChecks(semanticReplayDigest);
  const semanticEvidenceRows = semanticChecks.map(check => ({
    suite: check.suite,
    name: check.name,
    passed: check.passed,
    evidence: check.evidence,
  }));
  const filingEntitySelectionRows = tickerManifest.rows.slice(0, 60).map((row, index) => ({
    directoryOrdinal: index,
    ticker: row.ticker,
    officialCik: row.officialCik,
    title: row.title,
    outcome: 'selected',
    reasonCode: null,
    scoredOrdinal: index + 1,
    expectedCik: row.officialCik,
    exclusion: null,
    decisionEvidence: null,
  }));
  const schemaEvidence = validSchemaContractEvidence(expected);
  const application = {
    deploymentId: expected.deploymentId,
    sha: expected.sha,
    schemaVersion: expected.schemaVersion,
    schemaMigrationCount: expected.schemaMigrationCount,
    schemaChainChecksum: expected.schemaChainChecksum,
    schemaChecksumAlgorithm: expected.schemaChecksumAlgorithm,
    schemaDatabaseFingerprint: databaseFingerprint,
    filingSearchBackend: 'enriched',
    releaseGateNotAfter: '2026-08-04T04:00:00.000Z',
    environment: 'production',
  };
  const attestation = (generatedAt: string, minRemainingSeconds: number) => ({
    generatedAt,
    pass: true,
    base,
    expected: { ...expected },
    application: { ...application },
    vercel: {
      deploymentId: expected.deploymentId,
      url: base,
      gitSha: expected.sha,
      readyAt: '2026-08-04T00:00:00.000Z',
      createdAt: '2026-08-03T23:58:00.000Z',
      readyState: 'READY',
      readySubstate: 'STAGED',
      target: 'production',
      aliasAssigned: false,
      prebuilt: false,
      gitType: 'github',
      gitRef: 'main',
      repositoryId: expected.repositoryId,
      connectedRepositoryId: expected.repositoryId,
    },
    project: {
      id: 'prj_example',
      autoAssignCustomDomains: false,
      productionDeploymentId: 'dpl_current_production',
      gitType: 'github',
      gitRepositoryId: expected.repositoryId,
      productionBranch: 'main',
    },
    aliases: [],
    releaseGateWindow: {
      minRemainingSeconds,
      maxSecondsFromDeploymentReady: 21_600,
    },
    problems: [],
  });
  return {
    base,
    expected: { ...expected },
    expectedRepository: repository,
    semantic: {
      candidateBase: base,
      score: 100,
      threshold: 97,
      checks: semanticChecks,
      evidenceManifest: {
        algorithm: 'sha256',
        count: semanticEvidenceRows.length,
        digest: createHash('sha256').update(JSON.stringify(semanticEvidenceRows)).digest('hex'),
        rows: semanticEvidenceRows,
      },
      selectedSuites: ['entity', 'filing-entity', 'xbrl', 'boolean-deployed', 'boolean', 'equivalence', 'disclosure'],
      complete: true,
      exclusions: [],
      filingEntitySelectionManifest: {
        schema: 'urc.semantic-filing-entity-selection.v1',
        directorySource: 'https://www.sec.gov/files/company_tickers.json',
        ordering: 'canonical-ticker-cik-v1',
        directoryCount: tickerManifest.rows.length,
        directoryProjectionDigest: tickerManifest.projectionDigest,
        count: filingEntitySelectionRows.length,
        rows: filingEntitySelectionRows,
        algorithm: 'sha256',
        digest: createHash('sha256').update(JSON.stringify(filingEntitySelectionRows)).digest('hex'),
      },
      coverage: {
        entity: { target: 64, scored: 64, skipped: 0, failed: 0, examined: 64, examineLimit: 64, exclusions: 0 },
        'filing-entity': { target: 60, scored: 60, skipped: 0, failed: 0, examined: 60, examineLimit: 120, exclusions: 0 },
        xbrl: { target: 20, scored: 20, skipped: 0, failed: 0, examined: 20, examineLimit: 20, exclusions: 0 },
        'boolean-deployed': { target: 1, scored: 1, skipped: 0, failed: 0, examined: 1, examineLimit: 1, exclusions: 0 },
        boolean: { target: 5, scored: 5, skipped: 0, failed: 0, examined: 5, examineLimit: 5, exclusions: 0 },
        equivalence: { target: 8, scored: 8, skipped: 0, failed: 0, examined: 8, examineLimit: 64, exclusions: 0 },
        disclosure: { target: 160, scored: 160, skipped: 0, failed: 0, examined: 160, examineLimit: 160, exclusions: 0 },
      },
      availability: { logicalRequests: 400, httpAttempts: 400, serverErrorResponses: 0, requestErrors: 0 },
      candidateRequestBudget: { maximum: 449 },
      replay: semanticReplay,
      replayEvidenceManifest: {
        algorithm: 'sha256',
        count: semanticReplay.boolean.length + semanticReplay.booleanRejected.length
          + semanticReplay.booleanDeployedCanary.length,
        digest: semanticReplayDigest,
      },
      booleanExecutionEvidence: {
        hybridExactShaExecutor: true,
        deployedCanary: {
          required: true,
          pass: true,
          candidateBase: base,
          candidateRequests: 4,
          secEftsGet: true,
          filingTextGet: true,
          positiveValidate: true,
          negativeValidate: true,
        },
      },
    },
    tickers: {
      base,
      generatedAt: tickerGeneratedAt,
      tickers: 10_000,
      uniqueIssuers: 10_000,
      pass: 10_000,
      emptyVerified: 0,
      fail: 0,
      evidence: passingTickerEvidence(tickerManifest),
      coverageManifest: tickerManifest,
      availability: { serverErrorResponses: 0, casesWith5xx: 0, requestErrors: 0 },
    },
    e2e: {
      base,
      total: 1_000,
      totalPass: 1_000,
      availability: {
        logicalRequests: 1_000,
        httpAttempts: 1_000,
        serverErrorResponses: 0,
        casesWith5xx: 0,
        requestErrors: 0,
      },
      summary: [
        { cls: 'A', n: 450, pass: 450, passRate: 100, p95: 10 },
        { cls: 'B', n: 150, pass: 150, passRate: 100, p95: 10 },
        { cls: 'C', n: 150, pass: 150, passRate: 100, p95: 10 },
        { cls: 'D', n: 150, pass: 150, passRate: 100, p95: 10 },
        { cls: 'E', n: 20, pass: 20, passRate: 100, p95: 10 },
        { cls: 'F', n: 80, pass: 80, passRate: 100, p95: 10 },
      ],
      criticalPaths: [
        { name: 'auditor', n: 150, passRate: 100, p95: 10, serverErrorCases: 0, requestErrors: 0 },
        { name: 'topic', n: 50, passRate: 100, p95: 10, serverErrorCases: 0, requestErrors: 0 },
      ],
      sampling: {
        complete: true,
        planned: {
          total: 1_000,
          classes: { A: 450, B: 150, C: 150, D: 150, E: 20, F: 80 },
          criticalPaths: { auditor: 150, topic: 50 },
        },
        generated: { A: 450, B: 150, C: 150, D: 150, E: 20, F: 80 },
        criticalGenerated: { auditor: 150, topic: 50 },
        replay: e2eReplay,
        groundTruth: passingE2eGroundTruth(e2eReplay),
        targetPagination: {
          maxPagesPerCase: 10,
          maxLogicalCandidateRequests: 7_120,
          maxHttpCandidateAttempts: 14_240,
          maxExaminedFilings: 620_000,
          cases: 0,
          examined: 790,
        },
      },
    },
    schemaContract: {
      generatedAt: '2026-08-03T23:59:00.000Z',
      expected: {
        schemaVersion: expected.schemaVersion,
        schemaMigrationCount: expected.schemaMigrationCount,
        schemaChainChecksum: expected.schemaChainChecksum,
        schemaChecksumAlgorithm: expected.schemaChecksumAlgorithm,
      },
      databaseFingerprint,
      observedEvidenceSha256: schemaEvidenceSha256(schemaEvidence),
      evidence: schemaEvidence,
      limitations: [],
      problems: [],
      pass: true,
    },
    qualityAttestation: {
      generatedAt: '2026-08-03T23:59:30.000Z',
      repository,
      expectedSha: expected.sha,
      requiredWorkflowPaths: [
        '.github/workflows/ci.yml',
        '.github/workflows/codeql.yml',
        '.github/workflows/auth-lifecycle.yml',
      ],
      workflows: [
        '.github/workflows/ci.yml',
        '.github/workflows/codeql.yml',
        '.github/workflows/auth-lifecycle.yml',
      ].map((workflowPath, index) => ({
        workflowPath,
        workflowId: 100 + index,
        workflowState: 'active',
        runId: 1_000 + index,
        runAttempt: 1,
        runNumber: 50 + index,
        headSha: expected.sha,
        event: 'push',
        headBranch: 'main',
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-08-03T22:00:00.000Z',
        updatedAt: '2026-08-03T23:00:00.000Z',
        htmlUrl: `https://github.com/${repository}/actions/runs/${1_000 + index}`,
      })),
      codeScanning: {
        ref: 'refs/heads/main',
        expectedSha: expected.sha,
        tool: 'CodeQL',
        workflowRunId: 1_001,
        analysisBookendIds: { before: 2_001, after: 2_001 },
        analysis: {
          id: 2_001,
          ref: 'refs/heads/main',
          commitSha: expected.sha,
          analysisKey: '.github/workflows/codeql.yml:analyze',
          category: '.github/workflows/codeql.yml:analyze',
          createdAt: '2026-08-03T22:30:00.000Z',
        },
        blockedSeverities: ['critical', 'high'],
        openFindings: [],
        problems: [],
        pass: true,
      },
      limitations: [],
      problems: [],
      pass: true,
    },
    candidate: attestation('2026-08-04T00:00:00.000Z', 7_200),
    candidateFinal: attestation('2026-08-04T01:00:00.000Z', 300),
    authProbe: {
      generatedAt: '2026-08-04T00:30:00.000Z',
      pass: true,
      base,
      credential: 'renewable-ecdsa-p256-v3-path-method-bound',
      ttlSeconds: 300,
      httpAttempts: 5,
      allowlistedProbe: { path: '/api/es-search', method: 'GET', status: 200 },
      deniedProbe: { path: '/api/sec-proxy', method: 'GET', status: 401 },
      crossRouteProbe: { path: '/api/filing-text', method: 'GET', status: 403 },
      wrongMethodProbe: { path: '/api/es-search', method: 'POST', status: 404 },
      enrichPostProbe: {
        path: '/api/enrich', method: 'POST', status: 400, contentType: 'application/json', typed: true,
      },
      problems: [],
    },
    securityHeaders: passingSecurityHeaders(),
    uiBrowser: passingUiEvidence('browser'),
    uiAuth: passingUiEvidence('auth'),
    finalVersion: application,
    generatedAt: '2026-08-04T01:01:00.000Z',
  };
}

function problems(input: ReleaseEvidenceInput): string[] {
  return evaluateReleaseEvidence(input).problems as string[];
}

describe('consolidation candidate request trust', () => {
  it('does not fetch an arbitrary workflow input or any candidate whose preflight failed', async () => {
    const passing = passingInput();
    const requests: string[] = [];
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      requests.push(String(input));
      return Response.json(passing.finalVersion);
    };

    await expect(fetchTrustedCandidateVersion({
      base: 'https://attacker-controlled.vercel.app',
      expected,
      candidate: passing.candidate,
      fetchImpl,
    })).resolves.toBeNull();

    const failedCandidate = {
      ...passing.candidate,
      base: 'https://attacker-controlled.vercel.app',
      vercel: {
        ...(passing.candidate!.vercel as Record<string, unknown>),
        url: 'https://attacker-controlled.vercel.app',
      },
      pass: false,
      problems: ['candidate URL is not the expected deployment URL'],
    };
    await expect(fetchTrustedCandidateVersion({
      base: 'https://attacker-controlled.vercel.app',
      expected,
      candidate: failedCandidate,
      fetchImpl,
    })).resolves.toBeNull();

    expect(requests).toEqual([]);
  });

  it('permits the final identity read only from the exact passing preflight origin', async () => {
    const passing = passingInput();
    const requests: string[] = [];
    const fetchImpl = async (input: string | URL | Request): Promise<Response> => {
      requests.push(String(input));
      return Response.json(passing.finalVersion);
    };

    expect(trustedCandidateOriginForFinalRead({
      base,
      expected,
      candidate: passing.candidate,
    })).toBe(base);
    await expect(fetchTrustedCandidateVersion({
      base,
      expected,
      candidate: passing.candidate,
      fetchImpl,
    })).resolves.toEqual(passing.finalVersion);
    expect(requests).toEqual([`${base}/api/version`]);
  });
});

function rehashSemanticEvidence(input: ReleaseEvidenceInput) {
  const semantic = input.semantic!;
  const rows = (semantic.checks as Array<Record<string, unknown>>)
    .filter(check => check.skipped !== true)
    .map(check => ({ suite: check.suite, name: check.name, passed: check.passed, evidence: check.evidence }));
  semantic.evidenceManifest = {
    algorithm: 'sha256', count: rows.length,
    digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), rows,
  };
}

function rehashFilingEntitySelection(input: ReleaseEvidenceInput) {
  const manifest = input.semantic!.filingEntitySelectionManifest as Record<string, unknown>;
  const rows = manifest.rows as Array<Record<string, unknown>>;
  manifest.count = rows.length;
  manifest.digest = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function rehashSemanticReplay(input: ReleaseEvidenceInput) {
  const semantic = input.semantic!;
  const replay = semantic.replay as Record<string, unknown[]>;
  const digest = createHash('sha256').update(JSON.stringify(replay)).digest('hex');
  semantic.replayEvidenceManifest = {
    algorithm: 'sha256',
    count: Object.values(replay).reduce((sum, rows) => sum + rows.length, 0),
    digest,
  };
  for (const check of semantic.checks as Array<Record<string, unknown>>) {
    if (check.suite !== 'boolean' && check.suite !== 'boolean-deployed') continue;
    const evidence = check.evidence as Record<string, Record<string, unknown>>;
    evidence.actual.replayEvidenceSha256 = digest;
  }
  rehashSemanticEvidence(input);
}

function rehashE2eReplay(input: ReleaseEvidenceInput) {
  const replay = (input.e2e!.sampling as Record<string, unknown>).replay as Record<string, unknown>;
  const cases = replay.cases as Array<Record<string, unknown>>;
  replay.selectionSha256 = createHash('sha256').update(JSON.stringify(cases.map(item => ({
    caseId: item.caseId, cls: item.cls, criticalPath: item.criticalPath ?? null,
    label: item.label, requestPath: item.requestPath,
    expectedFiling: item.expectedFiling ?? null, forbiddenFiling: item.forbiddenFiling ?? null,
    oracleEvidence: item.oracleEvidence ?? null,
  })))).digest('hex');
  replay.evidenceSha256 = createHash('sha256').update(JSON.stringify(cases)).digest('hex');
}

function rehashE2eBoundaryManifest(input: ReleaseEvidenceInput) {
  const sampling = input.e2e!.sampling as Record<string, Record<string, unknown>>;
  const replay = sampling.replay;
  const cases = replay.cases as Array<Record<string, unknown>>;
  const rows = [...new Map(cases.flatMap(item => {
    const oracle = item.oracleEvidence as Record<string, unknown>;
    const boundary = oracle.boundaryOracle as Record<string, unknown> | undefined;
    return boundary ? [[String(boundary.pairId), {
      pairId: boundary.pairId,
      boundaryDate: boundary.boundaryDate,
      issuerCik: boundary.issuerCik,
      predecessor: boundary.predecessor,
      successor: boundary.successor,
      rawTransitionWitness: boundary.rawTransitionWitness,
      pair: boundary.pair,
    }] as const] : [];
  })).values()].sort((left, right) => String(left.pairId).localeCompare(String(right.pairId)));
  sampling.groundTruth.auditorBoundarySelectionManifest = {
    source: 'urc_auditor_periods_mat+urc_sec_filings+urc_sec_auditors',
    algorithm: 'sha256', count: rows.length,
    digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), rows,
  };
  rehashE2eReplay(input);
}

function rehashTickerManifest(input: ReleaseEvidenceInput) {
  const manifest = input.tickers!.coverageManifest as Record<string, unknown>;
  manifest.digest = createHash('sha256')
    .update(JSON.stringify(manifest.rows))
    .digest('hex');
}

function rehashTickerDirectoryBindings(input: ReleaseEvidenceInput) {
  const manifest = input.tickers!.coverageManifest as Record<string, unknown>;
  const rows = manifest.rows as Array<Record<string, unknown>>;
  const keys = rows.map(row => `${String(row.ticker)}\u0000${String(row.officialCik)}`);
  const projection = rows.map(row => ({
    ticker: row.ticker,
    officialCik: row.officialCik,
    title: row.title,
  }));
  const keyDigest = createHash('sha256').update(JSON.stringify(keys)).digest('hex');
  const projectionDigest = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
  manifest.keyDigest = keyDigest;
  manifest.projectionDigest = projectionDigest;
  Object.assign(manifest.directoryUniverse as Record<string, unknown>, { keyDigest, projectionDigest });
  const resolverCanary = (input.tickers!.evidence as Record<string, Record<string, unknown>>).resolverCanary;
  resolverCanary.directoryProjectionDigest = projectionDigest;
  rehashTickerManifest(input);
  rehashTickerResolverCanary(input);
}

function rehashTickerResolverCanary(input: ReleaseEvidenceInput) {
  const evidence = input.tickers!.evidence as Record<string, Record<string, unknown>>;
  const canary = evidence.resolverCanary;
  canary.digest = createHash('sha256').update(JSON.stringify({
    expectedSha: canary.expectedSha,
    deploymentId: canary.deploymentId,
    candidateBase: canary.candidateBase,
    directoryProjectionDigest: canary.directoryProjectionDigest,
    sourceFiles: canary.sourceFiles,
    rows: canary.rows,
  })).digest('hex');
}

describe('immutable release evidence gate', () => {
  it('passes only when every independent dimension and identity passes', () => {
    const evidence = evaluateReleaseEvidence(passingInput());
    expect(evidence.problems).toEqual([]);
    expect(evidence.pass).toBe(true);
    expect(evidence.base).toBe(base);
    expect(evidence.candidateDeploymentId).toBe(expected.deploymentId);
  });

  it('enforces 97% semantic accuracy and zero critical skips', () => {
    const input = passingInput();
    input.semantic = {
      score: 96.9,
      threshold: 90,
      checks: [
        { suite: 'boolean', passed: false, skipped: true },
        { suite: 'filing-entity', passed: true },
      ],
    };

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('semantic score 96.9% is below required 97%'),
      expect.stringContaining('runner threshold 90% is weaker'),
      expect.stringContaining("critical semantic suite 'boolean' produced no scored checks"),
      expect.stringContaining("critical semantic suite 'boolean' skipped 1 check"),
    ]));
  });

  it('blocks a filing-entity sample that cannot fill its scored target', () => {
    const input = passingInput();
    const semantic = input.semantic!;
    semantic.checks = [
      ...(semantic.checks as Array<Record<string, unknown>>),
      { suite: 'filing-entity', name: 'scoreable sample reaches 60', passed: false },
    ];
    semantic.coverage = {
      ...(semantic.coverage as Record<string, unknown>),
      'filing-entity': { target: 60, scored: 59, skipped: 0, examined: 120, examineLimit: 120, exclusions: 61 },
    };

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining("critical semantic suite 'filing-entity' failed 1 scored check"),
      expect.stringContaining("semantic suite 'filing-entity' coverage scored 59/60 with 0 skips after examining 120/120"),
    ]));
  });

  it('blocks a collapsed semantic truth suite even when the aggregate remains above 97%', () => {
    const input = passingInput();
    (input.semantic!.coverage as Record<string, Record<string, unknown>>).equivalence.failed = 8;
    for (const check of input.semantic!.checks as Array<Record<string, unknown>>) {
      if (check.suite === 'equivalence') check.passed = false;
    }
    input.semantic!.score = 97.4;

    expect(problems(input)).toContain("semantic suite 'equivalence' pass rate 0.0% is below 100%");
  });

  it('reconciles raw semantic checks with every claimed coverage denominator', () => {
    const input = passingInput();
    input.semantic!.checks = (input.semantic!.checks as Array<Record<string, unknown>>)
      .filter(check => check.suite !== 'xbrl');

    expect(problems(input)).toContain(
      "semantic suite 'xbrl' raw checks (0 scored, 0 failed, 0 skipped) do not match reported coverage (20 scored, 0 failed, 0 skipped)",
    );
  });

  it('binds semantic deployed-path evidence to the immutable candidate origin', () => {
    const input = passingInput();
    input.semantic!.candidateBase = 'https://different.vercel.app';

    expect(problems(input)).toContain(
      `semantic suite targeted https://different.vercel.app, expected immutable candidate ${base}`,
    );
  });

  it('requires real immutable filing-text and Boolean-validation canary outcomes', () => {
    const input = passingInput();
    const evidence = input.semantic!.booleanExecutionEvidence as Record<string, unknown>;
    const canary = evidence.deployedCanary as Record<string, unknown>;
    canary.candidateBase = 'https://different.vercel.app';
    canary.negativeValidate = false;

    expect(problems(input)).toContain(
      'semantic report did not prove the four-request immutable Boolean route canary',
    );
  });

  it.each([
    ['cross-suite kind', (check: Record<string, unknown>) => {
      const evidence = check.evidence as Record<string, Record<string, unknown>>;
      evidence.target.kind = 'entity-ticker';
      evidence.expected = { ticker: 'AAPL' };
      evidence.actual = { ticker: 'AAPL' };
    }, 'xbrl-latest-annual'],
    ['null entity values', (check: Record<string, unknown>) => {
      const evidence = check.evidence as Record<string, Record<string, unknown>>;
      evidence.expected = { ticker: null };
      evidence.actual = { ticker: null };
    }, 'entity-ticker'],
    ['CIK zero filing resolver', (check: Record<string, unknown>) => {
      const evidence = check.evidence as Record<string, unknown> & { target: Record<string, unknown>; expected: Record<string, unknown>; actual: Record<string, unknown> };
      evidence.target.expectedCik = '0';
      evidence.expected.resolvedCik = '0';
      evidence.actual.resolvedCik = '0';
      evidence.sourceUrls = [
        'https://www.sec.gov/files/company_tickers.json',
        'https://data.sec.gov/submissions/CIK0000000000.json',
        `${base}/api/es-search?cik=0&forms=10-K%2C20-F%2C40-F&size=1`,
      ];
    }, 'filing-entity'],
    ['wrong candidate origin', (check: Record<string, unknown>) => {
      const evidence = check.evidence as Record<string, unknown>;
      evidence.sourceUrls = (evidence.sourceUrls as string[]).map(url => (
        url.includes('/api/es-search?') ? url.replace(base, 'https://evil.test') : url
      ));
    }, 'filing-entity'],
    ['unrelated XBRL tag and null value', (check: Record<string, unknown>) => {
      const evidence = check.evidence as Record<string, unknown> & { expected: Record<string, unknown>; actual: Record<string, unknown> };
      evidence.sourceUrls = ['https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json', 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000320193/us-gaap/Assets.json'];
      evidence.expected.candidates = [{ tag: 'Assets', val: null, end: '2026-01-01', form: '10-K', fp: 'FY' }];
      evidence.actual.value = 0;
    }, 'xbrl-latest-annual'],
    ['coerced equivalence count', (check: Record<string, unknown>) => {
      const evidence = check.evidence as Record<string, Record<string, unknown>>;
      evidence.expected.agreements = null;
      evidence.actual.agreements = null;
    }, 'equivalence-agreement'],
    ['invented disclosure term', (check: Record<string, unknown>) => {
      const evidence = check.evidence as Record<string, Record<string, unknown>>;
      evidence.expected.mustContain = ['the'];
      evidence.actual.hit = 'the';
      evidence.actual.matchKind = 'made-up';
    }, 'disclosure-topic'],
  ])('rejects malformed semantic evidence: %s', (_label, mutate, kind) => {
    const input = passingInput();
    const check = (input.semantic!.checks as Array<Record<string, unknown>>).find(item => (
      (item.evidence as Record<string, Record<string, unknown>>).target.kind === kind
    ))!;
    mutate(check);
    rehashSemanticEvidence(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid structured oracle/observation record'),
    ]));
  });

  it.each([
    ['resolved topic URL', 'disclosure-topic', 'resolved-annual-document', (evidence: Record<string, Record<string, unknown>>) => {
      const scored = evidence.target.scoredSource as Record<string, unknown>;
      scored.url = 'https://www.sec.gov/Archives/edgar/data/1/000000000126000001/other.htm';
    }],
    ['block selector digest', 'disclosure-topic', 'filing-summary-block', (evidence: Record<string, Record<string, unknown>>) => {
      const scored = evidence.target.scoredSource as Record<string, Record<string, unknown>>;
      scored.selectorSource.payloadSha256 = '0'.repeat(64);
      scored.selectorSource.url = `${base}/forged-FilingSummary.xml`;
    }],
    ['auditor raw HTML digest', 'disclosure-auditor', 'resolved-annual-document', (evidence: Record<string, Record<string, unknown>>) => {
      evidence.actual.sourceHtmlSha256 = 'f'.repeat(64);
    }],
  ])('rejects rehashed disclosure source provenance forgery: %s', (_label, kind, sourceKind, mutate) => {
    const input = passingInput();
    const check = (input.semantic!.checks as Array<Record<string, unknown>>).find(item => {
      const target = (item.evidence as Record<string, Record<string, unknown>>).target;
      const scored = target.scoredSource as Record<string, unknown> | undefined;
      return target.kind === kind && scored?.kind === sourceKind;
    })!;
    mutate(check.evidence as Record<string, Record<string, unknown>>);
    rehashSemanticEvidence(input);
    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid structured oracle/observation record'),
    ]));
  });

  it('rejects individually valid disclosure rows cherry-picked from different filings for one issuer', () => {
    const input = passingInput();
    const check = (input.semantic!.checks as Array<Record<string, unknown>>).find(item => {
      const target = (item.evidence as Record<string, Record<string, unknown>>).target;
      return target.kind === 'disclosure-topic'
        && target.ticker === ISSUERS[0].ticker
        && (target.scoredSource as Record<string, unknown>).kind === 'resolved-annual-document';
    })!;
    const evidence = check.evidence as Record<string, unknown> & {
      sourceUrls: string[];
      target: Record<string, unknown>;
    };
    const target = evidence.target;
    const accession = `${ISSUERS[0].cik.padStart(10, '0')}26000002`;
    const directory = `https://www.sec.gov/Archives/edgar/data/${Number(ISSUERS[0].cik)}/${accession}`;
    target.accession = accession;
    (target.scoredSource as Record<string, unknown>).url = `${directory}/${String(target.resolvedDocument)}`;
    evidence.sourceUrls = [
      `${directory}/${String(target.document)}`,
      `${directory}/${String(target.resolvedDocument)}`,
    ];
    rehashSemanticEvidence(input);

    expect(problems(input)).toContain(
      `semantic disclosure sample must bind all topic/auditor evidence for ${ISSUERS[0].ticker} to one filing and coherent source manifests`,
    );
  });

  it('derives Boolean case verdicts from detailed replay instead of trusting a rehashed pass flag', () => {
    const input = passingInput();
    const replay = input.semantic!.replay as Record<string, Array<Record<string, unknown>>>;
    const union = replay.boolean.find(row => row.query === booleanFixtures[0].query && row.role == null)!;
    union.branchWitnesses = Object.fromEntries(booleanFixtures[0].branches.map(branch => [branch, []]));
    rehashSemanticReplay(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      'semantic Boolean case verdict is not derivable as passing from its canonical detailed replay',
      expect.stringContaining('invalid structured oracle/observation record'),
    ]));
  });

  it('rejects junk-wrapped Boolean witness accessions after replay rehashing', () => {
    const input = passingInput();
    const replay = input.semantic!.replay as Record<string, Array<Record<string, unknown>>>;
    const union = replay.boolean.find(row => row.query === booleanFixtures[0].query && row.role == null)!;
    const witnesses = union.branchWitnesses as Record<string, string[]>;
    witnesses[booleanFixtures[0].branches[0]][0] = `junk-${witnesses[booleanFixtures[0].branches[0]][0]}`;
    rehashSemanticReplay(input);

    expect(problems(input)).toContain(
      'semantic Boolean case verdict is not derivable as passing from its canonical detailed replay',
    );
  });

  it('rejects contradictory full filing metadata for a repeated Boolean accession', () => {
    const input = passingInput();
    const replay = input.semantic!.replay as Record<string, Array<Record<string, unknown>>>;
    const branch = replay.boolean.find(row => row.role === 'or-branch-window')!;
    const branchResults = branch.results as Array<Record<string, unknown>>;
    branchResults[0] = { ...branchResults[0], fileDate: '2026-02-01' };
    rehashSemanticReplay(input);

    expect(problems(input)).toContain(
      'semantic Boolean detail replay reuses an accession with contradictory CIK/form/date/document/text evidence',
    );
  });

  it('binds the deployed Boolean replay target to the exact structured semantic target', () => {
    const input = passingInput();
    const check = (input.semantic!.checks as Array<Record<string, unknown>>)
      .find(row => row.suite === 'boolean-deployed')!;
    const evidence = check.evidence as Record<string, unknown> & {
      target: Record<string, unknown>; sourceUrls: string[];
    };
    evidence.target.cik = '2';
    evidence.target.accession = '000000000226000001';
    evidence.sourceUrls = [
      `${base}/api/boolean-validate`,
      'https://www.sec.gov/Archives/edgar/data/2/000000000226000001/filing.htm',
    ];
    rehashSemanticEvidence(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid structured oracle/observation record'),
    ]));
  });

  it.each([
    ['negative', -1, 64],
    ['fractional', 63.5, 64],
    ['less than scored', 63, 64],
    ['invalid limit', 64, 0],
  ])('rejects %s semantic examined/examineLimit counters', (_label, examined, examineLimit) => {
    const input = passingInput();
    const coverage = input.semantic!.coverage as Record<string, Record<string, unknown>>;
    coverage.entity.examined = examined;
    coverage.entity.examineLimit = examineLimit;
    expect(problems(input)).toContain(
      `semantic suite 'entity' coverage scored 64/64 with 0 skips after examining ${examined}/${examineLimit}; required exact target is 64`,
    );
  });

  it('rejects self-rehashed filing-entity ordinals outside the exact examined canonical prefix', () => {
    const input = passingInput();
    const filingChecks = (input.semantic!.checks as Array<Record<string, unknown>>)
      .filter(check => check.suite === 'filing-entity');
    for (const [index, check] of filingChecks.entries()) {
      const target = (check.evidence as Record<string, Record<string, unknown>>).target;
      const selection = target.selection as Record<string, unknown>;
      selection.directoryOrdinal = 1_002 + index * 2;
      selection.replacementCountBefore = 1_002 + index * 2 - index;
    }
    const manifest = input.semantic!.filingEntitySelectionManifest as Record<string, unknown>;
    for (const [index, row] of (manifest.rows as Array<Record<string, unknown>>).entries()) {
      row.directoryOrdinal = 1_002 + index * 2;
    }
    rehashFilingEntitySelection(input);
    rehashSemanticEvidence(input);

    expect(problems(input)).toContain(
      'semantic filing-entity examined selection/exclusion trace does not exactly reconcile canonical directory order and coverage counters',
    );
  });

  it('binds equivalence candidate ordinals to the exact first four fixed ISSUERS without replacements', () => {
    const input = passingInput();
    const ordinals = [10, 20, 30, 40];
    for (const check of input.semantic!.checks as Array<Record<string, unknown>>) {
      if (check.suite !== 'equivalence') continue;
      const target = (check.evidence as Record<string, Record<string, unknown>>).target;
      const selection = target.selection as Record<string, unknown>;
      const scoredIndex = Number(selection.scoredOrdinal) - 1;
      selection.candidateOrdinal = ordinals[scoredIndex];
      selection.replacementCountBefore = ordinals[scoredIndex] - scoredIndex;
    }
    rehashSemanticEvidence(input);
    expect(problems(input)).toContain(
      'semantic equivalence sample does not prove deterministic first-scoreable issuer selection',
    );

    const wrongForm = passingInput();
    const equivalenceCheck = (wrongForm.semantic!.checks as Array<Record<string, unknown>>)
      .find(check => check.suite === 'equivalence')!;
    (equivalenceCheck.evidence as Record<string, Record<string, unknown>>).target.form = '8-K';
    rehashSemanticEvidence(wrongForm);
    expect(problems(wrongForm)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid structured oracle/observation record'),
    ]));

    const excluded = passingInput();
    excluded.semantic!.exclusions = [{
      suite: 'equivalence', name: 'AAPL 10-K',
      detail: 'document fetch failed; replaced by next deterministic issuer',
    }];
    const coverage = excluded.semantic!.coverage as Record<string, Record<string, unknown>>;
    coverage.equivalence.examined = 9;
    coverage.equivalence.exclusions = 1;
    expect(problems(excluded)).toContain(
      'semantic equivalence release sample must use the exact first four ISSUERS with zero replacement exclusions',
    );
  });

  it('binds accession CIK prefixes and accession years to filing dates across release evidence', () => {
    const semantic = passingInput();
    const filingCheck = (semantic.semantic!.checks as Array<Record<string, unknown>>)
      .find(check => check.suite === 'filing-entity')!;
    const filingTarget = (filingCheck.evidence as Record<string, Record<string, unknown>>).target;
    const submissions = filingTarget.officialSubmissions as Record<string, unknown>;
    (submissions.annualFilings as Array<Record<string, unknown>>)[0].filingDate = '2099-01-01';
    submissions.annualEvidenceSha256 = createHash('sha256').update(JSON.stringify({
      requestedCik: submissions.requestedCik,
      responseCik: submissions.responseCik,
      annualFilings: submissions.annualFilings,
    })).digest('hex');
    rehashSemanticEvidence(semantic);
    expect(problems(semantic)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid structured oracle/observation record'),
    ]));

    const equivalence = passingInput();
    for (const check of equivalence.semantic!.checks as Array<Record<string, unknown>>) {
      if (check.suite === 'equivalence') {
        (check.evidence as Record<string, Record<string, unknown>>).target.date = '2099-01-01';
      }
    }
    rehashSemanticEvidence(equivalence);
    expect(problems(equivalence)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid structured oracle/observation record'),
    ]));

    const disclosure = passingInput();
    for (const check of disclosure.semantic!.checks as Array<Record<string, unknown>>) {
      const target = (check.evidence as Record<string, Record<string, unknown>>).target;
      if (check.suite === 'disclosure' && target.ticker === ISSUERS[0].ticker) target.date = '2099-01-01';
    }
    rehashSemanticEvidence(disclosure);
    expect(problems(disclosure)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid structured oracle/observation record'),
    ]));

    const ticker = passingInput();
    const tickerManifest = ticker.tickers!.coverageManifest as Record<string, unknown>;
    const tickerRow = (tickerManifest.rows as Array<Record<string, unknown>>)[1];
    (tickerRow.candidatePage as Array<Record<string, unknown>>)[0].filingDate = '2099-01-01';
    (tickerRow.secExpectedPage as Array<Record<string, unknown>>)[0].filingDate = '2099-01-01';
    tickerRow.candidateNewestDate = '2099-01-01';
    tickerRow.secNewestDate = '2099-01-01';
    rehashTickerManifest(ticker);
    expect(problems(ticker)).toEqual(expect.arrayContaining([
      expect.stringContaining('ticker coverage manifest has 1 invalid row'),
    ]));

    const replay = passingInput();
    const replayManifest = (replay.e2e!.sampling as Record<string, unknown>).replay as Record<string, unknown>;
    const classA = (replayManifest.cases as Array<Record<string, unknown>>).find(item => item.cls === 'A')!;
    (classA.oracleEvidence as Record<string, unknown>).dateFiled = '2099-01-01';
    (classA.expectedFiling as Record<string, unknown>).dateFiled = '2099-01-01';
    rehashE2eReplay(replay);
    expect(problems(replay)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid oracle evidence record'),
    ]));
  });

  it('rejects a self-rehashed successor correction that contradicts the raw EDGAR Atom returned CIK', () => {
    const input = passingInput();
    const check = (input.semantic!.checks as Array<Record<string, unknown>>)
      .find(item => item.suite === 'filing-entity')!;
    const evidence = check.evidence as Record<string, unknown> & {
      sourceUrls: string[];
      target: Record<string, unknown>;
      expected: Record<string, unknown>;
      actual: Record<string, unknown>;
    };
    const target = evidence.target;
    const ticker = String(target.ticker);
    const atomUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=1&output=atom`;
    const payloadText = '<feed><company-info><cik>1</cik></company-info></feed>';
    target.expectedCik = '9999';
    target.resolutionMode = 'edgar-successor-correction';
    target.officialHasAnnual = false;
    target.officialSubmissions = passingSubmissionsWitness('1', false);
    target.edgarCorrection = {
      required: true,
      reachable: true,
      resolvedCik: '9999',
      candidateHasAnnual: true,
      atomEvidence: {
        sourceUrl: atomUrl,
        responseStatus: 200,
        contentType: 'application/atom+xml',
        payloadBytes: Buffer.byteLength(payloadText),
        payloadSha256: createHash('sha256').update(payloadText).digest('hex'),
        payloadText,
        returnedCik: '9999',
      },
      candidateSubmissions: passingSubmissionsWitness('9999', true),
    };
    evidence.sourceUrls = [
      'https://www.sec.gov/files/company_tickers.json',
      'https://data.sec.gov/submissions/CIK0000000001.json',
      atomUrl,
      'https://data.sec.gov/submissions/CIK0000009999.json',
      `${base}/api/es-search?cik=9999&forms=10-K%2C20-F%2C40-F&size=1`,
    ];
    evidence.expected.resolvedCik = '9999';
    evidence.actual.resolvedCik = '9999';
    const selectionManifest = input.semantic!.filingEntitySelectionManifest as Record<string, unknown>;
    (selectionManifest.rows as Array<Record<string, unknown>>)[0].expectedCik = '9999';
    rehashFilingEntitySelection(input);
    rehashSemanticEvidence(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid structured oracle/observation record'),
    ]));
  });

  it('rejects a canonical replacement backed by a structurally valid self-hashed SEC 503 response', () => {
    const input = passingInput();
    const tickerRows = (input.tickers!.coverageManifest as Record<string, unknown>)
      .rows as Array<Record<string, unknown>>;
    const filingChecks = (input.semantic!.checks as Array<Record<string, unknown>>)
      .filter(check => check.suite === 'filing-entity');
    for (const [index, check] of filingChecks.entries()) {
      const row = tickerRows[index + 1];
      const evidence = check.evidence as Record<string, unknown> & {
        sourceUrls: string[];
        target: Record<string, unknown>;
        expected: Record<string, unknown>;
        actual: Record<string, unknown>;
      };
      const cik = String(row.officialCik);
      evidence.target = {
        kind: 'filing-entity', ticker: row.ticker,
        officialCik: cik, expectedCik: cik,
        resolutionMode: 'official-directory-cik', officialHasAnnual: true,
        officialSubmissions: passingSubmissionsWitness(cik, true),
        edgarCorrection: {
          required: false, reachable: false, resolvedCik: null, candidateHasAnnual: false,
          atomEvidence: null, candidateSubmissions: null,
        },
        selection: { directoryOrdinal: index + 1, scoredOrdinal: index + 1, replacementCountBefore: 1 },
      };
      evidence.expected = { resolvedCik: cik, deployedAnnual: true };
      evidence.actual = { resolvedCik: cik, deployedAnnual: true };
      evidence.sourceUrls = [
        'https://www.sec.gov/files/company_tickers.json',
        `https://data.sec.gov/submissions/CIK${cik.padStart(10, '0')}.json`,
        `${base}/api/es-search?cik=${cik}&forms=10-K%2C20-F%2C40-F&size=1`,
      ];
    }
    const exclusion = {
      suite: 'filing-entity', name: 'T00001 submissions',
      detail: 'unreachable; replaced by next deterministic directory row',
    };
    input.semantic!.exclusions = [exclusion];
    const coverage = input.semantic!.coverage as Record<string, Record<string, unknown>>;
    coverage['filing-entity'].examined = 61;
    coverage['filing-entity'].exclusions = 1;
    const manifest = input.semantic!.filingEntitySelectionManifest as Record<string, unknown>;
    const failurePayload = 'temporarily unavailable';
    manifest.rows = [
      {
        directoryOrdinal: 0,
        ticker: tickerRows[0].ticker,
        officialCik: tickerRows[0].officialCik,
        title: tickerRows[0].title,
        outcome: 'excluded',
        reasonCode: 'official-submissions-unreachable',
        scoredOrdinal: null,
        expectedCik: null,
        exclusion: { name: exclusion.name, detail: exclusion.detail },
        decisionEvidence: {
          officialSubmissionsFailure: {
            sourceUrl: 'https://data.sec.gov/submissions/CIK0000000001.json',
            responseStatus: 503,
            contentType: 'text/plain',
            payloadBytes: Buffer.byteLength(failurePayload),
            payloadSha256: createHash('sha256').update(failurePayload).digest('hex'),
            payloadText: failurePayload,
          },
        },
      },
      ...tickerRows.slice(1, 61).map((row, index) => ({
        directoryOrdinal: index + 1,
        ticker: row.ticker,
        officialCik: row.officialCik,
        title: row.title,
        outcome: 'selected',
        reasonCode: null,
        scoredOrdinal: index + 1,
        expectedCik: row.officialCik,
        exclusion: null,
        decisionEvidence: null,
      })),
    ];
    rehashFilingEntitySelection(input);
    rehashSemanticEvidence(input);

    const observed = problems(input);
    expect(observed).toContain(
      'semantic filing-entity release sample cannot replace a canonical row because of an upstream HTTP failure',
    );
    expect(observed).not.toContain(
      'semantic filing-entity examined selection/exclusion trace does not exactly reconcile canonical directory order and coverage counters',
    );
  });

  it('blocks a retry-hidden HTTP 5xx even when every logical case ultimately passes', () => {
    const input = passingInput();
    const e2e = input.e2e!;
    e2e.availability = {
      logicalRequests: 1_001,
      httpAttempts: 1_002,
      serverErrorResponses: 1,
      casesWith5xx: 1,
      requestErrors: 0,
    };

    expect(problems(input)).toContain(
      'e2e suite observed 1 HTTP 5xx response(s) — release requires zero, including retry-hidden responses',
    );
  });

  it('binds exact replay cases, outcomes, selection digest, and database watermark', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, unknown>).replay as Record<string, unknown>;
    replay.selectionSha256 = '0'.repeat(64);
    const cases = replay.cases as Array<Record<string, unknown>>;
    cases[1].caseId = cases[0].caseId;
    (cases[2].outcome as Record<string, unknown>).pass = false;
    cases[3].cls = 'F';
    delete (cases[4].oracleEvidence as Record<string, unknown>).accession;
    delete (replay.databaseWatermark as Record<string, unknown>).rawFormAp;

    expect(problems(input)).toEqual(expect.arrayContaining([
      'e2e replay manifest case IDs are missing or duplicated',
      'e2e replay manifest selection digest does not match its cases',
      'e2e replay outcomes contain 999 passes, report totalPass is 1000',
      'e2e replay manifest did not bind a complete database watermark',
      expect.stringContaining('e2e replay class A contains 449 cases/448 passes'),
      expect.stringContaining('e2e replay class F contains 81 cases/81 passes'),
      expect.stringContaining('invalid oracle evidence record'),
    ]));
  });

  it.each([
    ['filing watermark', (watermark: Record<string, Record<string, unknown>>) => {
      (watermark.filings.latest as Record<string, unknown>).cik = 2;
    }],
    ['comment-letter watermark', (watermark: Record<string, Record<string, unknown>>) => {
      (watermark.commentLetters.latest as Record<string, unknown>).date_filed = '2025-08-03';
    }],
  ])('rejects a self-rehashed %s with a mismatched accession/CIK/date identity', (_label, mutate) => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    mutate(replay.databaseWatermark as Record<string, Record<string, unknown>>);
    rehashE2eReplay(input);

    expect(problems(input)).toContain(
      'e2e replay manifest did not bind a complete database watermark',
    );
  });

  it('rejects exact-but-stale source watermarks and a stale raw Form AP high-water mark', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    const watermark = replay.databaseWatermark as Record<string, Record<string, unknown>>;
    watermark.filings.latest = {
      accession: '0000000001-17-000001', cik: 1, date_filed: '2017-01-01',
    };
    watermark.commentLetters.latest = {
      accession: '0000000001-17-000002', cik: 1, date_filed: '2017-01-01',
      thread_id: '1:2017-01-01', review_key: null,
    };
    watermark.rawFormAp.latest = { form_filing_id: 1, filing_date: '2017-01-01' };
    rehashE2eReplay(input);

    expect(problems(input)).toContain(
      'e2e replay manifest did not bind a complete database watermark',
    );
  });

  it('rejects a comment-letter watermark whose thread prefix contradicts its exact CIK', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    const watermark = replay.databaseWatermark as Record<string, Record<string, unknown>>;
    const latest = watermark.commentLetters.latest as Record<string, unknown>;
    latest.thread_id = '999:review-key';
    latest.review_key = 'review-key';
    rehashE2eReplay(input);

    expect(problems(input)).toContain(
      'e2e replay manifest did not bind a complete database watermark',
    );
  });

  it('rejects a date-fallback watermark thread when migration evidence carries a review key', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    const watermark = replay.databaseWatermark as Record<string, Record<string, unknown>>;
    const latest = watermark.commentLetters.latest as Record<string, unknown>;
    latest.review_key = 'review-deadbeef';
    rehashE2eReplay(input);

    expect(problems(input)).toContain(
      'e2e replay manifest did not bind a complete database watermark',
    );
  });

  it('rejects a date-fallback Class C thread whose direct-table row carries a review key', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    const thread = (replay.cases as Array<Record<string, unknown>>).find(item => (
      item.cls === 'C' && item.criticalPath === null
    ))!;
    const oracle = thread.oracleEvidence as Record<string, unknown>;
    ((oracle.letters as Array<Record<string, unknown>>)[0]).review_key = 'review-deadbeef';
    rehashE2eReplay(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid oracle evidence record'),
    ]));
  });

  it('rejects exact nested comment-letter dates after the captured watermark', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    const thread = (replay.cases as Array<Record<string, unknown>>).find(item => (
      item.cls === 'C' && item.criticalPath === null
    ))!;
    const oracle = thread.oracleEvidence as Record<string, unknown>;
    const letter = (oracle.letters as Array<Record<string, unknown>>)[0];
    const cik = String(letter.cik);
    const accession = `${cik.padStart(10, '0')}99000001`;
    letter.accession = accession;
    letter.date_filed = '2099-01-01';
    oracle.threadId = `${cik}:2099-01-01`;
    thread.requestPath = `/api/letters?thread=${encodeURIComponent(String(oracle.threadId))}`;
    const page = ((thread.observation as Record<string, unknown>).pages as Array<Record<string, unknown>>)[0];
    const projection = page.projection as Record<string, unknown>;
    projection.thread = oracle.threadId;
    const projectedLetter = (projection.letters as Array<Record<string, unknown>>)[0];
    projectedLetter.accession = accession;
    projectedLetter.date_filed = '2099-01-01';
    page.projectionSha256 = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
    rehashE2eReplay(input);

    expect(problems(input)).toContain(
      'e2e replay contains ground-truth dates after its captured database watermark',
    );
  });

  it('fails closed when availability counters are absent', () => {
    const input = passingInput();
    delete input.tickers!.availability;
    delete input.e2e!.availability;

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('ticker suite did not report availability counters'),
      expect.stringContaining('e2e suite did not report availability counters'),
    ]));
  });

  it('requires a complete canonical ticker PASS/EMPTY_VERIFIED manifest with a matching digest', () => {
    const missing = passingInput();
    delete missing.tickers!.coverageManifest;
    expect(problems(missing)).toContain('ticker suite did not provide a full PASS/EMPTY_VERIFIED coverage manifest');

    const tampered = passingInput();
    const manifest = tampered.tickers!.coverageManifest as Record<string, unknown>;
    const rows = manifest.rows as Array<Record<string, unknown>>;
    rows[0].resolvedCik = '999999';
    rows.pop();
    expect(problems(tampered)).toEqual(expect.arrayContaining([
      'ticker coverage manifest contains 9999/10000 official directory rows',
      'ticker coverage manifest digest does not match its rows',
      expect.stringContaining('ticker coverage manifest has 1 invalid row(s)'),
    ]));
  });

  it('independently binds ticker rows to the complete SEC directory universe and SEC archive provenance', () => {
    const input = passingInput();
    const manifest = input.tickers!.coverageManifest as Record<string, unknown>;
    const directory = manifest.directoryUniverse as Record<string, unknown>;
    const rows = manifest.rows as Array<Record<string, unknown>>;
    directory.projectionDigest = '1'.repeat(64);
    directory.keyDigest = '2'.repeat(64);
    manifest.projectionDigest = directory.projectionDigest;
    manifest.keyDigest = directory.keyDigest;
    manifest.complete = false;
    manifest.problems = ['forged producer warning'];
    rows[1].secSourceCik = '999999';
    rows[1].secArchivePlanComplete = false;
    rows[1].secArchiveEvidence = [{
      name: 'foreign-submissions.json', filingTo: '2026-01-01', declaredFilings: 1, observedFilings: 0,
    }];
    rehashTickerManifest(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      'ticker coverage manifest did not report complete coverage with an empty problems array',
      expect.stringContaining('ticker coverage manifest has 1 invalid row'),
      'ticker coverage key/projection digests do not bind the complete official directory universe',
    ]));
  });

  it.each([
    ['candidate identity', (canary: Record<string, unknown>) => { canary.deploymentId = 'dpl_forged'; }],
    ['direct deployed overclaim', (canary: Record<string, unknown>) => { canary.directDeployedResolverRoute = true; }],
    ['checked-out source hash', (canary: Record<string, unknown>) => {
      (canary.sourceFiles as Array<Record<string, unknown>>)[0].sha256 = 'f'.repeat(64);
    }],
    ['sample row result', (canary: Record<string, unknown>) => {
      const row = (canary.rows as Array<Record<string, unknown>>)[0];
      row.resolvedCik = '999999';
      row.pass = true;
    }],
    ['producer pass flag/problems', (canary: Record<string, unknown>) => {
      canary.pass = true;
      canary.problems = ['ignored failure'];
    }],
  ])('rejects a self-rehashed ticker resolver canary forgery: %s', (_label, mutate) => {
    const input = passingInput();
    const evidence = input.tickers!.evidence as Record<string, Record<string, unknown>>;
    mutate(evidence.resolverCanary);
    rehashTickerResolverCanary(input);

    expect(problems(input)).toContain(
      'ticker resolver canary is missing, forged, or inconsistent with the exact SHA, candidate, source hash, and full directory evidence',
    );
  });

  it('derives unique issuer and newest-filing counters from manifest CIK groups', () => {
    const input = passingInput();
    const evidence = input.tickers!.evidence as Record<string, unknown>;
    input.tickers!.uniqueIssuers = 9_999;
    evidence.independentChecks = 9_999;
    evidence.newestFilingMatches = 9_999;
    expect(problems(input)).toContain(
      'ticker resolver canary is missing, forged, or inconsistent with the exact SHA, candidate, source hash, and full directory evidence',
    );

    const newestOnly = passingInput();
    (newestOnly.tickers!.evidence as Record<string, unknown>).newestFilingMatches = 9_999;
    expect(problems(newestOnly)).toContain(
      'ticker resolver canary is missing, forged, or inconsistent with the exact SHA, candidate, source hash, and full directory evidence',
    );
  });

  it('rejects primitive extras hidden by resolver-canary object filtering', () => {
    const input = passingInput();
    const evidence = input.tickers!.evidence as Record<string, Record<string, unknown>>;
    (evidence.resolverCanary.rows as unknown[]).push(null);
    (evidence.resolverCanary.sourceFiles as unknown[]).push('forged');
    rehashTickerResolverCanary(input);
    expect(problems(input)).toContain(
      'ticker resolver canary is missing, forged, or inconsistent with the exact SHA, candidate, source hash, and full directory evidence',
    );
  });

  it('rejects internally consistent ticker filing rows with a foreign accession CIK prefix', () => {
    const input = passingInput();
    const manifest = input.tickers!.coverageManifest as Record<string, unknown>;
    const row = (manifest.rows as Array<Record<string, unknown>>)[1];
    const foreign = '000000999926000001';
    const display = '0000009999-26-000001';
    const candidatePage = row.candidatePage as Array<Record<string, unknown>>;
    const secPage = row.secExpectedPage as Array<Record<string, unknown>>;
    candidatePage[0].accession = foreign;
    secPage[0].accession = foreign;
    row.candidateNewestAccession = display;
    row.secNewestAccessions = [display];
    rehashTickerManifest(input);
    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('ticker coverage manifest has 1 invalid row'),
    ]));
  });

  it('requires SEC newest-accession truth to include every same-date expected-page filing', () => {
    const input = passingInput();
    const manifest = input.tickers!.coverageManifest as Record<string, unknown>;
    const row = (manifest.rows as Array<Record<string, unknown>>)[0];
    (row.candidatePage as Array<Record<string, unknown>>)[1].filingDate = row.secNewestDate;
    (row.secExpectedPage as Array<Record<string, unknown>>)[1].filingDate = row.secNewestDate;
    rehashTickerManifest(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('ticker coverage manifest has 1 invalid row'),
    ]));
  });

  it('rejects a fabricated newest accession beyond a complete SEC expected page', () => {
    const input = passingInput();
    const manifest = input.tickers!.coverageManifest as Record<string, unknown>;
    const row = (manifest.rows as Array<Record<string, unknown>>)[0];
    (row.secNewestAccessions as string[]).push('0000000001-26-999999');
    rehashTickerManifest(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('ticker coverage manifest has 1 invalid row'),
    ]));
  });

  it('rejects self-rehashed ticker aliases that contradict SEC truth for the same official CIK', () => {
    const input = passingInput();
    const manifest = input.tickers!.coverageManifest as Record<string, unknown>;
    const rows = manifest.rows as Array<Record<string, unknown>>;
    const source = rows[0];
    const alias = rows[1];
    const truthFields = [
      'candidateNewestAccession', 'candidateNewestDate', 'secNewestAccessions', 'secNewestDate',
      'returnedFilings', 'secEligibleFilings', 'secSubmissionsEvidenceSha256', 'secSourceCik',
      'secRecentRawFilings', 'secArchivePlanComplete', 'secArchiveDescriptorCount',
      'secRelevantArchiveCount', 'secArchivePlanSha256', 'secArchiveEvidence', 'secTruthDetail',
      'candidatePage', 'secExpectedPage',
    ];
    alias.officialCik = source.officialCik;
    alias.resolvedCik = source.officialCik;
    for (const field of truthFields) alias[field] = structuredClone(source[field]);
    alias.secSubmissionsEvidenceSha256 = 'f'.repeat(64);
    input.tickers!.uniqueIssuers = 9_999;
    const evidence = input.tickers!.evidence as Record<string, unknown>;
    evidence.independentChecks = 9_999;
    evidence.newestFilingMatches = 9_999;
    rehashTickerDirectoryBindings(input);

    expect(problems(input)).toContain(
      'ticker coverage manifest contains contradictory filing truth for duplicate official-CIK aliases',
    );
  });

  it('enforces per-class sampling, accuracy, and p95 latency floors', () => {
    const input = passingInput();
    const summary = input.e2e!.summary as Array<Record<string, unknown>>;
    const criticalPaths = input.e2e!.criticalPaths as Array<Record<string, unknown>>;
    Object.assign(summary.find(item => item.cls === 'B')!, { n: 140, passRate: 96, p95: 5_001 });
    Object.assign(summary.find(item => item.cls === 'C')!, { passRate: 96, p95: 2_001 });
    Object.assign(criticalPaths.find(item => item.name === 'topic')!, { passRate: 96, p95: 2_001 });

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('class B sampled 140/150 exact required cases'),
      expect.stringContaining('class B pass rate 96.0% is below 97%'),
      expect.stringContaining('class B p95 5001ms exceeds 5000ms'),
      expect.stringContaining('class C pass rate 96.0% is below 97%'),
      expect.stringContaining('class C p95 2001ms exceeds 2000ms'),
      expect.stringContaining("critical deployed path 'topic' pass rate 96.0% is below 97%"),
      expect.stringContaining("critical deployed path 'topic' p95 2001ms exceeds 2000ms"),
    ]));
  });

  it('rejects duplicate or extraneous e2e summary and critical-path rows', () => {
    const input = passingInput();
    const summary = input.e2e!.summary as Array<Record<string, unknown>>;
    const criticalPaths = input.e2e!.criticalPaths as Array<Record<string, unknown>>;
    summary.push({ ...summary[0] }, { cls: 'G', n: 0, pass: 0, passRate: 100, p95: 0 });
    criticalPaths.push(
      { ...criticalPaths[0] },
      { name: 'other', n: 0, passRate: 100, p95: 0, serverErrorCases: 0, requestErrors: 0 },
    );

    expect(problems(input)).toEqual(expect.arrayContaining([
      'e2e summary must contain exactly one row for each class A/B/C/D/E/F',
      'e2e criticalPaths must contain exactly one row for each path auditor/topic',
    ]));
  });

  it('requires exact target-pagination declarations reconciled to every bounded observation', () => {
    const missing = passingInput();
    delete (missing.e2e!.sampling as Record<string, unknown>).targetPagination;
    expect(problems(missing)).toContain(
      'e2e targetPagination is missing or does not reconcile to the exact release bounds and replay outcomes',
    );

    const oversized = passingInput();
    const replay = ((oversized.e2e!.sampling as Record<string, unknown>).replay as Record<string, unknown>);
    const first = (replay.cases as Array<Record<string, unknown>>)[0];
    const outcome = first.outcome as Record<string, unknown>;
    outcome.pages = 11;
    outcome.examined = 1_100;
    const observation = first.observation as Record<string, unknown>;
    observation.pages = Array.from({ length: 11 }, (_, index) => ({
      ...((observation.pages as Array<Record<string, unknown>>)[0]),
      requestPath: `${first.requestPath}${String(first.requestPath).includes('?') ? '&' : '?'}from=${index * 100}`,
    }));
    (oversized.e2e!.sampling as Record<string, Record<string, unknown>>).targetPagination.cases = 1;
    (oversized.e2e!.sampling as Record<string, Record<string, unknown>>).targetPagination.examined = 1_889;
    oversized.e2e!.availability = {
      logicalRequests: 1_010, httpAttempts: 1_010,
      serverErrorResponses: 0, casesWith5xx: 0, requestErrors: 0,
    };
    rehashE2eReplay(oversized);
    expect(problems(oversized)).toEqual(expect.arrayContaining([
      'e2e replay contains unsafe, unreconciled, or over-budget page/attempt/examined counters',
    ]));
  });

  it('rejects auditor boundary relabeling and inconsistent transition evidence after canonical rehashing', () => {
    const relabeled = passingInput();
    const relabeledReplay = ((relabeled.e2e!.sampling as Record<string, unknown>).replay as Record<string, unknown>);
    const annual = (relabeledReplay.cases as Array<Record<string, unknown>>).find(item => (
      (item.oracleEvidence as Record<string, unknown>).sampleKind === 'year-stratum'
    ))!;
    (annual.oracleEvidence as Record<string, unknown>).sampleKind = 'boundary-before';
    rehashE2eReplay(relabeled);
    expect(problems(relabeled)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid oracle evidence record'),
      expect.stringContaining('boundary replay must contain ten complete'),
    ]));

    const tampered = passingInput();
    const tamperedReplay = ((tampered.e2e!.sampling as Record<string, unknown>).replay as Record<string, unknown>);
    const boundary = (tamperedReplay.cases as Array<Record<string, unknown>>).find(item => (
      Boolean((item.oracleEvidence as Record<string, unknown>).boundaryOracle)
    ))!;
    ((boundary.oracleEvidence as Record<string, Record<string, unknown>>).boundaryOracle).boundaryDate = '2026-02-30';
    rehashE2eReplay(tampered);
    expect(problems(tampered)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid oracle evidence record'),
    ]));
  });

  it('rejects a fully rehashed raw transition witness containing an intervening Form AP event', () => {
    const input = passingInput();
    const sampling = input.e2e!.sampling as Record<string, Record<string, unknown>>;
    const cases = sampling.replay.cases as Array<Record<string, unknown>>;
    const firstBoundary = cases.find(item => (
      Boolean((item.oracleEvidence as Record<string, unknown>).boundaryOracle)
    ))!;
    const firstOracle = firstBoundary.oracleEvidence as Record<string, Record<string, unknown>>;
    const pairId = String(firstOracle.boundaryOracle.pairId);
    for (const item of cases) {
      const oracle = item.oracleEvidence as Record<string, unknown>;
      const boundary = oracle.boundaryOracle as Record<string, unknown> | undefined;
      if (!boundary || boundary.pairId !== pairId) continue;
      const predecessor = boundary.predecessor as Record<string, unknown>;
      const successor = boundary.successor as Record<string, unknown>;
      const witness = boundary.rawTransitionWitness as Record<string, unknown>;
      const existingRows = witness.rows as Array<Record<string, unknown>>;
      const interveningDate = `${String(boundary.boundaryDate).slice(0, 4)}-01-01`;
      const intervening = {
        formFilingId: Number(boundary.issuerCik) * 10 + 9,
        issuerCik: boundary.issuerCik,
        auditReportDate: interveningDate,
        auditReportType: 'Issuer, other than employee benefit plan or investment company',
        firmCanonical: 'Intervening Auditor',
        filingDate: interveningDate,
        isLatest: true,
      };
      const rows = [existingRows[0], intervening, ...existingRows.slice(1)];
      const nextEventAfterPredecessor = {
        source: 'urc_sec_auditors.direct-next-event',
        afterAuditReportDateExclusive: predecessor.effectiveFromInclusive,
        auditReportDate: interveningDate,
        firstFormFilingId: intervening.formFilingId,
      };
      const digestPayload = {
        issuerCik: boundary.issuerCik,
        fromAuditReportDateInclusive: predecessor.effectiveFromInclusive,
        toAuditReportDateInclusive: successor.effectiveFromInclusive,
        exactRowCount: rows.length,
        returnedRowCount: rows.length,
        complete: true,
        eventDates: [predecessor.effectiveFromInclusive, interveningDate, successor.effectiveFromInclusive],
        rows,
        nextEventAfterPredecessor,
      };
      Object.assign(witness, digestPayload, {
        digest: createHash('sha256').update(JSON.stringify(digestPayload)).digest('hex'),
      });
    }
    rehashE2eBoundaryManifest(input);
    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid oracle evidence record'),
    ]));
  });

  it('requires the positive and negative target identity to match within the same boundary pairId', () => {
    const input = passingInput();
    const sampling = input.e2e!.sampling as Record<string, Record<string, unknown>>;
    const cases = sampling.replay.cases as Array<Record<string, unknown>>;
    const negativeBefore = cases.find(item => {
      const oracle = item.oracleEvidence as Record<string, unknown>;
      return oracle.sampleKind === 'boundary-before' && oracle.polarity === 'negative';
    })!;
    const oracle = negativeBefore.oracleEvidence as Record<string, unknown>;
    oracle.form = '8-K';
    (negativeBefore.forbiddenFiling as Record<string, unknown>).form = '8-K';
    const request = new URL(String(negativeBefore.requestPath), base);
    request.searchParams.set('forms', '8-K');
    negativeBefore.requestPath = `${request.pathname}${request.search}`;
    rehashE2eReplay(input);
    expect(problems(input)).toContain(
      'Class B replay target reuse does not form exact pairId-local positive/negative boundary pairs',
    );
  });

  it('rejects primitive, array, and null boundaryOracle properties on annual strata', () => {
    for (const forgedBoundary of ['forged', [], null]) {
      const input = passingInput();
      const sampling = input.e2e!.sampling as Record<string, Record<string, unknown>>;
      const cases = sampling.replay.cases as Array<Record<string, unknown>>;
      const annual = cases.find(item => (
        (item.oracleEvidence as Record<string, unknown>).sampleKind === 'year-stratum'
      ))!;
      (annual.oracleEvidence as Record<string, unknown>).boundaryOracle = forgedBoundary;
      rehashE2eReplay(input);
      expect(problems(input)).toEqual(expect.arrayContaining([
        expect.stringContaining('invalid oracle evidence record'),
      ]));
    }
  });

  it('rejects a rehashed negative control whose mutable target form/date hide the forbidden accession', () => {
    const input = passingInput();
    const sampling = input.e2e!.sampling as Record<string, Record<string, unknown>>;
    const replay = sampling.replay as Record<string, unknown>;
    const negative = (replay.cases as Array<Record<string, unknown>>).find(item => (
      item.cls === 'B'
      && (item.oracleEvidence as Record<string, unknown>).polarity === 'negative'
    ))!;
    const oracle = negative.oracleEvidence as Record<string, unknown>;
    const forbidden = negative.forbiddenFiling as Record<string, unknown>;
    forbidden.form = '8-K';
    forbidden.dateFiled = '2025-12-31';

    const observation = negative.observation as Record<string, unknown>;
    const page = (observation.pages as Array<Record<string, unknown>>)[0];
    const projection = page.projection as Record<string, Record<string, unknown>>;
    projection.hits = {
      total: { value: 1, relation: 'eq' },
      hits: [{
        _id: oracle.accession,
        _source: {
          adsh: oracle.accession,
          ciks: [String(oracle.cik)],
          cik: oracle.cik,
          form: oracle.form,
          file_date: oracle.dateFiled,
          display_names: [`Company ${String(oracle.cik)}`],
          auditor: oracle.rejectedAuditor,
        },
      }],
    };
    page.projectionSha256 = createHash('sha256').update(JSON.stringify(projection)).digest('hex');
    const outcome = negative.outcome as Record<string, unknown>;
    outcome.examined = 1;
    (sampling.targetPagination as Record<string, unknown>).examined =
      Number((sampling.targetPagination as Record<string, unknown>).examined) + 1;
    rehashE2eReplay(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid route/oracle contract'),
      expect.stringContaining('forbidden target appears in projected results'),
    ]));
  });

  it('rejects a self-rehashed forbidden filing with a junk-wrapped accession', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    const negative = (replay.cases as Array<Record<string, unknown>>).find(item => (
      item.cls === 'F' && (item.oracleEvidence as Record<string, unknown>).polarity === 'negative'
    ))!;
    const forbidden = negative.forbiddenFiling as Record<string, unknown>;
    forbidden.accession = `junk-${String(forbidden.accession)}`;
    rehashE2eReplay(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid route/oracle contract'),
    ]));
  });

  it('rejects self-rehashed boundary pair accession aliases with junk raw grammar', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    const cases = replay.cases as Array<Record<string, unknown>>;
    const firstBoundary = cases.find(item => (
      (item.oracleEvidence as Record<string, unknown>).sampleKind === 'boundary-before'
    ))!;
    const originalPairId = String(
      ((firstBoundary.oracleEvidence as Record<string, Record<string, unknown>>).boundaryOracle).pairId,
    );
    for (const item of cases.filter(candidate => (
      String(((candidate.oracleEvidence as Record<string, Record<string, unknown>>).boundaryOracle ?? {}).pairId ?? '')
        === originalPairId
    ))) {
      const boundary = (item.oracleEvidence as Record<string, Record<string, unknown>>).boundaryOracle;
      const pair = boundary.pair as Record<string, Record<string, unknown>>;
      pair.before.accession = `junk-${String(pair.before.accession)}`;
      const predecessor = boundary.predecessor as Record<string, unknown>;
      const successor = boundary.successor as Record<string, unknown>;
      boundary.pairId = createHash('sha256').update(JSON.stringify({
        boundaryDate: boundary.boundaryDate,
        issuerCik: Number(boundary.issuerCik),
        predecessorIntervalId: predecessor.intervalId,
        successorIntervalId: successor.intervalId,
        beforeAccession: pair.before.accession,
        afterAccession: pair.after.accession,
      })).digest('hex');
    }
    rehashE2eBoundaryManifest(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid oracle evidence record'),
    ]));
  });

  it('reconciles nested raw Form AP event dates to the captured database watermark', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    const cases = replay.cases as Array<Record<string, unknown>>;
    const firstBoundary = cases.find(item => (
      (item.oracleEvidence as Record<string, unknown>).sampleKind === 'boundary-before'
    ))!;
    const pairId = String(
      ((firstBoundary.oracleEvidence as Record<string, Record<string, unknown>>).boundaryOracle).pairId,
    );
    for (const item of cases.filter(candidate => (
      String(((candidate.oracleEvidence as Record<string, Record<string, unknown>>).boundaryOracle ?? {}).pairId ?? '')
        === pairId
    ))) {
      const boundary = (item.oracleEvidence as Record<string, Record<string, unknown>>).boundaryOracle;
      const predecessor = boundary.predecessor as Record<string, Record<string, unknown>>;
      const rawEvent = predecessor.rawEvent;
      const rawRows = rawEvent.rows as Array<Record<string, unknown>>;
      const formFilingId = rawRows[0].formFilingId;
      rawRows[0].filingDate = '2099-01-01';
      rawEvent.digest = createHash('sha256').update(JSON.stringify(rawRows)).digest('hex');
      const witness = boundary.rawTransitionWitness as Record<string, unknown>;
      const transitionRows = witness.rows as Array<Record<string, unknown>>;
      transitionRows.find(row => row.formFilingId === formFilingId)!.filingDate = '2099-01-01';
      const digestPayload = {
        issuerCik: witness.issuerCik,
        fromAuditReportDateInclusive: witness.fromAuditReportDateInclusive,
        toAuditReportDateInclusive: witness.toAuditReportDateInclusive,
        exactRowCount: witness.exactRowCount,
        returnedRowCount: witness.returnedRowCount,
        complete: witness.complete,
        eventDates: witness.eventDates,
        rows: witness.rows,
        nextEventAfterPredecessor: witness.nextEventAfterPredecessor,
      };
      witness.digest = createHash('sha256').update(JSON.stringify(digestPayload)).digest('hex');
    }
    rehashE2eBoundaryManifest(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      'e2e replay contains ground-truth dates after its captured database watermark',
      'e2e replay manifest did not bind a complete database watermark',
    ]));
  });

  it('rejects self-rehashed Class E official CIK wrappers', () => {
    const input = passingInput();
    const replay = (input.e2e!.sampling as Record<string, Record<string, unknown>>).replay;
    const classE = (replay.cases as Array<Record<string, unknown>>).find(item => item.cls === 'E')!;
    const companies = (classE.oracleEvidence as Record<string, unknown>).companies as Array<Record<string, unknown>>;
    companies[0].cik = `CIK${String(companies[0].cik)}`;
    rehashE2eReplay(input);

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid oracle evidence record'),
    ]));
  });

  it('rejects topic artifacts that overclaim independent rank or top-k equivalence', () => {
    const input = passingInput();
    const replay = ((input.e2e!.sampling as Record<string, unknown>).replay as Record<string, unknown>);
    const topic = (replay.cases as Array<Record<string, unknown>>).find(item => item.criticalPath === 'topic')!;
    const ranking = (topic.oracleEvidence as Record<string, Record<string, unknown>>).rankingClaim;
    ranking.topKIdentityClaimed = true;
    ranking.rankEquivalenceClaimed = true;
    rehashE2eReplay(input);
    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('invalid oracle evidence record'),
    ]));
  });

  it('binds start and finish to the exact deployment, SHA, and schema chain', () => {
    const input = passingInput();
    input.candidate!.base = 'https://production-alias.vercel.app';
    (input.candidate!.vercel as Record<string, unknown>).url = 'https://production-alias.vercel.app';
    input.finalVersion = {
      ...input.finalVersion,
      deploymentId: 'dpl_different',
      schemaChainChecksum: 'c'.repeat(64),
      environment: 'production',
    };

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('initial staged-candidate attestation targeted https://production-alias.vercel.app'),
      expect.stringContaining('Vercel canonical identity does not match'),
      expect.stringContaining('candidate final application deploymentId dpl_different'),
      expect.stringContaining(`candidate final application schemaChainChecksum ${'c'.repeat(64)}`),
    ]));
  });

  it('requires the enriched filing-search backend at initial, final, and live reads', () => {
    const input = passingInput();
    (input.candidate!.application as Record<string, unknown>).filingSearchBackend = 'legacy-sec-efts';
    delete (input.candidateFinal!.application as Record<string, unknown>).filingSearchBackend;
    delete input.finalVersion!.filingSearchBackend;

    expect(problems(input)).toEqual(expect.arrayContaining([
      'initial staged-candidate attestation application filingSearchBackend is legacy-sec-efts, expected enriched',
      'post-sweep staged-candidate attestation application filingSearchBackend is missing, expected enriched',
      'candidate final filingSearchBackend is missing, expected enriched',
    ]));
  });

  it('blocks when the post-sweep attestation is missing or the candidate was promoted mid-run', () => {
    const missing = passingInput();
    missing.candidateFinal = null;
    expect(problems(missing)).toEqual(expect.arrayContaining([
      expect.stringContaining('post-sweep immutable-candidate attestation did not produce a report'),
      expect.stringContaining('post-sweep staged-candidate attestation did not produce an attestation'),
    ]));

    const promoted = passingInput();
    const final = promoted.candidateFinal!;
    (final.vercel as Record<string, unknown>).readySubstate = 'PROMOTED';
    (final.vercel as Record<string, unknown>).aliasAssigned = true;
    final.aliases = ['uniqus-research.vercel.app'];
    expect(problems(promoted)).toEqual(expect.arrayContaining([
      expect.stringContaining('post-sweep staged-candidate attestation is not READY/STAGED'),
      expect.stringContaining('post-sweep staged-candidate attestation has aliases assigned'),
      expect.stringContaining('post-sweep staged-candidate attestation already has 1 assigned alias'),
    ]));
  });

  it('fails closed when candidate provenance omits explicit build and Production-state facts', () => {
    const input = passingInput();
    delete (input.candidate!.vercel as Record<string, unknown>).prebuilt;
    delete (input.candidate!.project as Record<string, unknown>).productionDeploymentId;

    expect(problems(input)).toEqual(expect.arrayContaining([
      'initial staged-candidate attestation did not prove prebuilt=false',
      'initial staged-candidate attestation did not report the current Production deployment ID',
    ]));
  });

  it('rejects candidate attestations that claim pass while retaining problems', () => {
    const input = passingInput();
    input.candidate!.pass = true;
    input.candidate!.problems = ['forged ignored problem'];

    expect(problems(input)).toContain(
      'initial staged-candidate attestation: forged ignored problem',
    );
  });

  it('re-hashes and independently reassesses schema-contract artifacts', () => {
    const input = passingInput();
    const schema = input.schemaContract!;
    schema.pass = true;
    schema.problems = ['forged producer warning'];
    schema.observedEvidenceSha256 = 'e'.repeat(64);
    const evidence = schema.evidence as Record<string, unknown>;
    evidence.registry = {};
    evidence.relations = [];

    expect(problems(input)).toEqual(expect.arrayContaining([
      'database schema contract: forged producer warning',
      'database schema contract evidence digest does not match its canonical payload',
      expect.stringContaining('database schema contract evidence: live registry version'),
      expect.stringContaining('database schema contract evidence: required live relation urc_sec_filings is missing'),
    ]));
  });

  it('rejects an oversized schema-contract collection even with a matching digest', () => {
    const input = passingInput();
    const schema = input.schemaContract!;
    const evidence = schema.evidence as Record<string, unknown>;
    evidence.policies = Array.from({ length: 5_001 }, () => ({}));
    schema.observedEvidenceSha256 = schemaEvidenceSha256(evidence);

    expect(problems(input)).toContain(
      'database schema contract evidence policies is missing or exceeds 5000 entries',
    );
  });

  it('rejects forged extra URC relation and function backdoors in schema evidence', () => {
    const input = passingInput();
    const schema = input.schemaContract!;
    const evidence = schema.evidence as Record<string, unknown>;
    (evidence.relations as Array<Record<string, unknown>>).push({
      name: 'urc_backdoor', kind: 'r', rls: false, populated: true,
      anonSelect: true, anonInsert: true, anonUpdate: false, anonDelete: false,
      authenticatedSelect: false, authenticatedInsert: false,
      authenticatedUpdate: false, authenticatedDelete: false,
      urcWebSelect: true, urcWebInsert: false, urcWebUpdate: false, urcWebDelete: false,
    });
    (evidence.functions as Array<Record<string, unknown>>).push({
      name: 'urc_backdoor', identityArguments: '', anonExecute: true,
      authenticatedExecute: false, urcWebExecute: true, serviceExecute: true,
      securityDefiner: true, config: ['search_path=pg_catalog, public'], definition: 'select 1',
    });
    schema.observedEvidenceSha256 = schemaEvidenceSha256(evidence);

    expect(problems(input)).toEqual(expect.arrayContaining([
      'database schema contract evidence: unexpected relation urc_backdoor is readable by anon',
      'database schema contract evidence: unexpected relation urc_backdoor lacks anon INSERT denial',
      'database schema contract evidence: unexpected live function urc_backdoor() is executable by anon',
      'database schema contract evidence: unexpected live function urc_backdoor() is SECURITY DEFINER',
    ]));
  });

  it('binds one valid releaseGateNotAfter across initial, final, and live version evidence', () => {
    const missing = passingInput();
    delete (missing.candidate!.application as Record<string, unknown>).releaseGateNotAfter;
    expect(problems(missing)).toContain(
      'initial staged-candidate attestation application did not report a valid releaseGateNotAfter',
    );

    const mismatched = passingInput();
    (mismatched.candidateFinal!.application as Record<string, unknown>).releaseGateNotAfter = '2026-08-04T03:00:00.000Z';
    expect(problems(mismatched)).toEqual(expect.arrayContaining([
      expect.stringContaining('releaseGateNotAfter changed across initial/final evidence'),
    ]));

    const expired = passingInput();
    expired.candidateFinal!.generatedAt = '2026-08-04T03:59:00.000Z';
    expect(problems(expired)).toContain(
      'post-sweep staged-candidate attestation release credential has 60s remaining; requires at least 300s',
    );

    const farFuture = passingInput();
    for (const evidence of [farFuture.candidate, farFuture.candidateFinal]) {
      (evidence!.application as Record<string, unknown>).releaseGateNotAfter = '2026-08-05T00:00:00.000Z';
    }
    farFuture.finalVersion!.releaseGateNotAfter = '2026-08-05T00:00:00.000Z';
    expect(problems(farFuture)).toEqual(expect.arrayContaining([
      expect.stringContaining('release credential lifetime from deployment readiness is 86400s; maximum is 21600s'),
    ]));

    const weakenedWindow = passingInput();
    (weakenedWindow.candidate!.releaseGateWindow as Record<string, unknown>).minRemainingSeconds = 1;
    expect(problems(weakenedWindow)).toContain(
      'initial staged-candidate attestation did not prove release-gate window {minRemainingSeconds:7200,maxSecondsFromDeploymentReady:21600}',
    );
  });

  it('accepts only explicit authentication denials for the non-allowlisted probe', () => {
    for (const status of [302, 429, 500]) {
      const input = passingInput();
      (input.authProbe!.deniedProbe as Record<string, unknown>).status = status;
      expect(problems(input)).toContain(
        'credential probe did not prove explicit 401, 403, or 404 rejection on a non-allowlisted API',
      );
    }
  });

  it('rejects forged, stale, cross-route, and wrong-method credential evidence', () => {
    const input = passingInput();
    input.authProbe!.credential = 'renewable-ecdsa-p256-v2';
    input.authProbe!.httpAttempts = 1;
    input.authProbe!.generatedAt = '2026-08-03T23:00:00.000Z';
    (input.authProbe!.crossRouteProbe as Record<string, unknown>).status = 200;
    (input.authProbe!.wrongMethodProbe as Record<string, unknown>).method = 'GET';
    (input.authProbe!.enrichPostProbe as Record<string, unknown>).status = 401;

    expect(problems(input)).toEqual(expect.arrayContaining([
      'credential probe did not attest the five-minute path/method-bound v3 format',
      'credential probe did not report the exact 5 HTTP attempts',
      'credential probe timestamp is outside the initial/post-sweep candidate attestation window',
      'credential probe did not prove that an exact-path token is rejected on another allowlisted route',
      'credential probe did not prove that an exact-method token is rejected on another method',
      'credential probe did not prove an authorized exact POST /api/enrich typed-400 response',
    ]));
  });

  it('requires enforced security headers on every exact-candidate response archetype', () => {
    const input = passingInput();
    input.securityHeaders!.base = 'https://different.vercel.app';
    const observations = input.securityHeaders!.observations as Array<Record<string, unknown>>;
    const headers = observations[4].headers as Record<string, unknown>;
    headers.contentSecurityPolicy = "default-src 'self'";
    headers.xContentTypeOptions = null;

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('security-header probe targeted https://different.vercel.app'),
      expect.stringContaining('security-header typed-bad-request CSP object-src must be exactly'),
      'security-header typed-bad-request has an invalid X-Content-Type-Options value',
    ]));
  });

  it('independently rejects forged structured security-header values', () => {
    const input = passingInput();
    const observations = input.securityHeaders!.observations as Array<Record<string, unknown>>;
    const headers = observations[0].headers as Record<string, unknown>;
    headers.contentSecurityPolicy = [
      "default-src 'self'",
      "script-src * 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://img.clerk.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      'connect-src *',
      'frame-src *',
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none' https://evil.example",
      "base-uri 'self'",
      'form-action *',
      "frame-ancestors 'self'",
      'report-uri /api/csp-report',
      'report-to csp-endpoint',
    ].join('; ');
    headers.permissionsPolicy = 'camera=(self), microphone=(), geolocation=()';
    headers.strictTransportSecurity = 'max-age=315360000; includeSubDomains; preload';

    expect(problems(input)).toEqual(expect.arrayContaining([
      "security-header public-html CSP object-src combines 'none' with another source",
      "security-header public-html CSP object-src must be exactly 'none'",
      expect.stringContaining('security-header public-html CSP script-src must be exactly'),
      expect.stringContaining('security-header public-html CSP connect-src must be exactly'),
      expect.stringContaining('security-header public-html CSP frame-src must be exactly'),
      expect.stringContaining('security-header public-html CSP form-action must be exactly'),
      'security-header public-html Permissions-Policy must disable exactly camera, microphone, and geolocation',
      'security-header public-html Strict-Transport-Security must be exactly max-age=31536000, includeSubDomains, and preload',
    ]));
  });

  it('rejects a fail-open 200 from the unauthenticated protected route', () => {
    const input = passingInput();
    const observations = input.securityHeaders!.observations as Array<Record<string, unknown>>;
    const protectedRoute = observations.find(observation => observation.name === 'protected-route');
    if (!protectedRoute) throw new Error('protected-route fixture missing');
    protectedRoute.status = 200;

    expect(problems(input)).toContain(
      'security-header protected-route status 200 is outside 301/302/303/307/308/401/403/404',
    );
  });

  it('requires successful exact-SHA push-main quality workflows', () => {
    const input = passingInput();
    const workflows = input.qualityAttestation!.workflows as Array<Record<string, unknown>>;
    workflows[0].headSha = 'f'.repeat(40);
    workflows[1].conclusion = 'failure';
    workflows[2].event = 'workflow_dispatch';

    expect(problems(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('.github/workflows/ci.yml did not run on exact SHA'),
      'quality workflow .github/workflows/codeql.yml did not conclude success',
      'quality workflow .github/workflows/auth-lifecycle.yml was not a push run',
    ]));
  });

  it('requires a separately clean, stable exact-SHA CodeQL finding inventory', () => {
    const input = passingInput();
    const codeScanning = input.qualityAttestation!.codeScanning as Record<string, unknown>;
    const analysis = codeScanning.analysis as Record<string, unknown>;
    analysis.commitSha = 'f'.repeat(40);
    (codeScanning.openFindings as Array<Record<string, unknown>>).push({
      number: 8,
      severity: 'high',
    });

    expect(problems(input)).toEqual(expect.arrayContaining([
      'CodeQL alert inventory was not bracketed by one stable exact-SHA workflow analysis',
      'CodeQL exact-ref inventory contains 1 open high/critical finding(s)',
    ]));
  });

  it('fails closed on missing or duplicate quality-workflow evidence', () => {
    const missing = passingInput();
    missing.qualityAttestation = null;
    expect(problems(missing)).toContain('exact-SHA quality workflows did not produce an attestation');

    const duplicate = passingInput();
    const workflows = duplicate.qualityAttestation!.workflows as Array<Record<string, unknown>>;
    workflows[1].workflowPath = workflows[0].workflowPath;
    workflows[1].workflowId = workflows[0].workflowId;
    workflows[1].runId = workflows[0].runId;
    expect(problems(duplicate)).toEqual(expect.arrayContaining([
      'quality workflow attestation duplicates path .github/workflows/ci.yml',
      'quality workflow attestation reuses workflow ID 100',
      'quality workflow attestation reuses run ID 1000',
      'quality workflow attestation is missing .github/workflows/codeql.yml',
    ]));
  });
});
