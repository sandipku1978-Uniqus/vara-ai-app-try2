/**
 * Consolidates every release-candidate signal into one fail-closed record.
 * Dimensions stay separate: availability cannot be averaged into accuracy,
 * and a healthy aggregate cannot hide a failed auditor/topic class.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  candidateRequestHeaders,
  canonicalVercelCandidateOrigin,
} from './request';
import {
  isExplicitReleaseGateDenial,
  RELEASE_AUTH_PROBE_HTTP_ATTEMPTS,
} from './probe-auth';
import {
  assessContentSecurityPolicy,
  assessPermissionsPolicy,
  assessStrictTransportSecurity,
} from './security-headers';
import {
  assessSchemaContractEvidence,
  schemaEvidenceSha256,
} from './schema-contract';
import { UI_ACTION_TEST_MAP, UI_CONTENT_TEST_MAP } from '../../src/__tests__/uiActionCoverage';
import {
  UI_ACTION_EVIDENCE_SCHEMA,
  uiActionMappingDigest,
  uiContentMappingDigest,
  type UiActionScope,
} from '../ui-actions/evidence';
import {
  completeFilingSearchPageProblem,
  inspectFilingSearchPage,
  isDisjointEntityNameControl,
  validateCompanyEnrichment,
  validateFilingSearchPagePrecision,
  validateThreadDetails,
  validateTopicSearchResult,
  type FilingSearchPrecisionConstraints,
  type TopicSearchTruth,
} from './evaluator-validity';
import { BOOLEAN_CASES, ISSUERS, TOPIC_CASES, XBRL_CONCEPTS } from './cases';

type UnknownRecord = Record<string, unknown>;

export const REQUIRED_SEMANTIC_SCORE = 97;
export const MAX_SEMANTIC_CANDIDATE_REQUESTS = 449;
export const REQUIRED_E2E_SCORE = 97;
export const REQUIRED_E2E_CASES = 1_000;
const E2E_MAX_TARGET_PAGES = 10;
const E2E_PAGINATED_TARGET_CASES = 450 + 150 + 80;
const E2E_MAX_LOGICAL_CANDIDATE_REQUESTS = REQUIRED_E2E_CASES
  + E2E_PAGINATED_TARGET_CASES * (E2E_MAX_TARGET_PAGES - 1);
const E2E_MAX_HTTP_CANDIDATE_ATTEMPTS = E2E_MAX_LOGICAL_CANDIDATE_REQUESTS * 2;
const E2E_MAX_EXAMINED_FILINGS = (450 * 100 * E2E_MAX_TARGET_PAGES)
  + (150 * 100)
  + (150 * 50 * E2E_MAX_TARGET_PAGES)
  + (80 * 100 * E2E_MAX_TARGET_PAGES);
export const CRITICAL_SEMANTIC_SUITES = ['boolean', 'boolean-deployed', 'filing-entity'] as const;
export const REQUIRED_SEMANTIC_SUITES: Record<string, number> = {
  entity: 64,
  'filing-entity': 60,
  xbrl: 20,
  'boolean-deployed': 1,
  boolean: 5,
  equivalence: 8,
  disclosure: 160,
};

export const SEMANTIC_SUITE_MIN_RATES: Record<string, number> = {
  entity: 97,
  'filing-entity': 100,
  xbrl: 100,
  'boolean-deployed': 100,
  boolean: 100,
  equivalence: 100,
  disclosure: 97,
};

export const CLASS_REQUIREMENTS: Record<string, { minPassRate: number; maxP95Ms: number; share: number }> = {
  A: { minPassRate: 97, maxP95Ms: 5_000, share: 0.45 },
  B: { minPassRate: 97, maxP95Ms: 5_000, share: 0.15 },
  C: { minPassRate: 97, maxP95Ms: 2_000, share: 0.15 },
  D: { minPassRate: 97, maxP95Ms: 5_000, share: 0.15 },
  E: { minPassRate: 100, maxP95Ms: 5_000, share: 0.02 },
  F: { minPassRate: 95, maxP95Ms: 5_000, share: 0.08 },
};

export const CRITICAL_PATH_REQUIREMENTS: Record<string, { cases: number; minPassRate: number; maxP95Ms: number }> = {
  auditor: { cases: 150, minPassRate: 97, maxP95Ms: 5_000 },
  topic: { cases: 50, minPassRate: 97, maxP95Ms: 2_000 },
};

export const REQUIRED_QUALITY_WORKFLOWS = [
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/auth-lifecycle.yml',
] as const;
const REQUIRED_CODE_SCANNING_REF = 'refs/heads/main';
const REQUIRED_CODEQL_ANALYSIS_KEY = '.github/workflows/codeql.yml:analyze';
const REQUIRED_BLOCKING_CODE_SCANNING_SEVERITIES = ['critical', 'high'] as const;
const TICKER_DIRECTORY_SOURCE = 'https://www.sec.gov/files/company_tickers.json';
const TICKER_DIRECTORY_SCHEMA = 'urc.sec-company-directory-universe.v1';
const TICKER_RESOLVER_CANARY_SCHEMA = 'urc.ticker-resolver-canary.v1';
const TICKER_RESOLVER_CANARY_SIZE = 60;
const TICKER_DIRECTORY_MINIMUM = 10_000;
const TICKER_COVERAGE_FLOOR = '2010-01-01';
const TICKER_RESOLVER_ROUTE_LIMITATION = '/api/sec-proxy is intentionally outside the staged release-token allowlist; no deployed resolver route is claimed. The exact-SHA product resolver runs locally against the cryptographically bound direct-SEC directory payload, direct-SEC submissions supplies truth, and only /api/es-search is candidate-deployed';
const TICKER_RESOLVER_DEPENDENCY_SCOPE = {
  directory: 'direct-sec-cryptographically-bound-payload',
  submissionsTruth: 'direct-sec-complete-submissions',
  search: 'immutable-candidate-api-es-search',
} as const;

export const REQUIRED_SECURITY_HEADER_RESPONSES: Record<string, {
  path: string;
  statuses: readonly number[];
  contentType?: string;
}> = {
  'public-html': { path: '/support', statuses: [200], contentType: 'text/html' },
  'public-api': { path: '/api/version', statuses: [200], contentType: 'application/json' },
  'not-found': { path: '/_next/static/release-security-header-archetype-missing.js', statuses: [404] },
  'protected-route': { path: '/dashboard', statuses: [301, 302, 303, 307, 308, 401, 403, 404] },
  'typed-bad-request': { path: '/api/es-search?size=0', statuses: [400], contentType: 'application/json' },
};

export interface ExpectedReleaseIdentity {
  deploymentId: string;
  sha: string;
  schemaVersion: string;
  schemaMigrationCount: number;
  schemaChainChecksum: string;
  schemaChecksumAlgorithm: string;
  repositoryId: string;
}

export interface ReleaseEvidenceInput {
  base: string;
  expected: ExpectedReleaseIdentity;
  expectedRepository: string;
  semantic: UnknownRecord | null;
  tickers: UnknownRecord | null;
  e2e: UnknownRecord | null;
  schemaContract: UnknownRecord | null;
  qualityAttestation: UnknownRecord | null;
  candidate: UnknownRecord | null;
  candidateFinal: UnknownRecord | null;
  authProbe: UnknownRecord | null;
  securityHeaders: UnknownRecord | null;
  uiBrowser: UnknownRecord | null;
  uiAuth: UnknownRecord | null;
  finalVersion: UnknownRecord | null;
  generatedAt?: string;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function number(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function isoEpoch(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return null;
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return null;
  const canonical = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
  return new Date(epoch).toISOString() === canonical ? epoch : null;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function exactSecAccession(value: unknown): string | null {
  if (typeof value !== 'string' || (!/^\d{18}$/.test(value) && !/^\d{10}-\d{2}-\d{6}$/.test(value))) {
    return null;
  }
  return value.replace(/-/g, '');
}

function exactSecCik(value: unknown): string | null {
  const raw = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string' ? value : '';
  if (!/^\d{1,10}$/.test(raw)) return null;
  const normalized = raw.replace(/^0+/, '') || '0';
  return normalized === '0' ? null : normalized;
}

function exactSecFilingIdentity(accessionValue: unknown, cikValue: unknown, dateValue: unknown): boolean {
  const accession = exactSecAccession(accessionValue);
  const cik = exactSecCik(cikValue);
  if (!accession || !cik || !isIsoDate(dateValue)) return false;
  return accession.startsWith(cik.padStart(10, '0'))
    && accession.slice(10, 12) === dateValue.slice(2, 4);
}

function commentThreadIdentityValid(
  threadIdValue: unknown,
  letters: Array<{ cik?: unknown; date_filed?: unknown; review_key?: unknown }>,
): boolean {
  if (letters.length === 0) return false;
  const ciks = letters.map(letter => exactSecCik(letter.cik));
  if (ciks.some(cik => !cik) || new Set(ciks).size !== 1) return false;
  const cik = ciks[0]!;
  const threadId = typeof threadIdValue === 'string' ? threadIdValue : '';
  const prefix = `${cik}:`;
  if (!threadId.startsWith(prefix)) return false;
  const suffix = threadId.slice(prefix.length);
  if (!suffix || suffix.length > 500 || /[\u0000-\u001F\u007F]/.test(suffix)) return false;
  const dates = letters.map(letter => letter.date_filed);
  if (!dates.every(isIsoDate)) return false;
  const reviewKeys = letters.map(letter => (
    typeof letter.review_key === 'string' ? letter.review_key : null
  ));
  const definedReviewKeys = reviewKeys.filter((reviewKey): reviewKey is string => reviewKey !== null);
  if (definedReviewKeys.length > 0) {
    return definedReviewKeys.length === letters.length
      && new Set(definedReviewKeys).size === 1
      && suffix === definedReviewKeys[0];
  }
  const minimumDate = [...dates].sort()[0];
  const bareDateSuffix = /^\d{4}-\d{2}-\d{2}$/.test(suffix) && isIsoDate(suffix);
  if (bareDateSuffix) return suffix === minimumDate;
  if (suffix.startsWith('date:')) return suffix === `date:${minimumDate}`;
  return false;
}

function commentWatermarkThreadIdentityValid(latest: UnknownRecord): boolean {
  const cik = exactSecCik(latest.cik);
  const filingDate = latest.date_filed;
  const threadId = typeof latest.thread_id === 'string' ? latest.thread_id : '';
  if (!cik || !isIsoDate(filingDate) || !threadId.startsWith(`${cik}:`)) return false;
  const suffix = threadId.slice(cik.length + 1);
  if (!suffix || suffix.length > 500 || /[\u0000-\u001F\u007F]/.test(suffix)) return false;
  if (typeof latest.review_key === 'string') return latest.review_key === suffix;
  const bareDateSuffix = /^\d{4}-\d{2}-\d{2}$/.test(suffix) && isIsoDate(suffix);
  if (bareDateSuffix) return suffix <= filingDate;
  if (suffix.startsWith('date:')) {
    const episodeDate = suffix.slice(5);
    return isIsoDate(episodeDate) && episodeDate <= filingDate;
  }
  return false;
}

const APPLICATION_IDENTITY_FIELDS = [
  'deploymentId',
  'sha',
  'schemaVersion',
  'schemaMigrationCount',
  'schemaChainChecksum',
  'schemaChecksumAlgorithm',
] as const;

function sameIdentity(actual: UnknownRecord | null, expected: ExpectedReleaseIdentity, label: string, problems: string[]) {
  if (!actual) {
    problems.push(`${label} did not report release identity`);
    return;
  }
  for (const field of APPLICATION_IDENTITY_FIELDS) {
    const value = actual[field];
    if (value !== expected[field]) {
      problems.push(`${label} ${field} ${String(value ?? 'null')} differs from expected ${String(expected[field])}`);
    }
  }
}

function validateCandidateAttestation(
  attestation: UnknownRecord | null,
  expected: ExpectedReleaseIdentity,
  base: string,
  label: string,
  problems: string[],
  databaseFingerprint: string | null,
  minimumRemainingSeconds: number,
) {
  if (!attestation) {
    problems.push(`${label} did not produce an attestation`);
    return;
  }
  if (attestation.pass !== true) {
    problems.push(`${label} failed`);
  }
  if (!Array.isArray(attestation.problems)) {
    problems.push(`${label} did not report a problems array`);
  } else if (attestation.problems.length > 0) {
    for (const problem of attestation.problems) problems.push(`${label}: ${String(problem)}`);
  }
  if (attestation.base !== base) {
    problems.push(`${label} targeted ${String(attestation.base ?? 'no base')}, expected ${base}`);
  }

  const reportedExpected = record(attestation.expected);
  sameIdentity(reportedExpected, expected, `${label} expectation`, problems);
  if (reportedExpected?.repositoryId !== expected.repositoryId) {
    problems.push(`${label} repositoryId ${String(reportedExpected?.repositoryId ?? 'null')} differs from expected ${expected.repositoryId}`);
  }
  const application = record(attestation.application);
  sameIdentity(application, expected, `${label} application`, problems);
  if (application?.environment !== 'production') {
    problems.push(`${label} application environment is ${String(application?.environment ?? 'null')}, expected production`);
  }
  if (application?.filingSearchBackend !== 'enriched') {
    problems.push(
      `${label} application filingSearchBackend is ${String(application?.filingSearchBackend ?? 'missing')}, expected enriched`,
    );
  }
  if (!databaseFingerprint || application?.schemaDatabaseFingerprint !== databaseFingerprint) {
    problems.push(
      `${label} application database fingerprint ${String(application?.schemaDatabaseFingerprint ?? 'null')} differs from schema evidence ${databaseFingerprint || 'null'}`,
    );
  }
  const releaseGateNotAfter = isoEpoch(application?.releaseGateNotAfter);
  if (releaseGateNotAfter === null) {
    problems.push(`${label} application did not report a valid releaseGateNotAfter`);
  }
  const releaseGateWindow = record(attestation.releaseGateWindow);
  if (
    number(releaseGateWindow?.minRemainingSeconds) !== minimumRemainingSeconds
    || number(releaseGateWindow?.maxSecondsFromDeploymentReady) !== 21_600
  ) {
    problems.push(
      `${label} did not prove release-gate window {minRemainingSeconds:${minimumRemainingSeconds},maxSecondsFromDeploymentReady:21600}`,
    );
  }

  const vercel = record(attestation.vercel);
  if (
    !vercel
    || vercel.url !== base
    || vercel.deploymentId !== expected.deploymentId
    || vercel.gitSha !== expected.sha
  ) {
    problems.push(`${label} Vercel canonical identity does not match the expected staged candidate`);
  }
  if (vercel?.readyState !== 'READY' || vercel?.readySubstate !== 'STAGED') {
    problems.push(`${label} is not READY/STAGED`);
  }
  if (vercel?.target !== 'production') problems.push(`${label} is not a production-target build`);
  if (vercel?.aliasAssigned !== false) problems.push(`${label} has aliases assigned`);
  if (!['github', 'github-limited'].includes(String(vercel?.gitType || ''))) {
    problems.push(`${label} does not report an authenticated GitHub source`);
  }
  if (vercel?.gitRef !== 'main') problems.push(`${label} was not built from protected main`);
  if (String(vercel?.repositoryId ?? '') !== expected.repositoryId) problems.push(`${label} repository identity differs`);
  if (String(vercel?.connectedRepositoryId ?? '') !== expected.repositoryId) problems.push(`${label} connected repository differs`);
  if (vercel?.prebuilt !== false) problems.push(`${label} did not prove prebuilt=false`);
  const generatedAt = isoEpoch(attestation.generatedAt);
  const readyAt = isoEpoch(vercel?.readyAt) ?? isoEpoch(vercel?.createdAt);
  if (generatedAt === null) problems.push(`${label} did not report a valid generatedAt timestamp`);
  if (readyAt === null) problems.push(`${label} did not report a valid Vercel readyAt/createdAt timestamp`);
  if (releaseGateNotAfter !== null && generatedAt !== null) {
    const remainingSeconds = (releaseGateNotAfter - generatedAt) / 1_000;
    if (remainingSeconds < minimumRemainingSeconds) {
      problems.push(
        `${label} release credential has ${remainingSeconds}s remaining; requires at least ${minimumRemainingSeconds}s`,
      );
    }
  }
  if (Array.isArray(attestation.problems) && attestation.problems.length > 0) {
    problems.push(`${label} reported ${attestation.problems.length} unresolved attestation problem(s)`);
  }
  if (releaseGateNotAfter !== null && readyAt !== null) {
    const lifetimeSeconds = (releaseGateNotAfter - readyAt) / 1_000;
    if (lifetimeSeconds < 0 || lifetimeSeconds > 21_600) {
      problems.push(`${label} release credential lifetime from deployment readiness is ${lifetimeSeconds}s; maximum is 21600s`);
    }
  }

  const project = record(attestation.project);
  if (!project) {
    problems.push(`${label} did not report Vercel project attestation`);
  } else {
    if (project.autoAssignCustomDomains !== false) problems.push(`${label} project still auto-assigns Production domains`);
    if (typeof project.productionDeploymentId !== 'string' || !project.productionDeploymentId.trim()) {
      problems.push(`${label} did not report the current Production deployment ID`);
    } else if (project.productionDeploymentId === expected.deploymentId) {
      problems.push(`${label} is already the Production deployment`);
    }
    if (!['github', 'github-limited'].includes(String(project.gitType || ''))) problems.push(`${label} project is not linked to GitHub`);
    if (String(project.gitRepositoryId ?? '') !== expected.repositoryId) problems.push(`${label} project repository differs`);
    if (project.productionBranch !== 'main') problems.push(`${label} project production branch is not main`);
  }
  if (!Array.isArray(attestation.aliases)) {
    problems.push(`${label} did not report an alias inventory`);
  } else if (attestation.aliases.length > 0) {
    problems.push(`${label} already has ${attestation.aliases.length} assigned alias(es)`);
  }
}

function validateSchemaContract(
  schemaContract: UnknownRecord | null,
  expected: ExpectedReleaseIdentity,
  problems: string[],
): string | null {
  if (!schemaContract) {
    problems.push('database schema contract did not produce a report');
    return null;
  }
  if (schemaContract.pass !== true) {
    problems.push('database schema contract failed');
  }
  if (!Array.isArray(schemaContract.problems)) {
    problems.push('database schema contract did not report a problems array');
  } else if (schemaContract.problems.length > 0) {
    for (const problem of schemaContract.problems) problems.push(`database schema contract: ${String(problem)}`);
  }
  if (isoEpoch(schemaContract.generatedAt) === null) {
    problems.push('database schema contract did not report a valid generatedAt timestamp');
  }
  const reportedExpected = record(schemaContract.expected);
  for (const field of [
    'schemaVersion',
    'schemaMigrationCount',
    'schemaChainChecksum',
    'schemaChecksumAlgorithm',
  ] as const) {
    if (reportedExpected?.[field] !== expected[field]) {
      problems.push(
        `database schema contract ${field} ${String(reportedExpected?.[field] ?? 'null')} differs from expected ${String(expected[field])}`,
      );
    }
  }
  const fingerprint = typeof schemaContract.databaseFingerprint === 'string'
    && /^sha256:[0-9a-f]{64}$/.test(schemaContract.databaseFingerprint)
    ? schemaContract.databaseFingerprint
    : null;
  if (!fingerprint) problems.push('database schema contract did not report a valid non-null database fingerprint');
  const evidence = record(schemaContract.evidence);
  if (!evidence) {
    problems.push('database schema contract did not include observed schema evidence');
    return fingerprint;
  }

  const serializedEvidence = JSON.stringify(evidence);
  const evidenceArrays: Record<string, number> = {
    schemas: 50,
    defaultPrivileges: 500,
    relations: 500,
    columns: 5_000,
    views: 500,
    indexes: 5_000,
    functions: 1_000,
    roles: 100,
    extensions: 100,
    policies: 5_000,
  };
  let evidenceIsBounded = Buffer.byteLength(serializedEvidence, 'utf8') <= 2_000_000;
  if (!evidenceIsBounded) problems.push('database schema contract evidence exceeds the 2 MB bound');
  for (const [field, maximum] of Object.entries(evidenceArrays)) {
    const value = evidence[field];
    if (!Array.isArray(value) || value.length > maximum) {
      evidenceIsBounded = false;
      problems.push(`database schema contract evidence ${field} is missing or exceeds ${maximum} entries`);
    }
  }

  const recomputedDigest = schemaEvidenceSha256(evidence);
  if (schemaContract.observedEvidenceSha256 !== recomputedDigest) {
    problems.push('database schema contract evidence digest does not match its canonical payload');
  }
  if (evidenceIsBounded) {
    for (const problem of assessSchemaContractEvidence(evidence, expected)) {
      problems.push(`database schema contract evidence: ${problem}`);
    }
  }
  return fingerprint;
}

function validateQualityAttestation(
  report: UnknownRecord | null,
  expectedRepository: string,
  expectedSha: string,
  problems: string[],
) {
  if (!report) {
    problems.push('exact-SHA quality workflows did not produce an attestation');
    return;
  }
  if (report.pass !== true) problems.push('exact-SHA quality workflow attestation failed');
  if (report.repository !== expectedRepository) {
    problems.push(
      `quality workflow repository ${String(report.repository ?? 'null')} differs from expected ${expectedRepository || 'null'}`,
    );
  }
  if (report.expectedSha !== expectedSha) {
    problems.push(
      `quality workflow expected SHA ${String(report.expectedSha ?? 'null')} differs from release SHA ${expectedSha}`,
    );
  }
  if (!Array.isArray(report.problems)) {
    problems.push('quality workflow attestation did not report a problems array');
  } else {
    for (const problem of report.problems) problems.push(`quality workflow attestation: ${String(problem)}`);
  }

  const expectedPaths = [...REQUIRED_QUALITY_WORKFLOWS];
  const requiredPaths = Array.isArray(report.requiredWorkflowPaths)
    ? report.requiredWorkflowPaths.map(String)
    : [];
  if (
    requiredPaths.length !== expectedPaths.length
    || new Set(requiredPaths).size !== expectedPaths.length
    || expectedPaths.some(path => !requiredPaths.includes(path))
  ) {
    problems.push(`quality workflow required-path inventory is not the exact ${expectedPaths.join(', ')} set`);
  }

  const workflows = Array.isArray(report.workflows)
    ? report.workflows.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  if (workflows.length !== expectedPaths.length) {
    problems.push(`quality workflow attestation reported ${workflows.length}/${expectedPaths.length} required runs`);
  }
  const seenPaths = new Set<string>();
  const seenWorkflowIds = new Set<number>();
  const seenRunIds = new Set<number>();
  let codeqlRunId: number | null = null;
  for (const workflow of workflows) {
    const path = String(workflow.workflowPath ?? '');
    if (!expectedPaths.includes(path as typeof expectedPaths[number])) {
      problems.push(`quality workflow attestation contains unexpected path ${path || '(missing)'}`);
    }
    if (seenPaths.has(path)) problems.push(`quality workflow attestation duplicates path ${path}`);
    seenPaths.add(path);

    const identifiers = {
      workflowId: number(workflow.workflowId),
      runId: number(workflow.runId),
      runAttempt: number(workflow.runAttempt),
      runNumber: number(workflow.runNumber),
    };
    for (const [label, value] of Object.entries(identifiers)) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        problems.push(`quality workflow ${path || '(missing)'} has invalid ${label} ${String(value)}`);
      }
    }
    if (seenRunIds.has(identifiers.runId)) {
      problems.push(`quality workflow attestation reuses run ID ${identifiers.runId}`);
    }
    if (seenWorkflowIds.has(identifiers.workflowId)) {
      problems.push(`quality workflow attestation reuses workflow ID ${identifiers.workflowId}`);
    }
    seenWorkflowIds.add(identifiers.workflowId);
    seenRunIds.add(identifiers.runId);
    if (path === '.github/workflows/codeql.yml' && Number.isSafeInteger(identifiers.runId) && identifiers.runId > 0) {
      codeqlRunId = identifiers.runId;
    }
    if (workflow.workflowState !== 'active') problems.push(`quality workflow ${path} is not active`);
    if (workflow.headSha !== expectedSha) problems.push(`quality workflow ${path} did not run on exact SHA ${expectedSha}`);
    if (workflow.event !== 'push') problems.push(`quality workflow ${path} was not a push run`);
    if (workflow.headBranch !== 'main') problems.push(`quality workflow ${path} did not run on main`);
    if (workflow.status !== 'completed') problems.push(`quality workflow ${path} is not completed`);
    if (workflow.conclusion !== 'success') problems.push(`quality workflow ${path} did not conclude success`);
  }
  for (const path of expectedPaths) {
    if (!seenPaths.has(path)) problems.push(`quality workflow attestation is missing ${path}`);
  }

  // CodeQL action completion and a clean finding inventory are deliberately
  // independent conditions. The alert API filters by a branch ref rather than
  // an arbitrary SHA, so the verifier brackets both severity queries with the
  // same latest analysis and records that exact-SHA binding here.
  const codeScanning = record(report.codeScanning);
  if (!codeScanning) {
    problems.push('quality attestation omitted the exact-ref CodeQL finding inventory');
    return;
  }
  if (codeScanning.pass !== true) problems.push('exact-ref CodeQL finding inventory failed');
  if (
    codeScanning.ref !== REQUIRED_CODE_SCANNING_REF
    || codeScanning.expectedSha !== expectedSha
    || codeScanning.tool !== 'CodeQL'
  ) {
    problems.push('CodeQL finding inventory is not bound to the expected main ref and exact release SHA');
  }
  if (number(codeScanning.workflowRunId) !== codeqlRunId || codeqlRunId === null) {
    problems.push('CodeQL finding inventory is not bound to the attested CodeQL workflow run ID');
  }

  const blockedSeverities = Array.isArray(codeScanning.blockedSeverities)
    ? codeScanning.blockedSeverities.map(String)
    : [];
  if (
    blockedSeverities.length !== REQUIRED_BLOCKING_CODE_SCANNING_SEVERITIES.length
    || new Set(blockedSeverities).size !== REQUIRED_BLOCKING_CODE_SCANNING_SEVERITIES.length
    || REQUIRED_BLOCKING_CODE_SCANNING_SEVERITIES.some(severity => !blockedSeverities.includes(severity))
  ) {
    problems.push('CodeQL finding inventory did not query the exact critical/high blocking severities');
  }

  const analysis = record(codeScanning.analysis);
  const bookends = record(codeScanning.analysisBookendIds);
  const analysisId = number(analysis?.id);
  if (
    !analysis
    || !Number.isSafeInteger(analysisId)
    || analysisId <= 0
    || analysis.ref !== REQUIRED_CODE_SCANNING_REF
    || analysis.commitSha !== expectedSha
    || analysis.analysisKey !== REQUIRED_CODEQL_ANALYSIS_KEY
    || analysis.category !== REQUIRED_CODEQL_ANALYSIS_KEY
    || isoEpoch(analysis.createdAt) === null
    || number(bookends?.before) !== analysisId
    || number(bookends?.after) !== analysisId
  ) {
    problems.push('CodeQL alert inventory was not bracketed by one stable exact-SHA workflow analysis');
  }

  if (!Array.isArray(codeScanning.openFindings)) {
    problems.push('CodeQL finding inventory omitted its open-findings array');
  } else if (codeScanning.openFindings.length > 0) {
    problems.push(
      `CodeQL exact-ref inventory contains ${codeScanning.openFindings.length} open high/critical finding(s)`,
    );
  }
  if (!Array.isArray(codeScanning.problems) || codeScanning.problems.length !== 0) {
    problems.push('CodeQL finding inventory contains problems or lacks a problems array');
  }
}

function validateSecurityHeaderEvidence(
  report: UnknownRecord | null,
  base: string,
  problems: string[],
) {
  if (!report) {
    problems.push('immutable-candidate security headers did not produce a report');
    return;
  }
  if (report.pass !== true) problems.push('immutable-candidate security-header probe failed');
  if (report.base !== base) {
    problems.push(
      `security-header probe targeted ${String(report.base ?? 'no base')}, expected immutable candidate ${base}`,
    );
  }
  if (isoEpoch(report.generatedAt) === null) {
    problems.push('security-header report did not include a valid generatedAt timestamp');
  }
  if (!Array.isArray(report.problems)) {
    problems.push('security-header report did not include a problems array');
  } else if (report.problems.length > 0) {
    for (const problem of report.problems) problems.push(`security-header probe: ${String(problem)}`);
  }

  const expectedNames = Object.keys(REQUIRED_SECURITY_HEADER_RESPONSES);
  const policy = record(report.policy);
  const policyArchetypes = Array.isArray(policy?.responseArchetypes)
    ? policy.responseArchetypes.map(String)
    : [];
  if (policy?.enforcedCsp !== true) problems.push('security-header policy did not require enforced CSP');
  if (
    policyArchetypes.length !== expectedNames.length
    || new Set(policyArchetypes).size !== expectedNames.length
    || expectedNames.some(name => !policyArchetypes.includes(name))
  ) {
    problems.push('security-header policy does not declare the exact five required response archetypes');
  }
  const authBoundary = record(policy?.authBoundary);
  const requiredAuthBoundary = REQUIRED_SECURITY_HEADER_RESPONSES['protected-route'];
  const declaredAuthStatuses = Array.isArray(authBoundary?.acceptedStatuses)
    ? authBoundary.acceptedStatuses.map(number)
    : [];
  if (
    authBoundary?.path !== requiredAuthBoundary.path
    || authBoundary?.authentication !== 'unauthenticated'
    || authBoundary?.releaseGateToken !== 'absent'
    || authBoundary?.redirectMode !== 'manual'
    || declaredAuthStatuses.length !== requiredAuthBoundary.statuses.length
    || new Set(declaredAuthStatuses).size !== requiredAuthBoundary.statuses.length
    || requiredAuthBoundary.statuses.some(status => !declaredAuthStatuses.includes(status))
  ) {
    problems.push('security-header policy did not attest the exact unauthenticated /dashboard boundary');
  }

  const observations = Array.isArray(report.observations)
    ? report.observations.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  if (observations.length !== expectedNames.length) {
    problems.push(`security-header report contains ${observations.length}/${expectedNames.length} required observations`);
  }
  const seen = new Set<string>();
  for (const observation of observations) {
    const name = String(observation.name ?? '');
    const expectedResponse = REQUIRED_SECURITY_HEADER_RESPONSES[name];
    if (!expectedResponse) {
      problems.push(`security-header report contains unexpected archetype ${name || '(missing)'}`);
      continue;
    }
    if (seen.has(name)) problems.push(`security-header report duplicates archetype ${name}`);
    seen.add(name);
    if (observation.path !== expectedResponse.path) {
      problems.push(
        `security-header ${name} path ${String(observation.path ?? 'missing')} differs from ${expectedResponse.path}`,
      );
    }
    const status = number(observation.status);
    if (!Number.isInteger(status) || !expectedResponse.statuses.includes(status)) {
      problems.push(
        `security-header ${name} status ${String(observation.status ?? 'missing')} is outside ${expectedResponse.statuses.join('/')}`,
      );
    }
    if (
      expectedResponse.contentType
      && !String(observation.contentType ?? '').toLowerCase().includes(expectedResponse.contentType)
    ) {
      problems.push(`security-header ${name} did not report ${expectedResponse.contentType} content`);
    }
    if (observation.pass !== true) problems.push(`security-header ${name} observation did not pass`);
    if (!Array.isArray(observation.problems) || observation.problems.length !== 0) {
      problems.push(`security-header ${name} observation contains problems or lacks a problems array`);
    }

    const headers = record(observation.headers);
    if (!headers) {
      problems.push(`security-header ${name} observation omitted its header evidence`);
      continue;
    }
    const csp = typeof headers.contentSecurityPolicy === 'string'
      ? headers.contentSecurityPolicy
      : null;
    for (const problem of assessContentSecurityPolicy(csp)) {
      problems.push(`security-header ${name} ${problem}`);
    }
    if (headers.contentSecurityPolicyReportOnly !== null) {
      problems.push(`security-header ${name} includes report-only CSP or did not prove its absence`);
    }
    if (headers.reportingEndpoints !== 'csp-endpoint="/api/csp-report"') {
      problems.push(`security-header ${name} has an invalid Reporting-Endpoints value`);
    }
    if (String(headers.xFrameOptions ?? '').toUpperCase() !== 'SAMEORIGIN') {
      problems.push(`security-header ${name} has an invalid X-Frame-Options value`);
    }
    if (String(headers.xContentTypeOptions ?? '').toLowerCase() !== 'nosniff') {
      problems.push(`security-header ${name} has an invalid X-Content-Type-Options value`);
    }
    if (String(headers.referrerPolicy ?? '').toLowerCase() !== 'strict-origin-when-cross-origin') {
      problems.push(`security-header ${name} has an invalid Referrer-Policy value`);
    }
    for (const problem of assessPermissionsPolicy(
      typeof headers.permissionsPolicy === 'string' ? headers.permissionsPolicy : null,
    )) {
      problems.push(`security-header ${name} ${problem}`);
    }
    for (const problem of assessStrictTransportSecurity(
      typeof headers.strictTransportSecurity === 'string' ? headers.strictTransportSecurity : null,
    )) {
      problems.push(`security-header ${name} ${problem}`);
    }
  }
  for (const name of expectedNames) {
    if (!seen.has(name)) problems.push(`security-header report is missing archetype ${name}`);
  }
}

function replayIdentity(value: UnknownRecord): string {
  return `${String(value.accession ?? '').replace(/\D/g, '')}:${String(value.cik ?? '').replace(/^0+/, '')}:${String(value.form ?? '')}`;
}

function auditorBoundaryOracleProblem(oracle: UnknownRecord): string | null {
  const boundaryPropertyPresent = Object.prototype.hasOwnProperty.call(oracle, 'boundaryOracle');
  const boundary = record(oracle.boundaryOracle);
  const sampleKind = String(oracle.sampleKind ?? '');
  if (sampleKind === 'year-stratum') {
    return boundaryPropertyPresent
      ? 'year-stratum auditor case must not carry a boundaryOracle property'
      : null;
  }
  if (!['boundary-before', 'boundary-after'].includes(sampleKind) || !boundary) {
    return 'boundary auditor case is missing structured transition evidence';
  }
  const predecessor = record(boundary.predecessor);
  const successor = record(boundary.successor);
  const rawTransitionWitness = record(boundary.rawTransitionWitness);
  const selection = record(boundary.selection);
  const window = record(selection?.selectionWindow);
  const pair = record(boundary.pair);
  const before = record(pair?.before);
  const after = record(pair?.after);
  const issuerCik = canonicalSemanticCik(boundary.issuerCik);
  const oracleCik = canonicalSemanticCik(oracle.cik);
  const predecessorCik = canonicalSemanticCik(predecessor?.issuerCik);
  const successorCik = canonicalSemanticCik(successor?.issuerCik);
  const boundaryDate = String(boundary.boundaryDate ?? '');
  const predecessorFrom = String(predecessor?.effectiveFromInclusive ?? '');
  const predecessorTo = predecessor?.effectiveToExclusive;
  const successorFrom = String(successor?.effectiveFromInclusive ?? '');
  const successorTo = successor?.effectiveToExclusive;
  const predecessorId = `${issuerCik}:${String(predecessorFrom ?? '')}`;
  const successorId = `${issuerCik}:${String(successorFrom ?? '')}`;
  const side = sampleKind === 'boundary-before' ? 'before' : 'after';
  const selected = side === 'before' ? predecessor : successor;
  const opposite = side === 'before' ? successor : predecessor;
  const selectedPair = side === 'before' ? before : after;
  const filingDate = String(oracle.dateFiled ?? '');
  const accession = exactSecAccession(oracle.accession) ?? '';
  const effectiveTo = selected?.effectiveToExclusive;
  const intervalContains = isIsoDate(filingDate)
    && isIsoDate(selected?.effectiveFromInclusive)
    && filingDate >= String(selected?.effectiveFromInclusive)
    && (effectiveTo === null || (isIsoDate(effectiveTo) && filingDate < effectiveTo));
  const selectionContains = isIsoDate(window?.fromInclusive) && isIsoDate(window?.toExclusive)
    && filingDate >= String(window?.fromInclusive) && filingDate < String(window?.toExclusive);
  const corpusStart = '2017-01-01';
  const corpusEnd = `${new Date().getUTCFullYear() + 1}-01-01`;
  const expectedWindowFrom = String(selected?.effectiveFromInclusive ?? '') < corpusStart
    ? corpusStart : String(selected?.effectiveFromInclusive ?? '');
  const selectedTo = selected?.effectiveToExclusive;
  const expectedWindowTo = typeof selectedTo === 'string' && selectedTo < corpusEnd
    ? selectedTo : corpusEnd;
  const predecessorFirm = String(predecessor?.firmName ?? '');
  const successorFirm = String(successor?.firmName ?? '');
  const paddedIssuerCik = issuerCik?.padStart(10, '0') ?? '';
  const beforeAccession = exactSecAccession(before?.accession) ?? '';
  const afterAccession = exactSecAccession(after?.accession) ?? '';
  const rawEventValid = (interval: UnknownRecord | null) => {
    const rawEvent = record(interval?.rawEvent);
    const rows = Array.isArray(rawEvent?.rows)
      ? rawEvent.rows.map(record).filter((value): value is UnknownRecord => value !== null) : [];
    const intervalCik = canonicalSemanticCik(interval?.issuerCik);
    const intervalDate = String(interval?.effectiveFromInclusive ?? '');
    const intervalFirm = String(interval?.firmName ?? '');
    const ids = rows.map(row => number(row.formFilingId));
    return rawEvent?.source === 'urc_sec_auditors.direct-event'
      && rawEvent.auditReportDate === intervalDate
      && rawEvent.resolvedFirmName === intervalFirm
      && rows.length > 0 && rows.length <= 100
      && rows.every(row => (
        Number.isSafeInteger(row.formFilingId) && number(row.formFilingId) > 0
        && canonicalSemanticCik(row.issuerCik) === intervalCik
        && row.auditReportDate === intervalDate
        && row.isLatest === true
        && String(row.auditReportType ?? '').trim().toLocaleLowerCase()
          === 'issuer, other than employee benefit plan or investment company'
        && String(row.firmCanonical ?? '') === intervalFirm
        && isIsoDate(row.filingDate)
      ))
      && new Set(ids).size === ids.length
      && rawEvent.digest === createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  };
  const rawEventRows = (interval: UnknownRecord | null): UnknownRecord[] => {
    const rawEvent = record(interval?.rawEvent);
    if (!Array.isArray(rawEvent?.rows) || rawEvent.rows.some(row => record(row) === null)) return [];
    return rawEvent.rows.map(row => record(row)!);
  };
  const transitionRowsValue = rawTransitionWitness?.rows;
  const transitionRows = Array.isArray(transitionRowsValue)
    && transitionRowsValue.every(row => record(row) !== null)
    ? transitionRowsValue.map(row => record(row)!) : [];
  const transitionEventDates = rawTransitionWitness?.eventDates;
  const nextEvent = record(rawTransitionWitness?.nextEventAfterPredecessor);
  const predecessorRawRows = rawEventRows(predecessor);
  const successorRawRows = rawEventRows(successor);
  const expectedTransitionRows = [...predecessorRawRows, ...successorRawRows];
  const transitionIds = transitionRows.map(row => number(row.formFilingId));
  const successorTransitionIds = transitionRows
    .filter(row => row.auditReportDate === successorFrom)
    .map(row => number(row.formFilingId));
  const transitionDigestPayload = {
    issuerCik: rawTransitionWitness?.issuerCik,
    fromAuditReportDateInclusive: rawTransitionWitness?.fromAuditReportDateInclusive,
    toAuditReportDateInclusive: rawTransitionWitness?.toAuditReportDateInclusive,
    exactRowCount: rawTransitionWitness?.exactRowCount,
    returnedRowCount: rawTransitionWitness?.returnedRowCount,
    complete: rawTransitionWitness?.complete,
    eventDates: transitionEventDates,
    rows: transitionRowsValue,
    nextEventAfterPredecessor: rawTransitionWitness?.nextEventAfterPredecessor,
  };
  const rawTransitionValid = rawTransitionWitness?.contract === 'urc.raw-form-ap-transition-range.v1'
    && rawTransitionWitness.source === 'urc_sec_auditors.direct-range+direct-next-event'
    && typeof rawTransitionWitness.issuerCik === 'number'
    && rawTransitionWitness.issuerCik === boundary.issuerCik
    && rawTransitionWitness.fromAuditReportDateInclusive === predecessorFrom
    && rawTransitionWitness.toAuditReportDateInclusive === successorFrom
    && Number.isSafeInteger(rawTransitionWitness.exactRowCount)
    && number(rawTransitionWitness.exactRowCount) > 1
    && number(rawTransitionWitness.exactRowCount) <= 1_000
    && rawTransitionWitness.returnedRowCount === rawTransitionWitness.exactRowCount
    && number(rawTransitionWitness.returnedRowCount) === transitionRows.length
    && rawTransitionWitness.complete === true
    && Array.isArray(transitionRowsValue)
    && transitionRows.length === transitionRowsValue.length
    && JSON.stringify(transitionEventDates) === JSON.stringify([predecessorFrom, successorFrom])
    && transitionRows.every(row => (
      Number.isSafeInteger(row.formFilingId) && number(row.formFilingId) > 0
      && canonicalSemanticCik(row.issuerCik) === issuerCik
      && row.isLatest === true
      && [predecessorFrom, successorFrom].includes(String(row.auditReportDate ?? ''))
      && String(row.auditReportType ?? '').trim().toLocaleLowerCase()
        === 'issuer, other than employee benefit plan or investment company'
      && String(row.firmCanonical ?? '') === (
        row.auditReportDate === predecessorFrom ? predecessorFirm : successorFirm
      )
      && isIsoDate(row.filingDate)
    ))
    && new Set(transitionIds).size === transitionIds.length
    && JSON.stringify(transitionRows) === JSON.stringify(expectedTransitionRows)
    && JSON.stringify(transitionRows) === JSON.stringify([...transitionRows].sort((left, right) => (
      String(left.auditReportDate).localeCompare(String(right.auditReportDate))
      || number(left.formFilingId) - number(right.formFilingId)
    )))
    && nextEvent?.source === 'urc_sec_auditors.direct-next-event'
    && nextEvent.afterAuditReportDateExclusive === predecessorFrom
    && nextEvent.auditReportDate === successorFrom
    && Number.isSafeInteger(nextEvent.firstFormFilingId)
    && successorTransitionIds.length > 0
    && number(nextEvent.firstFormFilingId) === Math.min(...successorTransitionIds)
    && rawTransitionWitness.digest === createHash('sha256')
      .update(JSON.stringify(transitionDigestPayload)).digest('hex');
  const pairId = createHash('sha256').update(JSON.stringify({
    boundaryDate,
    issuerCik: number(boundary.issuerCik),
    predecessorIntervalId: predecessor?.intervalId,
    successorIntervalId: successor?.intervalId,
    beforeAccession: before?.accession,
    afterAccession: after?.accession,
  })).digest('hex');
  if (
    boundary.contract !== 'urc.auditor-boundary-selection.v1'
    || boundary.intervalIdScheme !== 'issuer_cik:effective_from'
    || typeof boundary.issuerCik !== 'number' || !Number.isSafeInteger(boundary.issuerCik)
    || !issuerCik || issuerCik !== oracleCik || issuerCik !== predecessorCik || issuerCik !== successorCik
    || !isIsoDate(boundaryDate) || !isIsoDate(predecessorFrom) || !isIsoDate(successorFrom)
    || predecessorTo !== boundaryDate || successorFrom !== boundaryDate
    || (successorTo !== null && (!isIsoDate(successorTo) || successorFrom >= successorTo))
    || predecessorFrom >= boundaryDate
    || predecessor?.intervalId !== predecessorId || successor?.intervalId !== successorId
    || !rawEventValid(predecessor) || !rawEventValid(successor)
    || !rawTransitionValid
    || !predecessorFirm.trim() || predecessorFirm !== predecessorFirm.trim()
    || !successorFirm.trim() || successorFirm !== successorFirm.trim()
    || predecessorFirm.toLocaleLowerCase() === successorFirm.toLocaleLowerCase()
    || boundary.side !== side || selection?.selectedIntervalId !== selected?.intervalId
    || exactSecAccession(selection?.accession) !== accession
    || selection?.dateFiled !== filingDate
    || selection?.effectiveFromInclusive !== selected?.effectiveFromInclusive
    || selection?.effectiveToExclusive !== selected?.effectiveToExclusive
    || selection?.expectedFirmName !== selected?.firmName
    || selection?.reciprocalRejectedFirmName !== opposite?.firmName
    || selection?.intervalPredicate !== 'effectiveFromInclusive <= dateFiled AND (effectiveToExclusive IS NULL OR dateFiled < effectiveToExclusive)'
    || selection?.selectionPredicate !== 'selectionWindow.fromInclusive <= dateFiled < selectionWindow.toExclusive'
    || !intervalContains || !selectionContains
    || window?.fromInclusive !== expectedWindowFrom || window?.toExclusive !== expectedWindowTo
    || !before || !after
    || !/^\d{18}$/.test(beforeAccession) || !/^\d{18}$/.test(afterAccession)
    || beforeAccession === afterAccession
    || !beforeAccession.startsWith(paddedIssuerCik) || !afterAccession.startsWith(paddedIssuerCik)
    || !exactSecFilingIdentity(before.accession, issuerCik, before.dateFiled)
    || !exactSecFilingIdentity(after.accession, issuerCik, after.dateFiled)
    || !isIsoDate(before.dateFiled) || !isIsoDate(after.dateFiled)
    || before.intervalId !== predecessorId || after.intervalId !== successorId
    || String(before.dateFiled) >= String(boundaryDate) || String(after.dateFiled) < String(boundaryDate)
    || selectedPair?.intervalId !== selected?.intervalId
    || exactSecAccession(selectedPair?.accession) !== accession
    || selectedPair?.dateFiled !== filingDate
    || boundary.pairId !== pairId
    || oracle.auditor !== selection?.expectedFirmName
    || (oracle.polarity === 'negative' && oracle.rejectedAuditor !== selection?.reciprocalRejectedFirmName)
  ) return 'auditor boundary transition, interval, selection, pair, or firm evidence is inconsistent';
  return null;
}

function replayOracleProblem(item: UnknownRecord): string | null {
  const oracle = record(item.oracleEvidence);
  if (!oracle) return 'oracleEvidence is missing';
  if (JSON.stringify(oracle).length > 200_000) return 'oracleEvidence exceeds the bounded per-case size';
  const cls = String(item.cls ?? '');
  const kind = String(oracle.kind ?? '');
  const filingFieldsValid = () => (
    exactSecFilingIdentity(oracle.accession, oracle.cik, oracle.dateFiled)
    && /^[A-Z0-9][A-Z0-9 /-]{0,39}$/.test(String(oracle.form ?? ''))
  );

  if (cls === 'A') {
    return kind === 'filing-target'
      && oracle.source === 'urc_sec_filings'
      && filingFieldsValid()
      && Boolean(String(oracle.companyName ?? '').trim())
      ? null : 'Class A filing oracle is incomplete';
  }
  if (cls === 'B') {
    const polarity = oracle.polarity;
    const sampleKind = oracle.sampleKind;
    const boundaryProblem = auditorBoundaryOracleProblem(oracle);
    return kind === 'auditor-target'
      && (polarity === 'positive' || polarity === 'negative')
      && ['boundary-before', 'boundary-after', 'year-stratum'].includes(String(sampleKind ?? ''))
      && filingFieldsValid()
      && Boolean(String(oracle.auditor ?? '').trim())
      && (polarity !== 'negative' || Boolean(String(oracle.rejectedAuditor ?? '').trim()))
      && oracle.resolutionStatus === 'resolved'
      && oracle.basis === 'latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date'
      && boundaryProblem === null
      ? null : 'Class B raw-Form-AP auditor oracle is incomplete';
  }
  if (cls === 'C' && item.criticalPath === 'topic') {
    const matches = Array.isArray(oracle.matches)
      ? oracle.matches.map(record).filter((value): value is UnknownRecord => value !== null)
      : [];
    const total = number(oracle.total);
    const pageSize = number(oracle.pageSize);
    const poolDepth = number(oracle.poolDepth);
    const identities = matches.map(replayIdentity);
    const predicateDigest = createHash('sha256').update(JSON.stringify(matches)).digest('hex');
    const rankingClaim = record(oracle.rankingClaim);
    const directPoolOrder = Array.isArray(rankingClaim?.directPoolOrder)
      ? rankingClaim.directPoolOrder : [];
    return kind === 'topic-direct-fts'
      && Boolean(String(oracle.topic ?? '').trim())
      && (oracle.form === null || oracle.form === 'UPLOAD')
      && Number.isInteger(total) && total > 0
      && pageSize === 10
      && poolDepth === Math.min(1_000, total)
      && matches.length === poolDepth
      && matches.every(match => (
        exactSecFilingIdentity(match.accession, match.cik, match.date_filed)
        && ['UPLOAD', 'CORRESP'].includes(String(match.form ?? '').toUpperCase())
      ))
      && new Set(identities).size === identities.length
      && oracle.countSource === 'urc_comment_letters.direct-fts-count'
      && oracle.rankSource === 'candidate-rank-order-with-independent-fts-pool'
      && oracle.predicateSource === 'urc_comment_letters.direct-fts-identity'
      && oracle.predicateEvidenceSha256 === predicateDigest
      && rankingClaim?.contract === 'urc.topic-ranking-claim.v1'
      && rankingClaim.claimLevel === 'independent-fts-membership-pool'
      && rankingClaim.topKIdentityClaimed === false
      && rankingClaim.rankEquivalenceClaimed === false
      && rankingClaim.productRpcUsedAsOracle === false
      && rankingClaim.independentSource === 'urc_comment_letters.direct-table-fts'
      && number(rankingClaim.poolDepth) === poolDepth
      && JSON.stringify(directPoolOrder) === JSON.stringify([
        { field: 'date_filed', direction: 'desc' },
        { field: 'accession', direction: 'asc' },
        { field: 'cik', direction: 'asc' },
      ])
      ? null : 'Class C topic direct-FTS oracle is incomplete';
  }
  if (cls === 'C') {
    const letters = Array.isArray(oracle.letters)
      ? oracle.letters.map(record).filter((value): value is UnknownRecord => value !== null)
      : [];
    const identities = letters.map(letter => (
      `${replayIdentity(letter)}:${String(letter.date_filed ?? '')}:${String(letter.filename ?? '')}`
    ));
    return kind === 'thread-direct-table'
      && commentThreadIdentityValid(String(oracle.threadId ?? ''), letters)
      && letters.length > 0 && letters.length <= 200
      && letters.every(letter => (
        exactSecFilingIdentity(letter.accession, letter.cik, letter.date_filed)
        && ['UPLOAD', 'CORRESP'].includes(String(letter.form ?? '').toUpperCase())
        && Boolean(String(letter.filename ?? '').trim())
      ))
      && new Set(identities).size === identities.length
      ? null : 'Class C thread direct-table oracle is incomplete';
  }
  if (cls === 'D') {
    return kind === 'filing-text-target'
      && oracle.source === 'urc_sec_filings+SEC_EFTS'
      && filingFieldsValid()
      && Boolean(String(oracle.queryToken ?? '').trim())
      ? null : 'Class D filing-text oracle is incomplete';
  }
  if (cls === 'E') {
    const companies = Array.isArray(oracle.companies)
      ? oracle.companies.map(record).filter((value): value is UnknownRecord => value !== null)
      : [];
    const ciks = companies.map(company => exactSecCik(company.cik));
    return kind === 'official-sec-ticker-set'
      && oracle.source === 'https://www.sec.gov/files/company_tickers.json'
      && companies.length > 0 && companies.length <= 10
      && ciks.every((cik): cik is string => cik !== null) && new Set(ciks).size === ciks.length
      && companies.every(company => (
        Array.isArray(company.tickers)
        && company.tickers.length > 0
        && company.tickers.length === new Set(company.tickers.map(String)).size
      ))
      ? null : 'Class E official SEC ticker oracle is incomplete';
  }
  if (cls === 'F') {
    const polarity = oracle.polarity;
    return kind === 'entity-target'
      && (polarity === 'positive' || polarity === 'negative')
      && filingFieldsValid()
      && (polarity === 'positive'
        ? Boolean(String(oracle.entityName ?? '').trim())
        : Boolean(String(oracle.targetEntityName ?? '').trim())
          && exactSecCik(oracle.disjointControlCik) !== null
          && Boolean(String(oracle.disjointControlName ?? '').trim()))
      ? null : 'Class F entity oracle is incomplete';
  }
  return `unsupported class ${cls}`;
}

function normalizedReplayAccession(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizedReplayCik(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '').replace(/^0+/, '') || '0';
}

function replayTargetProblem(
  item: UnknownRecord,
  field: 'expectedFiling' | 'forbiddenFiling',
  oracle: UnknownRecord,
): string | null {
  const target = record(item[field]);
  if (!target) return `${field} is missing`;
  const targetAccession = exactSecAccession(target.accession);
  const oracleAccession = exactSecAccession(oracle.accession);
  const targetCik = exactSecCik(target.cik);
  const oracleCik = exactSecCik(oracle.cik);
  if (
    !targetAccession || !oracleAccession || targetAccession !== oracleAccession
    || !targetCik || !oracleCik || targetCik !== oracleCik
    || target.form !== oracle.form
    || target.dateFiled !== oracle.dateFiled
    || !exactSecFilingIdentity(target.accession, target.cik, target.dateFiled)
  ) return `${field} does not match the oracle filing identity`;
  return null;
}

/** Bind every replay case to the exact deployed product route and filters its
 * independent oracle is supposed to exercise. Generic /api/* traffic is not
 * accuracy evidence for a class-specific product path. */
