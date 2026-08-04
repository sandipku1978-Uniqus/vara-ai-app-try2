/**
 * Prove that the protected evaluator SHA already passed the repository's exact
 * quality workflow files, then separately prove that its stable main-ref
 * CodeQL analysis has no open critical/high findings. Workflow display names
 * and generic check names are intentionally ignored because both are spoofable
 * by another workflow.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type JsonRecord = Record<string, unknown>;

export const REQUIRED_QUALITY_WORKFLOW_PATHS = [
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/auth-lifecycle.yml',
] as const;

export const CODE_SCANNING_REF = 'refs/heads/main';
export const CODEQL_ANALYSIS_KEY = '.github/workflows/codeql.yml:analyze';
export const BLOCKING_CODE_SCANNING_SEVERITIES = ['critical', 'high'] as const;
type BlockingCodeScanningSeverity = typeof BLOCKING_CODE_SCANNING_SEVERITIES[number];

export interface QualityRunEvidence {
  workflowPath: string;
  workflowId: number;
  workflowState: string;
  runId: number;
  runAttempt: number;
  runNumber: number;
  headSha: string;
  event: string;
  headBranch: string;
  status: string;
  conclusion: string;
  createdAt: string | null;
  updatedAt: string | null;
  htmlUrl: string | null;
}

export interface CodeScanningFindingEvidence {
  number: number;
  severity: BlockingCodeScanningSeverity;
  ruleId: string;
  ref: string;
  commitSha: string;
  analysisKey: string;
  path: string | null;
  startLine: number | null;
  htmlUrl: string | null;
}

export interface CodeScanningGateEvidence {
  ref: typeof CODE_SCANNING_REF;
  expectedSha: string;
  tool: 'CodeQL';
  workflowRunId: number | null;
  analysisBookendIds: {
    before: number | null;
    after: number | null;
  };
  analysis: {
    id: number;
    ref: string;
    commitSha: string;
    analysisKey: string;
    category: string;
    createdAt: string;
  } | null;
  blockedSeverities: readonly BlockingCodeScanningSeverity[];
  openFindings: CodeScanningFindingEvidence[];
  problems: string[];
  pass: boolean;
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
}

function finitePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function workflowPathFromRun(run: JsonRecord): string {
  return String(run.path || '').split('@', 1)[0];
}

/** Pure fail-closed selector used by regression tests and the live probe. */
export function selectSuccessfulQualityRun(input: {
  repository: string;
  sha: string;
  requiredPath: string;
  workflow: JsonRecord | null;
  runs: JsonRecord[];
}): { evidence: QualityRunEvidence | null; problems: string[] } {
  const { repository, sha, requiredPath, workflow, runs } = input;
  const problems: string[] = [];
  if (!workflow) return { evidence: null, problems: [`required workflow ${requiredPath} is missing`] };

  const workflowId = Number(workflow.id);
  if (!Number.isSafeInteger(workflowId) || workflowId <= 0) {
    problems.push(`required workflow ${requiredPath} has no stable numeric workflow ID`);
  }
  if (workflow.path !== requiredPath) {
    problems.push(`resolved workflow path ${String(workflow.path || 'missing')} differs from ${requiredPath}`);
  }
  if (workflow.state !== 'active') {
    problems.push(`required workflow ${requiredPath} is ${String(workflow.state || 'unknown')}, not active`);
  }

  const matching = runs.filter((run) => {
    const runRepository = record(run.repository);
    const headRepository = record(run.head_repository);
    return Number(run.workflow_id) === workflowId
      && workflowPathFromRun(run) === requiredPath
      && run.head_sha === sha
      && run.event === 'push'
      && run.head_branch === 'main'
      && run.status === 'completed'
      && run.conclusion === 'success'
      && runRepository?.full_name === repository
      && headRepository?.full_name === repository;
  });

  const selected = matching.sort((left, right) => {
    const attemptDelta = Number(right.run_attempt) - Number(left.run_attempt);
    return attemptDelta || Number(right.id) - Number(left.id);
  })[0];
  if (!selected) {
    problems.push(`${requiredPath} has no completed successful push run on main for exact SHA ${sha}`);
    return { evidence: null, problems };
  }

  const runId = Number(selected.id);
  const runAttempt = Number(selected.run_attempt);
  const runNumber = Number(selected.run_number);
  if (!Number.isSafeInteger(runId) || runId <= 0) problems.push(`${requiredPath} successful run has an invalid run ID`);
  if (!Number.isSafeInteger(runAttempt) || runAttempt < 1) problems.push(`${requiredPath} successful run has an invalid attempt`);
  if (!Number.isSafeInteger(runNumber) || runNumber < 1) problems.push(`${requiredPath} successful run has an invalid run number`);
  if (problems.length > 0) return { evidence: null, problems };

  return {
    evidence: {
      workflowPath: requiredPath,
      workflowId,
      workflowState: String(workflow.state),
      runId,
      runAttempt,
      runNumber,
      headSha: String(selected.head_sha),
      event: String(selected.event),
      headBranch: String(selected.head_branch),
      status: String(selected.status),
      conclusion: String(selected.conclusion),
      createdAt: typeof selected.created_at === 'string' ? selected.created_at : null,
      updatedAt: typeof selected.updated_at === 'string' ? selected.updated_at : null,
      htmlUrl: typeof selected.html_url === 'string' ? selected.html_url : null,
    },
    problems,
  };
}

