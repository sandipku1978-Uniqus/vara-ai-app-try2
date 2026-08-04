/**
 * Fail-closed preflight for an immutable Vercel release candidate.
 *
 * This deliberately verifies two independent identities:
 *   1. Vercel's API says the supplied URL is the deployment's canonical URL.
 *   2. The running application reports the expected deployment, Git SHA and
 *      complete database migration-chain fingerprint.
 *
 * An alias (including the production alias) cannot pass because it differs
 * from the canonical deployment URL returned by Vercel.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  MAX_RELEASE_GATE_WINDOW_SECONDS,
  parseReleaseGateNotAfter,
} from '../../src/lib/release-gate-window';
import { candidateRequestHeaders } from './request';

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function normalizeBase(raw: string): string {
  const url = new URL(raw);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.vercel.app') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('candidate URL must be an HTTPS Vercel deployment origin with no path, credentials, query, or fragment');
  }
  return url.origin;
}

export interface ExpectedIdentity {
  deploymentId: string;
  sha: string;
  schemaVersion: string;
  schemaMigrationCount: number;
  schemaChainChecksum: string;
  schemaChecksumAlgorithm: string;
  repositoryId: string;
}

export function assessApplicationSearchBackend(application: Record<string, unknown>): string[] {
  return application.filingSearchBackend === 'enriched'
    ? []
    : [
      `application filingSearchBackend is ${String(application.filingSearchBackend ?? 'missing')}, expected enriched`,
    ];
}

function timestampMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value >= 1_000_000_000_000 ? value : value * 1_000;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d{10,13}$/.test(value.trim())) {
    const numeric = Number(value);
    return value.trim().length >= 13 ? numeric : numeric * 1_000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function assessReleaseGateWindow(input: {
  application: Record<string, unknown>;
  deployment: Record<string, unknown>;
  minRemainingSeconds: number;
  nowMs?: number;
}): string[] {
  const { application, deployment, minRemainingSeconds } = input;
  const nowMs = input.nowMs ?? Date.now();
  const notAfter = parseReleaseGateNotAfter(
    typeof application.releaseGateNotAfter === 'string'
      ? application.releaseGateNotAfter
      : null,
  );
  if (!notAfter) return ['application releaseGateNotAfter is missing or invalid'];

  const problems: string[] = [];
  const nowSeconds = Math.floor(nowMs / 1_000);
  if (notAfter < nowSeconds) problems.push('application releaseGateNotAfter is expired');
  if (notAfter < nowSeconds + minRemainingSeconds) {
    problems.push(
      `application releaseGateNotAfter has less than ${minRemainingSeconds} seconds remaining`,
    );
  }

  const readyAt = timestampMillis(deployment.ready ?? deployment.readyAt);
  const createdAt = timestampMillis(deployment.createdAt);
  const anchor = readyAt ?? createdAt;
  if (anchor === null) {
    problems.push('Vercel deployment ready/created timestamp could not be attested');
  } else {
    if (anchor > nowMs + 5 * 60 * 1_000) {
      problems.push('Vercel deployment ready/created timestamp is implausibly in the future');
    }
    const notAfterMs = notAfter * 1_000;
    if (notAfterMs <= anchor) {
      problems.push('application releaseGateNotAfter is not after deployment readiness');
    }
    if (notAfterMs > anchor + MAX_RELEASE_GATE_WINDOW_SECONDS * 1_000) {
      problems.push(
        `application releaseGateNotAfter exceeds the ${MAX_RELEASE_GATE_WINDOW_SECONDS}-second per-candidate window`,
      );
    }
  }
  return problems;
}

export function assessVercelCandidate(input: {
  base: string;
  expected: ExpectedIdentity;
  expectedProjectId: string;
  expectedOwnerId: string;
  deployment: Record<string, unknown>;
  project: Record<string, unknown> | null;
  aliases: Array<Record<string, unknown>> | null;
}): string[] {
  const { base, expected, expectedProjectId, expectedOwnerId, deployment, project, aliases } = input;
  const problems: string[] = [];
  const id = String(deployment.id || '');
  const canonicalUrl = deployment.url ? `https://${String(deployment.url)}` : '';
  const gitSource = deployment.gitSource as Record<string, unknown> | undefined;
  const deployedSha = String(gitSource?.sha || '');
  const gitType = String(gitSource?.type || '');
  const gitRef = String(gitSource?.ref || '');
  const repositoryId = String(gitSource?.repoId || '');
  const gitRepo = deployment.gitRepo as Record<string, unknown> | undefined;
  const readyState = String(deployment.readyState || '');
  const readySubstate = String(deployment.readySubstate || '');
  const target = deployment.target == null ? null : String(deployment.target);
  const projectId = String(deployment.projectId || '');

  if (id !== expected.deploymentId) problems.push(`Vercel returned deployment ${id || 'none'}, expected ${expected.deploymentId}`);
  if (canonicalUrl !== base) problems.push(`candidate URL ${base} is not deployment ${expected.deploymentId}'s immutable URL ${canonicalUrl || 'none'}`);
  if (deployedSha !== expected.sha) problems.push(`Vercel deployment SHA ${deployedSha || 'none'} differs from expected ${expected.sha}`);
  if (!['github', 'github-limited'].includes(gitType)) {
    problems.push(`candidate source is ${gitType || 'missing'}, expected an authenticated GitHub source`);
  }
  if (gitRef !== 'main') problems.push(`candidate Git ref is ${gitRef || 'missing'}, expected protected main`);
  if (repositoryId !== expected.repositoryId) {
    problems.push(`candidate repository ID ${repositoryId || 'missing'} differs from expected ${expected.repositoryId}`);
  }
  if (projectId !== expectedProjectId) problems.push(`Vercel deployment project ${projectId || 'none'} differs from expected ${expectedProjectId}`);
  if (String(deployment.ownerId || '') !== expectedOwnerId) problems.push('Vercel deployment owner differs from the configured owner');
  if (!gitRepo || !['github', 'github-limited'].includes(String(gitRepo.type || ''))) problems.push('deployment connected-repository details are missing');
  if (String(gitRepo?.repoId || '') !== expected.repositoryId) problems.push('deployment connected repository differs from the expected GitHub repository');
  if (readyState !== 'READY') problems.push(`Vercel deployment is ${readyState || 'unknown'}, not READY`);
  if (target !== 'production') problems.push(`candidate target is ${target || 'preview'}, expected a production build`);
  if (readySubstate !== 'STAGED') problems.push(`candidate ready substate is ${readySubstate || 'missing'}, expected STAGED`);
  if (deployment.aliasAssigned !== false) problems.push('candidate already has deployment aliases assigned; expected an unpromoted staged build');
  if (deployment.prebuilt !== false) {
    problems.push('candidate non-prebuilt Git-build status could not be attested');
  }
  if (deployment.deletedAt != null || deployment.softDeletedByRetention === true) problems.push('candidate deployment is deleted or retained only as a soft-deleted artifact');
  for (const field of ['alias', 'automaticAliases', 'userAliases'] as const) {
    if (Array.isArray(deployment[field]) && deployment[field].length > 0) {
      problems.push(`candidate deployment field ${field} contains assigned aliases`);
    }
  }
  if (deployment.aliasFinal != null) problems.push('candidate has a final alias assignment');

  if (project) {
    const link = project.link as Record<string, unknown> | undefined;
    const targets = project.targets as Record<string, unknown> | undefined;
    const productionTarget = targets?.production as Record<string, unknown> | undefined;
    if (String(project.id || '') !== expectedProjectId) problems.push('Vercel project lookup returned the wrong project');
    if (String(project.accountId || '') !== expectedOwnerId) problems.push('Vercel project owner differs from the configured owner');
    if (!link || !['github', 'github-limited'].includes(String(link.type || ''))) {
      problems.push('Vercel project is not linked to GitHub');
    }
    if (String(link?.repoId || '') !== expected.repositoryId) problems.push('Vercel project is linked to a different GitHub repository');
    if (String(link?.productionBranch || '') !== 'main') problems.push('Vercel project production branch is not protected main');
    if (project.autoAssignCustomDomains !== false) problems.push('Vercel project still auto-assigns Production domains');
    const productionDeploymentId = String(productionTarget?.id || '');
    if (!productionDeploymentId) problems.push('current Production deployment identity could not be attested');
    else if (productionDeploymentId === expected.deploymentId) problems.push('candidate is already the current Production deployment');
  } else {
    problems.push('Vercel project configuration could not be attested');
  }

  if (aliases) {
    if (aliases.length > 0) problems.push(`candidate already has ${aliases.length} assigned deployment alias(es)`);
  } else {
    problems.push('candidate alias absence could not be attested');
  }

  return problems;
}

async function main() {
  const out = arg('--out') || 'candidate-provenance.json';
  const problems: string[] = [];

  let base = '';
  try {
    base = normalizeBase(arg('--base') || '');
  } catch (error) {
    problems.push(`invalid candidate URL: ${error instanceof Error ? error.message : String(error)}`);
  }

  const expected: ExpectedIdentity = {
    deploymentId: arg('--deployment-id') || '',
    sha: arg('--expect-sha') || '',
    schemaVersion: arg('--expect-schema') || '',
    schemaMigrationCount: Number(arg('--expect-migration-count')),
    schemaChainChecksum: (arg('--expect-schema-checksum') || '').toLowerCase(),
    schemaChecksumAlgorithm: arg('--expect-checksum-algorithm') || '',
    repositoryId: arg('--expect-repository-id') || '',
  };
  const minNotAfterSeconds = Number(arg('--min-not-after-seconds') || 0);
  const vercelToken = process.env.VERCEL_TOKEN?.trim() || '';
  const vercelTeamId = process.env.VERCEL_ORG_ID?.trim() || '';
  const expectedProjectId = process.env.VERCEL_PROJECT_ID?.trim() || '';

  if (!expected.deploymentId) problems.push('deployment ID is required');
  if (!/^[0-9a-f]{40}$/i.test(expected.sha)) problems.push('expected SHA must be a full 40-character Git SHA');
  if (!/^\d{3,}$/.test(expected.schemaVersion)) problems.push('expected schema version is invalid');
  if (!Number.isInteger(expected.schemaMigrationCount) || expected.schemaMigrationCount < 1) {
    problems.push('expected migration count must be a positive integer');
  }
  if (!/^[0-9a-f]{64}$/.test(expected.schemaChainChecksum)) problems.push('expected schema checksum must be lowercase SHA-256 hex');
  if (expected.schemaChecksumAlgorithm !== 'sha256-v2') problems.push('expected checksum algorithm must be sha256-v2');
  if (!/^\d+$/.test(expected.repositoryId)) problems.push('expected GitHub repository ID must be numeric');
  if (!Number.isSafeInteger(minNotAfterSeconds) || minNotAfterSeconds < 0) {
    problems.push('minimum release-gate not-after seconds must be a non-negative integer');
  }
  if (!vercelToken) problems.push('VERCEL_TOKEN is required to prove the URL is canonical and immutable');
  if (!vercelTeamId) problems.push('VERCEL_ORG_ID is required to bind the deployment and project owner');
  if (!expectedProjectId) problems.push('VERCEL_PROJECT_ID is required to bind the candidate to this application');

  let vercel: Record<string, unknown> | null = null;
  let project: Record<string, unknown> | null = null;
  let aliases: Array<Record<string, unknown>> | null = null;
  let application: Record<string, unknown> | null = null;

  async function vercelJson(endpoint: URL, label: string): Promise<Record<string, unknown> | null> {
    if (vercelTeamId) endpoint.searchParams.set('teamId', vercelTeamId);
    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${vercelToken}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        problems.push(`${label} returned HTTP ${response.status}`);
        return null;
      }
      return await response.json() as Record<string, unknown>;
    } catch (error) {
      problems.push(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  if (problems.length === 0) {
    const endpoint = new URL(`https://api.vercel.com/v13/deployments/${encodeURIComponent(expected.deploymentId)}`);
    endpoint.searchParams.set('withGitRepoInfo', 'true');
    vercel = await vercelJson(endpoint, 'Vercel deployment lookup');
  }

  if (vercel) {
    const [projectResult, aliasResult] = await Promise.all([
      vercelJson(
        new URL(`https://api.vercel.com/v9/projects/${encodeURIComponent(expectedProjectId)}`),
        'Vercel project lookup',
      ),
      vercelJson(
        new URL(`https://api.vercel.com/v2/deployments/${encodeURIComponent(expected.deploymentId)}/aliases`),
        'Vercel deployment alias lookup',
      ),
    ]);
    project = projectResult;
    aliases = Array.isArray(aliasResult?.aliases)
      ? aliasResult.aliases as Array<Record<string, unknown>>
      : null;
    if (aliasResult && aliases === null) problems.push('Vercel deployment alias lookup returned no alias inventory');
  }

  if (vercel) problems.push(...assessVercelCandidate({
    base,
    expected,
    expectedProjectId,
    expectedOwnerId: vercelTeamId,
    deployment: vercel,
    project,
    aliases,
  }));

  if (base && problems.length === 0) {
    try {
      const response = await fetch(`${base}/api/version`, {
        // The Vercel API assessment above independently bound this exact
        // origin to the expected immutable deployment before any protection
        // bypass can be attached.
        headers: candidateRequestHeaders('/api/version', 'GET', {
          requestOrigin: base,
          trustedOrigin: base,
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        problems.push(`candidate /api/version returned HTTP ${response.status}`);
      } else {
        application = await response.json() as Record<string, unknown>;
      }
    } catch (error) {
      problems.push(`candidate /api/version failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (application) {
    const comparisons: Array<[keyof ExpectedIdentity, unknown]> = [
      ['deploymentId', application.deploymentId],
      ['sha', application.sha],
      ['schemaVersion', application.schemaVersion],
      ['schemaMigrationCount', application.schemaMigrationCount],
      ['schemaChainChecksum', application.schemaChainChecksum],
      ['schemaChecksumAlgorithm', application.schemaChecksumAlgorithm],
    ];
    for (const [field, actual] of comparisons) {
      if (actual !== expected[field]) {
        problems.push(`application ${field} ${String(actual ?? 'null')} differs from expected ${String(expected[field])}`);
      }
    }
    if (application.environment !== 'production') {
      problems.push(`application environment is ${String(application.environment ?? 'null')}, expected production`);
    }
    problems.push(...assessApplicationSearchBackend(application));
    if (!/^sha256:[0-9a-f]{64}$/.test(String(application.schemaDatabaseFingerprint || ''))) {
      problems.push('application schemaDatabaseFingerprint is missing or invalid');
    }
    if (vercel) {
      problems.push(...assessReleaseGateWindow({
        application,
        deployment: vercel,
        minRemainingSeconds: minNotAfterSeconds,
      }));
    }
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    base,
    expected,
    vercel: vercel ? {
      deploymentId: vercel.id || null,
      url: vercel.url ? `https://${String(vercel.url)}` : null,
      readyState: vercel.readyState || null,
      readySubstate: vercel.readySubstate ?? null,
      target: vercel.target ?? null,
      aliasAssigned: vercel.aliasAssigned ?? null,
      autoAssignCustomDomains: vercel.autoAssignCustomDomains ?? null,
      prebuilt: vercel.prebuilt ?? null,
      gitSha: (vercel.gitSource as Record<string, unknown> | undefined)?.sha || null,
      gitType: (vercel.gitSource as Record<string, unknown> | undefined)?.type || null,
      gitRef: (vercel.gitSource as Record<string, unknown> | undefined)?.ref || null,
      repositoryId: (vercel.gitSource as Record<string, unknown> | undefined)?.repoId || null,
      connectedRepositoryId: (vercel.gitRepo as Record<string, unknown> | undefined)?.repoId || null,
      ownerId: vercel.ownerId ?? null,
      createdAt: vercel.createdAt ?? null,
      readyAt: vercel.ready ?? null,
      projectId: vercel.projectId ?? null,
    } : null,
    project: project ? {
      id: project.id ?? null,
      accountId: project.accountId ?? null,
      autoAssignCustomDomains: project.autoAssignCustomDomains ?? null,
      productionDeploymentId: ((project.targets as Record<string, unknown> | undefined)?.production as Record<string, unknown> | undefined)?.id ?? null,
      gitType: (project.link as Record<string, unknown> | undefined)?.type ?? null,
      gitRepositoryId: (project.link as Record<string, unknown> | undefined)?.repoId ?? null,
      productionBranch: (project.link as Record<string, unknown> | undefined)?.productionBranch ?? null,
    } : null,
    aliases: aliases?.map(alias => String(alias.alias || alias.uid || 'unknown')) ?? null,
    application,
    releaseGateWindow: {
      minRemainingSeconds: minNotAfterSeconds,
      maxSecondsFromDeploymentReady: MAX_RELEASE_GATE_WINDOW_SECONDS,
    },
    problems,
    pass: problems.length === 0,
  };

  writeFileSync(out, JSON.stringify(evidence, null, 2));
  process.stdout.write(`Candidate provenance → ${out}\n`);
  if (problems.length) {
    for (const problem of problems) process.stderr.write(`  ✗ ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(`Immutable candidate verified: ${expected.deploymentId} @ ${expected.sha}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`candidate verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