function replayRequestProblem(item: UnknownRecord): string | null {
  const oracle = record(item.oracleEvidence);
  if (!oracle) return 'oracle is missing';
  let url: URL;
  try {
    url = new URL(String(item.requestPath ?? ''), 'https://candidate.invalid');
  } catch {
    return 'requestPath is not a valid relative URL';
  }
  if (`${url.pathname}${url.search}` !== item.requestPath) return 'requestPath is not canonical';
  const params = url.searchParams;
  const cls = String(item.cls ?? '');
  const criticalPath = item.criticalPath == null ? null : String(item.criticalPath);
  const expectedCriticalPath = cls === 'B'
    ? 'auditor'
    : cls === 'C' && oracle.kind === 'topic-direct-fts'
      ? 'topic'
      : null;
  if (criticalPath !== expectedCriticalPath) {
    return `class/oracle requires criticalPath ${expectedCriticalPath ?? 'null'}, observed ${criticalPath ?? 'null'}`;
  }
  const exact = (name: string, expected: unknown) => params.get(name) === String(expected ?? '');
  const allowed = (...names: string[]) => [...params.keys()].every(name => names.includes(name));

  if (cls === 'A') {
    return url.pathname === '/api/es-search'
      && exact('forms', oracle.form) && exact('startdt', oracle.dateFiled) && exact('enddt', oracle.dateFiled)
      && exact('entityName', String(oracle.companyName ?? '').slice(0, 40)) && exact('size', '100')
      && allowed('forms', 'startdt', 'enddt', 'entityName', 'size')
      && replayTargetProblem(item, 'expectedFiling', oracle) === null
      ? null : 'Class A request does not match its filing oracle';
  }
  if (cls === 'B') {
    const auditor = oracle.polarity === 'negative' ? oracle.rejectedAuditor : oracle.auditor;
    const targetField = oracle.polarity === 'negative' ? 'forbiddenFiling' : 'expectedFiling';
    return url.pathname === '/api/es-search'
      && exact('cik', oracle.cik)
      && exact('forms', String(oracle.form ?? '').replace(/\/A$/i, ''))
      && exact('startdt', oracle.dateFiled) && exact('enddt', oracle.dateFiled)
      && exact('auditor', auditor) && exact('size', '100')
      && allowed('cik', 'forms', 'startdt', 'enddt', 'auditor', 'size')
      && replayTargetProblem(item, targetField, oracle) === null
      ? null : 'Class B request does not match its raw-Form-AP oracle';
  }
  if (cls === 'C' && item.criticalPath === 'topic') {
    const formValid = oracle.form === null ? !params.has('form') : exact('form', oracle.form);
    return url.pathname === '/api/letters'
      && exact('q', oracle.topic) && exact('size', '10') && formValid
      && allowed('q', 'form', 'size')
      ? null : 'Class C topic request does not match its direct-FTS oracle';
  }
  if (cls === 'C') {
    return url.pathname === '/api/letters'
      && exact('thread', oracle.threadId) && allowed('thread')
      ? null : 'Class C thread request does not match its direct-table oracle';
  }
  if (cls === 'D') {
    return url.pathname === '/api/es-search'
      && exact('q', `"${String(oracle.queryToken ?? '')}"`)
      && exact('forms', oracle.form) && exact('startdt', oracle.dateFiled) && exact('enddt', oracle.dateFiled)
      && exact('size', '50') && allowed('q', 'forms', 'startdt', 'enddt', 'size')
      && replayTargetProblem(item, 'expectedFiling', oracle) === null
      ? null : 'Class D request does not match its filing-text oracle';
  }
  if (cls === 'E') {
    const companies = Array.isArray(oracle.companies)
      ? oracle.companies.map(record).filter((value): value is UnknownRecord => value !== null)
      : [];
    return url.pathname === '/api/enrich'
      && exact('ciks', companies.map(company => normalizedReplayCik(company.cik)).join(','))
      && allowed('ciks')
      ? null : 'Class E request does not match its official SEC ticker oracle';
  }
  if (cls === 'F') {
    const negative = oracle.polarity === 'negative';
    return url.pathname === '/api/es-search'
      && exact('entityName', negative ? oracle.disjointControlName : oracle.entityName)
      && exact('forms', oracle.form) && exact('startdt', oracle.dateFiled) && exact('enddt', oracle.dateFiled)
      && exact('size', '100') && allowed('entityName', 'forms', 'startdt', 'enddt', 'size')
      && replayTargetProblem(item, negative ? 'forbiddenFiling' : 'expectedFiling', oracle) === null
      ? null : 'Class F request does not match its entity oracle';
  }
  return `unsupported class ${cls}`;
}

