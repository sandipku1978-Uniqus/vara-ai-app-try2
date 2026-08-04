import { createHash } from 'node:crypto';
import {
  UI_ACTION_TEST_MAP,
  UI_CONTENT_TEST_MAP,
  type UiActionTestReference,
} from '../../src/__tests__/uiActionCoverage';

export const PLAYWRIGHT_ACTION_RUN_SCHEMA = 'urc.playwright-action-run.v1';
export const UI_ACTION_EVIDENCE_SCHEMA = 'urc.ui-action-evidence.v1';

export const UI_ACTION_EVIDENCE_LIMITS = Object.freeze({
  maxReports: 8,
  maxTestsPerReport: 1_000,
  maxAttemptsPerTest: 4,
  maxActionProofsPerAttempt: 20,
  maxActions: 500,
  maxReferencesPerAction: 20,
});

export type UiActionScope = 'browser' | 'auth';
export type PlaywrightAttemptStatus =
  | 'passed'
  | 'failed'
  | 'timedOut'
  | 'skipped'
  | 'interrupted';

export interface PlaywrightActionAttempt {
  retry: number;
  status: PlaywrightAttemptStatus;
  durationMs: number;
  assertionCount: number;
  interactionCount: number;
  actionProofs: PlaywrightActionProof[];
}

export interface PlaywrightActionProof {
  actionId: string;
  assertionCount: number;
  interactionCount: number;
}

export interface PlaywrightActionTestExecution {
  file: string;
  title: string;
  project: string;
  repeatEachIndex: number;
  expectedStatus: PlaywrightAttemptStatus;
  outcome: 'skipped' | 'expected' | 'unexpected' | 'flaky';
  attempts: PlaywrightActionAttempt[];
}

export interface PlaywrightActionRunReport {
  schema: typeof PLAYWRIGHT_ACTION_RUN_SCHEMA;
  generatedAt: string;
  commitSha: string | null;
  suite: UiActionScope;
  runLabel: string;
  fullStatus: 'passed' | 'failed' | 'timedout' | 'interrupted';
  globalErrorCount: number;
  tests: PlaywrightActionTestExecution[];
}

export interface UiActionEvidenceInput {
  name: string;
  value: unknown;
}

export interface UiActionReferenceResult extends UiActionTestReference {
  passed: boolean;
  executions: number;
  skippedExecutions: number;
  assertionCount: number;
  interactionCount: number;
  problems: string[];
}

export interface UiActionResult {
  actionId: string;
  testReferences: UiActionReferenceResult[];
  pass: boolean;
}

export interface UiContentResult {
  contentId: string;
  testReferences: UiActionReferenceResult[];
  pass: boolean;
}

export interface UiActionEvidenceReport {
  schema: typeof UI_ACTION_EVIDENCE_SCHEMA;
  generatedAt: string;
  commitSha: string | null;
  scope: UiActionScope;
  mappingDigest: string;
  scopedMappingDigest: string;
  contentMappingDigest: string;
  scopedContentMappingDigest: string;
  sourceReports: Array<{
    name: string;
    runLabel: string;
    commitSha: string | null;
    fullStatus: PlaywrightActionRunReport['fullStatus'];
    testCount: number;
  }>;
  expectedActionCount: number;
  passedActionCount: number;
  expectedTestReferenceCount: number;
  passedTestReferenceCount: number;
  actions: UiActionResult[];
  expectedContentCheckCount: number;
  passedContentCheckCount: number;
  expectedContentTestReferenceCount: number;
  passedContentTestReferenceCount: number;
  contentChecks: UiContentResult[];
  problems: string[];
  pass: boolean;
}

type JsonRecord = Record<string, unknown>;

const ATTEMPT_STATUSES = new Set<PlaywrightAttemptStatus>([
  'passed',
  'failed',
  'timedOut',
  'skipped',
  'interrupted',
]);
const OUTCOMES = new Set(['skipped', 'expected', 'unexpected', 'flaky']);
const FULL_STATUSES = new Set(['passed', 'failed', 'timedout', 'interrupted']);

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function referenceKey(reference: UiActionTestReference): string {
  return `${reference.file}\u0000${reference.title}`;
}

