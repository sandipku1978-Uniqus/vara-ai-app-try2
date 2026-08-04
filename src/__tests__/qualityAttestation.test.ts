import { describe, expect, it } from 'vitest';
import {
  assessCodeScanningGate,
  BLOCKING_CODE_SCANNING_SEVERITIES,
  CODEQL_ANALYSIS_KEY,
  CODE_SCANNING_REF,
  REQUIRED_QUALITY_WORKFLOW_PATHS,
  type QualityRunEvidence,
  selectSuccessfulQualityRun,
} from '../../scripts/accuracy/verify-quality-runs';

const repository = 'example/uniqus-research';
const sha = 'a'.repeat(40);
const requiredPath = '.github/workflows/ci.yml';

function workflow() {
  return { id: 101, path: requiredPath, state: 'active' };
}

function run() {
  return {
    id: 202,
    workflow_id: 101,
    run_attempt: 1,
    run_number: 42,
    path: `${requiredPath}@refs/heads/main`,
    head_sha: sha,
    event: 'push',
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    created_at: '2026-08-04T00:00:00Z',
    updated_at: '2026-08-04T00:05:00Z',
    html_url: 'https://github.com/example/uniqus-research/actions/runs/202',
  };
}

function codeqlRun(): QualityRunEvidence {
  return {
    workflowPath: '.github/workflows/codeql.yml',
    workflowId: 303,
    workflowState: 'active',
    runId: 404,
    runAttempt: 1,
    runNumber: 43,
    headSha: sha,
    event: 'push',
    headBranch: 'main',
    status: 'completed',
    conclusion: 'success',
    createdAt: '2026-08-04T00:00:00Z',
    updatedAt: '2026-08-04T00:05:00Z',
    htmlUrl: 'https://github.com/example/uniqus-research/actions/runs/404',
  };
}

function analysis(overrides: Record<string, unknown> = {}) {
  return {
    id: 505,
    ref: CODE_SCANNING_REF,
    commit_sha: sha,
    analysis_key: CODEQL_ANALYSIS_KEY,
    category: CODEQL_ANALYSIS_KEY,
    created_at: '2026-08-04T00:03:00Z',
    error: '',
    tool: { name: 'CodeQL' },
    ...overrides,
  };
}

function highFinding(overrides: Record<string, unknown> = {}) {
  return {
    number: 8,
    state: 'open',
    html_url: 'https://github.com/example/uniqus-research/security/code-scanning/8',
    rule: { id: 'js/polynomial-redos', security_severity_level: 'high' },
    tool: { name: 'CodeQL' },
    most_recent_instance: {
      state: 'open',
      ref: CODE_SCANNING_REF,
      commit_sha: sha,
      analysis_key: CODEQL_ANALYSIS_KEY,
      location: { path: 'src/app/api/es-search/route.ts', start_line: 259 },
    },
    ...overrides,
  };
}

describe('exact-SHA quality-run attestation', () => {
  it('requires CI, CodeQL, and the credentialed Clerk lifecycle by exact path', () => {
    expect(REQUIRED_QUALITY_WORKFLOW_PATHS).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/codeql.yml',
      '.github/workflows/auth-lifecycle.yml',
    ]);
  });

  it('accepts a successful completed push run from the exact workflow path and SHA', () => {
    const result = selectSuccessfulQualityRun({
      repository,
      sha,
      requiredPath,
      workflow: workflow(),
      runs: [run()],
    });

    expect(result.problems).toEqual([]);
    expect(result.evidence).toMatchObject({
      workflowPath: requiredPath,
      workflowId: 101,
      runId: 202,
      headSha: sha,
      event: 'push',
      headBranch: 'main',
      status: 'completed',
      conclusion: 'success',
    });
  });

  it('rejects a spoofed path, pull request, wrong SHA, wrong repository, or failed run', () => {
    const mutations: Array<Partial<ReturnType<typeof run>>> = [
      { path: '.github/workflows/fake.yml@refs/heads/main' },
      { event: 'pull_request' },
      { head_sha: 'b'.repeat(40) },
      { repository: { full_name: 'attacker/fork' } },
      { conclusion: 'failure' },
    ];

    for (const mutation of mutations) {
      const result = selectSuccessfulQualityRun({
        repository,
        sha,
        requiredPath,
        workflow: workflow(),
        runs: [{ ...run(), ...mutation }],
      });
      expect(result.evidence).toBeNull();
      expect(result.problems).toContain(
        `${requiredPath} has no completed successful push run on main for exact SHA ${sha}`,
      );
    }
  });

  it('fails closed when the exact workflow is missing, disabled, or lacks a stable ID', () => {
    expect(selectSuccessfulQualityRun({
      repository, sha, requiredPath, workflow: null, runs: [],
    }).problems).toContain(`required workflow ${requiredPath} is missing`);

    const disabled = selectSuccessfulQualityRun({
      repository,
      sha,
      requiredPath,
      workflow: { id: 0, path: requiredPath, state: 'disabled_manually' },
      runs: [run()],
    });
    expect(disabled.problems).toEqual(expect.arrayContaining([
      expect.stringContaining('no stable numeric workflow ID'),
      expect.stringContaining('not active'),
    ]));
  });

  it('separately proves a stable exact-SHA CodeQL analysis and clean blocking finding inventory', () => {
    const exactAnalysis = analysis();
    const result = assessCodeScanningGate({
      expectedSha: sha,
      codeqlRun: codeqlRun(),
      analysisBefore: [exactAnalysis],
      analysisAfter: [exactAnalysis],
      alertsBySeverity: { critical: [], high: [] },
    });

    expect(BLOCKING_CODE_SCANNING_SEVERITIES).toEqual(['critical', 'high']);
    expect(result.problems).toEqual([]);
    expect(result.pass).toBe(true);
    expect(result).toMatchObject({
      ref: CODE_SCANNING_REF,
      expectedSha: sha,
      workflowRunId: 404,
      analysisBookendIds: { before: 505, after: 505 },
      openFindings: [],
    });
  });

  it('blocks an open high finding even though the exact CodeQL workflow run succeeded', () => {
    const exactAnalysis = analysis();
    const result = assessCodeScanningGate({
      expectedSha: sha,
      codeqlRun: codeqlRun(),
      analysisBefore: [exactAnalysis],
      analysisAfter: [exactAnalysis],
      alertsBySeverity: { critical: [], high: [highFinding()] },
    });

    expect(result.pass).toBe(false);
    expect(result.openFindings).toHaveLength(1);
    expect(result.problems).toContain(
      'CodeQL exact-ref inventory contains 1 open high/critical finding(s)',
    );
  });

  it('rejects a later branch analysis, an inventory race, or an omitted severity query', () => {
    const laterSha = 'b'.repeat(40);
    const raced = assessCodeScanningGate({
      expectedSha: sha,
      codeqlRun: codeqlRun(),
      analysisBefore: [analysis()],
      analysisAfter: [analysis({ id: 506, commit_sha: laterSha })],
      alertsBySeverity: { high: [] },
    });

    expect(raced.pass).toBe(false);
    expect(raced.problems).toEqual(expect.arrayContaining([
      'CodeQL latest analysis changed while the alert inventory was collected',
      `CodeQL post-inventory latest ${CODE_SCANNING_REF} analysis is not the expected exact SHA ${sha}`,
      'CodeQL open-critical alert inventory is missing',
    ]));
  });
});