function replayObservationProblem(item: UnknownRecord): string | null {
  const outcome = record(item.outcome);
  const observation = record(item.observation);
  const pages = Array.isArray(observation?.pages)
    ? observation.pages.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  if (!outcome || pages.length !== number(outcome.pages) || pages.length < 1) {
    return 'response observation page count does not match the outcome';
  }
  let first: URL;
  try {
    first = new URL(String(item.requestPath ?? ''), 'https://candidate.invalid');
  } catch {
    return 'selection requestPath is invalid';
  }
  const firstParams = new URLSearchParams(first.searchParams);
  firstParams.delete('from');
  let expectedFrom = Number(first.searchParams.get('from') || 0);
  for (const [index, page] of pages.entries()) {
    let observedUrl: URL;
    try {
      observedUrl = new URL(String(page.requestPath ?? ''), 'https://candidate.invalid');
    } catch {
      return `observation page ${index + 1} requestPath is invalid`;
    }
    const comparable = new URLSearchParams(observedUrl.searchParams);
    const from = Number(comparable.get('from') || 0);
    comparable.delete('from');
    if (
      observedUrl.pathname !== first.pathname
      || comparable.toString() !== firstParams.toString()
      || !Number.isSafeInteger(from) || from < 0
      || from !== expectedFrom
    ) return `observation page ${index + 1} is not a canonical continuation of the selected request`;
    if (pages.length > 1) {
      const size = Number(observedUrl.searchParams.get('size') || first.searchParams.get('size') || 0);
      if (!Number.isSafeInteger(size) || size <= 0) {
        return `observation page ${index + 1} has an invalid pagination size`;
      }
      expectedFrom = from + size;
    }
    if (
      !Number.isInteger(number(page.status)) || number(page.status) < 0 || number(page.status) > 599
      || !Number.isSafeInteger(number(page.payloadBytes)) || number(page.payloadBytes) < 0
      || !/^[0-9a-f]{64}$/.test(String(page.payloadSha256 ?? ''))
      || JSON.stringify(page.projection ?? null).length > 1_000_000
      || page.projectionSha256 !== createHash('sha256')
        .update(JSON.stringify(page.projection ?? null))
        .digest('hex')
      || (number(page.status) >= 200 && number(page.status) < 300
        && (!String(page.contentType ?? '').toLowerCase().includes('application/json') || page.projection == null))
    ) return `observation page ${index + 1} has invalid response evidence`;
  }
  if (number(pages[pages.length - 1].status) !== number(outcome.status)) {
    return 'final observed response status does not match the outcome';
  }
  return null;
}

function replayProjectionVerdictProblem(item: UnknownRecord): string | null {
  const outcome = record(item.outcome);
  const oracle = record(item.oracleEvidence);
  const observation = record(item.observation);
  const pageRecords = Array.isArray(observation?.pages)
    ? observation.pages.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  if (!outcome || !oracle || pageRecords.length === 0) return 'projection verdict evidence is incomplete';
  const successful = pageRecords.every(page => number(page.status) >= 200 && number(page.status) < 300);
  let derivedPass = successful;
  let derivation = successful ? null : 'one or more projected responses were not 2xx';
  const cls = String(item.cls ?? '');

  if (derivedPass && ['A', 'B', 'D', 'F'].includes(cls)) {
    const negative = (cls === 'B' || cls === 'F') && oracle.polarity === 'negative';
    const target = record(item[negative ? 'forbiddenFiling' : 'expectedFiling']);
    const selected = new URL(String(item.requestPath), 'https://candidate.invalid');
    const constraints: FilingSearchPrecisionConstraints = cls === 'A' ? {
      cik: String(oracle.cik ?? ''), form: String(oracle.form), dateFiled: String(oracle.dateFiled),
      entityName: String(oracle.companyName ?? '').slice(0, 40),
    } : cls === 'B' ? {
      cik: String(oracle.cik ?? ''), form: String(oracle.form), dateFiled: String(oracle.dateFiled),
      auditor: String(negative ? oracle.rejectedAuditor : oracle.auditor),
    } : cls === 'D' ? {
      form: String(oracle.form), dateFiled: String(oracle.dateFiled), queryToken: String(oracle.queryToken),
    } : {
      cik: String(negative ? oracle.disjointControlCik ?? '' : oracle.cik ?? ''),
      form: String(oracle.form), dateFiled: String(oracle.dateFiled),
      entityName: String(negative ? oracle.disjointControlName : oracle.entityName),
    };
    const seen = new Set<string>();
    let found = false;
    let exactTotal: number | null = null;
    let expectedNegativeFrom = Number(selected.searchParams.get('from') || 0);
    let negativeExhausted = false;
    for (const page of pageRecords) {
      const projection = page.projection;
      const precisionProblem = validateFilingSearchPagePrecision(projection, constraints);
      if (precisionProblem) {
        derivedPass = false;
        derivation = precisionProblem;
        break;
      }
      if (!target) {
        derivedPass = false;
        derivation = 'filing target is missing';
        break;
      }
      const inspection = inspectFilingSearchPage(projection, {
        accession: String(target.accession ?? ''),
        cik: target.cik as string | number | undefined,
        form: String(oracle.form ?? ''),
        dateFiled: String(oracle.dateFiled ?? ''),
      });
      const targetAccession = normalizedReplayAccession(target.accession);
      const targetCik = normalizedReplayCik(target.cik);
      const forbiddenIdentityFound = inspection.identities.some(identity => {
        const [accession, rawCiks = ''] = identity.split('\u0000');
        return accession === targetAccession && rawCiks.split(',').includes(targetCik);
      });
      found ||= negative ? forbiddenIdentityFound : inspection.found;
      if (negative) {
        const observedPath = new URL(String(page.requestPath ?? ''), 'https://candidate.invalid');
        const from = Number(observedPath.searchParams.get('from') || selected.searchParams.get('from') || 0);
        const size = Number(observedPath.searchParams.get('size') || selected.searchParams.get('size') || 0);
        const completeProblem = completeFilingSearchPageProblem(inspection, from, size);
        if (from !== expectedNegativeFrom || completeProblem || (exactTotal !== null && exactTotal !== inspection.total)
          || inspection.identities.some(identity => seen.has(identity))) {
          derivedPass = false;
          derivation = from !== expectedNegativeFrom
            ? `negative-control page starts at ${from}, expected contiguous offset ${expectedNegativeFrom}`
            : completeProblem || 'negative-control pages are inconsistent or duplicated';
          break;
        }
        const exactPageTotal = inspection.total as number;
        exactTotal = exactPageTotal;
        expectedNegativeFrom = from + inspection.received;
        negativeExhausted = exactPageTotal === 0 || expectedNegativeFrom >= exactPageTotal;
        inspection.identities.forEach(identity => seen.add(identity));
      }
    }
    if (derivedPass) {
      if (negative && !negativeExhausted) {
        derivedPass = false;
        derivation = `negative-control pages stopped at ${expectedNegativeFrom}/${String(exactTotal)}`;
      } else if (negative && found) {
        derivedPass = false;
        derivation = 'forbidden target appears in projected results';
      } else if (!negative && !found) {
        derivedPass = false;
        derivation = 'expected target is absent from projected results';
      }
    }
  } else if (derivedPass && cls === 'C') {
    const projection = pageRecords[0].projection;
    if (item.criticalPath === 'topic') {
      const truth: TopicSearchTruth = {
        total: number(oracle.total),
        pageSize: number(oracle.pageSize),
        poolDepth: number(oracle.poolDepth),
        matches: Array.isArray(oracle.matches) ? oracle.matches as TopicSearchTruth['matches'] : [],
        countSource: oracle.countSource as TopicSearchTruth['countSource'],
        rankSource: oracle.rankSource as TopicSearchTruth['rankSource'],
        predicateSource: oracle.predicateSource as TopicSearchTruth['predicateSource'],
        predicateEvidenceSha256: String(oracle.predicateEvidenceSha256 ?? ''),
      };
      derivation = validateTopicSearchResult(
        String(oracle.topic ?? ''), projection, oracle.form === null ? undefined : String(oracle.form), truth,
      );
    } else {
      derivation = validateThreadDetails(
        String(oracle.threadId ?? ''),
        Array.isArray(oracle.letters) ? oracle.letters as Parameters<typeof validateThreadDetails>[1] : [],
        projection,
      );
    }
    derivedPass = derivation === null;
  } else if (derivedPass && cls === 'E') {
    derivation = validateCompanyEnrichment(
      Array.isArray(oracle.companies)
        ? oracle.companies as Parameters<typeof validateCompanyEnrichment>[0]
        : [],
      pageRecords[0].projection,
    );
    derivedPass = derivation === null;
  }

  if (outcome.pass !== derivedPass) {
    return `reported pass=${String(outcome.pass)} but bounded response projection derives pass=${derivedPass}${derivation ? ` (${derivation})` : ''}`;
  }
  return null;
}

function replayPercentile(cases: UnknownRecord[], percentile: number): number {
  const values = cases
    .map(item => number(record(item.outcome)?.ms))
    .filter(value => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  return values.length === 0
    ? NaN
    : values[Math.min(values.length - 1, Math.floor((percentile / 100) * values.length))];
}

function replaySamplingMixProblems(cases: UnknownRecord[]): string[] {
  const problems: string[] = [];
  const identity = (item: UnknownRecord) => {
    const oracle = record(item.oracleEvidence);
    return oracle
      ? `${normalizedReplayAccession(oracle.accession)}\u0000${normalizedReplayCik(oracle.cik)}\u0000${String(oracle.form ?? '')}\u0000${String(oracle.dateFiled ?? '')}`
      : '';
  };
  for (const cls of ['A', 'D']) {
    const items = cases.filter(item => item.cls === cls);
    const keys = items.map(identity);
    if (keys.some(key => !key) || new Set(keys).size !== items.length) {
      problems.push(`Class ${cls} replay targets are not unique`);
    }
  }

  const bCases = cases.filter(item => item.cls === 'B');
  const bOracles = bCases.map(item => record(item.oracleEvidence)).filter((value): value is UnknownRecord => value !== null);
  const bNegative = bOracles.filter(oracle => oracle.polarity === 'negative');
  const bKinds = Object.fromEntries(['boundary-before', 'boundary-after', 'year-stratum'].map(kind => [
    kind, bOracles.filter(oracle => oracle.sampleKind === kind).length,
  ]));
  if (bNegative.length !== 20 || bKinds['boundary-before'] !== 20
    || bKinds['boundary-after'] !== 20 || bKinds['year-stratum'] !== 110) {
    problems.push(
      `Class B replay mix is ${bNegative.length} negatives, ${bKinds['boundary-before']} before, ${bKinds['boundary-after']} after, ${bKinds['year-stratum']} annual; expected 20/20/20/110`,
    );
  }
  const boundaryCases = bCases.filter(item => (
    ['boundary-before', 'boundary-after'].includes(String(record(item.oracleEvidence)?.sampleKind ?? ''))
  ));
  const boundaryGroups = new Map<string, UnknownRecord[]>();
  for (const item of boundaryCases) {
    const pairId = String(record(record(item.oracleEvidence)?.boundaryOracle)?.pairId ?? '');
    boundaryGroups.set(pairId, [...(boundaryGroups.get(pairId) ?? []), item]);
  }
  const boundaryTransitionKeys = new Set<string>();
  if (boundaryGroups.size !== 10 || [...boundaryGroups.entries()].some(([pairId, items]) => {
    const combinations = new Set(items.map(item => {
      const oracle = record(item.oracleEvidence);
      return `${String(oracle?.sampleKind ?? '')}\u0000${String(oracle?.polarity ?? '')}`;
    }));
    const commonDigests = new Set(items.map(item => {
      const boundary = record(record(item.oracleEvidence)?.boundaryOracle);
      return createHash('sha256').update(JSON.stringify({
        pairId: boundary?.pairId,
        boundaryDate: boundary?.boundaryDate,
        issuerCik: boundary?.issuerCik,
        predecessor: boundary?.predecessor,
        successor: boundary?.successor,
        rawTransitionWitness: boundary?.rawTransitionWitness,
        pair: boundary?.pair,
      })).digest('hex');
    }));
    const sideItems = ['boundary-before', 'boundary-after'].map(side => (
      items.filter(item => record(item.oracleEvidence)?.sampleKind === side)
    ));
    const sideDigests = sideItems.map(sideCases => new Set(
      sideCases.map(item => (
        createHash('sha256').update(JSON.stringify(
          record(record(item.oracleEvidence)?.boundaryOracle),
        )).digest('hex')
      )),
    ));
    const sideIdentitySets = sideItems.map(sideCases => new Set(sideCases.map(identity)));
    const firstBoundary = record(record(items[0]?.oracleEvidence)?.boundaryOracle);
    const predecessor = record(firstBoundary?.predecessor);
    const successor = record(firstBoundary?.successor);
    boundaryTransitionKeys.add([
      canonicalSemanticCik(firstBoundary?.issuerCik), firstBoundary?.boundaryDate,
      predecessor?.intervalId, successor?.intervalId,
    ].join('\u0000'));
    return !/^[0-9a-f]{64}$/.test(pairId) || items.length !== 4 || combinations.size !== 4
      || !['boundary-before\u0000positive', 'boundary-before\u0000negative', 'boundary-after\u0000positive', 'boundary-after\u0000negative']
        .every(combination => combinations.has(combination))
      || commonDigests.size !== 1
      || sideDigests.some(digests => digests.size !== 1)
      || sideIdentitySets.some(identities => identities.size !== 1 || ![...identities][0]);
  })) problems.push('Class B boundary replay must contain ten complete, pairId-local, internally identical four-case transition pairs');
  if (boundaryTransitionKeys.size !== 10) {
    problems.push('Class B boundary replay reuses an underlying issuer/interval transition');
  }
  const bByIdentity = new Map<string, UnknownRecord[]>();
  for (const item of bCases) {
    const key = identity(item);
    bByIdentity.set(key, [...(bByIdentity.get(key) ?? []), item]);
  }
  if ([...bByIdentity.entries()].some(([key, items]) => {
    if (!key || items.length < 1 || items.length > 2) return true;
    if (items.length === 1) return record(items[0].oracleEvidence)?.sampleKind !== 'boundary-before'
      && record(items[0].oracleEvidence)?.sampleKind !== 'boundary-after'
      ? false
      : true;
    const oracles = items.map(item => record(item.oracleEvidence)!);
    const pairIds = new Set(oracles.map(oracle => (
      String(record(oracle.boundaryOracle)?.pairId ?? '')
    )));
    return !oracles.every(oracle => oracle.sampleKind === oracles[0].sampleKind)
      || new Set(oracles.map(oracle => oracle.polarity)).size !== 2
      || pairIds.size !== 1 || ![...pairIds][0];
  })) problems.push('Class B replay target reuse does not form exact pairId-local positive/negative boundary pairs');
  const startYear = 2017;
  const currentYear = new Date().getUTCFullYear();
  const years = Array.from({ length: Math.max(0, currentYear - startYear + 1) }, (_, index) => startYear + index);
  const yearTargets = Object.fromEntries(years.map((year, index) => [
    year,
    Math.floor(150 / years.length) + (index < 150 % years.length ? 1 : 0),
  ]));
  for (const [year, expected] of Object.entries(yearTargets)) {
    const actual = bOracles.filter(oracle => String(oracle.dateFiled ?? '').startsWith(`${year}-`)).length;
    if (actual !== expected) problems.push(`Class B year ${year} has ${actual}/${expected} replay cases`);
  }

  const fCases = cases.filter(item => item.cls === 'F');
  const fOracles = fCases.map(item => record(item.oracleEvidence)).filter((value): value is UnknownRecord => value !== null);
  const fNegative = fOracles.filter(oracle => oracle.polarity === 'negative');
  if (fNegative.length !== 20 || fOracles.filter(oracle => oracle.polarity === 'positive').length !== 60) {
    problems.push(`Class F replay mix is ${fNegative.length} negative/${80 - fNegative.length} positive; expected 20/60`);
  }
  if (fNegative.some(oracle => (
    normalizedReplayCik(oracle.disjointControlCik) === normalizedReplayCik(oracle.cik)
    || !isDisjointEntityNameControl(
      String(oracle.targetEntityName ?? ''), String(oracle.disjointControlName ?? ''),
    )
  ))) problems.push('Class F replay contains a non-disjoint negative control');
  const fByIdentity = new Map<string, UnknownRecord[]>();
  for (const item of fCases) {
    const key = identity(item);
    fByIdentity.set(key, [...(fByIdentity.get(key) ?? []), item]);
  }
  if ([...fByIdentity.entries()].some(([key, items]) => {
    if (!key || items.length < 1 || items.length > 2) return true;
    if (items.length === 1) return record(items[0].oracleEvidence)?.polarity !== 'positive';
    return new Set(items.map(item => record(item.oracleEvidence)?.polarity)).size !== 2;
  })) problems.push('Class F replay target reuse does not form 20 exact positive/disjoint-negative pairs');

  const cCases = cases.filter(item => item.cls === 'C');
  const cKeys = cCases.map(item => {
    const oracle = record(item.oracleEvidence);
    return oracle?.kind === 'topic-direct-fts'
      ? `topic:${String(oracle.topic)}:${String(oracle.form)}`
      : `thread:${String(oracle?.threadId ?? '')}`;
  });
  if (new Set(cKeys).size !== cKeys.length) problems.push('Class C replay thread/topic targets are not unique');
  const eCiks = cases.filter(item => item.cls === 'E').flatMap(item => {
    const oracle = record(item.oracleEvidence);
    return Array.isArray(oracle?.companies)
      ? oracle.companies.map(company => exactSecCik(record(company)?.cik) ?? '')
      : [];
  });
  if (eCiks.some(cik => !cik) || new Set(eCiks).size !== eCiks.length) {
    problems.push('Class E replay reuses or omits official CIK targets');
  }
  return problems;
}

const UI_ACTION_SCOPE_REQUIREMENTS: Record<UiActionScope, {
  actions: number; references: number; contentChecks: number; contentReferences: number;
}> = {
  browser: { actions: 131, references: 145, contentChecks: 1, contentReferences: 1 },
  auth: { actions: 3, references: 4, contentChecks: 0, contentReferences: 0 },
};

function uiScopeForFile(file: string): UiActionScope | null {
  if (file.startsWith('tests/e2e-auth/')) return 'auth';
  if (file.startsWith('tests/e2e/')) return 'browser';
  return null;
}

function validateUiActionEvidence(
  report: UnknownRecord | null,
  scope: UiActionScope,
  expectedSha: string,
  problems: string[],
) {
  const label = `${scope} UI-action evidence`;
  if (!report) {
    problems.push(`${label} did not produce a report`);
    return;
  }
  const expected = Object.entries(UI_ACTION_TEST_MAP)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actionId, references]) => ({
      actionId,
      testReferences: references
        .filter(reference => uiScopeForFile(reference.file) === scope)
        .map(reference => ({ file: reference.file, title: reference.title }))
        .sort((left, right) => (
          `${left.file}\u0000${left.title}`.localeCompare(`${right.file}\u0000${right.title}`)
        )),
    }))
    .filter(action => action.testReferences.length > 0);
  const requirement = UI_ACTION_SCOPE_REQUIREMENTS[scope];
  const expectedReferences = expected.reduce((total, action) => total + action.testReferences.length, 0);
  const expectedContent = Object.entries(UI_CONTENT_TEST_MAP)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([contentId, references]) => ({
      contentId,
      testReferences: references
        .filter(reference => uiScopeForFile(reference.file) === scope)
        .map(reference => ({ file: reference.file, title: reference.title }))
        .sort((left, right) => (
          `${left.file}\u0000${left.title}`.localeCompare(`${right.file}\u0000${right.title}`)
        )),
    }))
    .filter(content => content.testReferences.length > 0);
  const expectedContentReferences = expectedContent.reduce(
    (total, content) => total + content.testReferences.length,
    0,
  );
  if (expected.length !== requirement.actions || expectedReferences !== requirement.references) {
    problems.push(
      `${label} checked-in mapping changed to ${expected.length} actions/${expectedReferences} references; release policy requires ${requirement.actions}/${requirement.references}`,
    );
  }
  if (
    report.schema !== UI_ACTION_EVIDENCE_SCHEMA
    || report.scope !== scope
    || report.commitSha !== expectedSha
    || isoEpoch(report.generatedAt) === null
    || report.mappingDigest !== uiActionMappingDigest()
    || report.scopedMappingDigest !== uiActionMappingDigest(scope)
    || report.contentMappingDigest !== uiContentMappingDigest()
    || report.scopedContentMappingDigest !== uiContentMappingDigest(scope)
    || report.pass !== true
    || !Array.isArray(report.problems)
    || report.problems.length !== 0
  ) problems.push(`${label} metadata, exact SHA, mapping digest, or pass state is invalid`);

  const actions = Array.isArray(report.actions)
    ? report.actions.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  const passedActions = actions.filter(action => action.pass === true).length;
  const actualReferences = actions.reduce(
    (total, action) => total + (Array.isArray(action.testReferences) ? action.testReferences.length : 0),
    0,
  );
  const passedReferences = actions.reduce((total, action) => total + (
    Array.isArray(action.testReferences)
      ? action.testReferences.filter(reference => record(reference)?.passed === true).length
      : 0
  ), 0);
  if (
    actions.length !== requirement.actions
    || number(report.expectedActionCount) !== requirement.actions
    || number(report.passedActionCount) !== requirement.actions
    || passedActions !== requirement.actions
    || actualReferences !== requirement.references
    || number(report.expectedTestReferenceCount) !== requirement.references
    || number(report.passedTestReferenceCount) !== requirement.references
    || passedReferences !== requirement.references
  ) problems.push(`${label} did not prove all ${requirement.actions} actions/${requirement.references} test references`);

  const contentChecks = Array.isArray(report.contentChecks)
    ? report.contentChecks.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  const passedContent = contentChecks.filter(content => content.pass === true).length;
  const actualContentReferences = contentChecks.reduce(
    (total, content) => total + (Array.isArray(content.testReferences) ? content.testReferences.length : 0),
    0,
  );
  if (
    expectedContent.length !== requirement.contentChecks
    || expectedContentReferences !== requirement.contentReferences
    || contentChecks.length !== requirement.contentChecks
    || passedContent !== requirement.contentChecks
    || number(report.expectedContentCheckCount) !== requirement.contentChecks
    || number(report.passedContentCheckCount) !== requirement.contentChecks
    || actualContentReferences !== requirement.contentReferences
    || number(report.expectedContentTestReferenceCount) !== requirement.contentReferences
    || number(report.passedContentTestReferenceCount) !== requirement.contentReferences
  ) problems.push(`${label} did not prove all ${requirement.contentChecks} content checks/${requirement.contentReferences} references`);

  for (const [index, expectedAction] of expected.entries()) {
    const action = actions[index];
    const references = Array.isArray(action?.testReferences)
      ? action.testReferences.map(record).filter((value): value is UnknownRecord => value !== null)
      : [];
    if (action?.actionId !== expectedAction.actionId || action?.pass !== true || references.length !== expectedAction.testReferences.length) {
      problems.push(`${label} action ${expectedAction.actionId} is missing, reordered, incomplete, or failed`);
      continue;
    }
    for (const [referenceIndex, expectedReference] of expectedAction.testReferences.entries()) {
      const reference = references[referenceIndex];
      if (
        reference?.file !== expectedReference.file
        || reference?.title !== expectedReference.title
        || reference?.passed !== true
        || !Number.isSafeInteger(number(reference?.executions))
        || number(reference?.executions) < 1
        || !Number.isSafeInteger(number(reference?.assertionCount))
        || number(reference?.assertionCount) < 1
        || !Number.isSafeInteger(number(reference?.interactionCount))
        || number(reference?.interactionCount) < 1
        || !Array.isArray(reference?.problems)
        || reference.problems.length !== 0
      ) {
        problems.push(
          `${label} action ${expectedAction.actionId} lacks a clean executed interaction/assertion for ${expectedReference.file} :: ${expectedReference.title}`,
        );
        break;
      }
    }
  }

  for (const [index, expectedCheck] of expectedContent.entries()) {
    const content = contentChecks[index];
    const references = Array.isArray(content?.testReferences)
      ? content.testReferences.map(record).filter((value): value is UnknownRecord => value !== null)
      : [];
    if (content?.contentId !== expectedCheck.contentId || content?.pass !== true
      || references.length !== expectedCheck.testReferences.length) {
      problems.push(`${label} content check ${expectedCheck.contentId} is missing, reordered, incomplete, or failed`);
      continue;
    }
    for (const [referenceIndex, expectedReference] of expectedCheck.testReferences.entries()) {
      const reference = references[referenceIndex];
      if (
        reference?.file !== expectedReference.file || reference?.title !== expectedReference.title
        || reference?.passed !== true || number(reference?.executions) < 1
        || number(reference?.assertionCount) < 1
        || !Array.isArray(reference?.problems) || reference.problems.length !== 0
      ) {
        problems.push(
          `${label} content check ${expectedCheck.contentId} lacks a clean executed assertion for ${expectedReference.file} :: ${expectedReference.title}`,
        );
        break;
      }
    }
  }

  const sources = Array.isArray(report.sourceReports)
    ? report.sourceReports.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  const labels = sources.map(source => String(source.runLabel ?? ''));
  if (
    sources.length < 1 || sources.length > 8
    || labels.some(value => !value) || new Set(labels).size !== labels.length
    || sources.some(source => (
      source.commitSha !== expectedSha
      || source.fullStatus !== 'passed'
      || !Number.isSafeInteger(number(source.testCount))
      || number(source.testCount) < 1
    ))
  ) problems.push(`${label} source Playwright reports are missing, duplicated, failed, or bound to another SHA`);
}

