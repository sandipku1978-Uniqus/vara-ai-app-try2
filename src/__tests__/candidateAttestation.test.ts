import { describe, expect, it } from 'vitest';
import {
  assessApplicationSearchBackend,
  assessReleaseGateWindow,
  assessVercelCandidate,
  type ExpectedIdentity,
} from '../../scripts/accuracy/verify-candidate';

const base = 'https://candidate-attestation.vercel.app';
const expectedProjectId = 'prj_attestation';
const expectedOwnerId = 'team_attestation';
const expected: ExpectedIdentity = {
  deploymentId: 'dpl_attestation',
  sha: 'a'.repeat(40),
  repositoryId: '123456789',
  schemaVersion: '023',
  schemaMigrationCount: 25,
  schemaChainChecksum: 'b'.repeat(64),
  schemaChecksumAlgorithm: 'sha256-v2',
};

function passingInput(): Parameters<typeof assessVercelCandidate>[0] {
  return {
    base,
    expected,
    expectedProjectId,
    expectedOwnerId,
    deployment: {
      id: expected.deploymentId,
      url: new URL(base).hostname,
      projectId: expectedProjectId,
      ownerId: expectedOwnerId,
      readyState: 'READY',
      readySubstate: 'STAGED',
      ready: Date.parse('2026-08-04T10:00:00.000Z'),
      createdAt: Date.parse('2026-08-04T09:55:00.000Z'),
      target: 'production',
      aliasAssigned: false,
      aliasFinal: null,
      alias: [],
      automaticAliases: [],
      userAliases: [],
      prebuilt: false,
      deletedAt: null,
      gitSource: {
        type: 'github',
        ref: 'main',
        sha: expected.sha,
        repoId: Number(expected.repositoryId),
      },
      gitRepo: {
        type: 'github',
        repoId: Number(expected.repositoryId),
      },
    },
    project: {
      id: expectedProjectId,
      accountId: expectedOwnerId,
      autoAssignCustomDomains: false,
      link: {
        type: 'github',
        repoId: Number(expected.repositoryId),
        productionBranch: 'main',
      },
      targets: { production: { id: 'dpl_previous_production' } },
    },
    aliases: [] as Array<Record<string, unknown>>,
  };
}

describe('Vercel staged-production candidate attestation', () => {
  it('requires the enriched filing-search backend reported by the built application', () => {
    expect(assessApplicationSearchBackend({ filingSearchBackend: 'enriched' })).toEqual([]);
    expect(assessApplicationSearchBackend({ filingSearchBackend: 'legacy-sec-efts' })).toContain(
      'application filingSearchBackend is legacy-sec-efts, expected enriched',
    );
    expect(assessApplicationSearchBackend({})).toContain(
      'application filingSearchBackend is missing, expected enriched',
    );
  });

  it('accepts only the exact unaliased staged Git-source artifact', () => {
    expect(assessVercelCandidate(passingInput())).toEqual([]);
  });

  it('rejects caller-controlled metadata when authenticated Git source is absent', () => {
    const input = passingInput();
    delete input.deployment.gitSource;
    Object.assign(input.deployment, { meta: { githubCommitSha: expected.sha } });

    expect(assessVercelCandidate(input)).toEqual(expect.arrayContaining([
      expect.stringContaining('deployment SHA none'),
      expect.stringContaining('expected an authenticated GitHub source'),
      expect.stringContaining('candidate repository ID missing'),
    ]));
  });

  it('rejects preview, current, promoted, aliased, prebuilt, and wrong-repository candidates', () => {
    const input = passingInput();
    input.deployment.target = null;
    input.deployment.readySubstate = 'PROMOTED';
    input.deployment.aliasAssigned = true;
    input.deployment.alias = ['uniqus-research.vercel.app'];
    input.deployment.prebuilt = true;
    (input.deployment.gitSource as Record<string, unknown>).repoId = 42;
    const targets = input.project?.targets as Record<string, Record<string, unknown>>;
    targets.production.id = expected.deploymentId;
    input.aliases?.push({ alias: 'uniqus-research.vercel.app' });

    const problems = assessVercelCandidate(input);
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('expected a production build'),
      expect.stringContaining('expected STAGED'),
      expect.stringContaining('aliases assigned'),
      expect.stringContaining('non-prebuilt Git-build status'),
      expect.stringContaining('repository ID 42'),
      expect.stringContaining('already the current Production deployment'),
      expect.stringContaining('assigned deployment alias'),
    ]));
  });

  it('fails closed when project or live alias evidence is unavailable', () => {
    const input = passingInput();
    input.project = null;
    input.aliases = null;
    expect(assessVercelCandidate(input)).toEqual(expect.arrayContaining([
      'Vercel project configuration could not be attested',
      'candidate alias absence could not be attested',
    ]));
  });

  it('fails closed when non-prebuilt status or the current production target is unknown', () => {
    const input = passingInput();
    delete input.deployment.prebuilt;
    delete (input.project?.targets as Record<string, unknown>).production;

    expect(assessVercelCandidate(input)).toEqual(expect.arrayContaining([
      'candidate non-prebuilt Git-build status could not be attested',
      'current Production deployment identity could not be attested',
    ]));
  });

  it('requires a fresh per-candidate absolute not-after beyond the workflow budget', () => {
    const deployment = passingInput().deployment;
    const application = { releaseGateNotAfter: '2026-08-04T14:00:00.000Z' };
    expect(assessReleaseGateWindow({
      application,
      deployment,
      minRemainingSeconds: 7_200,
      nowMs: Date.parse('2026-08-04T11:00:00.000Z'),
    })).toEqual([]);
  });

  it('rejects missing, expired, insufficient, and far-future per-candidate windows', () => {
    const deployment = passingInput().deployment;
    const nowMs = Date.parse('2026-08-04T11:00:00.000Z');

    expect(assessReleaseGateWindow({
      application: {}, deployment, minRemainingSeconds: 7_200, nowMs,
    })).toContain('application releaseGateNotAfter is missing or invalid');
    expect(assessReleaseGateWindow({
      application: { releaseGateNotAfter: '2026-08-04T10:59:00.000Z' },
      deployment, minRemainingSeconds: 0, nowMs,
    })).toContain('application releaseGateNotAfter is expired');
    expect(assessReleaseGateWindow({
      application: { releaseGateNotAfter: '2026-08-04T12:00:00.000Z' },
      deployment, minRemainingSeconds: 7_200, nowMs,
    })).toContain('application releaseGateNotAfter has less than 7200 seconds remaining');
    expect(assessReleaseGateWindow({
      application: { releaseGateNotAfter: '2026-08-04T16:00:01.000Z' },
      deployment, minRemainingSeconds: 0, nowMs,
    })).toContain('application releaseGateNotAfter exceeds the 21600-second per-candidate window');
  });
});
