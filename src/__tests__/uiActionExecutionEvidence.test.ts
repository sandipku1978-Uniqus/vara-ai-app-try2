import { describe, expect, it } from 'vitest';
import {
  PLAYWRIGHT_ACTION_RUN_SCHEMA,
  parsePlaywrightActionRunReport,
  uiActionMappingDigest,
  uiContentMappingDigest,
  validateUiActionExecution,
  type PlaywrightActionRunReport,
  type PlaywrightActionTestExecution,
  type UiActionScope,
} from '../../scripts/ui-actions/evidence';
import { UI_ACTION_TEST_MAP, UI_CONTENT_TEST_MAP } from './uiActionCoverage';
import { isUserInteractionStep } from '../../scripts/ui-actions/playwright-reporter';

const SHA = 'a'.repeat(40);

function scopeFor(file: string): UiActionScope {
  return file.startsWith('tests/e2e-auth/') ? 'auth' : 'browser';
}

function executions(scope: UiActionScope): PlaywrightActionTestExecution[] {
  const unique = new Map<string, PlaywrightActionTestExecution>();
  const actionIdsByTest = new Map<string, string[]>();
  for (const [actionId, references] of Object.entries(UI_ACTION_TEST_MAP)) {
    for (const reference of references) {
      const key = `${reference.file}\u0000${reference.title}`;
      actionIdsByTest.set(key, [...(actionIdsByTest.get(key) || []), actionId]);
    }
  }
  for (const references of [
    ...Object.values(UI_ACTION_TEST_MAP),
    ...Object.values(UI_CONTENT_TEST_MAP),
  ]) {
    for (const reference of references) {
      if (scopeFor(reference.file) !== scope) continue;
      const key = `${reference.file}\u0000${reference.title}`;
      unique.set(key, {
        ...reference,
        project: 'chromium',
        repeatEachIndex: 0,
        expectedStatus: 'passed',
        outcome: 'expected',
        attempts: [{
          retry: 0,
          status: 'passed',
          durationMs: 25,
          assertionCount: 2,
          interactionCount: 3,
          actionProofs: (actionIdsByTest.get(key) || []).map(actionId => ({
            actionId,
            assertionCount: 2,
            interactionCount: 3,
          })),
        }],
      });
    }
  }
  return [...unique.values()];
}

function runReport(scope: UiActionScope, tests = executions(scope)): PlaywrightActionRunReport {
  return {
    schema: PLAYWRIGHT_ACTION_RUN_SCHEMA,
    generatedAt: '2026-08-04T00:00:00.000Z',
    commitSha: SHA,
    suite: scope,
    runLabel: `${scope}-production`,
    fullStatus: 'passed',
    globalErrorCount: 0,
    tests,
  };
}