function availabilityProblems(report: UnknownRecord, label: string, problems: string[]) {
  const availability = record(report.availability);
  if (!availability) {
    problems.push(`${label} did not report availability counters — zero 5xx cannot be proven`);
    return;
  }
  const serverErrors = number(availability.serverErrorResponses);
  const requestErrors = number(availability.requestErrors);
  if (!Number.isFinite(serverErrors) || serverErrors < 0) {
    problems.push(`${label} reported an invalid HTTP 5xx counter`);
  } else if (serverErrors !== 0) {
    problems.push(`${label} observed ${serverErrors} HTTP 5xx response(s) — release requires zero, including retry-hidden responses`);
  }
  if (!Number.isFinite(requestErrors) || requestErrors < 0) {
    problems.push(`${label} reported an invalid request-error counter`);
  } else if (requestErrors !== 0) {
    problems.push(`${label} observed ${requestErrors} transport/request error(s) — release requires zero`);
  }
}

interface SemanticReplayValidation {
  digest: string | null;
  booleanCases: Map<string, boolean>;
  deployedCanaryPass: boolean;
  deployedCanaryTargetIdentity: string | null;
  problems: string[];
}

function semanticReplayResultProblem(value: unknown): string | null {
  const row = record(value);
  if (!row) return 'result is not an object';
  if (
    !exactSecFilingIdentity(row.accession, row.cik, row.fileDate)
    || !String(row.form ?? '').trim()
    || !/^[A-Za-z0-9._-]+$/.test(String(row.document ?? ''))
    || !/^[0-9a-f]{64}$/.test(String(row.officialTextSha256 ?? ''))
  ) return 'result lacks a canonical SEC filing identity and official-text digest';
  return null;
}

function semanticReplayResultIdentity(value: unknown): string | null {
  const row = record(value);
  if (!row || semanticReplayResultProblem(row) !== null) return null;
  return JSON.stringify({
    accession: String(row.accession).replace(/-/g, ''),
    cik: String(row.cik).replace(/^0+/, ''),
    form: String(row.form),
    fileDate: String(row.fileDate),
    document: String(row.document),
    officialTextSha256: String(row.officialTextSha256),
  });
}

function semanticCanaryTargetIdentity(value: unknown): string | null {
  const target = record(value);
  if (
    !target
    || !exactSecFilingIdentity(target.accession, target.cik, target.dateFiled)
    || target.form !== '10-K'
    || !/^[A-Za-z0-9._-]+$/.test(String(target.document ?? ''))
  ) return null;
  return JSON.stringify({
    accession: String(target.accession).replace(/-/g, ''),
    cik: String(target.cik).replace(/^0+/, ''),
    form: target.form,
    dateFiled: target.dateFiled,
    document: target.document,
  });
}

function validateSemanticReplay(semantic: UnknownRecord): SemanticReplayValidation {
  const problems: string[] = [];
  const verdicts = new Map<string, boolean>();
  const replay = record(semantic.replay);
  const manifest = record(semantic.replayEvidenceManifest);
  const expectedKeys = ['boolean', 'booleanDeployedCanary', 'booleanRejected'];
  const actualKeys = replay ? Object.keys(replay).sort() : [];
  const arrays = Object.fromEntries(expectedKeys.map(key => [
    key,
    Array.isArray(replay?.[key]) ? replay![key] as unknown[] : [],
  ])) as Record<string, unknown[]>;
  const count = Object.values(arrays).reduce((sum, rows) => sum + rows.length, 0);
  const digest = replay
    ? createHash('sha256').update(JSON.stringify(replay)).digest('hex')
    : null;
  if (
    !replay || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys.sort())
    || !manifest || manifest.algorithm !== 'sha256'
    || number(manifest.count) !== count || manifest.digest !== digest
  ) problems.push('semantic replay manifest does not canonically bind the exact Boolean replay inventory');

  const detailRows = arrays.boolean.map(record).filter((value): value is UnknownRecord => value !== null);
  if (detailRows.length !== 9 || detailRows.length !== arrays.boolean.length || detailRows.some(row => {
    const query = String(row.query ?? '').trim();
    const results = Array.isArray(row.results) ? row.results : null;
    const identities = results?.map(result => {
      const item = record(result);
      return item ? `${normalizedReplayAccession(item.accession)}\u0000${normalizedReplayCik(item.cik)}\u0000${String(item.document ?? '')}` : '';
    }) ?? [];
    return !query || !results || results.length === 0
      || results.some(result => semanticReplayResultProblem(result) !== null)
      || identities.some(identity => !identity) || new Set(identities).size !== identities.length
      || !record(row.coverage)
      || (Array.isArray(row.degraded) && row.degraded.length > 0);
  })) problems.push('semantic Boolean detail replay contains malformed, empty, duplicate, degraded, or uncovered result evidence');

  const resultIdentityByAccession = new Map<string, string>();
  let contradictoryResultIdentity = false;
  for (const row of detailRows) {
    const results = Array.isArray(row.results) ? row.results : [];
    for (const result of results) {
      const item = record(result);
      const identity = semanticReplayResultIdentity(item);
      if (!item || !identity) continue;
      const accession = String(item.accession).replace(/-/g, '');
      const previous = resultIdentityByAccession.get(accession);
      if (previous !== undefined && previous !== identity) contradictoryResultIdentity = true;
      resultIdentityByAccession.set(accession, identity);
    }
  }
  if (contradictoryResultIdentity) {
    problems.push('semantic Boolean detail replay reuses an accession with contradictory CIK/form/date/document/text evidence');
  }

  const rejectedRows = arrays.booleanRejected
    .map(record).filter((value): value is UnknownRecord => value !== null);
  for (const testCase of BOOLEAN_CASES) {
    let pass = false;
    if (testCase.expect.kind === 'rejected-before-retrieval') {
      const matches = rejectedRows.filter(row => row.query === testCase.query);
      pass = matches.length === 1
        && matches[0].category === testCase.expect.kind
        && matches[0].compiled === false
        && matches[0].planned === false
        && number(matches[0].resultCount) === 0
        && number(matches[0].requestDelta) === 0;
    } else {
      const mainMatches = detailRows.filter(row => row.role == null && row.query === testCase.query);
      const main = mainMatches.length === 1 ? mainMatches[0] : undefined;
      const mainResults = Array.isArray(main?.results)
        ? main!.results.map(record).filter((value): value is UnknownRecord => value !== null)
        : [];
      const mainAccessions = new Set(mainResults.map(row => normalizedReplayAccession(row.accession)));
      const requiredQueries = Array.isArray(main?.requiredQueries) ? main!.requiredQueries.map(String) : [];
      const branches = testCase.branches ?? [];
      pass = mainMatches.length === 1 && mainResults.length > 0
        && JSON.stringify(requiredQueries) === JSON.stringify(branches);
      if (pass && testCase.expect.kind === 'union-superset-of-branches') {
        const witnesses = record(main?.branchWitnesses);
        for (const branch of branches) {
          const branchRows = detailRows.filter(row => row.query === branch && row.role === 'or-branch-window');
          const branchResults = branchRows.length === 1 && Array.isArray(branchRows[0].results)
            ? branchRows[0].results.map(record).filter((value): value is UnknownRecord => value !== null)
            : [];
          const branchAccessions = new Set(branchResults.map(row => exactSecAccession(row.accession)));
          const branchWitnesses = Array.isArray(witnesses?.[branch])
            ? (witnesses![branch] as unknown[]).map(exactSecAccession) : [];
          pass &&= branchRows.length === 1 && branchResults.length > 0 && branchWitnesses.length > 0
            && branchResults.every(row => mainAccessions.has(normalizedReplayAccession(row.accession)))
            && branchWitnesses.every(accession => (
              accession !== null && mainAccessions.has(accession) && branchAccessions.has(accession)
            ));
        }
      } else if (pass && testCase.expect.kind === 'intersection-subset-of-each-branch') {
        for (const branch of branches) {
          const branchRows = detailRows.filter(row => row.query === branch && row.role === 'and-candidate-window');
          const branchResults = branchRows.length === 1 && Array.isArray(branchRows[0].results)
            ? branchRows[0].results.map(record).filter((value): value is UnknownRecord => value !== null)
            : [];
          const branchAccessions = new Set(branchResults.map(row => exactSecAccession(row.accession)));
          const witnesses = branchRows.length === 1 && Array.isArray(branchRows[0].fullExpressionWitnesses)
            ? (branchRows[0].fullExpressionWitnesses as unknown[]).map(exactSecAccession) : [];
          pass &&= branchRows.length === 1 && witnesses.length > 0
            && witnesses.every(accession => (
              accession !== null && mainAccessions.has(accession) && branchAccessions.has(accession)
            ));
        }
        const residualRows = detailRows.filter(row => row.query === 'lease NOT sublease');
        const residual = residualRows.length === 1 ? residualRows[0] : null;
        const residualResults = Array.isArray(residual?.results)
          ? residual!.results.map(record).filter((value): value is UnknownRecord => value !== null) : [];
        const residualAccessions = new Set(residualResults.map(row => normalizedReplayAccession(row.accession)));
        const boundedExpected = Array.isArray(residual?.boundedExpected)
          ? (residual!.boundedExpected as unknown[]).map(exactSecAccession) : [];
        const negativeControls = Array.isArray(residual?.boundedNegativeControls)
          ? (residual!.boundedNegativeControls as unknown[]).map(exactSecAccession) : [];
        pass &&= Boolean(residual) && boundedExpected.length > 0 && negativeControls.length > 0
          && boundedExpected.every(accession => accession !== null && residualAccessions.has(accession))
          && negativeControls.every(accession => accession !== null && !residualAccessions.has(accession));
      } else if (pass && testCase.expect.kind === 'phrase-stricter-than-tokens') {
        const looseQuery = branches[0] ?? '';
        const looseRows = detailRows.filter(row => row.query === looseQuery && row.role === 'loose-token-control-window');
        const loose = looseRows.length === 1 ? looseRows[0] : null;
        const looseResults = Array.isArray(loose?.results)
          ? loose!.results.map(record).filter((value): value is UnknownRecord => value !== null) : [];
        const looseAccessions = new Set(looseResults.map(row => exactSecAccession(row.accession)));
        const exactExpected = Array.isArray(loose?.exactPhraseExpected)
          ? (loose!.exactPhraseExpected as unknown[]).map(exactSecAccession) : [];
        const looseOnly = Array.isArray(loose?.looseOnlyControls)
          ? (loose!.looseOnlyControls as unknown[]).map(exactSecAccession) : [];
        pass &&= Boolean(loose) && exactExpected.length > 0 && looseOnly.length > 0
          && exactExpected.every(accession => (
            accession !== null && mainAccessions.has(accession) && looseAccessions.has(accession)
          ))
          && looseOnly.every(accession => (
            accession !== null && !mainAccessions.has(accession) && looseAccessions.has(accession)
          ));
      }
    }
    verdicts.set(testCase.query, pass);
  }
  if (rejectedRows.length !== 2 || new Set(rejectedRows.map(row => String(row.query))).size !== 2) {
    problems.push('semantic Boolean rejected-query replay must contain exactly two unique no-network controls');
  }
  if ([...verdicts.values()].some(pass => !pass)) {
    problems.push('semantic Boolean case verdict is not derivable as passing from its canonical detailed replay');
  }

  const canaries = arrays.booleanDeployedCanary
    .map(record).filter((value): value is UnknownRecord => value !== null);
  const canary = canaries.length === 1 ? canaries[0] : null;
  const canaryTarget = record(canary?.target);
  const canaryTargetIdentity = semanticCanaryTargetIdentity(canaryTarget);
  const canaryPass = Boolean(
    canary && canaryTargetIdentity
    && /^[0-9a-f]{64}$/.test(String(canary.officialTextSha256 ?? ''))
    && canary.officialTextSha256 === canary.deployedTextSha256
    && String(canary.positiveQuery ?? '').trim() && String(canary.negativeQuery ?? '').trim()
    && number(canary.candidateRequests) === 4
    && canary.secEftsGet === true && canary.filingTextGet === true
    && canary.positiveValidate === true && canary.negativeValidate === true,
  );
  if (!canaryPass) problems.push('semantic deployed Boolean canary is not derivable as passing from exact filing/text/verdict replay');
  return {
    digest,
    booleanCases: verdicts,
    deployedCanaryPass: canaryPass,
    deployedCanaryTargetIdentity: canaryTargetIdentity,
    problems,
  };
}

function semanticTargetIdentity(row: UnknownRecord): string {
  const evidence = record(row.evidence);
  const target = record(evidence?.target);
  if (!target) return '';
  const kind = String(target.kind ?? '');
  switch (String(row.suite ?? '')) {
    case 'entity': return `${kind}\u0000${String(target.ticker ?? '')}\u0000${String(target.query ?? '')}`;
    case 'filing-entity': return `${kind}\u0000${String(target.ticker ?? '')}`;
    case 'xbrl': return `${kind}\u0000${String(target.ticker ?? '')}\u0000${String(target.concept ?? '')}`;
    case 'boolean': return `${kind}\u0000${String(target.query ?? '')}`;
    case 'boolean-deployed': return `${kind}\u0000${semanticCanaryTargetIdentity(target) ?? ''}`;
    case 'equivalence': return `${kind}\u0000${normalizedReplayAccession(target.accession)}`;
    case 'disclosure': return `${kind}\u0000${normalizedReplayAccession(target.accession)}\u0000${String(target.topic ?? '')}`;
    default: return '';
  }
}

function canonicalSemanticTicker(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(value) ? value : null;
}

function canonicalSemanticCik(value: unknown): string | null {
  return exactSecCik(value);
}

function exactSemanticAccession(value: unknown): string | null {
  return typeof value === 'string' && /^\d{18}$/.test(value) ? value : null;
}

const SEMANTIC_ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

function semanticSubmissionsWitnessProblem(
  value: unknown,
  expectedCik: string,
  expectedHasAnnual: boolean,
): string | null {
  const witness = record(value);
  if (!witness) return 'submissions response witness is missing';
  const rawRows = Array.isArray(witness.annualFilings) ? witness.annualFilings : [];
  const annualRows = rawRows.map(record).filter((row): row is UnknownRecord => row !== null);
  const sourceUrl = `https://data.sec.gov/submissions/CIK${expectedCik.padStart(10, '0')}.json`;
  const rowsValid = rawRows.length === annualRows.length
    && annualRows.every(row => (
      typeof row.accession === 'string'
      && /^\d{10}-\d{2}-\d{6}$/.test(row.accession)
      && exactSecFilingIdentity(row.accession, expectedCik, row.filingDate)
      && typeof row.form === 'string' && SEMANTIC_ANNUAL_FORMS.has(row.form)
      && typeof row.primaryDocument === 'string'
      && /^[A-Za-z0-9._-]+$/.test(row.primaryDocument)
    ));
  const annualDigest = createHash('sha256').update(JSON.stringify({
    requestedCik: witness.requestedCik,
    responseCik: witness.responseCik,
    annualFilings: witness.annualFilings,
  })).digest('hex');
  if (
    witness.sourceUrl !== sourceUrl
    || number(witness.responseStatus) !== 200
    || !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(String(witness.contentType ?? ''))
    || !Number.isSafeInteger(witness.payloadBytes) || number(witness.payloadBytes) <= 0
    || !/^[0-9a-f]{64}$/.test(String(witness.payloadSha256 ?? ''))
    || canonicalSemanticCik(witness.requestedCik) !== expectedCik
    || canonicalSemanticCik(witness.responseCik) !== expectedCik
    || !rowsValid || new Set(annualRows.map(row => row.accession)).size !== annualRows.length
    || (annualRows.length > 0) !== expectedHasAnnual
    || witness.annualEvidenceSha256 !== annualDigest
  ) return 'submissions response identity or annual-filing evidence is invalid';
  return null;
}

function semanticAtomWitnessResult(
  value: unknown,
  ticker: string,
): { cik: string | null } | null {
  const witness = record(value);
  if (!witness || typeof witness.payloadText !== 'string') return null;
  const expectedUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=1&output=atom`;
  const matches = [...witness.payloadText.matchAll(/<cik>(\d{1,10})<\/cik>/gi)]
    .map(match => canonicalSemanticCik(match[1]))
    .filter((candidate): candidate is string => candidate !== null);
  if (
    witness.sourceUrl !== expectedUrl
    || number(witness.responseStatus) !== 200
    || !/(?:atom\+xml|application\/xml|text\/xml)/i.test(String(witness.contentType ?? ''))
    || !Number.isSafeInteger(witness.payloadBytes)
    || number(witness.payloadBytes) !== Buffer.byteLength(witness.payloadText)
    || number(witness.payloadBytes) <= 0 || number(witness.payloadBytes) > 1_000_000
    || witness.payloadSha256 !== createHash('sha256').update(witness.payloadText).digest('hex')
    || (matches[0] ?? null) !== (canonicalSemanticCik(witness.returnedCik) ?? null)
  ) return null;
  return { cik: matches[0] ?? null };
}

function semanticAtomWitnessProblem(
  value: unknown,
  ticker: string,
  expectedCik: string,
): string | null {
  return semanticAtomWitnessResult(value, ticker)?.cik === expectedCik
    ? null : 'EDGAR Atom returned-CIK evidence is invalid';
}

function semanticHttpFailureWitnessProblem(value: unknown, expectedUrl: string): string | null {
  const witness = record(value);
  if (!witness || typeof witness.payloadText !== 'string') return 'HTTP failure witness is missing';
  if (
    witness.sourceUrl !== expectedUrl
    || !Number.isSafeInteger(witness.responseStatus)
    || number(witness.responseStatus) < 400 || number(witness.responseStatus) > 599
    || typeof witness.contentType !== 'string'
    || !Number.isSafeInteger(witness.payloadBytes)
    || number(witness.payloadBytes) !== Buffer.byteLength(witness.payloadText)
    || number(witness.payloadBytes) < 0 || number(witness.payloadBytes) > 1_000_000
    || witness.payloadSha256 !== createHash('sha256').update(witness.payloadText).digest('hex')
  ) return 'HTTP failure response evidence is invalid';
  return null;
}

function semanticDisclosureSourceProblem(options: {
  target: UnknownRecord;
  actual: UnknownRecord;
  sourceUrls: string[];
  cik: string;
  accession: string;
  auditor: boolean;
}): string | null {
  const { target, actual, sourceUrls, cik, accession, auditor } = options;
  const document = String(target.document ?? '');
  const resolvedDocument = String(target.resolvedDocument ?? '');
  const scored = record(target.scoredSource);
  const safeDocument = (value: string) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
    && value !== '.' && value !== '..';
  if (!safeDocument(document) || !safeDocument(resolvedDocument) || !scored) {
    return 'primary, resolved, or scored disclosure source is missing';
  }
  const directory = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}`;
  const primaryUrl = `${directory}/${document}`;
  const resolvedUrl = `${directory}/${resolvedDocument}`;
  const exactUrls = (values: string[]) => JSON.stringify(sourceUrls) === JSON.stringify([...new Set(values)]);
  const textLength = number(scored.textLength);
  const textSha256 = String(scored.textSha256 ?? '');
  const shared = Number.isSafeInteger(scored.textLength)
    && textLength >= 5_000
    && /^[0-9a-f]{64}$/.test(textSha256)
    && Number.isSafeInteger(actual.sourceTextLength)
    && number(actual.sourceTextLength) === textLength
    && actual.sourceTextSha256 === textSha256;

  if (auditor) {
    return scored.kind === 'resolved-annual-document'
      && scored.document === resolvedDocument
      && scored.url === resolvedUrl
      && shared
      && /^[0-9a-f]{64}$/.test(String(scored.rawHtmlSha256 ?? ''))
      && actual.sourceHtmlSha256 === scored.rawHtmlSha256
      && exactUrls([primaryUrl, resolvedUrl])
      ? null : 'auditor disclosure source is not the exact resolved annual document and HTML/text digest';
  }
  if (scored.kind === 'resolved-annual-document') {
    return scored.document === resolvedDocument
      && scored.url === resolvedUrl
      && shared
      && exactUrls([primaryUrl, resolvedUrl])
      ? null : 'topic disclosure source is not the exact resolved annual document and text digest';
  }
  if (scored.kind === 'filing-summary-block') {
    const selector = record(scored.selectorSource);
    const blockDocument = String(scored.document ?? '');
    const blockUrl = `${directory}/${blockDocument}`;
    const filingSummaryUrl = `${directory}/FilingSummary.xml`;
    return safeDocument(blockDocument)
      && scored.url === blockUrl
      && typeof scored.blockName === 'string' && scored.blockName.trim().length > 0
      && Number.isSafeInteger(scored.textLength) && textLength >= 200
      && /^[0-9a-f]{64}$/.test(textSha256)
      && Number.isSafeInteger(actual.sourceTextLength)
      && number(actual.sourceTextLength) === textLength
      && actual.sourceTextSha256 === textSha256
      && selector?.kind === 'filing-summary'
      && selector.document === 'FilingSummary.xml'
      && selector.url === filingSummaryUrl
      && /^[0-9a-f]{64}$/.test(String(selector.payloadSha256 ?? ''))
      && exactUrls([primaryUrl, resolvedUrl, filingSummaryUrl, blockUrl])
      ? null : 'topic disclosure source is not the exact FilingSummary-selected block and text digest';
  }
  return 'disclosure scoredSource kind is unsupported';
}