function scopeForFile(file: string): UiActionScope | null {
  if (file.startsWith('tests/e2e-auth/')) return 'auth';
  if (file.startsWith('tests/e2e/')) return 'browser';
  return null;
}

function sortedMapping(scope?: UiActionScope) {
  return Object.entries(UI_ACTION_TEST_MAP)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([actionId, references]) => ({
      actionId,
      testReferences: references
        .filter(reference => !scope || scopeForFile(reference.file) === scope)
        .map(reference => ({ file: reference.file, title: reference.title }))
        .sort((left, right) => referenceKey(left).localeCompare(referenceKey(right))),
    }))
    .filter(action => action.testReferences.length > 0);
}

function sortedContentMapping(scope?: UiActionScope) {
  return Object.entries(UI_CONTENT_TEST_MAP)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([contentId, references]) => ({
      contentId,
      testReferences: references
        .filter(reference => !scope || scopeForFile(reference.file) === scope)
        .map(reference => ({ file: reference.file, title: reference.title }))
        .sort((left, right) => referenceKey(left).localeCompare(referenceKey(right))),
    }))
    .filter(content => content.testReferences.length > 0);
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function uiActionMappingDigest(scope?: UiActionScope): string {
  return digest(sortedMapping(scope));
}

export function uiContentMappingDigest(scope?: UiActionScope): string {
  return digest(sortedContentMapping(scope));
}

function validateMapping(
  mapping: Readonly<Record<string, readonly UiActionTestReference[]>>,
  label: string,
): string[] {
  const problems: string[] = [];
  const entries = Object.entries(mapping);
  if (entries.length === 0 || entries.length > UI_ACTION_EVIDENCE_LIMITS.maxActions) {
    problems.push(`${label} mapping contains ${entries.length} entries; expected 1-${UI_ACTION_EVIDENCE_LIMITS.maxActions}`);
  }
  for (const [actionId, references] of entries) {
    if (!/^[a-z0-9][a-z0-9.-]{1,99}$/.test(actionId)) {
      problems.push(`UI action mapping has invalid action ID ${JSON.stringify(actionId)}`);
    }
    if (references.length === 0 || references.length > UI_ACTION_EVIDENCE_LIMITS.maxReferencesPerAction) {
      problems.push(`${actionId} maps to ${references.length} tests; expected 1-${UI_ACTION_EVIDENCE_LIMITS.maxReferencesPerAction}`);
    }
    const seen = new Set<string>();
    for (const reference of references) {
      if (!/^tests\/e2e(?:-auth)?\/[A-Za-z0-9._/-]+\.spec\.ts$/.test(reference.file)
        || reference.file.includes('..')) {
        problems.push(`${actionId} maps outside the bounded Playwright suites: ${reference.file}`);
      }
      if (!boundedString(reference.title, 300)) {
        problems.push(`${actionId} has an empty or oversized Playwright title`);
      }
      const key = referenceKey(reference);
      if (seen.has(key)) problems.push(`${actionId} repeats ${reference.file} :: ${reference.title}`);
      seen.add(key);
    }
  }
  return problems;
}