/**
 * Assess a separate CodeQL finding inventory after workflow completion.
 *
 * The alert endpoint filters by a branch ref, not an arbitrary commit SHA.
 * Therefore the inventory is bracketed by two latest-analysis reads and both
 * must resolve to the same CodeQL analysis for the expected candidate SHA.
 * This prevents a later clean main-branch scan from being credited to an older
 * release candidate, including the otherwise-ambiguous zero-alert case.
 */
export function assessCodeScanningGate(input: {
  expectedSha: string;
  codeqlRun: QualityRunEvidence | null;
  analysisBefore: unknown;
  analysisAfter: unknown;
  alertsBySeverity: Partial<Record<BlockingCodeScanningSeverity, unknown>>;
}): CodeScanningGateEvidence {
  const problems: string[] = [];
  const openFindings: CodeScanningFindingEvidence[] = [];
  const before = records(input.analysisBefore);
  const after = records(input.analysisAfter);

  if (!Array.isArray(input.analysisBefore) || before.length !== 1) {
    problems.push('CodeQL pre-inventory latest-analysis lookup did not return exactly one analysis');
  }
  if (!Array.isArray(input.analysisAfter) || after.length !== 1) {
    problems.push('CodeQL post-inventory latest-analysis lookup did not return exactly one analysis');
  }

  const analysisBefore = before[0] || null;
  const analysisAfter = after[0] || null;
  const beforeId = finitePositiveInteger(analysisBefore?.id);
  const afterId = finitePositiveInteger(analysisAfter?.id);
  if (!beforeId || !afterId || beforeId !== afterId) {
    problems.push('CodeQL latest analysis changed while the alert inventory was collected');
  }

  const analysis = analysisAfter;
  const analysisCreatedAt = typeof analysis?.created_at === 'string' ? analysis.created_at : '';
  for (const [label, bookend] of [
    ['pre-inventory', analysisBefore],
    ['post-inventory', analysisAfter],
  ] as const) {
    const analysisTool = record(bookend?.tool);
    if (
      !bookend
      || bookend.ref !== CODE_SCANNING_REF
      || bookend.commit_sha !== input.expectedSha
      || bookend.analysis_key !== CODEQL_ANALYSIS_KEY
      || bookend.category !== CODEQL_ANALYSIS_KEY
      || analysisTool?.name !== 'CodeQL'
      || String(bookend.error || '') !== ''
      || timestamp(bookend.created_at) === null
    ) {
      problems.push(
        `CodeQL ${label} latest ${CODE_SCANNING_REF} analysis is not the expected exact SHA ${input.expectedSha}`,
      );
    }
  }

  if (!input.codeqlRun) {
    problems.push('CodeQL finding inventory has no exact-SHA successful workflow run to bind to');
  } else {
    const runCreatedAt = timestamp(input.codeqlRun.createdAt);
    const runUpdatedAt = timestamp(input.codeqlRun.updatedAt);
    const analyzedAt = timestamp(analysisCreatedAt);
    if (
      input.codeqlRun.workflowPath !== '.github/workflows/codeql.yml'
      || input.codeqlRun.headSha !== input.expectedSha
      || input.codeqlRun.event !== 'push'
      || input.codeqlRun.headBranch !== 'main'
      || input.codeqlRun.status !== 'completed'
      || input.codeqlRun.conclusion !== 'success'
      || runCreatedAt === null
      || runUpdatedAt === null
      || analyzedAt === null
      || analyzedAt < runCreatedAt - 60_000
      || analyzedAt > runUpdatedAt + 60_000
    ) {
      problems.push('CodeQL latest analysis is not bound to the attested exact-SHA workflow run');
    }
  }

  const findingNumbers = new Set<number>();
  for (const severity of BLOCKING_CODE_SCANNING_SEVERITIES) {
    const rawInventory = input.alertsBySeverity[severity];
    if (!Array.isArray(rawInventory)) {
      problems.push(`CodeQL open-${severity} alert inventory is missing`);
      continue;
    }

    for (const rawFinding of rawInventory) {
      const finding = record(rawFinding);
      if (!finding) {
        problems.push(`CodeQL open-${severity} alert inventory contains a malformed finding`);
        continue;
      }
      const rule = record(finding.rule);
      const tool = record(finding.tool);
      const instance = record(finding.most_recent_instance);
      const location = record(instance?.location);
      const number = finitePositiveInteger(finding.number);
      const ruleId = typeof rule?.id === 'string' ? rule.id : '';
      const reportedSeverity = rule?.security_severity_level;
      const commitSha = typeof instance?.commit_sha === 'string' ? instance.commit_sha : '';
      const ref = typeof instance?.ref === 'string' ? instance.ref : '';
      const analysisKey = typeof instance?.analysis_key === 'string' ? instance.analysis_key : '';

      if (
        !number
        || finding.state !== 'open'
        || instance?.state !== 'open'
        || reportedSeverity !== severity
        || tool?.name !== 'CodeQL'
        || ref !== CODE_SCANNING_REF
        || commitSha !== input.expectedSha
        || analysisKey !== CODEQL_ANALYSIS_KEY
        || !ruleId
      ) {
        problems.push(`CodeQL open-${severity} alert inventory contains a finding not bound to the expected ref/SHA`);
      }
      if (number && findingNumbers.has(number)) {
        problems.push(`CodeQL finding #${number} appears more than once in the blocking inventory`);
      }
      if (number) findingNumbers.add(number);

      openFindings.push({
        number: number || 0,
        severity,
        ruleId: ruleId || 'unknown',
        ref,
        commitSha,
        analysisKey,
        path: typeof location?.path === 'string' ? location.path : null,
        startLine: finitePositiveInteger(location?.start_line),
        htmlUrl: typeof finding.html_url === 'string' ? finding.html_url : null,
      });
    }
  }

  if (openFindings.length > 0) {
    problems.push(
      `CodeQL exact-ref inventory contains ${openFindings.length} open high/critical finding(s)`,
    );
  }

  return {
    ref: CODE_SCANNING_REF,
    expectedSha: input.expectedSha,
    tool: 'CodeQL',
    workflowRunId: input.codeqlRun?.runId ?? null,
    analysisBookendIds: { before: beforeId, after: afterId },
    analysis: analysis && afterId ? {
      id: afterId,
      ref: String(analysis.ref || ''),
      commitSha: String(analysis.commit_sha || ''),
      analysisKey: String(analysis.analysis_key || ''),
      category: String(analysis.category || ''),
      createdAt: analysisCreatedAt,
    } : null,
    blockedSeverities: [...BLOCKING_CODE_SCANNING_SEVERITIES],
    openFindings,
    problems,
    pass: problems.length === 0,
  };
}