function semanticEvidenceShapeProblem(
  row: UnknownRecord,
  candidateBase: string,
  officialDirectoryCiks = new Map<string, string>(),
): string | null {
  const suite = String(row.suite ?? '');
  const evidence = record(row.evidence);
  const target = record(evidence?.target);
  const expected = record(evidence?.expected);
  const actual = record(evidence?.actual);
  if (!evidence || !target || !expected || !actual) return 'missing target/expected/actual object';
  const kind = String(target.kind ?? '');
  const allowedKinds: Record<string, string[]> = {
    entity: ['entity-ticker', 'entity-name'],
    'filing-entity': ['filing-entity'],
    xbrl: ['xbrl-latest-annual'],
    boolean: ['boolean-case'],
    'boolean-deployed': ['boolean-deployed-canary'],
    equivalence: ['equivalence-agreement', 'equivalence-positive'],
    disclosure: ['disclosure-topic', 'disclosure-auditor'],
  };
  if (!allowedKinds[suite]?.includes(kind)) return `target kind ${kind || 'missing'} is not allowed for suite ${suite}`;
  const sourceUrls = Array.isArray(evidence.sourceUrls) ? evidence.sourceUrls.map(String) : [];
  const parsedUrls = sourceUrls.map(value => {
    try { return new URL(value); } catch { return null; }
  });
  const hasUrl = (predicate: (url: URL) => boolean) => parsedUrls.some(url => url !== null && predicate(url));
  const ticker = canonicalSemanticTicker(target.ticker);
  const cik = canonicalSemanticCik(target.cik ?? target.expectedCik);
  const accession = exactSemanticAccession(target.accession);
  const filingDate = target.date ?? target.dateFiled;
  const secDirectoryBound = hasUrl(url => (
    url.origin === 'https://www.sec.gov' && url.pathname === '/files/company_tickers.json'
  ));
  const secArchiveBound = Boolean(cik && accession && hasUrl(url => (
    url.origin === 'https://www.sec.gov'
    && url.pathname.includes(`/Archives/edgar/data/${Number(cik)}/${accession}/`)
  )));
  const finiteNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

  if (kind === 'entity-ticker') {
    const issuer = ISSUERS.find(item => item.ticker === ticker);
    return issuer && expected.ticker === ticker && canonicalSemanticTicker(actual.ticker) === ticker && secDirectoryBound
      ? null : 'entity-ticker evidence is not bound to a canonical ticker and SEC directory result';
  }
  if (kind === 'entity-name') {
    const visible = Array.isArray(actual.visibleTickers) ? actual.visibleTickers : [];
    const issuer = ISSUERS.find(item => item.ticker === ticker);
    const expectedQuery = issuer?.title.split(/[\s,]+/)[0];
    return issuer && target.query === expectedQuery
      && expected.visibleTicker === ticker
      && visible.length > 0 && visible.every(value => canonicalSemanticTicker(value) !== null)
      && visible.includes(ticker) && secDirectoryBound
      ? null : 'entity-name evidence is not bound to its canonical ticker/query and SEC directory result';
  }
  if (kind === 'filing-entity') {
    const officialCik = canonicalSemanticCik(target.officialCik);
    const expectedCik = canonicalSemanticCik(target.expectedCik);
    const resolved = canonicalSemanticCik(expected.resolvedCik);
    const observed = canonicalSemanticCik(actual.resolvedCik);
    const candidateBound = Boolean(expectedCik && hasUrl(url => (
      url.origin === candidateBase && url.pathname === '/api/es-search'
      && canonicalSemanticCik(url.searchParams.get('cik')) === expectedCik
      && url.searchParams.get('forms') === '10-K,20-F,40-F'
      && url.searchParams.get('size') === '1'
    )));
    const submissionsBound = Boolean(expectedCik && hasUrl(url => (
      url.origin === 'https://data.sec.gov'
      && url.pathname === `/submissions/CIK${expectedCik.padStart(10, '0')}.json`
    )));
    const officialSubmissionsBound = Boolean(officialCik && hasUrl(url => (
      url.origin === 'https://data.sec.gov'
      && url.pathname === `/submissions/CIK${officialCik.padStart(10, '0')}.json`
    )));
    const correction = record(target.edgarCorrection);
    const selection = record(target.selection);
    const officialWitnessValid = Boolean(officialCik
      && semanticSubmissionsWitnessProblem(
        target.officialSubmissions,
        officialCik,
        target.officialHasAnnual === true,
      ) === null);
    const direct = target.resolutionMode === 'official-directory-cik'
      && target.officialHasAnnual === true && expectedCik === officialCik
      && correction?.required === false && correction.reachable === false
      && correction.resolvedCik === null && correction.candidateHasAnnual === false
      && correction.atomEvidence === null && correction.candidateSubmissions === null;
    const corrected = target.resolutionMode === 'edgar-successor-correction'
      && target.officialHasAnnual === false && expectedCik !== officialCik
      && correction?.required === true && correction.reachable === true
      && canonicalSemanticCik(correction.resolvedCik) === expectedCik
      && correction.candidateHasAnnual === true
      && Boolean(ticker && expectedCik
        && semanticAtomWitnessProblem(correction.atomEvidence, ticker, expectedCik) === null
        && semanticSubmissionsWitnessProblem(
          correction.candidateSubmissions,
          expectedCik,
          true,
        ) === null)
      && hasUrl(url => (
        url.origin === 'https://www.sec.gov' && url.pathname === '/cgi-bin/browse-edgar'
        && url.searchParams.get('action') === 'getcompany'
        && url.searchParams.get('ticker') === ticker
        && url.searchParams.get('type') === '10-K'
        && url.searchParams.get('owner') === 'include'
        && url.searchParams.get('count') === '1'
        && url.searchParams.get('output') === 'atom'
      ));
    const selectionBound = Boolean(selection
      && Number.isSafeInteger(selection.directoryOrdinal) && number(selection.directoryOrdinal) >= 0
      && Number.isSafeInteger(selection.scoredOrdinal) && number(selection.scoredOrdinal) >= 1
      && Number.isSafeInteger(selection.replacementCountBefore) && number(selection.replacementCountBefore) >= 0
      && number(selection.replacementCountBefore)
        === number(selection.directoryOrdinal) - (number(selection.scoredOrdinal) - 1));
    return ticker && officialCik && officialDirectoryCiks.get(ticker) === officialCik
      && expectedCik && resolved === expectedCik && observed === expectedCik
      && expected.deployedAnnual === true && actual.deployedAnnual === true
      && secDirectoryBound && officialSubmissionsBound && submissionsBound && candidateBound
      && officialWitnessValid
      && (direct || corrected) && selectionBound
      ? null : 'filing-entity evidence is not bound to ticker, expected CIK, official submissions, and deployed retrieval';
  }
  if (kind === 'xbrl-latest-annual') {
    const aliases: Record<string, string[]> = {
      revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense', 'InterestAndDividendIncomeOperating'],
      netIncome: ['NetIncomeLoss', 'ProfitLoss'],
      assets: ['Assets'],
      equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
    };
    const concept = String(target.concept ?? '');
    const allowedTags = aliases[concept] ?? [];
    const candidates = Array.isArray(expected.candidates)
      ? expected.candidates.map(record).filter((value): value is UnknownRecord => value !== null) : [];
    const periodEnd = String(expected.periodEnd ?? '');
    const year = expected.year;
    const companyFactsBound = Boolean(cik && hasUrl(url => (
      url.origin === 'https://data.sec.gov'
      && url.pathname === `/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`
    )));
    const conceptUrls = parsedUrls.filter((url): url is URL => (
      url !== null && url.pathname.includes('/api/xbrl/companyconcept/')
    ));
    const sourceBound = Boolean(cik && companyFactsBound && conceptUrls.length > 0
      && conceptUrls.every(url => {
        const prefix = `/api/xbrl/companyconcept/CIK${cik.padStart(10, '0')}/us-gaap/`;
        const tag = url.pathname.startsWith(prefix) && url.pathname.endsWith('.json')
          ? decodeURIComponent(url.pathname.slice(prefix.length, -5)) : '';
        return url.origin === 'https://data.sec.gov' && allowedTags.includes(tag);
      }));
    const issuer = ISSUERS.slice(0, 5).find(item => item.ticker === ticker && item.cik === cik);
    return issuer && cik && allowedTags.length > 0
      && candidates.length > 0 && candidates.every(candidate => (
        typeof candidate.tag === 'string' && allowedTags.includes(candidate.tag)
        && finiteNumber(candidate.val) && candidate.end === periodEnd
        && /^10-K(?:\/A)?$/.test(String(candidate.form ?? '')) && candidate.fp === 'FY'
      ))
      && isIsoDate(periodEnd) && Number.isSafeInteger(year) && year === Number(periodEnd.slice(0, 4))
      && finiteNumber(actual.value) && isIsoDate(actual.periodEnd)
      && Number.isSafeInteger(actual.year) && sourceBound
      ? null : 'XBRL evidence lacks typed latest-annual values or target-bound companyconcept provenance';
  }
  if (kind === 'equivalence-agreement' || kind === 'equivalence-positive') {
    const issuer = ISSUERS.find(item => item.ticker === ticker && item.cik === cik);
    const document = String(target.document ?? '');
    const selection = record(target.selection);
    const selectionBound = Boolean(selection
      && Number.isSafeInteger(selection.candidateOrdinal) && number(selection.candidateOrdinal) >= 0
      && Number.isSafeInteger(selection.scoredOrdinal) && number(selection.scoredOrdinal) >= 1
      && Number.isSafeInteger(selection.replacementCountBefore) && number(selection.replacementCountBefore) >= 0
      && number(selection.replacementCountBefore)
        === number(selection.candidateOrdinal) - (number(selection.scoredOrdinal) - 1));
    const exactArchiveBound = Boolean(cik && accession && /^[A-Za-z0-9._-]+$/.test(document)
      && hasUrl(url => url.href === `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${document}`));
    if (!issuer || !cik || !accession || !accession.startsWith(cik.padStart(10, '0'))
      || !exactSecFilingIdentity(accession, cik, filingDate) || target.form !== '10-K'
      || !secArchiveBound || !exactArchiveBound || !selectionBound) {
      return 'equivalence evidence lacks a canonical filing target or target-bound SEC archive source';
    }
    if (kind === 'equivalence-agreement') {
      return expected.agreements === 5
        && actual.agreements === 5 ? null : 'equivalence agreement counts are not the exact five-probe contract';
    }
    return expected.minimumHits === 1
      && Number.isSafeInteger(actual.hits) && number(actual.hits) >= 1 && number(actual.hits) <= 5
      ? null : 'equivalence positive counts are outside the one-to-five probe contract';
  }
  if (kind === 'disclosure-topic') {
    const topicCase = TOPIC_CASES.find(item => item.topicId === target.topic);
    const terms = Array.isArray(expected.mustContain) ? expected.mustContain : [];
    const issuer = ISSUERS.find(item => item.ticker === ticker && item.cik === cik);
    const sourceProblem = cik && accession ? semanticDisclosureSourceProblem({
      target, actual, sourceUrls, cik, accession, auditor: false,
    }) : 'missing filing identity';
    return issuer && accession && exactSecFilingIdentity(accession, cik, filingDate) && topicCase
      && accession.startsWith(issuer.cik.padStart(10, '0'))
      && target.form === '10-K' && secArchiveBound && sourceProblem === null
      && expected.found === true
      && JSON.stringify(terms) === JSON.stringify(topicCase.mustContain)
      && actual.found === true && typeof actual.hit === 'string' && terms.includes(actual.hit)
      && ['heading', 'density'].includes(String(actual.matchKind ?? ''))
      && Number.isSafeInteger(actual.textLength) && number(actual.textLength) > 0
      && number(actual.textLength) <= 2_600
      && number(actual.textLength) <= number(actual.sourceTextLength)
      ? null : 'disclosure topic evidence is not typed and bound to a canonical filing/topic/source';
  }
  if (kind === 'disclosure-auditor') {
    const expectedAuditor = typeof expected.auditor === 'string' ? expected.auditor.trim() : '';
    const actualAuditor = typeof actual.auditor === 'string' ? actual.auditor.trim() : '';
    const issuer = ISSUERS.find(item => item.ticker === ticker && item.cik === cik);
    const sourceProblem = cik && accession ? semanticDisclosureSourceProblem({
      target, actual, sourceUrls, cik, accession, auditor: true,
    }) : 'missing filing identity';
    return issuer && accession && exactSecFilingIdentity(accession, cik, filingDate) && secArchiveBound
      && accession.startsWith(issuer.cik.padStart(10, '0'))
      && target.form === '10-K' && sourceProblem === null
      && typeof target.declaredAuditor === 'string' && target.declaredAuditor === expectedAuditor
      && (expected.pcaobFirmId === null || /^\d{1,10}$/.test(String(expected.pcaobFirmId ?? '')))
      && expectedAuditor.length > 1 && actualAuditor === expectedAuditor
      ? null : 'disclosure auditor evidence is not bound to a canonical filing and non-empty auditor';
  }
  if (kind === 'boolean-case') {
    const testCase = BOOLEAN_CASES.find(item => item.query === target.query);
    return testCase && target.category === testCase.expect.kind
      && JSON.stringify(target.branches) === JSON.stringify(testCase.branches ?? [])
      && expected.replayPass === true && /^[0-9a-f]{64}$/.test(String(actual.replayEvidenceSha256 ?? ''))
      ? null : 'Boolean case evidence does not match the required query/category/branch contract';
  }
  if (kind === 'boolean-deployed-canary') {
    return semanticCanaryTargetIdentity(target) !== null && secArchiveBound
      && expected.replayPass === true && /^[0-9a-f]{64}$/.test(String(actual.replayEvidenceSha256 ?? ''))
      ? null : 'deployed Boolean evidence lacks a canonical target and replay digest';
  }
  return 'unsupported semantic evidence kind';
}

function semanticBreadthProblems(rows: UnknownRecord[]): string[] {
  const problems: string[] = [];
  const names = rows.map(row => `${String(row.suite ?? '')}\u0000${String(row.name ?? '')}`);
  if (names.some(name => name.endsWith('\u0000')) || new Set(names).size !== names.length) {
    problems.push('semantic checks must have unique non-empty (suite,name) identities');
  }
  const targetIdentities = rows.map(semanticTargetIdentity);
  if (targetIdentities.some(identity => !identity) || new Set(targetIdentities).size !== targetIdentities.length) {
    problems.push('semantic checks must cover unique suite-specific structured target identities');
  }
  const kindCount = (suite: string, kind: string) => rows.filter(row => (
    row.suite === suite && record(record(row.evidence)?.target)?.kind === kind
  )).length;
  if (kindCount('entity', 'entity-ticker') !== 32 || kindCount('entity', 'entity-name') !== 32) {
    problems.push('semantic entity sample must contain 32 unique ticker and 32 unique name-resolution targets');
  }
  for (const issuer of ISSUERS) {
    for (const kind of ['entity-ticker', 'entity-name']) {
      const count = rows.filter(row => {
        const target = record(record(row.evidence)?.target);
        return row.suite === 'entity' && target?.kind === kind && target.ticker === issuer.ticker;
      }).length;
      if (count !== 1) problems.push(`semantic entity sample must contain exactly one ${kind} target for ${issuer.ticker}`);
    }
  }
  if (kindCount('filing-entity', 'filing-entity') !== 60) {
    problems.push('semantic filing-entity sample must contain 60 unique ticker resolver targets');
  }
  const filingSelections = rows.filter(row => row.suite === 'filing-entity')
    .map(row => record(record(record(row.evidence)?.target)?.selection))
    .filter((value): value is UnknownRecord => value !== null)
    .sort((left, right) => number(left.scoredOrdinal) - number(right.scoredOrdinal));
  if (filingSelections.length !== 60 || filingSelections.some((selection, index) => (
    number(selection.scoredOrdinal) !== index + 1
    || (index > 0 && number(selection.directoryOrdinal) <= number(filingSelections[index - 1].directoryOrdinal))
    || number(selection.replacementCountBefore) !== number(selection.directoryOrdinal) - index
  ))) {
    problems.push('semantic filing-entity sample does not prove deterministic first-scoreable selection/replacement ordinals');
  }
  const xbrlRows = rows.filter(row => row.suite === 'xbrl');
  for (const concept of XBRL_CONCEPTS.map(item => item.key)) {
    if (xbrlRows.filter(row => record(record(row.evidence)?.target)?.concept === concept).length !== 5) {
      problems.push(`semantic XBRL sample must contain exactly five unique ${concept} targets`);
    }
  }
  for (const issuer of ISSUERS.slice(0, 5)) {
    for (const concept of XBRL_CONCEPTS.map(item => item.key)) {
      const count = xbrlRows.filter(row => {
        const target = record(record(row.evidence)?.target);
        return target?.ticker === issuer.ticker && canonicalSemanticCik(target.cik) === issuer.cik
          && target.concept === concept;
      }).length;
      if (count !== 1) problems.push(`semantic XBRL sample must contain ${issuer.ticker}/${concept} exactly once`);
    }
  }
  for (const testCase of BOOLEAN_CASES) {
    const matches = rows.filter(row => {
      const target = record(record(row.evidence)?.target);
      return row.suite === 'boolean' && target?.kind === 'boolean-case'
        && target.query === testCase.query && target.category === testCase.expect.kind;
    });
    if (matches.length !== 1) problems.push(`semantic Boolean sample must contain exactly one ${testCase.expect.kind} target for ${testCase.query}`);
  }
  if (kindCount('boolean-deployed', 'boolean-deployed-canary') !== 1) {
    problems.push('semantic sample must contain exactly one immutable deployed Boolean canary target');
  }
  if (kindCount('equivalence', 'equivalence-agreement') !== 4
    || kindCount('equivalence', 'equivalence-positive') !== 4) {
    problems.push('semantic equivalence sample must contain four agreement and four positive-control targets');
  }
  const equivalenceRows = rows.filter(row => row.suite === 'equivalence');
  const equivalenceTickers = new Set(equivalenceRows.map(row => (
    String(record(record(row.evidence)?.target)?.ticker ?? '')
  )));
  if (equivalenceTickers.size !== 4 || [...equivalenceTickers].some(ticker => !ISSUERS.some(item => item.ticker === ticker))) {
    problems.push('semantic equivalence sample must contain four distinct sanctioned issuers');
  }
  for (const ticker of equivalenceTickers) {
    const tickerRows = equivalenceRows.filter(row => (
      record(record(row.evidence)?.target)?.ticker === ticker
    ));
    const targets = tickerRows.map(row => record(record(row.evidence)?.target))
      .filter((target): target is UnknownRecord => target !== null);
    if (targets.length !== 2 || new Set(targets.map(target => target.kind)).size !== 2
      || new Set(targets.map(target => target.accession)).size !== 1
      || new Set(targets.map(target => canonicalSemanticCik(target.cik))).size !== 1
      || new Set(targets.map(target => target.date)).size !== 1
      || new Set(targets.map(target => target.form)).size !== 1
      || new Set(targets.map(target => target.document)).size !== 1
      || new Set(targets.map(target => JSON.stringify(record(target.selection)))).size !== 1
      || new Set(tickerRows.map(row => JSON.stringify(record(row.evidence)?.sourceUrls))).size !== 1) {
      problems.push(`semantic equivalence sample must pair agreement/positive evidence for ${ticker}`);
    }
  }
  const equivalenceSelections = [...equivalenceTickers].map(ticker => {
    const row = equivalenceRows.find(item => record(record(item.evidence)?.target)?.ticker === ticker);
    const target = record(record(row?.evidence)?.target);
    const selection = record(target?.selection);
    return target && selection ? { target, selection } : null;
  }).filter((value): value is { target: UnknownRecord; selection: UnknownRecord } => value !== null)
    .sort((left, right) => number(left.selection.scoredOrdinal) - number(right.selection.scoredOrdinal));
  if (equivalenceSelections.length !== 4 || equivalenceSelections.some((entry, index) => (
    number(entry.selection.scoredOrdinal) !== index + 1
    || number(entry.selection.candidateOrdinal) !== ISSUERS.findIndex(issuer => (
      issuer.ticker === entry.target.ticker
      && issuer.cik === canonicalSemanticCik(entry.target.cik)
    ))
    || number(entry.selection.candidateOrdinal) !== index
    || number(entry.selection.replacementCountBefore) !== 0
  ))) problems.push('semantic equivalence sample does not prove deterministic first-scoreable issuer selection');
  if (kindCount('disclosure', 'disclosure-auditor') !== 32) {
    problems.push('semantic disclosure sample must contain 32 unique auditor targets');
  }
  for (const topic of TOPIC_CASES.map(item => item.topicId)) {
    const count = rows.filter(row => {
      const target = record(record(row.evidence)?.target);
      return row.suite === 'disclosure' && target?.kind === 'disclosure-topic' && target.topic === topic;
    }).length;
    if (count !== 32) problems.push(`semantic disclosure sample must contain 32 unique ${topic} targets`);
  }
  for (const issuer of ISSUERS) {
    const issuerDisclosureRows = rows.filter(row => {
      const target = record(record(row.evidence)?.target);
      return row.suite === 'disclosure' && target?.ticker === issuer.ticker
        && canonicalSemanticCik(target.cik) === issuer.cik;
    });
    const auditorCount = issuerDisclosureRows.filter(row => (
      record(record(row.evidence)?.target)?.kind === 'disclosure-auditor'
    )).length;
    if (auditorCount !== 1) problems.push(`semantic disclosure sample must contain one auditor target for ${issuer.ticker}`);
    for (const topic of TOPIC_CASES.map(item => item.topicId)) {
      const count = rows.filter(row => {
        const target = record(record(row.evidence)?.target);
        return row.suite === 'disclosure' && target?.kind === 'disclosure-topic'
          && target.ticker === issuer.ticker && canonicalSemanticCik(target.cik) === issuer.cik
          && target.topic === topic;
      }).length;
      if (count !== 1) problems.push(`semantic disclosure sample must contain ${issuer.ticker}/${topic} exactly once`);
    }
    const targets = issuerDisclosureRows.map(row => record(record(row.evidence)?.target))
      .filter((target): target is UnknownRecord => target !== null);
    const filingTuples = new Set(targets.map(target => JSON.stringify({
      accession: target.accession,
      date: target.date,
      form: target.form,
      document: target.document,
      resolvedDocument: target.resolvedDocument,
    })));
    const scoredSources = targets.map(target => record(target.scoredSource))
      .filter((source): source is UnknownRecord => source !== null);
    const resolvedTextDigests = new Set(scoredSources
      .filter(source => source.kind === 'resolved-annual-document')
      .map(source => String(source.textSha256 ?? '')));
    const selectorIdentities = new Set(scoredSources
      .filter(source => source.kind === 'filing-summary-block')
      .map(source => JSON.stringify(record(source.selectorSource))));
    const sourceIdentitiesByUrl = new Map<string, Set<string>>();
    for (const source of scoredSources) {
      const url = String(source.url ?? '');
      const identities = sourceIdentitiesByUrl.get(url) ?? new Set<string>();
      identities.add(JSON.stringify({
        kind: source.kind,
        document: source.document,
        textLength: source.textLength,
        textSha256: source.textSha256,
        blockName: source.blockName ?? null,
        selectorSource: source.selectorSource ?? null,
      }));
      sourceIdentitiesByUrl.set(url, identities);
    }
    if (
      issuerDisclosureRows.length !== TOPIC_CASES.length + 1
      || targets.length !== issuerDisclosureRows.length
      || filingTuples.size !== 1
      || resolvedTextDigests.size !== 1
      || selectorIdentities.size > 1
      || [...sourceIdentitiesByUrl.values()].some(identities => identities.size !== 1)
    ) {
      problems.push(`semantic disclosure sample must bind all topic/auditor evidence for ${issuer.ticker} to one filing and coherent source manifests`);
    }
  }
  return problems;
}

function semanticFilingEntitySelectionProblems(
  semantic: UnknownRecord,
  evidenceRows: UnknownRecord[],
  directoryRows: UnknownRecord[],
): string[] {
  const problems: string[] = [];
  const manifest = record(semantic.filingEntitySelectionManifest);
  const rawTraceRows = Array.isArray(manifest?.rows) ? manifest.rows : [];
  const traceRows = rawTraceRows.map(record).filter((row): row is UnknownRecord => row !== null);
  const directoryProjection = directoryRows.map(row => ({
    ticker: String(row.ticker ?? ''),
    officialCik: String(row.officialCik ?? '').replace(/^0+/, ''),
    title: String(row.title ?? ''),
  }));
  const directoryProjectionDigest = createHash('sha256')
    .update(JSON.stringify(directoryProjection)).digest('hex');
  if (
    !manifest
    || manifest.schema !== 'urc.semantic-filing-entity-selection.v1'
    || manifest.directorySource !== TICKER_DIRECTORY_SOURCE
    || manifest.ordering !== 'canonical-ticker-cik-v1'
    || number(manifest.directoryCount) !== directoryProjection.length
    || manifest.directoryProjectionDigest !== directoryProjectionDigest
    || number(manifest.count) !== traceRows.length
    || rawTraceRows.length !== traceRows.length
    || manifest.algorithm !== 'sha256'
    || manifest.digest !== createHash('sha256').update(JSON.stringify(traceRows)).digest('hex')
  ) {
    problems.push('semantic filing-entity selection manifest is missing or not bound to the complete canonical SEC directory');
    return problems;
  }

  const coverage = record(record(semantic.coverage)?.['filing-entity']);
  const semanticExclusionsRaw = Array.isArray(semantic.exclusions) ? semantic.exclusions : [];
  const semanticExclusions = semanticExclusionsRaw.map(record)
    .filter((row): row is UnknownRecord => row !== null && row.suite === 'filing-entity');
  const filingTargets = evidenceRows.filter(row => row.suite === 'filing-entity')
    .map(row => record(record(row.evidence)?.target))
    .filter((target): target is UnknownRecord => target !== null);
  const targetsByDirectoryOrdinal = new Map<number, UnknownRecord[]>();
  for (const target of filingTargets) {
    const selection = record(target.selection);
    const ordinal = number(selection?.directoryOrdinal);
    const existing = targetsByDirectoryOrdinal.get(ordinal) ?? [];
    existing.push(target);
    targetsByDirectoryOrdinal.set(ordinal, existing);
  }

  let selectedCount = 0;
  let exclusionCount = 0;
  let invalidTrace = false;
  const traceKeys = ['directoryOrdinal', 'ticker', 'officialCik', 'title', 'outcome', 'reasonCode', 'scoredOrdinal', 'expectedCik', 'exclusion', 'decisionEvidence'];
  const allowedReasonCodes = new Set([
    'official-submissions-unreachable',
    'edgar-atom-unreachable',
    'candidate-submissions-unreachable',
    'no-annual-reporting-entity',
  ]);
  for (const [index, trace] of traceRows.entries()) {
    const directory = directoryProjection[index];
    const exactKeys = Object.keys(trace).sort().join('\u0000') === [...traceKeys].sort().join('\u0000');
    const identityValid = Boolean(directory
      && number(trace.directoryOrdinal) === index
      && trace.ticker === directory.ticker
      && canonicalSemanticCik(trace.officialCik) === directory.officialCik
      && trace.title === directory.title);
    if (trace.outcome === 'selected') {
      selectedCount += 1;
      const targets = targetsByDirectoryOrdinal.get(index) ?? [];
      const target = targets[0];
      const selection = record(target?.selection);
      if (
        !exactKeys || !identityValid || targets.length !== 1
        || trace.reasonCode !== null || trace.exclusion !== null || trace.decisionEvidence !== null
        || number(trace.scoredOrdinal) !== selectedCount
        || canonicalSemanticCik(trace.expectedCik) !== canonicalSemanticCik(target?.expectedCik)
        || target?.ticker !== trace.ticker
        || canonicalSemanticCik(target?.officialCik) !== directory.officialCik
        || number(selection?.scoredOrdinal) !== selectedCount
        || number(selection?.replacementCountBefore) !== exclusionCount
      ) invalidTrace = true;
    } else if (trace.outcome === 'excluded') {
      exclusionCount += 1;
      const exclusion = record(trace.exclusion);
      const decision = record(trace.decisionEvidence);
      const reported = semanticExclusions[exclusionCount - 1];
      const officialCik = directory?.officialCik ?? '';
      const submissionsUrl = `https://data.sec.gov/submissions/CIK${officialCik.padStart(10, '0')}.json`;
      const atomUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(String(directory?.ticker ?? ''))}&type=10-K&dateb=&owner=include&count=1&output=atom`;
      let reasonEvidenceValid = false;
      if (trace.reasonCode === 'official-submissions-unreachable') {
        reasonEvidenceValid = Boolean(decision
          && Object.keys(decision).length === 1
          && semanticHttpFailureWitnessProblem(decision.officialSubmissionsFailure, submissionsUrl) === null);
      } else if (trace.reasonCode === 'edgar-atom-unreachable') {
        reasonEvidenceValid = Boolean(decision
          && Object.keys(decision).sort().join('\u0000') === ['atomFailure', 'officialSubmissions'].sort().join('\u0000')
          && semanticSubmissionsWitnessProblem(decision.officialSubmissions, officialCik, false) === null
          && semanticHttpFailureWitnessProblem(decision.atomFailure, atomUrl) === null);
      } else if (trace.reasonCode === 'candidate-submissions-unreachable') {
        const atomResult = semanticAtomWitnessResult(decision?.atomEvidence, String(directory?.ticker ?? ''));
        const candidateUrl = atomResult?.cik
          ? `https://data.sec.gov/submissions/CIK${atomResult.cik.padStart(10, '0')}.json` : '';
        reasonEvidenceValid = Boolean(decision && atomResult?.cik
          && Object.keys(decision).sort().join('\u0000') === [
            'atomEvidence', 'candidateSubmissionsFailure', 'officialSubmissions',
          ].sort().join('\u0000')
          && semanticSubmissionsWitnessProblem(decision.officialSubmissions, officialCik, false) === null
          && semanticHttpFailureWitnessProblem(decision.candidateSubmissionsFailure, candidateUrl) === null);
      } else if (trace.reasonCode === 'no-annual-reporting-entity') {
        const atomResult = semanticAtomWitnessResult(decision?.atomEvidence, String(directory?.ticker ?? ''));
        const candidateWitnessValid = atomResult?.cik == null
          ? decision?.candidateSubmissions === null
          : semanticSubmissionsWitnessProblem(decision?.candidateSubmissions, atomResult.cik, false) === null;
        reasonEvidenceValid = Boolean(decision && atomResult
          && Object.keys(decision).sort().join('\u0000') === [
            'atomEvidence', 'candidateSubmissions', 'officialSubmissions',
          ].sort().join('\u0000')
          && semanticSubmissionsWitnessProblem(decision.officialSubmissions, officialCik, false) === null
          && candidateWitnessValid);
      }
      if (
        !exactKeys || !identityValid || !allowedReasonCodes.has(String(trace.reasonCode ?? ''))
        || trace.scoredOrdinal !== null || trace.expectedCik !== null
        || !exclusion || !reported
        || reported.suite !== 'filing-entity'
        || exclusion.name !== reported.name || exclusion.detail !== reported.detail
        || (targetsByDirectoryOrdinal.get(index)?.length ?? 0) !== 0
        || !reasonEvidenceValid
      ) invalidTrace = true;
    } else {
      invalidTrace = true;
    }
  }
  if (
    invalidTrace
    || traceRows.length < 1
    || traceRows.length > number(coverage?.examineLimit)
    || traceRows[traceRows.length - 1]?.outcome !== 'selected'
    || selectedCount !== 60 || selectedCount !== number(coverage?.scored)
    || exclusionCount !== semanticExclusions.length
    || exclusionCount !== number(coverage?.exclusions)
    || traceRows.length !== number(coverage?.examined)
    || filingTargets.length !== selectedCount
    || targetsByDirectoryOrdinal.size !== selectedCount
  ) {
    problems.push('semantic filing-entity examined selection/exclusion trace does not exactly reconcile canonical directory order and coverage counters');
  }
  const upstreamFailureReasons = new Set([
    'official-submissions-unreachable',
    'edgar-atom-unreachable',
    'candidate-submissions-unreachable',
  ]);
  if (traceRows.some(row => upstreamFailureReasons.has(String(row.reasonCode ?? '')))) {
    problems.push('semantic filing-entity release sample cannot replace a canonical row because of an upstream HTTP failure');
  }
  return problems;
}

function deriveSemanticEvidencePass(
  row: UnknownRecord,
  replay?: SemanticReplayValidation,
  candidateBase = '',
  officialDirectoryCiks = new Map<string, string>(),
): boolean | null {
  const evidence = record(row.evidence);
  const target = record(evidence?.target);
  const expected = record(evidence?.expected);
  const actual = record(evidence?.actual);
  if (!evidence || !target
    || semanticEvidenceShapeProblem(row, candidateBase, officialDirectoryCiks) !== null) return null;
  switch (target.kind) {
    case 'entity-ticker':
      return Boolean(expected && actual && actual.ticker === expected.ticker);
    case 'entity-name':
      return Boolean(
        expected && actual && Array.isArray(actual.visibleTickers)
        && actual.visibleTickers.includes(expected.visibleTicker),
      );
    case 'filing-entity':
      return Boolean(
        expected && actual && actual.resolvedCik === expected.resolvedCik
        && actual.deployedAnnual === true && expected.deployedAnnual === true,
      );
    case 'xbrl-latest-annual': {
      const candidates = Array.isArray(expected?.candidates)
        ? expected.candidates.map(record).filter((value): value is UnknownRecord => value !== null)
        : [];
      return Boolean(
        expected && actual && candidates.length > 0
        && candidates.some(candidate => candidate.val === actual.value)
        && actual.periodEnd === expected.periodEnd
        && actual.year === expected.year,
      );
    }
    case 'equivalence-agreement':
      return Boolean(expected && actual && actual.agreements === expected.agreements);
    case 'equivalence-positive':
      return Boolean(expected && actual && (actual.hits as number) >= (expected.minimumHits as number));
    case 'disclosure-topic':
      return Boolean(
        expected && actual && expected.found === true && actual.found === true
        && Array.isArray(expected.mustContain) && expected.mustContain.includes(actual.hit),
      );
    case 'disclosure-auditor':
      return Boolean(
        expected && actual && Boolean(String(expected.auditor ?? ''))
        && actual.auditor === expected.auditor,
      );
    case 'boolean-case':
      return Boolean(
        replay && expected?.replayPass === true
        && actual?.replayEvidenceSha256 === replay.digest
        && replay.booleanCases.get(String(target.query ?? '')) === true,
      );
    case 'boolean-deployed-canary':
      return Boolean(
        replay && expected?.replayPass === true
        && actual?.replayEvidenceSha256 === replay.digest
        && replay.deployedCanaryPass
        && semanticCanaryTargetIdentity(target) === replay.deployedCanaryTargetIdentity,
      );
    default:
      return null;
  }
}