function parseAttempt(value: unknown, label: string, problems: string[]): PlaywrightActionAttempt | null {
  const item = record(value);
  if (!item) {
    problems.push(`${label} is not an object`);
    return null;
  }
  if (!boundedInteger(item.retry, 3)) problems.push(`${label}.retry is invalid`);
  if (!ATTEMPT_STATUSES.has(item.status as PlaywrightAttemptStatus)) problems.push(`${label}.status is invalid`);
  if (!boundedInteger(item.durationMs, 10_000_000)) problems.push(`${label}.durationMs is invalid`);
  if (!boundedInteger(item.assertionCount, 100_000)) problems.push(`${label}.assertionCount is invalid`);
  if (!boundedInteger(item.interactionCount, 100_000)) problems.push(`${label}.interactionCount is invalid`);
  if (!Array.isArray(item.actionProofs)
    || item.actionProofs.length > UI_ACTION_EVIDENCE_LIMITS.maxActionProofsPerAttempt) {
    problems.push(`${label}.actionProofs exceeds the bounded per-action proof inventory`);
  }
  const actionProofs: PlaywrightActionProof[] = [];
  if (Array.isArray(item.actionProofs)) {
    const seen = new Set<string>();
    for (const [index, value] of item.actionProofs
      .slice(0, UI_ACTION_EVIDENCE_LIMITS.maxActionProofsPerAttempt).entries()) {
      const proofLabel = `${label}.actionProofs[${index}]`;
      const proof = record(value);
      if (!proof) {
        problems.push(`${proofLabel} is not an object`);
        continue;
      }
      if (!boundedString(proof.actionId, 100)
        || !/^[a-z0-9][a-z0-9.-]{1,99}$/.test(String(proof.actionId))) {
        problems.push(`${proofLabel}.actionId is invalid`);
      }
      if (!boundedInteger(proof.assertionCount, 100_000)) problems.push(`${proofLabel}.assertionCount is invalid`);
      if (!boundedInteger(proof.interactionCount, 100_000)) problems.push(`${proofLabel}.interactionCount is invalid`);
      if (boundedString(proof.actionId, 100)) {
        if (seen.has(proof.actionId)) problems.push(`${label}.actionProofs repeats ${proof.actionId}`);
        seen.add(proof.actionId);
      }
      if (!problems.some(problem => problem.startsWith(`${proofLabel}.`) || problem === `${proofLabel} is not an object`)) {
        actionProofs.push({
          actionId: proof.actionId as string,
          assertionCount: proof.assertionCount as number,
          interactionCount: proof.interactionCount as number,
        });
      }
    }
  }
  if (problems.some(problem => problem.startsWith(`${label}.`))) return null;
  return {
    retry: item.retry as number,
    status: item.status as PlaywrightAttemptStatus,
    durationMs: item.durationMs as number,
    assertionCount: item.assertionCount as number,
    interactionCount: item.interactionCount as number,
    actionProofs,
  };
}

function parseTest(value: unknown, label: string, problems: string[]): PlaywrightActionTestExecution | null {
  const item = record(value);
  if (!item) {
    problems.push(`${label} is not an object`);
    return null;
  }
  if (!boundedString(item.file, 300) || item.file.includes('..')) problems.push(`${label}.file is invalid`);
  if (!boundedString(item.title, 300)) problems.push(`${label}.title is invalid`);
  if (!boundedString(item.project, 100)) problems.push(`${label}.project is invalid`);
  if (!boundedInteger(item.repeatEachIndex, 100)) problems.push(`${label}.repeatEachIndex is invalid`);
  if (!ATTEMPT_STATUSES.has(item.expectedStatus as PlaywrightAttemptStatus)) problems.push(`${label}.expectedStatus is invalid`);
  if (!OUTCOMES.has(String(item.outcome))) problems.push(`${label}.outcome is invalid`);
  if (!Array.isArray(item.attempts)
    || item.attempts.length > UI_ACTION_EVIDENCE_LIMITS.maxAttemptsPerTest) {
    problems.push(`${label}.attempts exceeds the bounded retry inventory`);
  }
  const attempts = Array.isArray(item.attempts)
    ? item.attempts
      .slice(0, UI_ACTION_EVIDENCE_LIMITS.maxAttemptsPerTest)
      .map((attempt, index) => parseAttempt(attempt, `${label}.attempts[${index}]`, problems))
      .filter((attempt): attempt is PlaywrightActionAttempt => Boolean(attempt))
    : [];
  if (problems.some(problem => problem.startsWith(`${label}.`) || problem === `${label} is not an object`)) {
    return null;
  }
  return {
    file: item.file as string,
    title: item.title as string,
    project: item.project as string,
    repeatEachIndex: item.repeatEachIndex as number,
    expectedStatus: item.expectedStatus as PlaywrightAttemptStatus,
    outcome: item.outcome as PlaywrightActionTestExecution['outcome'],
    attempts,
  };
}