async function main() {
  const out = arg('--out') || 'quality-attestation.json';
  const repository = arg('--repository') || process.env.GITHUB_REPOSITORY || '';
  const sha = arg('--expect-sha') || process.env.EXPECTED_SHA || '';
  const token = process.env.GITHUB_TOKEN?.trim() || '';
  const problems: string[] = [];
  const evidence: QualityRunEvidence[] = [];

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    problems.push('trusted GitHub repository must be owner/name');
  }
  if (!/^[0-9a-f]{40}$/i.test(sha)) problems.push('expected SHA must be a full 40-character Git SHA');
  if (!token) problems.push('GITHUB_TOKEN with actions:read and security-events:read is required');

  async function githubValue(
    path: string,
    label: string,
    errorSink: string[] = problems,
  ): Promise<unknown | null> {
    try {
      const response = await fetch(`https://api.github.com${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'User-Agent': 'uniqus-release-quality-attestation',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        errorSink.push(`${label} returned HTTP ${response.status}`);
        return null;
      }
      return await response.json() as unknown;
    } catch (error) {
      errorSink.push(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async function githubJson(path: string, label: string): Promise<JsonRecord | null> {
    const value = await githubValue(path, label);
    const parsed = record(value);
    if (value !== null && !parsed) problems.push(`${label} did not return a JSON object`);
    return parsed;
  }

  const workflows: JsonRecord[] = [];
  if (problems.length === 0) {
    for (let page = 1; page <= 10; page += 1) {
      const inventory = await githubJson(
        `/repos/${repository}/actions/workflows?per_page=100&page=${page}`,
        `GitHub workflow inventory page ${page}`,
      );
      if (!inventory) break;
      const pageWorkflows = records(inventory.workflows);
      workflows.push(...pageWorkflows);
      if (pageWorkflows.length < 100 || workflows.length >= Number(inventory.total_count)) break;
      if (page === 10) problems.push('GitHub workflow inventory exceeded the bounded 1,000-workflow scan');
    }
  }

  for (const requiredPath of REQUIRED_QUALITY_WORKFLOW_PATHS) {
    if (problems.length > 0 && workflows.length === 0) break;
    const matchingWorkflows = workflows.filter(workflow => workflow.path === requiredPath);
    if (matchingWorkflows.length !== 1) {
      problems.push(`required workflow ${requiredPath} resolved ${matchingWorkflows.length} times; expected exactly one`);
      continue;
    }
    const workflow = matchingWorkflows[0];
    const workflowId = Number(workflow.id);
    if (!Number.isSafeInteger(workflowId) || workflowId <= 0) {
      problems.push(`required workflow ${requiredPath} has no stable numeric workflow ID`);
      continue;
    }
    const params = new URLSearchParams({
      branch: 'main',
      event: 'push',
      status: 'completed',
      head_sha: sha,
      exclude_pull_requests: 'true',
      per_page: '100',
    });
    const runInventory = await githubJson(
      `/repos/${repository}/actions/workflows/${workflowId}/runs?${params}`,
      `GitHub runs for ${requiredPath}`,
    );
    const assessment = selectSuccessfulQualityRun({
      repository,
      sha,
      requiredPath,
      workflow,
      runs: records(runInventory?.workflow_runs),
    });
    problems.push(...assessment.problems);
    if (assessment.evidence) evidence.push(assessment.evidence);
  }

  const codeScanningCollectionProblems: string[] = [];
  let analysisBefore: unknown = null;
  let analysisAfter: unknown = null;
  const alertsBySeverity: Partial<Record<BlockingCodeScanningSeverity, unknown>> = {};
  if (repository && /^[0-9a-f]{40}$/i.test(sha) && token) {
    const analysisParams = new URLSearchParams({
      ref: CODE_SCANNING_REF,
      tool_name: 'CodeQL',
      per_page: '1',
    });
    const analysisPath = `/repos/${repository}/code-scanning/analyses?${analysisParams}`;
    analysisBefore = await githubValue(
      analysisPath,
      'CodeQL pre-inventory latest-analysis lookup',
      codeScanningCollectionProblems,
    );
    for (const severity of BLOCKING_CODE_SCANNING_SEVERITIES) {
      const alertParams = new URLSearchParams({
        tool_name: 'CodeQL',
        state: 'open',
        severity,
        ref: CODE_SCANNING_REF,
        per_page: '100',
      });
      alertsBySeverity[severity] = await githubValue(
        `/repos/${repository}/code-scanning/alerts?${alertParams}`,
        `CodeQL open-${severity} alert inventory`,
        codeScanningCollectionProblems,
      );
    }
    analysisAfter = await githubValue(
      analysisPath,
      'CodeQL post-inventory latest-analysis lookup',
      codeScanningCollectionProblems,
    );
  }

  const codeqlRun = evidence.find(
    item => item.workflowPath === '.github/workflows/codeql.yml',
  ) || null;
  const assessedCodeScanning = assessCodeScanningGate({
    expectedSha: sha,
    codeqlRun,
    analysisBefore,
    analysisAfter,
    alertsBySeverity,
  });
  const codeScanning: CodeScanningGateEvidence = {
    ...assessedCodeScanning,
    problems: [...codeScanningCollectionProblems, ...assessedCodeScanning.problems],
    pass: codeScanningCollectionProblems.length === 0 && assessedCodeScanning.pass,
  };
  for (const problem of codeScanning.problems) problems.push(`code scanning: ${problem}`);

  const report = {
    generatedAt: new Date().toISOString(),
    repository,
    expectedSha: sha,
    requiredWorkflowPaths: REQUIRED_QUALITY_WORKFLOW_PATHS,
    workflows: evidence,
    codeScanning,
    limitations: [
      'Workflow completion and the exact-ref CodeQL alert inventory are separate release conditions; medium/low findings remain subject to normal security triage.',
    ],
    problems,
    pass: problems.length === 0
      && evidence.length === REQUIRED_QUALITY_WORKFLOW_PATHS.length
      && codeScanning.pass,
  };
  writeFileSync(out, JSON.stringify(report, null, 2));
  process.stdout.write(`Exact-SHA quality attestation → ${out}\n`);
  for (const problem of problems) process.stderr.write(`  ✗ ${problem}\n`);
  if (!report.pass) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`quality attestation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