/** Pure evaluator, exported so every fail-closed rule has deterministic tests. */
export function evaluateReleaseEvidence(input: ReleaseEvidenceInput): UnknownRecord {
  const {
    base, expected, expectedRepository, semantic, tickers, e2e, schemaContract, qualityAttestation,
    candidate, candidateFinal, authProbe, securityHeaders, uiBrowser, uiAuth, finalVersion,
  } = input;
  const problems: string[] = [];
  const warnings: string[] = [];

  try {
    const candidateUrl = new URL(base);
    if (candidateUrl.origin !== base || candidateUrl.protocol !== 'https:' || !candidateUrl.hostname.endsWith('.vercel.app')) {
      problems.push(`release base ${base || '(missing)'} is not an HTTPS Vercel deployment origin`);
    }
  } catch {
    problems.push(`release base ${base || '(missing)'} is not a valid URL`);
  }
  if (!expected.deploymentId.startsWith('dpl_')) problems.push('expected Vercel deployment ID is missing or invalid');
  if (!/^[0-9a-f]{40}$/i.test(expected.sha)) problems.push('expected Git SHA is missing or invalid');
  if (!/^\d{3,}$/.test(expected.schemaVersion)) problems.push('expected schema version is missing or invalid');
  if (!Number.isInteger(expected.schemaMigrationCount) || expected.schemaMigrationCount < 1) problems.push('expected schema migration count is missing or invalid');
  if (!/^[0-9a-f]{64}$/.test(expected.schemaChainChecksum)) problems.push('expected schema-chain checksum is missing or invalid');
  if (expected.schemaChecksumAlgorithm !== 'sha256-v2') problems.push('expected schema checksum algorithm is missing or invalid');
  if (!/^\d+$/.test(expected.repositoryId)) problems.push('expected GitHub repository ID is missing or invalid');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expectedRepository)) {
    problems.push('expected GitHub repository name is missing or invalid');
  }

  if (!semantic) problems.push('semantic suite did not produce a report');
  if (!tickers) problems.push('ticker suite did not produce a report');
  if (!e2e) problems.push('e2e suite did not produce a report');
  if (!schemaContract) problems.push('database schema contract did not produce a report');
  if (!qualityAttestation) problems.push('exact-SHA quality workflows did not produce an attestation');
  if (!candidate) problems.push('immutable-candidate preflight did not produce a report');
  if (!candidateFinal) problems.push('post-sweep immutable-candidate attestation did not produce a report');
  if (!authProbe) problems.push('staged-production credential probe did not produce a report');
  if (!securityHeaders) problems.push('immutable-candidate security headers did not produce a report');
  const databaseFingerprint = validateSchemaContract(schemaContract, expected, problems);
  validateQualityAttestation(qualityAttestation, expectedRepository, expected.sha, problems);
  validateSecurityHeaderEvidence(securityHeaders, base, problems);
  validateUiActionEvidence(uiBrowser, 'browser', expected.sha, problems);
  validateUiActionEvidence(uiAuth, 'auth', expected.sha, problems);

  const officialDirectoryCiks = new Map<string, string>();
  const semanticDirectoryManifest = record(tickers?.coverageManifest);
  const semanticDirectoryRows = Array.isArray(semanticDirectoryManifest?.rows)
    ? semanticDirectoryManifest.rows.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  for (const row of semanticDirectoryRows) {
    const ticker = canonicalSemanticTicker(row.ticker);
    const cik = canonicalSemanticCik(row.officialCik);
    if (ticker && cik && !officialDirectoryCiks.has(ticker)) officialDirectoryCiks.set(ticker, cik);
  }

  // Semantic truth checks.
  const semanticChecks = Array.isArray(semantic?.checks)
    ? semantic.checks as Array<{ suite?: string; passed?: boolean; skipped?: boolean }>
    : [];
  const semanticCheckRecords = Array.isArray(semantic?.checks)
    ? semantic.checks.map(record).filter((value): value is UnknownRecord => value !== null)
    : [];
  const semanticScore = number(semantic?.score);
  const reportedSemanticThreshold = number(semantic?.threshold);
  const criticalSkips = semanticChecks.filter(
    check => check.skipped && CRITICAL_SEMANTIC_SUITES.includes(check.suite as typeof CRITICAL_SEMANTIC_SUITES[number]),
  );
  const criticalFailures = semanticChecks.filter(
    check => !check.skipped && check.passed !== true && CRITICAL_SEMANTIC_SUITES.includes(check.suite as typeof CRITICAL_SEMANTIC_SUITES[number]),
  );
  if (semantic) {
    const semanticReplay = validateSemanticReplay(semantic);
    problems.push(...semanticReplay.problems);
    if (!Number.isFinite(semanticScore) || semanticScore < REQUIRED_SEMANTIC_SCORE) {
      problems.push(`semantic score ${Number.isFinite(semanticScore) ? semanticScore.toFixed(1) : 'n/a'}% is below required ${REQUIRED_SEMANTIC_SCORE}%`);
    }
    if (!Number.isFinite(reportedSemanticThreshold) || reportedSemanticThreshold < REQUIRED_SEMANTIC_SCORE) {
      problems.push(`semantic runner threshold ${Number.isFinite(reportedSemanticThreshold) ? reportedSemanticThreshold : 'n/a'}% is weaker than required ${REQUIRED_SEMANTIC_SCORE}%`);
    }
    for (const suite of CRITICAL_SEMANTIC_SUITES) {
      const suiteChecks = semanticChecks.filter(check => check.suite === suite);
      const scored = suiteChecks.filter(check => !check.skipped).length;
      const skipped = suiteChecks.filter(check => check.skipped).length;
      const failed = suiteChecks.filter(check => !check.skipped && check.passed !== true).length;
      if (scored === 0) problems.push(`critical semantic suite '${suite}' produced no scored checks`);
      if (skipped > 0) problems.push(`critical semantic suite '${suite}' skipped ${skipped} check(s) — release requires zero critical skips`);
      if (failed > 0) problems.push(`critical semantic suite '${suite}' failed ${failed} scored check(s) — release requires 100% critical truth checks`);
    }
    const allSkips = semanticChecks.filter(check => check.skipped).length;
    if (allSkips > 0) problems.push(`semantic suite skipped ${allSkips} target(s) — every release quota must be measured`);
    if (semantic.complete !== true) problems.push('semantic runner did not report complete fail-closed coverage');
    const evidenceManifest = record(semantic.evidenceManifest);
    const evidenceRows = Array.isArray(evidenceManifest?.rows)
      ? evidenceManifest.rows.map(record).filter((value): value is UnknownRecord => value !== null)
      : [];
    const expectedEvidenceRows = semanticCheckRecords
      .filter(check => check.skipped !== true)
      .map(check => ({
        suite: check.suite,
        name: check.name,
        passed: check.passed,
        evidence: check.evidence,
      }));
    const requiredSemanticEvidenceCount = Object.values(REQUIRED_SEMANTIC_SUITES)
      .reduce((sum, value) => sum + value, 0);
    if (
      !evidenceManifest
      || evidenceManifest.algorithm !== 'sha256'
      || number(evidenceManifest.count) !== expectedEvidenceRows.length
      || evidenceRows.length !== expectedEvidenceRows.length
      || expectedEvidenceRows.length !== requiredSemanticEvidenceCount
      || evidenceManifest.digest !== createHash('sha256').update(JSON.stringify(evidenceRows)).digest('hex')
      || JSON.stringify(evidenceRows) !== JSON.stringify(expectedEvidenceRows)
    ) problems.push(`semantic evidence manifest does not canonically bind all ${requiredSemanticEvidenceCount} scored checks`);
    problems.push(...semanticBreadthProblems(evidenceRows));
    problems.push(...semanticFilingEntitySelectionProblems(
      semantic,
      evidenceRows,
      semanticDirectoryRows,
    ));
    let invalidSemanticEvidence = 0;
    for (const row of evidenceRows) {
      const evidence = record(row.evidence);
      const target = record(evidence?.target);
      const sourceUrls = Array.isArray(evidence?.sourceUrls) ? evidence.sourceUrls : [];
      const derivedPass = deriveSemanticEvidencePass(row, semanticReplay, base, officialDirectoryCiks);
      if (
        !evidence || !target || Object.keys(target).length === 0
        || sourceUrls.length < 1 || sourceUrls.length > 8
        || sourceUrls.some(source => {
          try {
            return new URL(String(source)).protocol !== 'https:';
          } catch {
            return true;
          }
        })
        || !Object.prototype.hasOwnProperty.call(evidence, 'expected')
        || !Object.prototype.hasOwnProperty.call(evidence, 'actual')
        || derivedPass === null
        || derivedPass !== row.passed
        || JSON.stringify(evidence).length > 200_000
      ) invalidSemanticEvidence += 1;
    }
    if (invalidSemanticEvidence > 0) {
      problems.push(`semantic evidence manifest contains ${invalidSemanticEvidence} invalid structured oracle/observation record(s)`);
    }
    if (semantic.candidateBase !== base) {
      problems.push(`semantic suite targeted ${String(semantic.candidateBase ?? 'no base')}, expected immutable candidate ${base}`);
    }
    const selectedSuites = Array.isArray(semantic.selectedSuites) ? semantic.selectedSuites.map(String) : [];
    for (const suite of Object.keys(REQUIRED_SEMANTIC_SUITES)) {
      if (!selectedSuites.includes(suite)) problems.push(`required semantic suite '${suite}' was not selected`);
    }
    const semanticCoverage = record(semantic.coverage);
    for (const [suite, requiredTarget] of Object.entries(REQUIRED_SEMANTIC_SUITES)) {
      const suiteCoverage = record(semanticCoverage?.[suite]);
      const directChecks = semanticChecks.filter(check => check.suite === suite);
      const directScored = directChecks.filter(check => !check.skipped).length;
      const directSkipped = directChecks.filter(check => check.skipped).length;
      const directFailed = directChecks.filter(check => !check.skipped && check.passed !== true).length;
      const target = number(suiteCoverage?.target);
      const scored = number(suiteCoverage?.scored);
      const skipped = number(suiteCoverage?.skipped);
      const examined = number(suiteCoverage?.examined);
      const examineLimit = number(suiteCoverage?.examineLimit);
      const failed = number(suiteCoverage?.failed);
      const minimumRate = SEMANTIC_SUITE_MIN_RATES[suite];
      if (!suiteCoverage) {
        problems.push(`semantic suite '${suite}' did not report deterministic coverage`);
      } else if (
        target !== requiredTarget
        || scored !== target
        || skipped !== 0
        || !Number.isSafeInteger(examined)
        || examined < scored + skipped
        || !Number.isSafeInteger(examineLimit)
        || examineLimit <= 0
        || !Number.isInteger(failed)
        || failed < 0
        || failed > scored
        || examined > examineLimit
      ) {
        problems.push(
          `semantic suite '${suite}' coverage scored ${scored}/${target} with ${skipped} skips after examining ${examined}/${examineLimit}; required exact target is ${requiredTarget}`,
        );
      }
      if (
        directScored !== scored
        || directSkipped !== skipped
        || directFailed !== failed
        || directChecks.length !== scored + skipped
      ) {
        problems.push(
          `semantic suite '${suite}' raw checks (${directScored} scored, ${directFailed} failed, ${directSkipped} skipped) do not match reported coverage (${scored} scored, ${failed} failed, ${skipped} skipped)`,
        );
      }
      const suitePassRate = scored > 0 && Number.isInteger(failed)
        ? ((scored - failed) / scored) * 100
        : NaN;
      if (!Number.isFinite(suitePassRate) || suitePassRate < minimumRate) {
        problems.push(
          `semantic suite '${suite}' pass rate ${Number.isFinite(suitePassRate) ? suitePassRate.toFixed(1) : 'n/a'}% is below ${minimumRate}%`,
        );
      }
    }
    availabilityProblems(semantic, 'semantic deployed-path suite', problems);
    const semanticRequests = number(record(semantic.availability)?.logicalRequests);
    if (!Number.isInteger(semanticRequests) || semanticRequests < 0 || semanticRequests > MAX_SEMANTIC_CANDIDATE_REQUESTS) {
      problems.push(
        `semantic candidate request count ${String(semanticRequests)} exceeds or cannot prove ${MAX_SEMANTIC_CANDIDATE_REQUESTS}-request ceiling`,
      );
    }
    if (number(record(semantic.candidateRequestBudget)?.maximum) !== MAX_SEMANTIC_CANDIDATE_REQUESTS) {
      problems.push(`semantic report did not declare the exact ${MAX_SEMANTIC_CANDIDATE_REQUESTS}-request ceiling`);
    }
    const booleanEvidence = record(semantic.booleanExecutionEvidence);
    const deployedCanary = record(booleanEvidence?.deployedCanary);
    if (booleanEvidence?.hybridExactShaExecutor !== true) {
      problems.push('semantic report did not distinguish the checked-out exact-SHA Boolean executor sweep');
    }
    if (
      deployedCanary?.required !== true
      || deployedCanary?.pass !== true
      || deployedCanary?.candidateBase !== base
      || number(deployedCanary?.candidateRequests) !== 4
      || deployedCanary?.secEftsGet !== true
      || deployedCanary?.filingTextGet !== true
      || deployedCanary?.positiveValidate !== true
      || deployedCanary?.negativeValidate !== true
    ) {
      problems.push('semantic report did not prove the four-request immutable Boolean route canary');
    }

    const rawSemanticExclusions = Array.isArray(semantic.exclusions) ? semantic.exclusions : [];
    const semanticExclusionRecords = rawSemanticExclusions.map(record)
      .filter((value): value is UnknownRecord => value !== null);
    const semanticExclusions = rawSemanticExclusions.length;
    if (rawSemanticExclusions.length !== semanticExclusionRecords.length) {
      problems.push('semantic exclusions contain non-object entries');
    }
    if (semanticExclusionRecords.some(exclusion => exclusion.suite === 'equivalence')) {
      problems.push('semantic equivalence release sample must use the exact first four ISSUERS with zero replacement exclusions');
    }
    if (semanticExclusions > 0) {
      warnings.push(`${semanticExclusions} deterministic semantic sampling exclusion(s) were replaced within hard caps and are listed in the raw report`);
    }
  }

  // Full ticker-directory resolution and its deployed-path availability.
  const tickerTotal = number(tickers?.tickers);
  const tickerPass = number(tickers?.pass);
  const tickerEmptyVerified = number(tickers?.emptyVerified);
  const tickerFail = number(tickers?.fail);
  let tickerResolverCanary: UnknownRecord | null = null;
  if (tickers) {
    const accepted = tickerPass + tickerEmptyVerified;
    if (!Number.isFinite(tickerTotal) || tickerTotal < 10_000) {
      problems.push(`ticker suite measured ${Number.isFinite(tickerTotal) ? tickerTotal : 'n/a'} tickers; the full directory was not covered`);
    }
    if (tickerFail !== 0 || accepted !== tickerTotal) {
      problems.push(`ticker resolution accepted ${accepted}/${tickerTotal} with ${tickerFail} failure(s); must be 100% including EDGAR-verified empty issuers`);
    }
    if (tickers.base !== base) problems.push(`ticker suite targeted ${String(tickers.base ?? 'no base')}, expected immutable candidate ${base}`);
    availabilityProblems(tickers, 'ticker suite', problems);

    const manifest = record(tickers.coverageManifest);
    const rawManifestRows = Array.isArray(manifest?.rows) ? manifest.rows : [];
    const manifestRows = rawManifestRows.length > 0
      ? rawManifestRows.map(record).filter((value): value is UnknownRecord => value !== null)
      : [];
    const directoryUniverse = record(manifest?.directoryUniverse);
    if (!manifest) {
      problems.push('ticker suite did not provide a full PASS/EMPTY_VERIFIED coverage manifest');
    } else {
      if (
        manifest.directorySource !== 'https://www.sec.gov/files/company_tickers.json'
        || manifest.source !== 'https://data.sec.gov/submissions/CIK##########.json'
        || manifest.algorithm !== 'sha256'
        || isoEpoch(manifest.generatedAt) === null
        || manifest.generatedAt !== tickers.generatedAt
      ) {
        problems.push('ticker coverage manifest provenance is missing or inconsistent with the report');
      }
      if (number(manifest.count) !== tickerTotal || manifestRows.length !== tickerTotal) {
        problems.push(`ticker coverage manifest contains ${manifestRows.length}/${tickerTotal} official directory rows`);
      }
      if (rawManifestRows.length !== manifestRows.length) {
        problems.push('ticker coverage manifest contains non-object row entries');
      }
      const digest = createHash('sha256').update(JSON.stringify(manifestRows)).digest('hex');
      if (manifest.digest !== digest) problems.push('ticker coverage manifest digest does not match its rows');
      if (
        manifest.complete !== true
        || !Array.isArray(manifest.problems)
        || manifest.problems.length !== 0
      ) {
        problems.push('ticker coverage manifest did not report complete coverage with an empty problems array');
      }
      const directoryFetchedAt = isoEpoch(directoryUniverse?.fetchedAt);
      const manifestGeneratedAt = isoEpoch(manifest.generatedAt);
      if (
        !directoryUniverse
        || directoryUniverse.schema !== TICKER_DIRECTORY_SCHEMA
        || directoryUniverse.source !== TICKER_DIRECTORY_SOURCE
        || number(directoryUniverse.responseStatus) !== 200
        || !/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(String(directoryUniverse.contentType ?? ''))
        || directoryFetchedAt === null
        || manifestGeneratedAt === null
        || directoryFetchedAt > manifestGeneratedAt
        || typeof directoryUniverse.lastModified !== 'string'
        || typeof directoryUniverse.etag !== 'string'
        || !Number.isSafeInteger(directoryUniverse.payloadBytes)
        || number(directoryUniverse.payloadBytes) <= 0
        || !/^[0-9a-f]{64}$/.test(String(directoryUniverse.payloadSha256 ?? ''))
        || directoryUniverse.algorithm !== 'sha256'
        || number(directoryUniverse.minimumExpectedCount) !== TICKER_DIRECTORY_MINIMUM
        || directoryUniverse.complete !== true
        || number(directoryUniverse.count) !== tickerTotal
      ) {
        problems.push('ticker directory universe evidence is missing, incomplete, or not bound to the official SEC payload metadata');
      }

      const keys: string[] = [];
      const tickerNames: string[] = [];
      const directoryProjection: Array<{ ticker: string; officialCik: string; title: string }> = [];
      let invalidRows = 0;
      let manifestPass = 0;
      let manifestEmpty = 0;
      const validPageRow = (value: UnknownRecord | null, officialCik: string) => Boolean(
        value
        && exactSecFilingIdentity(value.accession, officialCik, value.filingDate)
        && /^[A-Z0-9][A-Z0-9 /-]{0,39}$/.test(String(value.form ?? ''))
      );
      for (const row of manifestRows) {
        const ticker = String(row.ticker ?? '');
        const officialCik = String(row.officialCik ?? '').replace(/^0+/, '');
        const resolvedCik = String(row.resolvedCik ?? '').replace(/^0+/, '');
        const candidateAccession = String(row.candidateNewestAccession ?? '').replace(/\D/g, '');
        const secNewestAccessions = Array.isArray(row.secNewestAccessions)
          ? row.secNewestAccessions.map(value => String(value).replace(/\D/g, ''))
          : [];
        const returnedFilings = number(row.returnedFilings);
        const secEligibleFilings = number(row.secEligibleFilings);
        const secSourceCik = String(row.secSourceCik ?? '').replace(/^0+/, '');
        const secRecentRawFilings = number(row.secRecentRawFilings);
        const secArchiveDescriptorCount = number(row.secArchiveDescriptorCount);
        const secRelevantArchiveCount = number(row.secRelevantArchiveCount);
        const rawSecArchiveEvidence = Array.isArray(row.secArchiveEvidence) ? row.secArchiveEvidence : [];
        const secArchiveEvidence = rawSecArchiveEvidence.length > 0
          ? rawSecArchiveEvidence.map(record).filter((value): value is UnknownRecord => value !== null)
          : [];
        const candidatePage = Array.isArray(row.candidatePage)
          ? row.candidatePage.map(record)
          : [];
        const secExpectedPage = Array.isArray(row.secExpectedPage)
          ? row.secExpectedPage.map(record)
          : [];
        const status = String(row.status ?? '');
        const key = `${ticker}\u0000${officialCik}`;
        keys.push(key);
        tickerNames.push(ticker);
        directoryProjection.push({ ticker, officialCik, title: String(row.title ?? '') });
        const archiveNames = secArchiveEvidence.map(value => String(value.name ?? ''));
        const archiveEvidenceValid = (
          rawSecArchiveEvidence.length === secArchiveEvidence.length
          && typeof row.secArchivePlanComplete === 'boolean'
          && Number.isSafeInteger(secArchiveDescriptorCount)
          && secArchiveDescriptorCount >= 0
          && Number.isSafeInteger(secRelevantArchiveCount)
          && secRelevantArchiveCount >= 0
          && secRelevantArchiveCount <= secArchiveDescriptorCount
          && /^[0-9a-f]{64}$/.test(String(row.secArchivePlanSha256 ?? ''))
          && new Set(archiveNames).size === archiveNames.length
          && archiveNames.every((name, index) => index === 0 || archiveNames[index - 1] < name)
          && secArchiveEvidence.every(value => (
            new RegExp(`^CIK${officialCik.padStart(10, '0')}-submissions-[A-Za-z0-9._-]*\\.json$`).test(String(value.name ?? ''))
            && isIsoDate(value.filingTo)
            && String(value.filingTo) >= TICKER_COVERAGE_FLOOR
            && Number.isSafeInteger(value.declaredFilings)
            && number(value.declaredFilings) >= 0
            && number(value.observedFilings) === number(value.declaredFilings)
          ))
          && (row.secArchivePlanComplete === true
            ? secArchiveEvidence.length === secRelevantArchiveCount
            : status === 'PASS'
              && secEligibleFilings >= 5
              && secRelevantArchiveCount > 0
              && secArchiveEvidence.length === 0)
        );
        const title = String(row.title ?? '');
        let invalid = (
          !/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(ticker)
          || !title || title !== title.trim() || title.length > 500 || /[\u0000-\u001F\u007F]/.test(title)
          || !/^[1-9]\d{0,9}$/.test(officialCik)
          || row.officialCik !== officialCik
          || resolvedCik !== officialCik
          || row.resolvedCik !== officialCik
          || secSourceCik !== officialCik
          || row.secSourceCik !== officialCik
          || !/^[0-9a-f]{64}$/.test(String(row.secSubmissionsEvidenceSha256 ?? ''))
          || typeof row.secEligibleFilings !== 'number'
          || !Number.isSafeInteger(secEligibleFilings)
          || secEligibleFilings < 0
          || typeof row.returnedFilings !== 'number'
          || !Number.isSafeInteger(returnedFilings)
          || returnedFilings < 0
          || typeof row.secRecentRawFilings !== 'number'
          || !Number.isSafeInteger(secRecentRawFilings)
          || secRecentRawFilings < 0
          || !archiveEvidenceValid
          || (secEligibleFilings < 5 && row.secArchivePlanComplete !== true)
        );
        if (status === 'PASS') {
          manifestPass += 1;
          const expectedLength = Math.min(5, secEligibleFilings);
          const expectedAccessions = secExpectedPage.map(value => String(value?.accession ?? ''));
          const expectedNewestPageAccessions = secExpectedPage
            .filter(value => value?.filingDate === row.secNewestDate)
            .map(value => String(value?.accession ?? '').replace(/\D/g, ''));
          const newestTieInventoryMayExceedPage = secEligibleFilings > expectedLength
            && expectedNewestPageAccessions.length === expectedLength;
          const paddedOfficialCik = officialCik.padStart(10, '0');
          const expectedPageCanonical = secExpectedPage.every((value, index) => {
            if (index === 0 || !value || !secExpectedPage[index - 1]) return true;
            const previous = secExpectedPage[index - 1]!;
            return String(previous.filingDate) > String(value.filingDate)
              || (previous.filingDate === value.filingDate
                && String(previous.accession) < String(value.accession));
          });
          invalid ||= secEligibleFilings < 1
            || returnedFilings !== expectedLength
            || candidatePage.length !== expectedLength
            || secExpectedPage.length !== expectedLength
            || candidatePage.some(value => !validPageRow(value, officialCik))
            || secExpectedPage.some(value => !validPageRow(value, officialCik))
            || candidatePage.some(value => value?.cik !== officialCik || !String(value.accession ?? '').startsWith(paddedOfficialCik))
            || secExpectedPage.some(value => value?.cik !== officialCik || !String(value.accession ?? '').startsWith(paddedOfficialCik))
            || JSON.stringify(candidatePage) !== JSON.stringify(secExpectedPage)
            || new Set(expectedAccessions).size !== expectedAccessions.length
            || !expectedPageCanonical
            || !/^\d{10}-\d{2}-\d{6}$/.test(String(row.candidateNewestAccession ?? ''))
            || !exactSecFilingIdentity(row.candidateNewestAccession, officialCik, row.candidateNewestDate)
            || !candidateAccession.startsWith(paddedOfficialCik)
            || candidateAccession !== String(candidatePage[0]?.accession ?? '')
            || !isIsoDate(row.candidateNewestDate)
            || !isIsoDate(row.secNewestDate)
            || row.candidateNewestDate !== row.secNewestDate
            || row.candidateNewestDate !== candidatePage[0]?.filingDate
            || secNewestAccessions.length === 0
            || !Array.isArray(row.secNewestAccessions)
            || row.secNewestAccessions.some(value => !/^\d{10}-\d{2}-\d{6}$/.test(String(value)))
            || row.secNewestAccessions.some(value => (
              !exactSecFilingIdentity(value, officialCik, row.secNewestDate)
            ))
            || secNewestAccessions.some(accession => !/^\d{18}$/.test(accession) || !accession.startsWith(paddedOfficialCik))
            || new Set(secNewestAccessions).size !== secNewestAccessions.length
            || JSON.stringify(row.secNewestAccessions) !== JSON.stringify(
              [...row.secNewestAccessions].map(String).sort(),
            )
            || candidateAccession !== secNewestAccessions[0]
            || expectedNewestPageAccessions.length === 0
            || secNewestAccessions.length > secEligibleFilings
            || JSON.stringify(secNewestAccessions.slice(0, expectedNewestPageAccessions.length))
              !== JSON.stringify(expectedNewestPageAccessions)
            || (!newestTieInventoryMayExceedPage
              && secNewestAccessions.length !== expectedNewestPageAccessions.length)
            || !secNewestAccessions.includes(candidateAccession);
        } else if (status === 'EMPTY_VERIFIED') {
          manifestEmpty += 1;
          invalid ||= secEligibleFilings !== 0
            || returnedFilings !== 0
            || candidatePage.length !== 0
            || secExpectedPage.length !== 0
            || candidateAccession !== ''
            || row.candidateNewestDate !== ''
            || row.secNewestDate !== ''
            || secNewestAccessions.length !== 0
            || row.secTruthDetail !== 'SEC submissions confirms no eligible post-2010 filings';
        } else {
          invalid = true;
        }
        if (invalid) invalidRows += 1;
      }
      const sortedKeys = [...keys].sort();
      const keyDigest = createHash('sha256').update(JSON.stringify(keys)).digest('hex');
      const projectionDigest = createHash('sha256').update(JSON.stringify(directoryProjection)).digest('hex');
      if (
        invalidRows > 0
        || new Set(keys).size !== keys.length
        || new Set(tickerNames).size !== tickerNames.length
        || keys.some((key, index) => key !== sortedKeys[index])
      ) {
        problems.push(`ticker coverage manifest has ${invalidRows} invalid row(s), duplicate keys/tickers, or non-canonical ordering`);
      }
      if (manifestPass !== tickerPass || manifestEmpty !== tickerEmptyVerified) {
        problems.push(
          `ticker coverage manifest reconciles ${manifestPass} PASS/${manifestEmpty} EMPTY_VERIFIED rows, report claims ${tickerPass}/${tickerEmptyVerified}`,
        );
      }
      if (manifestPass < 1) {
        problems.push('ticker coverage manifest cannot certify the official directory as entirely empty');
      }
      if (
        manifest.keyDigest !== keyDigest
        || directoryUniverse?.keyDigest !== keyDigest
        || manifest.projectionDigest !== projectionDigest
        || directoryUniverse?.projectionDigest !== projectionDigest
      ) {
        problems.push('ticker coverage key/projection digests do not bind the complete official directory universe');
      }

      const tickerEvidence = record(tickers.evidence);
      tickerResolverCanary = record(tickerEvidence?.resolverCanary);
      const rawCanaryRows = Array.isArray(tickerResolverCanary?.rows) ? tickerResolverCanary.rows : [];
      const canaryRows = rawCanaryRows.length > 0
        ? rawCanaryRows.map(record).filter((value): value is UnknownRecord => value !== null)
        : [];
      const rawSourceFiles = Array.isArray(tickerResolverCanary?.sourceFiles) ? tickerResolverCanary.sourceFiles : [];
      const sourceFiles = rawSourceFiles.length > 0
        ? rawSourceFiles.map(record).filter((value): value is UnknownRecord => value !== null)
        : [];
      const dependencyScope = record(tickerResolverCanary?.dependencyScope);
      let resolverSourceSha256 = '';
      try {
        resolverSourceSha256 = createHash('sha256')
          .update(readFileSync(resolve(process.cwd(), 'src/services/secApi.ts')))
          .digest('hex');
      } catch {
        // A missing checked-out source file must fail the same closed canary
        // validation below; the producer's self-reported hash is never enough.
      }
      const expectedCanaryRows = Array.from(
        { length: TICKER_RESOLVER_CANARY_SIZE },
        (_, index) => manifestRows[Math.floor((index * manifestRows.length) / TICKER_RESOLVER_CANARY_SIZE)],
      );
      const canaryRowsValid = canaryRows.length === TICKER_RESOLVER_CANARY_SIZE
        && rawCanaryRows.length === canaryRows.length
        && expectedCanaryRows.every((expectedRow, index) => {
          const row = canaryRows[index];
          const expectedCik = String(expectedRow?.officialCik ?? '').replace(/^0+/, '');
          return Boolean(
            row && expectedRow
            && row.ticker === expectedRow.ticker
            && row.officialCik === expectedCik
            && row.resolvedCik === expectedCik
            && row.title === expectedRow.title
            && row.resolvedTitle === expectedRow.title
            && row.deployedStatus === expectedRow.status
            && row.pass === true
          );
        });
      const canaryDigest = tickerResolverCanary
        ? createHash('sha256').update(JSON.stringify({
          expectedSha: tickerResolverCanary.expectedSha,
          deploymentId: tickerResolverCanary.deploymentId,
          candidateBase: tickerResolverCanary.candidateBase,
          directoryProjectionDigest: tickerResolverCanary.directoryProjectionDigest,
          sourceFiles: tickerResolverCanary.sourceFiles,
          rows: tickerResolverCanary.rows,
        })).digest('hex')
        : '';
      const uniqueOfficialCikCount = new Set(directoryProjection.map(row => row.officialCik)).size;
      const statusByOfficialCik = new Map<string, string>();
      const truthByOfficialCik = new Map<string, string>();
      let inconsistentCikTruth = false;
      for (const row of manifestRows) {
        const cik = String(row.officialCik ?? '').replace(/^0+/, '');
        const status = String(row.status ?? '');
        const truth = JSON.stringify({
          status,
          candidateNewestAccession: row.candidateNewestAccession,
          candidateNewestDate: row.candidateNewestDate,
          secNewestAccessions: row.secNewestAccessions,
          secNewestDate: row.secNewestDate,
          returnedFilings: row.returnedFilings,
          secEligibleFilings: row.secEligibleFilings,
          secSubmissionsEvidenceSha256: row.secSubmissionsEvidenceSha256,
          secSourceCik: row.secSourceCik,
          secRecentRawFilings: row.secRecentRawFilings,
          secArchivePlanComplete: row.secArchivePlanComplete,
          secArchiveDescriptorCount: row.secArchiveDescriptorCount,
          secRelevantArchiveCount: row.secRelevantArchiveCount,
          secArchivePlanSha256: row.secArchivePlanSha256,
          secArchiveEvidence: row.secArchiveEvidence,
          secTruthDetail: row.secTruthDetail,
          candidatePage: row.candidatePage,
          secExpectedPage: row.secExpectedPage,
        });
        const previous = truthByOfficialCik.get(cik);
        if (previous !== undefined && previous !== truth) inconsistentCikTruth = true;
        truthByOfficialCik.set(cik, truth);
        statusByOfficialCik.set(cik, status);
      }
      if (inconsistentCikTruth) {
        problems.push('ticker coverage manifest contains contradictory filing truth for duplicate official-CIK aliases');
      }
      const newestFilingMatchCount = [...statusByOfficialCik.values()]
        .filter(status => status === 'PASS').length;
      if (
        !tickerEvidence
        || number(tickerEvidence.resolverCikMatches) !== tickerTotal
        || tickerEvidence.candidateSearchInput !== 'resolved CIK'
        || tickerEvidence.independentSource !== 'SEC submissions'
        || !Number.isSafeInteger(tickers.uniqueIssuers)
        || number(tickers.uniqueIssuers) !== uniqueOfficialCikCount
        || !Number.isSafeInteger(tickerEvidence.independentChecks)
        || number(tickerEvidence.independentChecks) !== uniqueOfficialCikCount
        || inconsistentCikTruth
        || number(tickerEvidence.newestFilingMatches) !== newestFilingMatchCount
        || JSON.stringify(tickerEvidence.requiredHitFields) !== JSON.stringify(['accession', 'form', 'file_date', 'ciks'])
        || number(tickerEvidence.groundTruthErrors) !== 0
        || !tickerResolverCanary
        || tickerResolverCanary.schema !== TICKER_RESOLVER_CANARY_SCHEMA
        || tickerResolverCanary.mode !== 'exact-sha-product-resolver-with-bound-official-directory'
        || tickerResolverCanary.productFunction !== 'resolveCompanyInput'
        || tickerResolverCanary.verifyFilingHistory !== false
        || tickerResolverCanary.expectedSha !== expected.sha.toLowerCase()
        || tickerResolverCanary.deploymentId !== expected.deploymentId
        || tickerResolverCanary.candidateBase !== base
        || tickerResolverCanary.directDeployedResolverRoute !== false
        || JSON.stringify(dependencyScope) !== JSON.stringify(TICKER_RESOLVER_DEPENDENCY_SCOPE)
        || tickerResolverCanary.routeLimitation !== TICKER_RESOLVER_ROUTE_LIMITATION
        || tickerResolverCanary.directoryProjectionDigest !== projectionDigest
        || tickerResolverCanary.sampleMethod !== 'canonical-even-spread-v1'
        || number(tickerResolverCanary.requested) !== TICKER_RESOLVER_CANARY_SIZE
        || number(tickerResolverCanary.tested) !== TICKER_RESOLVER_CANARY_SIZE
        || number(tickerResolverCanary.passed) !== TICKER_RESOLVER_CANARY_SIZE
        || rawSourceFiles.length !== sourceFiles.length
        || sourceFiles.length !== 1
        || sourceFiles[0]?.path !== 'src/services/secApi.ts'
        || sourceFiles[0]?.sha256 !== resolverSourceSha256
        || !canaryRowsValid
        || tickerResolverCanary.algorithm !== 'sha256'
        || tickerResolverCanary.digest !== canaryDigest
        || tickerResolverCanary.pass !== true
        || !Array.isArray(tickerResolverCanary.problems)
        || tickerResolverCanary.problems.length !== 0
      ) {
        problems.push('ticker resolver canary is missing, forged, or inconsistent with the exact SHA, candidate, source hash, and full directory evidence');
      }
    }
  }

  // 1,000-point deployed API suite. Every class has its own accuracy and
  // latency floor so an aggregate cannot conceal an auditor/topic collapse.
  const e2eTotal = number(e2e?.total);
  const e2eTotalPass = number(e2e?.totalPass);
  const e2ePassRate = e2eTotal > 0 ? (e2eTotalPass / e2eTotal) * 100 : NaN;
  const perClass = Array.isArray(e2e?.summary)
    ? e2e.summary as Array<{ cls?: string; n?: number; pass?: number; passRate?: number; p95?: number }>
    : [];
  const criticalPaths = Array.isArray(e2e?.criticalPaths)
    ? e2e.criticalPaths as Array<{
      name?: string;
      n?: number;
      passRate?: number;
      p95?: number;
      serverErrorCases?: number;
      requestErrors?: number;
    }>
    : [];
  if (e2e) {
    const expectedClassInventory = Object.keys(CLASS_REQUIREMENTS).sort();
    const observedClassInventory = perClass.map(item => String(item.cls ?? '')).sort();
    if (
      perClass.length !== expectedClassInventory.length
      || new Set(observedClassInventory).size !== expectedClassInventory.length
      || JSON.stringify(observedClassInventory) !== JSON.stringify(expectedClassInventory)
    ) {
      problems.push('e2e summary must contain exactly one row for each class A-F and no unknown or duplicate rows');
    }
    const expectedCriticalInventory = Object.keys(CRITICAL_PATH_REQUIREMENTS).sort();
    const observedCriticalInventory = criticalPaths.map(item => String(item.name ?? '')).sort();
    if (
      criticalPaths.length !== expectedCriticalInventory.length
      || new Set(observedCriticalInventory).size !== expectedCriticalInventory.length
      || JSON.stringify(observedCriticalInventory) !== JSON.stringify(expectedCriticalInventory)
    ) {
      problems.push('e2e criticalPaths must contain exactly one auditor row and one topic row with no unknown or duplicate rows');
    }
    const expectedClasses = Object.keys(CLASS_REQUIREMENTS);
    const reportedClasses = perClass.map(item => String(item.cls ?? ''));
    if (
      perClass.length !== expectedClasses.length
      || new Set(reportedClasses).size !== expectedClasses.length
      || expectedClasses.some(cls => !reportedClasses.includes(cls))
    ) {
      problems.push(`e2e summary must contain exactly one row for each class ${expectedClasses.join('/')}`);
    }
    const expectedCriticalPaths = Object.keys(CRITICAL_PATH_REQUIREMENTS);
    const reportedCriticalPaths = criticalPaths.map(item => String(item.name ?? ''));
    if (
      criticalPaths.length !== expectedCriticalPaths.length
      || new Set(reportedCriticalPaths).size !== expectedCriticalPaths.length
      || expectedCriticalPaths.some(name => !reportedCriticalPaths.includes(name))
    ) {
      problems.push(`e2e criticalPaths must contain exactly one row for each path ${expectedCriticalPaths.join('/')}`);
    }
    if (e2eTotal !== REQUIRED_E2E_CASES) problems.push(`e2e suite ran ${e2eTotal} cases; exactly ${REQUIRED_E2E_CASES} are required`);
    if (!Number.isInteger(e2eTotalPass) || e2eTotalPass < 0 || e2eTotalPass > e2eTotal) {
      problems.push(`e2e suite reported invalid passing denominator ${e2eTotalPass}/${e2eTotal}`);
    }
    if (!Number.isFinite(e2ePassRate) || e2ePassRate < REQUIRED_E2E_SCORE) {
      problems.push(`e2e pass rate ${Number.isFinite(e2ePassRate) ? e2ePassRate.toFixed(1) : 'n/a'}% is below required ${REQUIRED_E2E_SCORE}%`);
    }
    if (e2e.base !== base) problems.push(`e2e suite targeted ${String(e2e.base ?? 'no base')}, expected immutable candidate ${base}`);
    availabilityProblems(e2e, 'e2e suite', problems);

    const sampling = record(e2e.sampling);
    const planned = record(sampling?.planned);
    const plannedClasses = record(planned?.classes);
    const plannedCritical = record(planned?.criticalPaths);
    const generated = record(sampling?.generated);
    const criticalGenerated = record(sampling?.criticalGenerated);
    if (sampling?.complete !== true || number(planned?.total) !== REQUIRED_E2E_CASES) {
      problems.push('e2e sampler did not report a complete exact 1,000-point plan');
    }

    const replay = record(sampling?.replay);
    const replayCases = Array.isArray(replay?.cases)
      ? replay.cases.map(record).filter((value): value is UnknownRecord => value !== null)
      : [];
    const watermark = record(replay?.databaseWatermark);
    if (number(replay?.rngSeed) !== 20260719) problems.push('e2e replay manifest did not report the deterministic RNG seed');
    if (replayCases.length !== REQUIRED_E2E_CASES) {
      problems.push(`e2e replay manifest contains ${replayCases.length}/${REQUIRED_E2E_CASES} cases`);
    }
    const replayIds = replayCases.map(item => String(item.caseId ?? ''));
    if (replayIds.some(id => !id) || new Set(replayIds).size !== replayCases.length) {
      problems.push('e2e replay manifest case IDs are missing or duplicated');
    }
    const replaySelection = replayCases.map(item => ({
      caseId: item.caseId,
      cls: item.cls,
      criticalPath: item.criticalPath ?? null,
      label: item.label,
      requestPath: item.requestPath,
      expectedFiling: item.expectedFiling ?? null,
      forbiddenFiling: item.forbiddenFiling ?? null,
      oracleEvidence: item.oracleEvidence ?? null,
    }));
    const computedSelectionSha256 = createHash('sha256')
      .update(JSON.stringify(replaySelection))
      .digest('hex');
    if (replay?.selectionSha256 !== computedSelectionSha256) {
      problems.push('e2e replay manifest selection digest does not match its cases');
    }
    const computedEvidenceSha256 = createHash('sha256')
      .update(JSON.stringify(replayCases))
      .digest('hex');
    if (replay?.evidenceSha256 !== computedEvidenceSha256) {
      problems.push('e2e replay evidence digest does not bind its oracle, observations, and outcomes');
    }
    const replayPass = replayCases.filter(item => record(item.outcome)?.pass === true).length;
    if (replayPass !== e2eTotalPass) {
      problems.push(`e2e replay outcomes contain ${replayPass} passes, report totalPass is ${e2eTotalPass}`);
    }
    if (replayCases.some(item => {
      const outcome = record(item.outcome);
      return !outcome
        || typeof outcome.pass !== 'boolean'
        || !Number.isInteger(number(outcome.status))
        || !Number.isFinite(number(outcome.ms))
        || number(outcome.ms) < 0
        || number(outcome.pages) < 1
        || number(outcome.examined) < 0
        || !Array.isArray(outcome.statusHistory)
        || outcome.statusHistory.length < 1
        || number(outcome.statusHistory[outcome.statusHistory.length - 1]) !== number(outcome.status)
        || outcome.statusHistory.some(status => !Number.isInteger(number(status)) || number(status) < 0 || number(status) > 599)
        || (outcome.pass === true && (number(outcome.status) < 200 || number(outcome.status) >= 300))
        || (outcome.pass === true && outcome.statusHistory.some(status => number(status) === 0 || number(status) >= 500))
        || (outcome.pass === true && outcome.failure !== null)
        || (outcome.pass === false && !String(outcome.failure ?? '').trim());
    })) {
      problems.push('e2e replay manifest contains an invalid or incomplete case outcome');
    }
    if (replayCases.some(item => (
      !CLASS_REQUIREMENTS[String(item.cls ?? '')]
      || !String(item.label ?? '').trim()
      || !String(item.requestPath ?? '').startsWith('/api/')
      || ![null, 'auditor', 'topic'].includes(
        item.criticalPath == null ? null : String(item.criticalPath),
      )
    ))) {
      problems.push('e2e replay manifest contains an invalid class, critical path, label, or request path');
    }
    const oracleProblems = replayCases
      .map(item => ({ caseId: String(item.caseId ?? ''), problem: replayOracleProblem(item) }))
      .filter(item => item.problem !== null);
    if (oracleProblems.length > 0) {
      problems.push(
        `e2e replay manifest contains ${oracleProblems.length} invalid oracle evidence record(s); first ${oracleProblems[0].caseId}: ${oracleProblems[0].problem}`,
      );
    }
    problems.push(...replaySamplingMixProblems(replayCases));
    const groundTruth = record(sampling?.groundTruth);
    const auditorYears = Array.from(
      { length: new Date().getUTCFullYear() - 2017 + 1 },
      (_, index) => 2017 + index,
    );
    const expectedYearTargets = Object.fromEntries(auditorYears.map((year, index) => [
      String(year),
      Math.floor(150 / auditorYears.length) + (index < 150 % auditorYears.length ? 1 : 0),
    ]));
    const generatedByYear = record(groundTruth?.auditorYearGenerated);
    const positiveByYear = record(groundTruth?.auditorYearPositiveGenerated);
    const negativeByYear = record(groundTruth?.auditorYearNegativeGenerated);
    const reportedTargets = record(groundTruth?.auditorYearTargets);
    const diagnosticsValid = Boolean(
      groundTruth
      && JSON.stringify(groundTruth.auditorYears) === JSON.stringify(auditorYears)
      && JSON.stringify(reportedTargets) === JSON.stringify(expectedYearTargets)
      && auditorYears.every(year => (
        number(generatedByYear?.[year]) === number(expectedYearTargets[year])
        && Number.isSafeInteger(positiveByYear?.[year]) && number(positiveByYear?.[year]) >= 0
        && Number.isSafeInteger(negativeByYear?.[year]) && number(negativeByYear?.[year]) >= 0
        && number(positiveByYear?.[year]) + number(negativeByYear?.[year]) === number(generatedByYear?.[year])
      ))
      && auditorYears.reduce((sum, year) => sum + number(positiveByYear?.[year]), 0) === 130
      && auditorYears.reduce((sum, year) => sum + number(negativeByYear?.[year]), 0) === 20
      && number(groundTruth.auditorPositiveCases) === 130
      && number(groundTruth.auditorNegativeControls) === 20
      && number(groundTruth.auditorRawResolverMismatches) === 0
      && number(groundTruth.auditorBoundaryRawEventMismatches) === 0
      && number(groundTruth.auditorBoundaryRawRangeMismatches) === 0
      && Number.isSafeInteger(groundTruth.auditorRawRowsRead) && number(groundTruth.auditorRawRowsRead) > 0
      && Number.isSafeInteger(groundTruth.auditorBoundaryRawEventRowsRead)
      && number(groundTruth.auditorBoundaryRawEventRowsRead) >= 20
      && Number.isSafeInteger(groundTruth.auditorBoundaryRawRangeRowsRead)
      && number(groundTruth.auditorBoundaryRawRangeRowsRead) >= 20
      && number(groundTruth.auditorBoundaryRawNextEventProbes) === 10
      && Number.isSafeInteger(groundTruth.auditorRawPages) && number(groundTruth.auditorRawPages) > 0
      && number(groundTruth.auditorRawRowHardCapPerChunk) === 5_000
      && Number.isSafeInteger(groundTruth.auditorRawMaxFormFilingId)
      && number(groundTruth.auditorRawMaxFormFilingId) > 0
      && isIsoDate(groundTruth.auditorRawMaxFilingDate)
      && number(groundTruth.auditorBoundaryPairTarget) === 10
      && number(groundTruth.auditorBoundaryPairsGenerated) === 10
      && number(groundTruth.auditorCandidateHardCap) === auditorYears.length * 500
      && number(groundTruth.auditorBoundaryPredecessorHardCap) === auditorYears.length * 200
      && number(groundTruth.auditorBoundaryTransitionHardCap) === 500
      && number(groundTruth.auditorBoundaryCandidateHardCap) === 10_000
      && Number.isSafeInteger(groundTruth.auditorBoundaryPredecessorsExamined)
      && number(groundTruth.auditorBoundaryPredecessorsExamined) >= 10
      && number(groundTruth.auditorBoundaryPredecessorsExamined) <= number(groundTruth.auditorBoundaryPredecessorHardCap)
      && Number.isSafeInteger(groundTruth.auditorBoundaryTransitionsExamined)
      && number(groundTruth.auditorBoundaryTransitionsExamined) >= 10
      && number(groundTruth.auditorBoundaryTransitionsExamined) <= 500
      && Number.isSafeInteger(groundTruth.auditorBoundaryCandidatesExamined)
      && number(groundTruth.auditorBoundaryCandidatesExamined) >= 20
      && number(groundTruth.auditorBoundaryCandidatesExamined) <= 10_000,
    );
    if (!diagnosticsValid) {
      problems.push('e2e sampler groundTruth does not prove complete zero-mismatch raw Form AP boundary coverage');
    }
    const boundaryManifest = record(groundTruth?.auditorBoundarySelectionManifest);
    const boundaryRows = Array.isArray(boundaryManifest?.rows)
      ? boundaryManifest.rows.map(record).filter((value): value is UnknownRecord => value !== null) : [];
    const derivedBoundaryRows = [...new Map(replayCases.flatMap(item => {
      const boundary = record(record(item.oracleEvidence)?.boundaryOracle);
      if (!boundary) return [];
      return [[String(boundary.pairId), {
        pairId: boundary.pairId,
        boundaryDate: boundary.boundaryDate,
        issuerCik: boundary.issuerCik,
        predecessor: boundary.predecessor,
        successor: boundary.successor,
        rawTransitionWitness: boundary.rawTransitionWitness,
        pair: boundary.pair,
      }] as const];
    })).values()].sort((left, right) => String(left.pairId).localeCompare(String(right.pairId)));
    if (
      !boundaryManifest
      || boundaryManifest.source !== 'urc_auditor_periods_mat+urc_sec_filings+urc_sec_auditors'
      || boundaryManifest.algorithm !== 'sha256'
      || number(boundaryManifest.count) !== 10 || boundaryRows.length !== 10
      || JSON.stringify(boundaryRows) !== JSON.stringify(derivedBoundaryRows)
      || boundaryManifest.digest !== createHash('sha256').update(JSON.stringify(boundaryRows)).digest('hex')
    ) problems.push('e2e sampler did not bind the ten selected period/filing/raw-event boundary rows');
    const watermarkDate = typeof watermark?.capturedAt === 'string'
      ? watermark.capturedAt.slice(0, 10) : '';
    const filingSourceDates = replayCases.flatMap(item => {
      const oracle = record(item.oracleEvidence);
      return ['A', 'B', 'D', 'F'].includes(String(item.cls ?? '')) && isIsoDate(oracle?.dateFiled)
        ? [String(oracle!.dateFiled)] : [];
    });
    const commentLetterSourceDates = replayCases.flatMap(item => {
      if (item.cls !== 'C') return [];
      const oracle = record(item.oracleEvidence);
      const rows = oracle?.kind === 'topic-direct-fts'
        ? oracle.matches : oracle?.kind === 'thread-direct-table' ? oracle.letters : [];
      return Array.isArray(rows)
        ? rows.flatMap(row => {
          const date = record(row)?.date_filed;
          return isIsoDate(date) ? [date] : [];
        })
        : [];
    });
    const rawFormApReplayRows = replayCases.flatMap(item => {
      const boundary = record(record(item.oracleEvidence)?.boundaryOracle);
      if (!boundary) return [];
      return [record(boundary.predecessor), record(boundary.successor)].flatMap(interval => {
        const rows = record(interval?.rawEvent)?.rows;
        return Array.isArray(rows)
          ? rows.map(record).filter((row): row is UnknownRecord => row !== null)
          : [];
      });
    });
    const rawFormApSourceDates = rawFormApReplayRows.flatMap(row => (
      isIsoDate(row.filingDate) ? [row.filingDate] : []
    ));
    const maxRawFormApSourceId = rawFormApReplayRows.reduce(
      (maximum, row) => Math.max(maximum, number(row.formFilingId)),
      0,
    );
    const sortedFilingSourceDates = [...filingSourceDates].sort();
    const sortedCommentLetterSourceDates = [...commentLetterSourceDates].sort();
    const sortedRawFormApSourceDates = [...rawFormApSourceDates].sort();
    const maxFilingSourceDate = sortedFilingSourceDates[sortedFilingSourceDates.length - 1] ?? '';
    const maxCommentLetterSourceDate = sortedCommentLetterSourceDates[sortedCommentLetterSourceDates.length - 1] ?? '';
    const maxRawFormApSourceDate = sortedRawFormApSourceDates[sortedRawFormApSourceDates.length - 1] ?? '';
    if (
      !isIsoDate(watermarkDate)
      || [...filingSourceDates, ...commentLetterSourceDates, ...rawFormApSourceDates]
        .some(date => date > watermarkDate)
      || replayCases.some(item => {
        const boundary = record(record(item.oracleEvidence)?.boundaryOracle);
        return boundary !== null && String(boundary.boundaryDate ?? '') > watermarkDate;
      })
    ) problems.push('e2e replay contains ground-truth dates after its captured database watermark');
    const requestProblems = replayCases
      .map(item => ({ caseId: String(item.caseId ?? ''), problem: replayRequestProblem(item) }))
      .filter(item => item.problem !== null);
    if (requestProblems.length > 0) {
      problems.push(
        `e2e replay manifest contains ${requestProblems.length} invalid route/oracle contract(s); first ${requestProblems[0].caseId}: ${requestProblems[0].problem}`,
      );
    }
    const observationProblems = replayCases
      .map(item => ({ caseId: String(item.caseId ?? ''), problem: replayObservationProblem(item) }))
      .filter(item => item.problem !== null);
    if (observationProblems.length > 0) {
      problems.push(
        `e2e replay manifest contains ${observationProblems.length} invalid response observation(s); first ${observationProblems[0].caseId}: ${observationProblems[0].problem}`,
      );
    }
    const verdictProblems = replayCases
      .map(item => ({ caseId: String(item.caseId ?? ''), problem: replayProjectionVerdictProblem(item) }))
      .filter(item => item.problem !== null);
    if (verdictProblems.length > 0) {
      problems.push(
        `e2e replay manifest contains ${verdictProblems.length} outcome(s) not derivable from bounded response projections; first ${verdictProblems[0].caseId}: ${verdictProblems[0].problem}`,
      );
    }
    const replayOutcomes = replayCases
      .map(item => record(item.outcome))
      .filter((value): value is UnknownRecord => value !== null);
    const pagination = record(sampling?.targetPagination);
    const derivedPaginatedCases = replayCases.filter(item => number(record(item.outcome)?.pages) > 1).length;
    const derivedExamined = replayOutcomes.reduce((total, outcome) => total + number(outcome.examined), 0);
    if (
      !pagination
      || number(pagination.maxPagesPerCase) !== E2E_MAX_TARGET_PAGES
      || number(pagination.maxLogicalCandidateRequests) !== E2E_MAX_LOGICAL_CANDIDATE_REQUESTS
      || number(pagination.maxHttpCandidateAttempts) !== E2E_MAX_HTTP_CANDIDATE_ATTEMPTS
      || number(pagination.maxExaminedFilings) !== E2E_MAX_EXAMINED_FILINGS
      || number(pagination.cases) !== derivedPaginatedCases
      || number(pagination.examined) !== derivedExamined
    ) {
      problems.push('e2e targetPagination is missing or does not reconcile to the exact release bounds and replay outcomes');
    }
    let replayBudgetProblem = false;
    for (const item of replayCases) {
      const outcome = record(item.outcome);
      const observation = record(item.observation);
      const pages = number(outcome?.pages);
      const examined = number(outcome?.examined);
      const cls = String(item.cls ?? '');
      const observedPages = Array.isArray(observation?.pages)
        ? observation.pages.map(record).filter((value): value is UnknownRecord => value !== null)
        : [];
      const maxPages = ['A', 'D', 'F'].includes(cls) ? E2E_MAX_TARGET_PAGES : 1;
      const pageSize = cls === 'D' ? 50 : ['A', 'B', 'F'].includes(cls) ? 100 : 0;
      const projectedHits = observedPages.reduce((total, page) => {
        const projection = record(page.projection);
        const hits = record(projection?.hits);
        return total + (Array.isArray(hits?.hits) ? hits.hits.length : 0);
      }, 0);
      const attempts = Array.isArray(outcome?.statusHistory) ? outcome.statusHistory.length : -1;
      if (
        !Number.isSafeInteger(pages) || pages < 1 || pages > maxPages
        || !Number.isSafeInteger(examined) || examined < 0 || examined > pages * pageSize
        || pages !== observedPages.length
        || !Number.isSafeInteger(attempts) || attempts < pages || attempts > pages * 2
        || examined > projectedHits
        || (outcome?.pass === true && examined !== projectedHits)
      ) replayBudgetProblem = true;
    }
    if (replayBudgetProblem) {
      problems.push('e2e replay contains unsafe, unreconciled, or over-budget page/attempt/examined counters');
    }
    const derivedAvailability = {
      logicalRequests: replayCases.reduce((total, item) => {
        const observation = record(item.observation);
        return total + (Array.isArray(observation?.pages) ? observation.pages.length : 0);
      }, 0),
      httpAttempts: replayOutcomes.reduce(
        (total, outcome) => total + (Array.isArray(outcome.statusHistory) ? outcome.statusHistory.length : 0),
        0,
      ),
      serverErrorResponses: replayOutcomes.reduce(
        (total, outcome) => total + (Array.isArray(outcome.statusHistory)
          ? outcome.statusHistory.filter(status => number(status) >= 500).length
          : 0),
        0,
      ),
      casesWith5xx: replayOutcomes.filter(outcome => (
        Array.isArray(outcome.statusHistory) && outcome.statusHistory.some(status => number(status) >= 500)
      )).length,
      requestErrors: replayOutcomes.filter(outcome => number(outcome.status) === 0).length,
    };
    if (
      derivedAvailability.logicalRequests > E2E_MAX_LOGICAL_CANDIDATE_REQUESTS
      || derivedAvailability.httpAttempts > E2E_MAX_HTTP_CANDIDATE_ATTEMPTS
      || derivedExamined > E2E_MAX_EXAMINED_FILINGS
    ) {
      problems.push('e2e replay exceeds the declared logical-request, HTTP-attempt, or examined-filing ceiling');
    }
    const reportedAvailability = record(e2e.availability);
    for (const [counter, value] of Object.entries(derivedAvailability)) {
      if (number(reportedAvailability?.[counter]) !== value) {
        problems.push(
          `e2e availability ${counter} ${String(reportedAvailability?.[counter] ?? 'missing')} does not match replay-derived ${value}`,
        );
      }
    }
    if (derivedAvailability.serverErrorResponses !== 0 || derivedAvailability.requestErrors !== 0) {
      problems.push(
        `e2e replay observations contain ${derivedAvailability.serverErrorResponses} HTTP 5xx response(s) and ${derivedAvailability.requestErrors} request error(s)`,
      );
    }
    const latestFilingWatermark = record(record(watermark?.filings)?.latest);
    const latestCommentLetterWatermark = record(record(watermark?.commentLetters)?.latest);
    const latestRawFormApWatermark = record(record(watermark?.rawFormAp)?.latest);
    const latestFilingWatermarkDate = latestFilingWatermark?.date_filed;
    const latestCommentLetterWatermarkDate = latestCommentLetterWatermark?.date_filed;
    const latestRawFormApId = number(latestRawFormApWatermark?.form_filing_id);
    const latestRawFormApDate = latestRawFormApWatermark?.filing_date;
    if (
      !watermark
      || isoEpoch(watermark.capturedAt) === null
      || number(record(watermark.filings)?.count) <= 0
      || number(record(watermark.commentLetters)?.count) <= 0
      || number(record(watermark.rawFormAp)?.count) <= 0
      || !latestFilingWatermark
      || !exactSecFilingIdentity(
        latestFilingWatermark.accession,
        latestFilingWatermark.cik,
        latestFilingWatermark.date_filed,
      )
      || !isIsoDate(latestFilingWatermarkDate)
      || latestFilingWatermarkDate < maxFilingSourceDate
      || latestFilingWatermarkDate > watermarkDate
      || !latestCommentLetterWatermark
      || !exactSecFilingIdentity(
        latestCommentLetterWatermark.accession,
        latestCommentLetterWatermark.cik,
        latestCommentLetterWatermark.date_filed,
      )
      || !commentWatermarkThreadIdentityValid(latestCommentLetterWatermark)
      || !isIsoDate(latestCommentLetterWatermarkDate)
      || latestCommentLetterWatermarkDate < maxCommentLetterSourceDate
      || latestCommentLetterWatermarkDate > watermarkDate
      || !latestRawFormApWatermark
      || !Number.isSafeInteger(latestRawFormApId) || latestRawFormApId <= 0
      || number(groundTruth?.auditorRawMaxFormFilingId) < maxRawFormApSourceId
      || String(groundTruth?.auditorRawMaxFilingDate ?? '') < maxRawFormApSourceDate
      || latestRawFormApId < number(groundTruth?.auditorRawMaxFormFilingId)
      || latestRawFormApId < maxRawFormApSourceId
      || !isIsoDate(latestRawFormApDate)
      || latestRawFormApDate < String(groundTruth?.auditorRawMaxFilingDate ?? '')
      || latestRawFormApDate < maxRawFormApSourceDate
      || latestRawFormApDate > watermarkDate
    ) {
      problems.push('e2e replay manifest did not bind a complete database watermark');
    }

    let classCaseTotal = 0;
    let classPassTotal = 0;
    for (const [cls, requirement] of Object.entries(CLASS_REQUIREMENTS)) {
      const result = perClass.find(item => item.cls === cls);
      if (!result) {
        problems.push(`e2e class ${cls} did not report results`);
        continue;
      }
      const n = number(result.n);
      const pass = number(result.pass);
      const passRate = number(result.passRate);
      const p95 = number(result.p95);
      const plannedCases = Math.round(requirement.share * REQUIRED_E2E_CASES);
      const replayClassCases = replayCases.filter(item => item.cls === cls);
      const replayClassPasses = replayClassCases.filter(item => record(item.outcome)?.pass === true).length;
      const replayClassP95 = replayPercentile(replayClassCases, 95);
      if (n !== plannedCases || number(plannedClasses?.[cls]) !== plannedCases || number(generated?.[cls]) !== plannedCases) {
        problems.push(`e2e class ${cls} sampled ${n}/${plannedCases} exact required cases`);
      }
      if (replayClassCases.length !== n || replayClassPasses !== pass) {
        problems.push(
          `e2e replay class ${cls} contains ${replayClassCases.length} cases/${replayClassPasses} passes, summary reports ${n}/${pass}`,
        );
      }
      if (!Number.isInteger(pass) || pass < 0 || pass > n) {
        problems.push(`e2e class ${cls} reported invalid pass count ${pass}/${n}`);
      } else {
        classPassTotal += pass;
      }
      if (Number.isFinite(n)) classCaseTotal += n;
      const computedPassRate = n > 0 ? (pass / n) * 100 : NaN;
      if (!Number.isFinite(passRate) || !Number.isFinite(computedPassRate) || Math.abs(passRate - computedPassRate) > 0.001) {
        problems.push(`e2e class ${cls} pass-rate denominator is inconsistent (${passRate}% vs ${pass}/${n})`);
      }
      if (!Number.isFinite(passRate) || passRate < requirement.minPassRate) {
        problems.push(`e2e class ${cls} pass rate ${Number.isFinite(passRate) ? passRate.toFixed(1) : 'n/a'}% is below ${requirement.minPassRate}%`);
      }
      if (!Number.isFinite(p95) || p95 > requirement.maxP95Ms) {
        problems.push(`e2e class ${cls} p95 ${Number.isFinite(p95) ? Math.round(p95) : 'n/a'}ms exceeds ${requirement.maxP95Ms}ms`);
      }
      if (!Number.isFinite(replayClassP95) || Math.abs(p95 - replayClassP95) > 0.001) {
        problems.push(
          `e2e class ${cls} reported p95 ${Number.isFinite(p95) ? p95 : 'n/a'}ms, replay cases derive ${Number.isFinite(replayClassP95) ? replayClassP95 : 'n/a'}ms`,
        );
      }
      if (Number.isFinite(replayClassP95) && replayClassP95 > requirement.maxP95Ms) {
        problems.push(`e2e replay class ${cls} p95 ${Math.round(replayClassP95)}ms exceeds ${requirement.maxP95Ms}ms`);
      }
    }
    if (classCaseTotal !== e2eTotal) problems.push(`e2e class denominators sum to ${classCaseTotal}, report total is ${e2eTotal}`);
    if (classPassTotal !== e2eTotalPass) problems.push(`e2e class pass counts sum to ${classPassTotal}, report totalPass is ${e2eTotalPass}`);

    for (const [name, requirement] of Object.entries(CRITICAL_PATH_REQUIREMENTS)) {
      const result = criticalPaths.find(item => item.name === name);
      if (!result) {
        problems.push(`critical deployed path '${name}' did not report results`);
        continue;
      }
      const n = number(result.n);
      const passRate = number(result.passRate);
      const p95 = number(result.p95);
      const serverErrorCases = number(result.serverErrorCases);
      const requestErrors = number(result.requestErrors);
      const replayPathCases = replayCases.filter(item => item.criticalPath === name);
      const replayPathPasses = replayPathCases.filter(item => record(item.outcome)?.pass === true).length;
      const replayPathPassRate = replayPathCases.length > 0
        ? (replayPathPasses / replayPathCases.length) * 100
        : NaN;
      const replayPathP95 = replayPercentile(replayPathCases, 95);
      const replayPathServerErrorCases = replayPathCases.filter(item => {
        const history = record(item.outcome)?.statusHistory;
        return Array.isArray(history) && history.some(status => number(status) >= 500);
      }).length;
      const replayPathRequestErrors = replayPathCases.filter(item => number(record(item.outcome)?.status) === 0).length;
      if (n !== requirement.cases || number(plannedCritical?.[name]) !== requirement.cases || number(criticalGenerated?.[name]) !== requirement.cases) {
        problems.push(`critical deployed path '${name}' ran ${n}/${requirement.cases} exact required cases`);
      }
      if (
        replayPathCases.length !== n
        || !Number.isFinite(replayPathPassRate)
        || Math.abs(replayPathPassRate - passRate) > 0.001
      ) {
        problems.push(
          `e2e replay critical path '${name}' contains ${replayPathCases.length} cases at ${Number.isFinite(replayPathPassRate) ? replayPathPassRate.toFixed(1) : 'n/a'}%, summary reports ${n} at ${passRate}%`,
        );
      }
      if (!Number.isFinite(passRate) || passRate < requirement.minPassRate) {
        problems.push(`critical deployed path '${name}' pass rate ${Number.isFinite(passRate) ? passRate.toFixed(1) : 'n/a'}% is below ${requirement.minPassRate}%`);
      }
      if (!Number.isFinite(p95) || p95 > requirement.maxP95Ms) {
        problems.push(`critical deployed path '${name}' p95 ${Number.isFinite(p95) ? Math.round(p95) : 'n/a'}ms exceeds ${requirement.maxP95Ms}ms`);
      }
      if (!Number.isFinite(replayPathP95) || Math.abs(p95 - replayPathP95) > 0.001) {
        problems.push(
          `critical deployed path '${name}' reported p95 ${Number.isFinite(p95) ? p95 : 'n/a'}ms, replay cases derive ${Number.isFinite(replayPathP95) ? replayPathP95 : 'n/a'}ms`,
        );
      }
      if (Number.isFinite(replayPathP95) && replayPathP95 > requirement.maxP95Ms) {
        problems.push(`e2e replay critical path '${name}' p95 ${Math.round(replayPathP95)}ms exceeds ${requirement.maxP95Ms}ms`);
      }
      if (serverErrorCases !== replayPathServerErrorCases || requestErrors !== replayPathRequestErrors) {
        problems.push(
          `critical deployed path '${name}' availability counters do not match replay-derived ${replayPathServerErrorCases} 5xx case(s) and ${replayPathRequestErrors} request error(s)`,
        );
      }
      if (serverErrorCases !== 0 || requestErrors !== 0) {
        problems.push(`critical deployed path '${name}' observed ${serverErrorCases} 5xx case(s) and ${requestErrors} request error(s)`);
      }
    }
  }

  // Attest the same unaliased STAGED Production build before and after the
  // long sweep. The second Vercel API read is mandatory: a candidate promoted
  // mid-run must not pass on a stale initial snapshot.
  validateCandidateAttestation(
    candidate, expected, base, 'initial staged-candidate attestation', problems, databaseFingerprint, 7_200,
  );
  validateCandidateAttestation(
    candidateFinal, expected, base, 'post-sweep staged-candidate attestation', problems, databaseFingerprint, 300,
  );
  const initialAt = Date.parse(String(candidate?.generatedAt || ''));
  const finalAt = Date.parse(String(candidateFinal?.generatedAt || ''));
  if (!Number.isFinite(initialAt) || !Number.isFinite(finalAt) || finalAt < initialAt) {
    problems.push('post-sweep candidate attestation is missing a valid timestamp after the initial attestation');
  }

  if (authProbe) {
    if (authProbe.pass !== true) problems.push('staged-production credential acceptance/path-scope probe failed');
    if (authProbe.base !== base) problems.push(`credential probe targeted ${String(authProbe.base ?? 'no base')}, expected ${base}`);
    if (authProbe.credential !== 'renewable-ecdsa-p256-v3-path-method-bound' || number(authProbe.ttlSeconds) !== 300) {
      problems.push('credential probe did not attest the five-minute path/method-bound v3 format');
    }
    if (number(authProbe.httpAttempts) !== RELEASE_AUTH_PROBE_HTTP_ATTEMPTS) {
      problems.push(`credential probe did not report the exact ${RELEASE_AUTH_PROBE_HTTP_ATTEMPTS} HTTP attempts`);
    }
    const authProbeAt = isoEpoch(authProbe.generatedAt);
    if (authProbeAt === null) {
      problems.push('credential probe did not report a valid generatedAt timestamp');
    } else if (
      !Number.isFinite(initialAt)
      || !Number.isFinite(finalAt)
      || authProbeAt < initialAt
      || authProbeAt > finalAt
    ) {
      problems.push('credential probe timestamp is outside the initial/post-sweep candidate attestation window');
    }
    if (!Array.isArray(authProbe.problems) || authProbe.problems.length !== 0) {
      problems.push('credential probe contains problems or lacks a problems array');
    }

    const allowlistedProbe = record(authProbe.allowlistedProbe);
    if (
      allowlistedProbe?.path !== '/api/es-search'
      || allowlistedProbe?.method !== 'GET'
      || allowlistedProbe?.status !== 200
    ) {
      problems.push('credential probe did not receive HTTP 200 on exact GET /api/es-search');
    }
    const deniedProbe = record(authProbe.deniedProbe);
    const deniedStatus = number(deniedProbe?.status);
    if (
      deniedProbe?.path !== '/api/sec-proxy'
      || deniedProbe?.method !== 'GET'
      || !Number.isFinite(deniedStatus)
      || !isExplicitReleaseGateDenial(deniedStatus)
    ) {
      problems.push('credential probe did not prove explicit 401, 403, or 404 rejection on a non-allowlisted API');
    }
    const crossRouteProbe = record(authProbe.crossRouteProbe);
    const crossRouteStatus = number(crossRouteProbe?.status);
    if (
      crossRouteProbe?.path !== '/api/filing-text'
      || crossRouteProbe?.method !== 'GET'
      || !Number.isFinite(crossRouteStatus)
      || !isExplicitReleaseGateDenial(crossRouteStatus)
    ) {
      problems.push('credential probe did not prove that an exact-path token is rejected on another allowlisted route');
    }
    const wrongMethodProbe = record(authProbe.wrongMethodProbe);
    const wrongMethodStatus = number(wrongMethodProbe?.status);
    if (
      wrongMethodProbe?.path !== '/api/es-search'
      || wrongMethodProbe?.method !== 'POST'
      || !Number.isFinite(wrongMethodStatus)
      || !isExplicitReleaseGateDenial(wrongMethodStatus)
    ) {
      problems.push('credential probe did not prove that an exact-method token is rejected on another method');
    }
    const enrichPostProbe = record(authProbe.enrichPostProbe);
    if (
      enrichPostProbe?.path !== '/api/enrich'
      || enrichPostProbe?.method !== 'POST'
      || number(enrichPostProbe?.status) !== 400
      || !String(enrichPostProbe?.contentType ?? '').toLowerCase().includes('application/json')
      || enrichPostProbe?.typed !== true
    ) {
      problems.push('credential probe did not prove an authorized exact POST /api/enrich typed-400 response');
    }
  }

  sameIdentity(finalVersion, expected, 'candidate final application', problems);
  if (finalVersion && finalVersion.environment !== 'production') {
    problems.push(`candidate final environment is ${String(finalVersion.environment ?? 'null')}, expected production`);
  }
  if (finalVersion?.filingSearchBackend !== 'enriched') {
    problems.push(
      `candidate final filingSearchBackend is ${String(finalVersion?.filingSearchBackend ?? 'missing')}, expected enriched`,
    );
  }
  if (!databaseFingerprint || finalVersion?.schemaDatabaseFingerprint !== databaseFingerprint) {
    problems.push(
      `candidate final application database fingerprint ${String(finalVersion?.schemaDatabaseFingerprint ?? 'null')} differs from schema evidence ${databaseFingerprint || 'null'}`,
    );
  }
  const initialNotAfter = record(candidate?.application)?.releaseGateNotAfter;
  const finalNotAfter = record(candidateFinal?.application)?.releaseGateNotAfter;
  const versionNotAfter = finalVersion?.releaseGateNotAfter;
  if (!Number.isFinite(Date.parse(String(versionNotAfter ?? '')))) {
    problems.push('candidate final application did not report a valid releaseGateNotAfter');
  }
  if (initialNotAfter !== finalNotAfter || finalNotAfter !== versionNotAfter) {
    problems.push(
      `releaseGateNotAfter changed across initial/final evidence (${String(initialNotAfter ?? 'null')} / ${String(finalNotAfter ?? 'null')} / ${String(versionNotAfter ?? 'null')})`,
    );
  }

  const policy = {
    semantic: {
      minScore: REQUIRED_SEMANTIC_SCORE,
      criticalSkips: 0,
      criticalFailures: 0,
      filingEntityScoredTarget: 60,
      boolean: { hybridExactShaExecutor: true, immutableRouteCanary: true, canaryRequests: 4 },
    },
    ticker: { fullDirectory: true, minResolution: 100, max5xx: 0, maxRequestErrors: 0 },
    e2e: {
      minCases: REQUIRED_E2E_CASES,
      minPassRate: REQUIRED_E2E_SCORE,
      max5xx: 0,
      maxRequestErrors: 0,
      classes: CLASS_REQUIREMENTS,
      criticalPaths: CRITICAL_PATH_REQUIREMENTS,
    },
    securityHeaders: {
      enforcedCsp: true,
      responseArchetypes: Object.keys(REQUIRED_SECURITY_HEADER_RESPONSES),
      authBoundary: {
        path: '/dashboard',
        authentication: 'unauthenticated',
        releaseGateToken: 'absent',
        redirectMode: 'manual',
        acceptedStatuses: REQUIRED_SECURITY_HEADER_RESPONSES['protected-route'].statuses,
      },
    },
    uiActions: {
      exactSha: true,
      mappingDigest: true,
      browser: UI_ACTION_SCOPE_REQUIREMENTS.browser,
      auth: UI_ACTION_SCOPE_REQUIREMENTS.auth,
      requiresExecutedInteractionAndAssertion: true,
    },
    provenance: {
      immutableVercelUrl: true,
      unaliasedStagedProduction: true,
      initialAndPostSweepAttestation: true,
      exactSha: true,
      exactRepository: true,
      exactSchemaChain: true,
      exactDatabaseFingerprint: true,
      filingSearchBackend: 'enriched',
      exactShaQualityWorkflows: [...REQUIRED_QUALITY_WORKFLOWS],
      releaseGateNotAfter: {
        identicalAcrossEvidence: true,
        initialMinRemainingSeconds: 7_200,
        finalMinRemainingSeconds: 300,
        maxSecondsFromDeploymentReady: 21_600,
      },
    },
  };

  return {
    generatedAt: input.generatedAt || new Date().toISOString(),
    base,
    candidateDeploymentId: expected.deploymentId,
    provenance: {
      expected,
      qualityAttestation,
      releaseGateNotAfter: versionNotAfter ?? null,
      initialAttestation: candidate,
      postSweepAttestation: candidateFinal,
      finalApplication: finalVersion,
    },
    policy,
    dimensions: {
      releaseCredential: authProbe,
      candidateSecurityHeaders: securityHeaders,
      uiActions: {
        browser: uiBrowser,
        auth: uiAuth,
      },
      schemaContract,
      qualityAttestation,
      semantic: semantic ? {
        score: semanticScore,
        reportedThreshold: reportedSemanticThreshold,
        requiredThreshold: REQUIRED_SEMANTIC_SCORE,
        criticalSkips: criticalSkips.length,
        criticalFailures: criticalFailures.length,
        checks: semanticChecks.length,
        exclusions: Array.isArray(semantic.exclusions) ? semantic.exclusions.length : 0,
        coverage: semantic.coverage ?? null,
        candidateBase: semantic.candidateBase ?? null,
      } : null,
      tickerResolution: tickers ? {
        accepted: tickerPass + tickerEmptyVerified,
        pass: tickerPass,
        emptyVerified: tickerEmptyVerified,
        total: tickerTotal,
        availability: tickers.availability ?? null,
      } : null,
      e2e: e2e ? {
        total: e2eTotal,
        totalPass: e2eTotalPass,
        passRate: Number.isFinite(e2ePassRate) ? Number(e2ePassRate.toFixed(2)) : null,
        availability: e2e.availability ?? null,
        perClass,
        criticalPaths,
      } : null,
    },
    problems: [...new Set(problems)],
    warnings,
    pass: problems.length === 0,
  };
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function readReport(path: string | null, label: string): UnknownRecord | null {
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as UnknownRecord;
  } catch (error) {
    process.stderr.write(`FAIL-CLOSED: ${label} report at ${path} is missing or unparsable (${(error as Error).message}).\n`);
    return null;
  }
}