export function parsePlaywrightActionRunReport(
  value: unknown,
  label = 'report',
): { report: PlaywrightActionRunReport | null; problems: string[] } {
  const problems: string[] = [];
  const item = record(value);
  if (!item) return { report: null, problems: [`${label} is not a JSON object`] };
  if (item.schema !== PLAYWRIGHT_ACTION_RUN_SCHEMA) problems.push(`${label}.schema is unsupported`);
  if (!boundedString(item.generatedAt, 100) || !Number.isFinite(Date.parse(item.generatedAt))) {
    problems.push(`${label}.generatedAt is invalid`);
  }
  if (item.commitSha !== null && !/^[0-9a-f]{40}$/i.test(String(item.commitSha))) {
    problems.push(`${label}.commitSha is not a full Git SHA or null`);
  }
  if (item.suite !== 'browser' && item.suite !== 'auth') problems.push(`${label}.suite is invalid`);
  if (!boundedString(item.runLabel, 64) || !/^[a-z0-9][a-z0-9-]*$/.test(item.runLabel)) {
    problems.push(`${label}.runLabel is invalid`);
  }
  if (!FULL_STATUSES.has(String(item.fullStatus))) problems.push(`${label}.fullStatus is invalid`);
  if (!boundedInteger(item.globalErrorCount, 10_000)) problems.push(`${label}.globalErrorCount is invalid`);
  if (!Array.isArray(item.tests) || item.tests.length > UI_ACTION_EVIDENCE_LIMITS.maxTestsPerReport) {
    problems.push(`${label}.tests exceeds the bounded test inventory`);
  }
  const tests = Array.isArray(item.tests)
    ? item.tests
      .slice(0, UI_ACTION_EVIDENCE_LIMITS.maxTestsPerReport)
      .map((test, index) => parseTest(test, `${label}.tests[${index}]`, problems))
      .filter((test): test is PlaywrightActionTestExecution => Boolean(test))
    : [];
  if (problems.length > 0) return { report: null, problems };
  return {
    report: {
      schema: PLAYWRIGHT_ACTION_RUN_SCHEMA,
      generatedAt: item.generatedAt as string,
      commitSha: item.commitSha as string | null,
      suite: item.suite as UiActionScope,
      runLabel: item.runLabel as string,
      fullStatus: item.fullStatus as PlaywrightActionRunReport['fullStatus'],
      globalErrorCount: item.globalErrorCount as number,
      tests,
    },
    problems,
  };
}

