import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';
import type {
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';
import {
  PLAYWRIGHT_ACTION_RUN_SCHEMA,
  type PlaywrightActionAttempt,
  type PlaywrightActionRunReport,
  type UiActionScope,
} from './evidence';
import { UI_ACTION_TEST_MAP } from '../../src/__tests__/uiActionCoverage';

interface ReporterOptions {
  outputFile: string;
  suite: UiActionScope;
  runLabel: string;
}

interface StepCounts {
  assertions: number;
  interactions: number;
  actionProofs: Map<string, { assertions: number; interactions: number }>;
}

export const UI_ACTION_STEP_PREFIX = 'ui-action:';

const ACTIONS_BY_TEST = new Map<string, string[]>();
for (const [actionId, references] of Object.entries(UI_ACTION_TEST_MAP)) {
  for (const reference of references) {
    const key = `${reference.file}\u0000${reference.title}`;
    ACTIONS_BY_TEST.set(key, [...(ACTIONS_BY_TEST.get(key) || []), actionId].sort());
  }
}

/**
 * Reporter steps intentionally expose only a user-facing title, not the
 * underlying Playwright API name. Keep this allow-list narrow: navigation,
 * locator reads, waits, screenshots and evaluate calls are useful test setup,
 * but they do not prove that the mapped control was exercised.
 */
const USER_INTERACTION_TITLES = [
  /^Blur(?:\s|$)/,
  /^Check(?:\s|$)/,
  /^Click(?:\s|$)/,
  /^Double click(?:\s|$)/,
  /^Drag and drop(?:\s|$)/,
  /^Drop files or data onto an element(?:\s|$)/,
  /^Fill(?:\s|$)/,
  /^Focus(?:\s|$)/,
  /^Hover(?:\s|$)/,
  /^Insert(?:\s|$)/,
  /^Key down(?:\s|$)/,
  /^Key up(?:\s|$)/,
  /^Mouse down(?:\s|$)/,
  /^Mouse move(?:\s|$)/,
  /^Mouse up(?:\s|$)/,
  /^Mouse wheel(?:\s|$)/,
  /^Press(?:\s|$)/,
  /^Select option(?:\s|$)/,
  /^Select text(?:\s|$)/,
  /^Set input files(?:\s|$)/,
  /^Tap(?:\s|$)/,
  /^Type(?:\s|$)/,
  /^Uncheck(?:\s|$)/,
] as const;

export function isUserInteractionStep(step: Pick<TestStep, 'category' | 'title'>): boolean {
  return step.category === 'pw:api'
    && USER_INTERACTION_TITLES.some(pattern => pattern.test(step.title));
}

function actionMarkers(step: TestStep): string[] {
  let current = step.parent;
  while (current) {
    if (current.category === 'test.step' && current.title.startsWith(UI_ACTION_STEP_PREFIX)) {
      return current.title
        .slice(UI_ACTION_STEP_PREFIX.length)
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    }
    current = current.parent;
  }
  return [];
}

function emptyCounts(): StepCounts {
  return { assertions: 0, interactions: 0, actionProofs: new Map() };
}

/**
 * A deliberately metadata-only reporter. It records exact test identity,
 * outcome, retry status, and runtime step counts, but never error messages,
 * URLs, attachments, stdout, cookies, or traces. That makes the auth report
 * safe to retain while still proving that a mapped test really executed both
 * a browser interaction and an assertion.
 */
export default class UiActionExecutionReporter implements Reporter {
  private readonly options: ReporterOptions;
  private tests: TestCase[] = [];
  private globalErrorCount = 0;
  private readonly counts = new WeakMap<TestResult, StepCounts>();

  constructor(options: ReporterOptions) {
    this.options = options;
  }

  printsToStdio() {
    return false;
  }

  onBegin(_config: unknown, suite: Suite) {
    this.tests = suite.allTests();
  }

  onError() {
    this.globalErrorCount += 1;
  }

  onTestBegin(_test: TestCase, result: TestResult) {
    this.counts.set(result, emptyCounts());
  }

  onStepEnd(_test: TestCase, result: TestResult, step: TestStep) {
    const counts = this.counts.get(result) || emptyCounts();
    let parent = step.parent;
    let setupOrTeardown = false;
    while (parent) {
      if (parent.category === 'hook' || parent.category === 'fixture') {
        setupOrTeardown = true;
        break;
      }
      parent = parent.parent;
    }
    const assertion = !setupOrTeardown && step.category === 'expect';
    const interaction = !setupOrTeardown && isUserInteractionStep(step);
    if (assertion) counts.assertions += 1;
    if (interaction) counts.interactions += 1;
    if (assertion || interaction) {
      for (const actionId of actionMarkers(step)) {
        const proof = counts.actionProofs.get(actionId) || { assertions: 0, interactions: 0 };
        if (assertion) proof.assertions += 1;
        if (interaction) proof.interactions += 1;
        counts.actionProofs.set(actionId, proof);
      }
    }
    this.counts.set(result, counts);
  }

  async onEnd(result: FullResult) {
    try {
      const report: PlaywrightActionRunReport = {
        schema: PLAYWRIGHT_ACTION_RUN_SCHEMA,
        generatedAt: new Date().toISOString(),
        commitSha: process.env.QA_ACTION_SHA?.trim()
          || process.env.GITHUB_SHA?.trim()
          || null,
        suite: this.options.suite,
        runLabel: this.options.runLabel,
        fullStatus: result.status,
        globalErrorCount: this.globalErrorCount,
        tests: this.tests.map(test => {
          const file = relative(process.cwd(), test.location.file).split(sep).join('/');
          const mappedActions = ACTIONS_BY_TEST.get(`${file}\u0000${test.title}`) || [];
          return {
            file,
            title: test.title,
            project: test.parent.project()?.name || 'unnamed-project',
            repeatEachIndex: test.repeatEachIndex,
            expectedStatus: test.expectedStatus,
            outcome: test.outcome(),
            attempts: test.results.map((attempt): PlaywrightActionAttempt => {
              const counts = this.counts.get(attempt) || emptyCounts();
              const proofs = new Map(counts.actionProofs);
              // A test identity owned by exactly one action is itself a bounded
              // action-specific scope. Shared identities must use explicit
              // ui-action:<id> test.step markers so one unrelated click cannot
              // satisfy several mapped controls.
              if (mappedActions.length === 1 && !proofs.has(mappedActions[0])) {
                proofs.set(mappedActions[0], {
                  assertions: counts.assertions,
                  interactions: counts.interactions,
                });
              }
              return {
                retry: attempt.retry,
                status: attempt.status,
                durationMs: Math.max(0, Math.round(attempt.duration)),
                assertionCount: counts.assertions,
                interactionCount: counts.interactions,
                actionProofs: [...proofs]
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([actionId, proof]) => ({
                    actionId,
                    assertionCount: proof.assertions,
                    interactionCount: proof.interactions,
                  })),
              };
            }),
          };
        }),
      };
      mkdirSync(dirname(this.options.outputFile), { recursive: true });
      writeFileSync(this.options.outputFile, JSON.stringify(report, null, 2));
    } catch {
      process.stderr.write('UI action reporter could not write its bounded execution report.\n');
      return { status: 'failed' as const };
    }
  }
}