describe('runtime UI action execution evidence', () => {
  it('treats navigation plus assertions as a no-op while counting real user input', () => {
    expect(isUserInteractionStep({ category: 'pw:api', title: 'Navigate to "/search"' })).toBe(false);
    expect(isUserInteractionStep({ category: 'pw:api', title: 'Get inner text locator("main")' })).toBe(false);
    expect(isUserInteractionStep({ category: 'expect', title: 'Expect "toBeVisible"' })).toBe(false);
    expect(isUserInteractionStep({ category: 'pw:api', title: 'Click getByRole("button")' })).toBe(true);
    expect(isUserInteractionStep({ category: 'pw:api', title: 'Fill "climate" getByRole("searchbox")' })).toBe(true);
    expect(isUserInteractionStep({ category: 'pw:api', title: 'Press "Enter" getByRole("searchbox")' })).toBe(true);
  });

  it('keeps 135 actionable contracts separate from static content and validates exact runtime identities', () => {
    expect(Object.keys(UI_ACTION_TEST_MAP)).toHaveLength(135);
    expect(Object.keys(UI_CONTENT_TEST_MAP)).toHaveLength(1);
    expect(uiActionMappingDigest()).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(uiContentMappingDigest()).toMatch(/^sha256:[0-9a-f]{64}$/);

    const browser = validateUiActionExecution({
      scope: 'browser',
      expectedSha: SHA,
      reports: [{ name: 'browser.json', value: runReport('browser') }],
    });
    const auth = validateUiActionExecution({
      scope: 'auth',
      expectedSha: SHA,
      reports: [{ name: 'auth.json', value: runReport('auth') }],
    });

    expect(browser.pass, browser.problems.join('\n')).toBe(true);
    expect(browser.expectedActionCount).toBe(132);
    expect(browser.expectedTestReferenceCount).toBe(147);
    expect(browser.passedActionCount).toBe(browser.expectedActionCount);
    expect(browser.expectedContentCheckCount).toBe(1);
    expect(browser.passedContentCheckCount).toBe(1);
    expect(browser.expectedContentTestReferenceCount).toBe(1);
    expect(browser.passedContentTestReferenceCount).toBe(1);
    expect(auth.pass, auth.problems.join('\n')).toBe(true);
    expect(auth.expectedActionCount).toBe(3);
    expect(auth.expectedTestReferenceCount).toBe(4);
    expect(auth.passedActionCount).toBe(3);
    expect(auth.expectedContentCheckCount).toBe(0);
  });

  it('accepts assertion-only content evidence without letting it masquerade as an action', () => {
    const tests = executions('browser');
    const content = Object.values(UI_CONTENT_TEST_MAP)[0][0];
    const contentIndex = tests.findIndex(test => test.file === content.file && test.title === content.title);
    tests[contentIndex] = {
      ...tests[contentIndex],
      attempts: [{ ...tests[contentIndex].attempts[0], interactionCount: 0 }],
    };

    const accepted = validateUiActionExecution({
      scope: 'browser', expectedSha: SHA, reports: [{ name: 'browser.json', value: runReport('browser', tests) }],
    });
    expect(accepted.pass, accepted.problems.join('\n')).toBe(true);
    expect(accepted.actions.some(action => action.actionId === 'terms.review-limitations')).toBe(false);
    expect(accepted.contentChecks[0]).toMatchObject({ contentId: 'terms.review-limitations', pass: true });

    tests[contentIndex] = {
      ...tests[contentIndex],
      attempts: [{ ...tests[contentIndex].attempts[0], assertionCount: 0, interactionCount: 8 }],
    };
    const rejected = validateUiActionExecution({
      scope: 'browser', expectedSha: SHA, reports: [{ name: 'browser.json', value: runReport('browser', tests) }],
    });
    expect(rejected.pass).toBe(false);
    expect(rejected.problems.join('\n')).toContain('mapped content test recorded 1 passing attempts without an assertion');
  });

  it.each([
    ['missing', (tests: PlaywrightActionTestExecution[]) => tests.slice(1), 'not discovered'],
    ['skipped', (tests: PlaywrightActionTestExecution[]) => [
      { ...tests[0], outcome: 'skipped' as const, attempts: [{ ...tests[0].attempts[0], status: 'skipped' as const, assertionCount: 0, interactionCount: 0 }] },
      ...tests.slice(1),
    ], 'was skipped'],
    ['not executed', (tests: PlaywrightActionTestExecution[]) => [
      { ...tests[0], outcome: 'skipped' as const, attempts: [] },
      ...tests.slice(1),
    ], 'not executed'],
    ['no-op', (tests: PlaywrightActionTestExecution[]) => [
      { ...tests[0], attempts: [{
        ...tests[0].attempts[0],
        assertionCount: 0,
        interactionCount: 0,
        actionProofs: tests[0].attempts[0].actionProofs.map(proof => ({
          ...proof, assertionCount: 0, interactionCount: 0,
        })),
      }] },
      ...tests.slice(1),
    ], 'without both a Playwright interaction and an assertion'],
    ['failed', (tests: PlaywrightActionTestExecution[]) => [
      { ...tests[0], outcome: 'unexpected' as const, attempts: [{ ...tests[0].attempts[0], status: 'failed' as const }] },
      ...tests.slice(1),
    ], 'failed, timed-out, or interrupted'],
  ])('fails closed when a mapped test is %s', (_label, mutate, message) => {
    const result = validateUiActionExecution({
      scope: 'browser',
      expectedSha: SHA,
      reports: [{ name: 'browser.json', value: runReport('browser', mutate(executions('browser'))) }],
    });
    expect(result.pass).toBe(false);
    expect(result.problems.join('\n')).toContain(message);
  });

  it('rejects retry-masked failures, failed source runs, and reports from another SHA', () => {
    const tests = executions('auth');
    tests[0] = {
      ...tests[0],
      outcome: 'flaky',
      attempts: [
        { ...tests[0].attempts[0], status: 'failed' },
        { ...tests[0].attempts[0], retry: 1 },
      ],
    };
    const report = { ...runReport('auth', tests), commitSha: 'b'.repeat(40), fullStatus: 'failed' as const };
    const result = validateUiActionExecution({
      scope: 'auth',
      expectedSha: SHA,
      reports: [{ name: 'auth.json', value: report }],
    });

    expect(result.pass).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      expect.stringContaining('expected aaaaaaaaaa'),
      expect.stringContaining('finished failed'),
      expect.stringContaining('failed retry'),
    ]));
  });

  it('rejects aggregate clicks for shared tests without per-action proof and rejects forged markers', () => {
    const tests = executions('browser');
    const sharedIndex = tests.findIndex(test =>
      test.title === 'research-workbench.save-alert and dashboard.check-saved-alert round-trip');
    expect(sharedIndex).toBeGreaterThanOrEqual(0);
    tests[sharedIndex] = {
      ...tests[sharedIndex],
      attempts: [{ ...tests[sharedIndex].attempts[0], actionProofs: [] }],
    };

    const aggregateOnly = validateUiActionExecution({
      scope: 'browser', expectedSha: SHA, reports: [{ name: 'browser.json', value: runReport('browser', tests) }],
    });
    expect(aggregateOnly.pass).toBe(false);
    expect(aggregateOnly.problems.join('\n')).toContain('research-workbench.save-alert');
    expect(aggregateOnly.problems.join('\n')).toContain('dashboard.check-saved-alert');
    expect(aggregateOnly.problems.join('\n')).toContain('without both a Playwright interaction and an assertion');

    tests[sharedIndex] = {
      ...tests[sharedIndex],
      attempts: [{
        ...tests[sharedIndex].attempts[0],
        actionProofs: [{ actionId: 'landing.submit-search', assertionCount: 1, interactionCount: 1 }],
      }],
    };
    const forged = validateUiActionExecution({
      scope: 'browser', expectedSha: SHA, reports: [{ name: 'browser.json', value: runReport('browser', tests) }],
    });
    expect(forged.pass).toBe(false);
    expect(forged.problems.join('\n')).toContain('forged or misplaced proof for landing.submit-search');
  });

  it('accepts an environment-specific skip only when another bounded run executes that exact test cleanly', () => {
    const tests = executions('browser');
    const skipped = tests.map((test, index) => index === 0 ? {
      ...test,
      outcome: 'skipped' as const,
      attempts: [{ ...test.attempts[0], status: 'skipped' as const, assertionCount: 0, interactionCount: 0 }],
    } : test);
    const complementary = [{ ...tests[0] }];
    const result = validateUiActionExecution({
      scope: 'browser',
      expectedSha: SHA,
      reports: [
        { name: 'development.json', value: { ...runReport('browser', skipped), runLabel: 'browser-development' } },
        { name: 'production.json', value: runReport('browser', complementary) },
      ],
    });

    expect(result.pass, result.problems.join('\n')).toBe(true);
    expect(result.actions.flatMap(action => action.testReferences).some(reference =>
      reference.skippedExecutions === 1 && reference.passed)).toBe(true);
  });

  it('rejects malformed or unbounded raw reports before trusting results', () => {
    const oversized = {
      ...runReport('browser'),
      tests: Array.from({ length: 1_001 }, () => executions('browser')[0]),
    };
    const parsed = parsePlaywrightActionRunReport(oversized, 'oversized.json');
    expect(parsed.report).toBeNull();
    expect(parsed.problems).toContain('oversized.json.tests exceeds the bounded test inventory');
  });
});