export function validateUiActionExecution(input: {
  scope: UiActionScope;
  expectedSha?: string | null;
  reports: UiActionEvidenceInput[];
}): UiActionEvidenceReport {
  const { scope } = input;
  const expectedSha = input.expectedSha?.trim() || null;
  const problems = [
    ...validateMapping(UI_ACTION_TEST_MAP, 'UI action'),
    ...validateMapping(UI_CONTENT_TEST_MAP, 'UI content'),
  ];
  const parsedReports: Array<{ name: string; report: PlaywrightActionRunReport }> = [];

  if (input.reports.length === 0 || input.reports.length > UI_ACTION_EVIDENCE_LIMITS.maxReports) {
    problems.push(`received ${input.reports.length} source reports; expected 1-${UI_ACTION_EVIDENCE_LIMITS.maxReports}`);
  }
  if (expectedSha && !/^[0-9a-f]{40}$/i.test(expectedSha)) {
    problems.push('expected SHA must be a full 40-character Git SHA');
  }

  for (const source of input.reports.slice(0, UI_ACTION_EVIDENCE_LIMITS.maxReports)) {
    const parsed = parsePlaywrightActionRunReport(source.value, source.name);
    problems.push(...parsed.problems);
    if (!parsed.report) continue;
    const report = parsed.report;
    if (report.suite !== scope) problems.push(`${source.name} is suite ${report.suite}; expected ${scope}`);
    if (expectedSha && report.commitSha !== expectedSha) {
      problems.push(`${source.name} is bound to SHA ${report.commitSha || 'missing'}; expected ${expectedSha}`);
    }
    if (report.fullStatus !== 'passed') {
      problems.push(`${source.name} Playwright run finished ${report.fullStatus}, not passed`);
    }
    if (report.globalErrorCount !== 0) {
      problems.push(`${source.name} recorded ${report.globalErrorCount} global reporter errors`);
    }
    parsedReports.push({ name: source.name, report });
  }

  const labels = new Set<string>();
  for (const { name, report } of parsedReports) {
    if (labels.has(report.runLabel)) problems.push(`${name} repeats run label ${report.runLabel}`);
    labels.add(report.runLabel);
  }

  const allowedActionsByTest = new Map<string, Set<string>>();
  for (const [actionId, references] of Object.entries(UI_ACTION_TEST_MAP)) {
    for (const reference of references) {
      const key = referenceKey(reference);
      const allowed = allowedActionsByTest.get(key) || new Set<string>();
      allowed.add(actionId);
      allowedActionsByTest.set(key, allowed);
    }
  }
  for (const { name, report } of parsedReports) {
    for (const test of report.tests) {
      const allowed = allowedActionsByTest.get(referenceKey(test)) || new Set<string>();
      for (const attempt of test.attempts) {
        for (const proof of attempt.actionProofs) {
          if (!allowed.has(proof.actionId)) {
            problems.push(`${name} test ${test.file} :: ${test.title} forged or misplaced proof for ${proof.actionId}`);
          }
        }
      }
    }
  }

  const evaluateReferences = (
    references: readonly UiActionTestReference[],
    requireInteraction: boolean,
    actionId?: string,
  ): UiActionReferenceResult[] => {
    const testReferences: UiActionReferenceResult[] = [];
    for (const reference of references) {
      const referenceProblems: string[] = [];
      const matching = parsedReports.flatMap(({ report }) => report.tests.filter(test =>
        test.file === reference.file && test.title === reference.title));
      const attempts = matching.flatMap(test => test.attempts);
      const failedAttempts = attempts.filter(attempt =>
        attempt.status === 'failed' || attempt.status === 'timedOut' || attempt.status === 'interrupted');
      const proofFor = (attempt: PlaywrightActionAttempt) => {
        if (!requireInteraction) {
          return { assertionCount: attempt.assertionCount, interactionCount: attempt.interactionCount };
        }
        return attempt.actionProofs.find(proof => proof.actionId === actionId)
          || { assertionCount: 0, interactionCount: 0 };
      };
      const noOpAttempts = attempts.filter(attempt =>
        attempt.status === 'passed'
          && (proofFor(attempt).assertionCount === 0
            || (requireInteraction && proofFor(attempt).interactionCount === 0)));
      const cleanPasses = attempts.filter(attempt =>
        attempt.status === 'passed'
          && proofFor(attempt).assertionCount > 0
          && (!requireInteraction || proofFor(attempt).interactionCount > 0));
      const skippedExecutions = attempts.filter(attempt => attempt.status === 'skipped').length;

      if (matching.length === 0) {
        referenceProblems.push('mapped test was not discovered in any source report');
      } else if (attempts.length === 0) {
        referenceProblems.push('mapped test was discovered but not executed');
      }
      if (matching.some(test => test.expectedStatus === 'failed')) {
        referenceProblems.push('mapped test is marked as an expected failure');
      }
      if (matching.some(test => test.outcome === 'flaky')) {
        referenceProblems.push('mapped test passed only after a failed retry');
      }
      if (matching.some(test => test.outcome === 'unexpected')) {
        referenceProblems.push('mapped test had an unexpected outcome');
      }
      if (failedAttempts.length > 0) {
        referenceProblems.push(`mapped test recorded ${failedAttempts.length} failed, timed-out, or interrupted attempts`);
      }
      if (noOpAttempts.length > 0) {
        referenceProblems.push(requireInteraction
          ? `mapped test recorded ${noOpAttempts.length} passing attempts without both a Playwright interaction and an assertion`
          : `mapped content test recorded ${noOpAttempts.length} passing attempts without an assertion`);
      }
      if (cleanPasses.length === 0 && skippedExecutions > 0) {
        referenceProblems.push('mapped test was skipped and never completed a clean passing execution');
      } else if (cleanPasses.length === 0 && matching.length > 0 && attempts.length > 0) {
        referenceProblems.push('mapped test never completed a clean passing execution');
      }

      testReferences.push({
        ...reference,
        passed: referenceProblems.length === 0,
        executions: attempts.length,
        skippedExecutions,
        assertionCount: attempts.reduce((total, attempt) => total + proofFor(attempt).assertionCount, 0),
        interactionCount: attempts.reduce((total, attempt) => total + proofFor(attempt).interactionCount, 0),
        problems: referenceProblems,
      });
    }
    return testReferences;
  };

  const actions: UiActionResult[] = sortedMapping(scope).map(action => {
    const testReferences = evaluateReferences(action.testReferences, true, action.actionId);
    return {
      actionId: action.actionId,
      testReferences,
      pass: testReferences.every(reference => reference.passed),
    };
  });
  const contentChecks: UiContentResult[] = sortedContentMapping(scope).map(content => {
    const testReferences = evaluateReferences(content.testReferences, false);
    return {
      contentId: content.contentId,
      testReferences,
      pass: testReferences.every(reference => reference.passed),
    };
  });

  const actionProblems = actions.flatMap(action => action.testReferences.flatMap(reference =>
    reference.problems.map(problem => `${action.actionId} → ${reference.file} :: ${reference.title}: ${problem}`)));
  const contentProblems = contentChecks.flatMap(content => content.testReferences.flatMap(reference =>
    reference.problems.map(problem => `${content.contentId} [content] → ${reference.file} :: ${reference.title}: ${problem}`)));
  problems.push(...actionProblems, ...contentProblems);
  const expectedTestReferenceCount = actions.reduce((total, action) => total + action.testReferences.length, 0);
  const passedTestReferenceCount = actions.reduce(
    (total, action) => total + action.testReferences.filter(reference => reference.passed).length,
    0,
  );
  const expectedContentTestReferenceCount = contentChecks.reduce(
    (total, content) => total + content.testReferences.length,
    0,
  );
  const passedContentTestReferenceCount = contentChecks.reduce(
    (total, content) => total + content.testReferences.filter(reference => reference.passed).length,
    0,
  );
  const report: UiActionEvidenceReport = {
    schema: UI_ACTION_EVIDENCE_SCHEMA,
    generatedAt: new Date().toISOString(),
    commitSha: expectedSha || parsedReports[0]?.report.commitSha || null,
    scope,
    mappingDigest: uiActionMappingDigest(),
    scopedMappingDigest: uiActionMappingDigest(scope),
    contentMappingDigest: uiContentMappingDigest(),
    scopedContentMappingDigest: uiContentMappingDigest(scope),
    sourceReports: parsedReports.map(({ name, report: source }) => ({
      name,
      runLabel: source.runLabel,
      commitSha: source.commitSha,
      fullStatus: source.fullStatus,
      testCount: source.tests.length,
    })),
    expectedActionCount: actions.length,
    passedActionCount: actions.filter(action => action.pass).length,
    expectedTestReferenceCount,
    passedTestReferenceCount,
    actions,
    expectedContentCheckCount: contentChecks.length,
    passedContentCheckCount: contentChecks.filter(content => content.pass).length,
    expectedContentTestReferenceCount,
    passedContentTestReferenceCount,
    contentChecks,
    problems,
    pass: problems.length === 0
      && actions.length > 0
      && actions.every(action => action.pass)
      && contentChecks.every(content => content.pass),
  };
  return report;
}
