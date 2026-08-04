/** Verify renewable credential acceptance and live path/method scoping. */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { candidateRequestHeaders } from './request';

export const RELEASE_GATE_DENIAL_STATUSES = new Set([401, 403, 404]);
export const RELEASE_AUTH_PROBE_HTTP_ATTEMPTS = 5;

export function isExplicitReleaseGateDenial(status: number): boolean {
  return RELEASE_GATE_DENIAL_STATUSES.has(status);
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const base = (arg('--base') || process.env.CANDIDATE_URL || '').replace(/\/$/, '');
  const out = arg('--out') || 'release-auth-probe.json';
  const problems: string[] = [];
  const headers = candidateRequestHeaders('/api/es-search', 'GET', { requestOrigin: base });
  let allowedStatus: number | null = null;
  let deniedStatus: number | null = null;
  let crossRouteStatus: number | null = null;
  let wrongMethodStatus: number | null = null;
  let enrichPostStatus: number | null = null;
  let enrichPostContentType: string | null = null;
  let enrichPostTyped = false;
  let httpAttempts = 0;

  if (!base) problems.push('candidate base URL is required');
  if (!headers['x-urc-release-gate-token']) {
    problems.push('release private key or exact candidate identity is missing');
  }

  if (problems.length === 0) {
    try {
      httpAttempts += 1;
      const allowed = await fetch(`${base}/api/es-search?cik=0000320193&size=1`, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      allowedStatus = allowed.status;
      if (allowed.status !== 200) problems.push(`allowlisted search probe returned HTTP ${allowed.status}; expected 200`);

      // Reuse the exact token accepted above. Only an explicit authentication
      // denial proves scope. Redirects, throttles and server failures could
      // occur after unintended authorization and therefore fail closed.
      httpAttempts += 1;
      const denied = await fetch(`${base}/api/sec-proxy?upstream=data&path=submissions/CIK0000320193.json`, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      deniedStatus = denied.status;
      if (!isExplicitReleaseGateDenial(denied.status)) {
        problems.push(
          `non-allowlisted API returned HTTP ${denied.status}; expected explicit 401, 403, or 404 denial`,
        );
      }

      // A v3 token is not a bearer credential for the whole canary allowlist:
      // reusing this exact /api/es-search GET token on another allowed path or
      // method must fall through to the normal authentication boundary.
      httpAttempts += 1;
      const crossRoute = await fetch(`${base}/api/filing-text`, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      crossRouteStatus = crossRoute.status;
      if (!isExplicitReleaseGateDenial(crossRoute.status)) {
        problems.push(
          `path-bound token reuse returned HTTP ${crossRoute.status}; expected explicit 401, 403, or 404 denial`,
        );
      }

      httpAttempts += 1;
      const wrongMethod = await fetch(`${base}/api/es-search?cik=0000320193&size=1`, {
        method: 'POST',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      wrongMethodStatus = wrongMethod.status;
      if (!isExplicitReleaseGateDenial(wrongMethod.status)) {
        problems.push(
          `method-bound token reuse returned HTTP ${wrongMethod.status}; expected explicit 401, 403, or 404 denial`,
        );
      }

      httpAttempts += 1;
      const enrichPost = await fetch(`${base}/api/enrich`, {
        method: 'POST',
        headers: {
          ...candidateRequestHeaders('/api/enrich', 'POST', { requestOrigin: base }),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filings: [] }),
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      enrichPostStatus = enrichPost.status;
      enrichPostContentType = enrichPost.headers.get('content-type');
      try {
        const payload = await enrichPost.json() as Record<string, unknown>;
        enrichPostTyped = typeof payload.error === 'string'
          && payload.error.includes("non-empty 'filings' array");
      } catch {
        enrichPostTyped = false;
      }
      if (
        enrichPost.status !== 400
        || !enrichPostContentType?.toLowerCase().includes('application/json')
        || !enrichPostTyped
      ) {
        problems.push(
          `allowlisted filing-auditor enrichment probe returned HTTP ${enrichPost.status}; expected typed JSON HTTP 400`,
        );
      }
    } catch (error) {
      problems.push(`release credential probe failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const evidence = {
    generatedAt: new Date().toISOString(),
    base,
    credential: 'renewable-ecdsa-p256-v3-path-method-bound',
    ttlSeconds: 300,
    httpAttempts,
    allowlistedProbe: { path: '/api/es-search', method: 'GET', status: allowedStatus },
    deniedProbe: { path: '/api/sec-proxy', method: 'GET', status: deniedStatus },
    crossRouteProbe: { path: '/api/filing-text', method: 'GET', status: crossRouteStatus },
    wrongMethodProbe: { path: '/api/es-search', method: 'POST', status: wrongMethodStatus },
    enrichPostProbe: {
      path: '/api/enrich',
      method: 'POST',
      status: enrichPostStatus,
      contentType: enrichPostContentType,
      typed: enrichPostTyped,
    },
    problems,
    pass: problems.length === 0,
  };
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  process.stdout.write(`Release credential evidence → ${out}\n`);
  if (!evidence.pass) {
    for (const problem of problems) process.stderr.write(`  ✗ ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write('Renewable staged-production credential is accepted only on the probe allowlist.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`release credential probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
