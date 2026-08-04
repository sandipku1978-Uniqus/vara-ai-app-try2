import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  UI_ACTION_EVIDENCE_LIMITS,
  validateUiActionExecution,
  type UiActionEvidenceInput,
  type UiActionScope,
} from './evidence';

const MAX_REPORT_BYTES = 5 * 1024 * 1024;

function values(name: string): string[] {
  const found: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) found.push(process.argv[index + 1]);
  }
  return found;
}

function value(name: string): string | null {
  return values(name)[0] || null;
}

function readInputs(paths: string[]): { inputs: UiActionEvidenceInput[]; problems: string[] } {
  const inputs: UiActionEvidenceInput[] = [];
  const problems: string[] = [];
  for (const path of paths.slice(0, UI_ACTION_EVIDENCE_LIMITS.maxReports)) {
    if (!existsSync(path)) {
      problems.push(`${path} is missing`);
      continue;
    }
    if (statSync(path).size > MAX_REPORT_BYTES) {
      problems.push(`${path} exceeds the ${MAX_REPORT_BYTES}-byte execution-report limit`);
      continue;
    }
    try {
      inputs.push({ name: path, value: JSON.parse(readFileSync(path, 'utf8')) as unknown });
    } catch {
      problems.push(`${path} is not valid JSON`);
    }
  }
  if (paths.length > UI_ACTION_EVIDENCE_LIMITS.maxReports) {
    problems.push(`received ${paths.length} report paths; maximum is ${UI_ACTION_EVIDENCE_LIMITS.maxReports}`);
  }
  return { inputs, problems };
}

export function runUiActionValidator(argv = process.argv): number {
  const originalArgv = process.argv;
  process.argv = argv;
  try {
    const scopeValue = value('--scope');
    const scope: UiActionScope | null = scopeValue === 'browser' || scopeValue === 'auth'
      ? scopeValue
      : null;
    const paths = values('--report');
    const out = value('--out') || 'ui-action-evidence.json';
    const expectedSha = value('--expect-sha');
    const loaded = readInputs(paths);
    const report = validateUiActionExecution({
      scope: scope || 'browser',
      expectedSha,
      reports: loaded.inputs,
    });
    if (!scope) report.problems.unshift('--scope must be browser or auth');
    report.problems.unshift(...loaded.problems);
    report.pass = report.pass && report.problems.length === 0;

    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2));
    process.stdout.write(
      `UI action execution evidence (${report.scope}) ${report.passedActionCount}/${report.expectedActionCount} actions, `
      + `${report.passedTestReferenceCount}/${report.expectedTestReferenceCount} action tests, `
      + `${report.passedContentCheckCount}/${report.expectedContentCheckCount} content checks, `
      + `${report.passedContentTestReferenceCount}/${report.expectedContentTestReferenceCount} content tests → ${out}\n`,
    );
    for (const problem of report.problems) process.stderr.write(`  ✗ ${problem}\n`);
    return report.pass ? 0 : 1;
  } finally {
    process.argv = originalArgv;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runUiActionValidator();
}