function exactExpectedIdentity(
  actual: UnknownRecord | null,
  expected: ExpectedReleaseIdentity,
): boolean {
  return Boolean(actual)
    && actual!.deploymentId === expected.deploymentId
    && actual!.sha === expected.sha
    && actual!.schemaVersion === expected.schemaVersion
    && actual!.schemaMigrationCount === expected.schemaMigrationCount
    && actual!.schemaChainChecksum === expected.schemaChainChecksum
    && actual!.schemaChecksumAlgorithm === expected.schemaChecksumAlgorithm
    && actual!.repositoryId === expected.repositoryId;
}

/**
 * Derive the only origin that consolidation may read from. The workflow input
 * is not trusted by itself: it must exactly match a passing provenance record
 * produced by the preflight for this deployment, revision, and schema chain.
 */
export function trustedCandidateOriginForFinalRead(input: {
  base: string;
  expected: ExpectedReleaseIdentity;
  candidate: UnknownRecord | null;
}): string | null {
  const origin = canonicalVercelCandidateOrigin(input.base);
  const candidate = record(input.candidate);
  if (!origin || !candidate || candidate.pass !== true) return null;
  if (!Array.isArray(candidate.problems) || candidate.problems.length !== 0) return null;
  if (candidate.base !== origin) return null;
  if (!exactExpectedIdentity(record(candidate.expected), input.expected)) return null;

  const vercel = record(candidate.vercel);
  if (
    !vercel
    || vercel.deploymentId !== input.expected.deploymentId
    || vercel.url !== origin
    || vercel.gitSha !== input.expected.sha
    || vercel.repositoryId !== input.expected.repositoryId
    || vercel.connectedRepositoryId !== input.expected.repositoryId
    || vercel.readyState !== 'READY'
    || vercel.readySubstate !== 'STAGED'
    || vercel.target !== 'production'
    || vercel.aliasAssigned !== false
    || vercel.prebuilt !== false
  ) return null;

  const application = record(candidate.application);
  if (
    !application
    || application.deploymentId !== input.expected.deploymentId
    || application.sha !== input.expected.sha
    || application.schemaVersion !== input.expected.schemaVersion
    || application.schemaMigrationCount !== input.expected.schemaMigrationCount
    || application.schemaChainChecksum !== input.expected.schemaChainChecksum
    || application.schemaChecksumAlgorithm !== input.expected.schemaChecksumAlgorithm
    || application.environment !== 'production'
    || !/^sha256:[0-9a-f]{64}$/.test(String(application.schemaDatabaseFingerprint || ''))
  ) return null;

  return origin;
}

type FinalVersionFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export async function fetchTrustedCandidateVersion(input: {
  base: string;
  expected: ExpectedReleaseIdentity;
  candidate: UnknownRecord | null;
  fetchImpl?: FinalVersionFetch;
}): Promise<UnknownRecord | null> {
  const trustedOrigin = trustedCandidateOriginForFinalRead(input);
  if (!trustedOrigin) return null;

  const fetchImpl = input.fetchImpl || fetch;
  try {
    const response = await fetchImpl(`${trustedOrigin}/api/version`, {
      headers: candidateRequestHeaders('/api/version', 'GET', {
        requestOrigin: trustedOrigin,
        trustedOrigin,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    return await response.json() as UnknownRecord;
  } catch {
    return null;
  }
}

async function main() {
  const base = (arg('--base') || '').replace(/\/$/, '');
  const out = arg('--out') || 'release-evidence.json';
  const expected: ExpectedReleaseIdentity = {
    deploymentId: arg('--deployment-id') || '',
    sha: arg('--expect-sha') || process.env.EXPECTED_SHA || '',
    schemaVersion: arg('--expect-schema') || process.env.EXPECTED_SCHEMA_VERSION || '',
    schemaMigrationCount: Number(arg('--expect-migration-count') || process.env.EXPECTED_SCHEMA_MIGRATION_COUNT),
    schemaChainChecksum: (arg('--expect-schema-checksum') || process.env.EXPECTED_SCHEMA_CHAIN_CHECKSUM || '').toLowerCase(),
    schemaChecksumAlgorithm: arg('--expect-checksum-algorithm') || process.env.EXPECTED_SCHEMA_CHECKSUM_ALGORITHM || '',
    repositoryId: arg('--expect-repository-id') || process.env.EXPECTED_REPOSITORY_ID || '',
  };
  const expectedRepository = arg('--expect-repository') || process.env.EXPECTED_REPOSITORY || '';
  const candidate = readReport(arg('--candidate'), 'candidate-provenance');

  const evidence = evaluateReleaseEvidence({
    base,
    expected,
    expectedRepository,
    semantic: readReport(arg('--semantic'), 'semantic'),
    tickers: readReport(arg('--tickers'), 'ticker-coverage'),
    e2e: readReport(arg('--e2e'), 'e2e-perf'),
    schemaContract: readReport(arg('--schema-contract'), 'schema-contract'),
    qualityAttestation: readReport(arg('--quality-attestation'), 'quality-attestation'),
    candidate,
    candidateFinal: readReport(arg('--candidate-final'), 'candidate-final-provenance'),
    authProbe: readReport(arg('--auth'), 'release-auth-probe'),
    securityHeaders: readReport(arg('--security-headers'), 'security-header'),
    uiBrowser: readReport(arg('--ui-browser'), 'browser UI-action evidence'),
    uiAuth: readReport(arg('--ui-auth'), 'auth UI-action evidence'),
    finalVersion: await fetchTrustedCandidateVersion({ base, expected, candidate }),
  });

  writeFileSync(out, JSON.stringify(evidence, null, 2));
  process.stdout.write(`\nRelease evidence → ${out}\n`);
  for (const warning of evidence.warnings as string[]) process.stdout.write(`  ~ ${warning}\n`);
  const problems = evidence.problems as string[];
  if (problems.length) {
    process.stdout.write('PROMOTION BLOCKED:\n');
    for (const problem of problems) process.stdout.write(`  ✗ ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write('Exact immutable candidate satisfies every release policy.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`consolidate failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
