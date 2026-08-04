/**
 * Record enforced security headers from the exact immutable release candidate.
 *
 * This deliberately probes response archetypes that can bypass one another in
 * framework routing: HTML, JSON, static 404, protected-page auth boundary and a
 * typed application 400. The report contains response metadata only; request
 * credentials are never serialized.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { candidateRequestHeaders } from './request';

type FetchLike = typeof fetch;

export interface SecurityHeaderObservation {
  name: string;
  path: string;
  status: number | null;
  contentType: string | null;
  headers: {
    contentSecurityPolicy: string | null;
    contentSecurityPolicyReportOnly: string | null;
    reportingEndpoints: string | null;
    xFrameOptions: string | null;
    xContentTypeOptions: string | null;
    referrerPolicy: string | null;
    permissionsPolicy: string | null;
    strictTransportSecurity: string | null;
  };
  problems: string[];
  pass: boolean;
}

export interface SecurityHeaderEvidence {
  generatedAt: string;
  base: string;
  policy: {
    enforcedCsp: true;
    responseArchetypes: readonly string[];
    authBoundary: {
      path: '/dashboard';
      authentication: 'unauthenticated';
      releaseGateToken: 'absent';
      redirectMode: 'manual';
      acceptedStatuses: readonly number[];
    };
  };
  observations: SecurityHeaderObservation[];
  problems: string[];
  pass: boolean;
}

interface ProbeDefinition {
  name: string;
  path: string;
  acceptedStatuses: readonly number[];
  contentType?: string;
  validateBody?: (body: unknown) => string | null;
}

export const SECURITY_HEADER_ARCHETYPES = [
  'public-html',
  'public-api',
  'not-found',
  'protected-route',
  'typed-bad-request',
] as const;

export const PROTECTED_AUTH_BOUNDARY_STATUSES = [
  301,
  302,
  303,
  307,
  308,
  401,
  403,
  404,
] as const;

const PROBES: readonly ProbeDefinition[] = [
  {
    name: 'public-html',
    path: '/support',
    acceptedStatuses: [200],
    contentType: 'text/html',
  },
  {
    name: 'public-api',
    path: '/api/version',
    acceptedStatuses: [200],
    contentType: 'application/json',
  },
  {
    name: 'not-found',
    path: '/_next/static/release-security-header-archetype-missing.js',
    acceptedStatuses: [404],
  },
  {
    name: 'protected-route',
    path: '/dashboard',
    // This is the real neutral-visitor boundary: no Clerk session and no
    // release-gate token. A manual redirect or explicit denial/not-found is
    // acceptable while production Clerk configuration remains deferred, but
    // a fail-open 200 is never acceptable.
    acceptedStatuses: PROTECTED_AUTH_BOUNDARY_STATUSES,
  },
  {
    name: 'typed-bad-request',
    path: '/api/es-search?size=0',
    acceptedStatuses: [400],
    contentType: 'application/json',
    validateBody: body => {
      if (!body || typeof body !== 'object' || Array.isArray(body)) return 'body is not a JSON object';
      const value = body as Record<string, unknown>;
      if (value.ok !== false || value.errorClass !== 'invalid-request' || typeof value.error !== 'string') {
        return 'body is not the typed invalid-request envelope';
      }
      return null;
    },
  },
];

const REQUIRED_CSP_DIRECTIVES = [
  ['default-src', ["'self'"]],
  ['script-src', [
    "'self'", "'unsafe-inline'", 'https://*.clerk.accounts.dev',
    'https://challenges.cloudflare.com',
  ]],
  ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
  ['img-src', ["'self'", 'data:', 'blob:', 'https://img.clerk.com']],
  ['font-src', ["'self'", 'data:', 'https://fonts.gstatic.com']],
  ['connect-src', [
    "'self'", 'https://*.clerk.accounts.dev', 'https://clerk-telemetry.com',
    'https://us.i.posthog.com', 'https://us-assets.i.posthog.com',
  ]],
  ['frame-src', [
    "'self'", 'https://challenges.cloudflare.com', 'https://*.clerk.accounts.dev',
  ]],
  ['worker-src', ["'self'", 'blob:']],
  ['manifest-src', ["'self'"]],
  ['object-src', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'self'", 'https://*.clerk.accounts.dev']],
  ['frame-ancestors', ["'self'"]],
  ['report-uri', ['/api/csp-report']],
  ['report-to', ['csp-endpoint']],
] as const satisfies ReadonlyArray<readonly [string, readonly string[]]>;

export interface ParsedCspDirectives {
  directives: Map<string, string[]>;
  problems: string[];
}

/** Parse CSP once into unique, case-normalized directive names and tokens. */
export function parseCspDirectives(policy: string): ParsedCspDirectives {
  const directives = new Map<string, string[]>();
  const problems: string[] = [];
  for (const rawDirective of policy.split(';')) {
    const trimmed = rawDirective.trim();
    if (!trimmed) continue;
    const [rawName, ...tokens] = trimmed.split(/\s+/);
    const name = (rawName || '').toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      problems.push(`CSP contains invalid directive name ${rawName || '(missing)'}`);
      continue;
    }
    if (directives.has(name)) {
      problems.push(`CSP contains duplicate directive ${name}`);
      continue;
    }
    if (new Set(tokens).size !== tokens.length) {
      problems.push(`CSP directive ${name} contains duplicate tokens`);
    }
    directives.set(name, tokens);
  }
  return { directives, problems };
}

function sameTokenSet(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
  return Boolean(
    actual
    && actual.length === expected.length
    && new Set(actual).size === expected.length
    && expected.every(token => actual.includes(token)),
  );
}

export function assessContentSecurityPolicy(policy: string | null): string[] {
  if (!policy) return ['enforced Content-Security-Policy is missing'];
  const parsed = parseCspDirectives(policy);
  const problems = [...parsed.problems];
  for (const directive of ['object-src', 'base-uri', 'frame-ancestors']) {
    const tokens = parsed.directives.get(directive) || [];
    if (tokens.includes("'none'") && tokens.length !== 1) {
      problems.push(`CSP ${directive} combines 'none' with another source`);
    }
  }
  for (const [directive, expected] of REQUIRED_CSP_DIRECTIVES) {
    if (!sameTokenSet(parsed.directives.get(directive), expected)) {
      problems.push(`CSP ${directive} must be exactly ${expected.join(' ')}`);
    }
  }
  const requiredNames = new Set<string>(
    REQUIRED_CSP_DIRECTIVES.map(([directive]) => directive),
  );
  for (const directive of parsed.directives.keys()) {
    if (!requiredNames.has(directive)) problems.push(`CSP contains unexpected directive ${directive}`);
  }
  if (parsed.directives.get('script-src')?.includes("'unsafe-eval'")) {
    problems.push("production CSP permits 'unsafe-eval'");
  }
  return problems;
}

export function assessPermissionsPolicy(policy: string | null): string[] {
  if (!policy) return ['Permissions-Policy is missing'];
  const expected = new Set(['camera', 'microphone', 'geolocation']);
  const observed = new Map<string, string>();
  const problems: string[] = [];
  for (const rawEntry of policy.split(',')) {
    const entry = rawEntry.trim();
    const match = entry.match(/^([a-z][a-z0-9-]*)\s*=\s*(\([^)]*\))$/i);
    if (!match) {
      problems.push(`Permissions-Policy contains invalid entry ${entry || '(empty)'}`);
      continue;
    }
    const feature = match[1].toLowerCase();
    if (observed.has(feature)) problems.push(`Permissions-Policy duplicates ${feature}`);
    observed.set(feature, match[2].replace(/\s+/g, ''));
  }
  if (
    observed.size !== expected.size
    || [...expected].some(feature => observed.get(feature) !== '()')
    || [...observed.keys()].some(feature => !expected.has(feature))
  ) {
    problems.push('Permissions-Policy must disable exactly camera, microphone, and geolocation');
  }
  return problems;
}

export function assessStrictTransportSecurity(policy: string | null): string[] {
  if (!policy) return ['Strict-Transport-Security is missing'];
  const directives = new Map<string, string | null>();
  const problems: string[] = [];
  for (const rawDirective of policy.split(';')) {
    const directive = rawDirective.trim();
    if (!directive) continue;
    const maxAge = directive.match(/^max-age\s*=\s*(\d+)$/i);
    const name = maxAge ? 'max-age' : directive.toLowerCase();
    const value = maxAge ? maxAge[1] : null;
    if (!['max-age', 'includesubdomains', 'preload'].includes(name)) {
      problems.push(`Strict-Transport-Security contains unexpected directive ${directive}`);
      continue;
    }
    if (directives.has(name)) problems.push(`Strict-Transport-Security duplicates ${name}`);
    directives.set(name, value);
  }
  if (
    directives.size !== 3
    || directives.get('max-age') !== '31536000'
    || directives.get('includesubdomains') !== null
    || directives.get('preload') !== null
  ) {
    problems.push('Strict-Transport-Security must be exactly max-age=31536000, includeSubDomains, and preload');
  }
  return problems;
}

function responseHeaderSnapshot(headers: Headers): SecurityHeaderObservation['headers'] {
  return {
    contentSecurityPolicy: headers.get('content-security-policy'),
    contentSecurityPolicyReportOnly: headers.get('content-security-policy-report-only'),
    reportingEndpoints: headers.get('reporting-endpoints'),
    xFrameOptions: headers.get('x-frame-options'),
    xContentTypeOptions: headers.get('x-content-type-options'),
    referrerPolicy: headers.get('referrer-policy'),
    permissionsPolicy: headers.get('permissions-policy'),
    strictTransportSecurity: headers.get('strict-transport-security'),
  };
}

export function assessSecurityHeaders(
  name: string,
  path: string,
  response: Pick<Response, 'status' | 'headers'>,
  definition: Pick<ProbeDefinition, 'acceptedStatuses' | 'contentType'>,
): SecurityHeaderObservation {
  const problems: string[] = [];
  const headers = responseHeaderSnapshot(response.headers);
  const contentType = response.headers.get('content-type');
  const csp = headers.contentSecurityPolicy || '';

  if (!definition.acceptedStatuses.includes(response.status)) {
    problems.push(`HTTP ${response.status}; expected ${definition.acceptedStatuses.join('/')}`);
  }
  if (definition.contentType && !contentType?.toLowerCase().includes(definition.contentType)) {
    problems.push(`content-type ${contentType || 'missing'}; expected ${definition.contentType}`);
  }
  problems.push(...assessContentSecurityPolicy(csp || null));
  if (headers.contentSecurityPolicyReportOnly) problems.push('production response includes report-only CSP');
  if (headers.reportingEndpoints !== 'csp-endpoint="/api/csp-report"') {
    problems.push('Reporting-Endpoints does not bind csp-endpoint to /api/csp-report');
  }
  if (headers.xFrameOptions?.toUpperCase() !== 'SAMEORIGIN') problems.push('X-Frame-Options is not SAMEORIGIN');
  if (headers.xContentTypeOptions?.toLowerCase() !== 'nosniff') problems.push('X-Content-Type-Options is not nosniff');
  if (headers.referrerPolicy?.toLowerCase() !== 'strict-origin-when-cross-origin') {
    problems.push('Referrer-Policy is not strict-origin-when-cross-origin');
  }
  problems.push(...assessPermissionsPolicy(headers.permissionsPolicy));
  problems.push(...assessStrictTransportSecurity(headers.strictTransportSecurity));

  return {
    name,
    path,
    status: response.status,
    contentType,
    headers,
    problems,
    pass: problems.length === 0,
  };
}

function canonicalCandidateBase(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:'
      || !/^[a-z0-9-]+\.vercel\.app$/.test(url.hostname.toLowerCase())
      || url.username
      || url.password
      || (url.pathname !== '/' && url.pathname !== '')
      || url.search
      || url.hash
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function collectSecurityHeaderEvidence(
  rawBase: string,
  fetchImpl: FetchLike = fetch,
): Promise<SecurityHeaderEvidence> {
  const base = canonicalCandidateBase(rawBase) || '';
  const problems: string[] = [];
  const observations: SecurityHeaderObservation[] = [];
  if (!base) problems.push('candidate base must be a canonical HTTPS *.vercel.app origin');

  const credentialCheck = candidateRequestHeaders('/api/es-search', 'GET', { requestOrigin: base });
  if (!credentialCheck['x-urc-release-gate-token']) {
    problems.push('release private key or exact candidate identity is missing');
  }

  if (problems.length === 0) {
    for (const probe of PROBES) {
      try {
        const probePathname = new URL(probe.path, base).pathname;
        // Non-API paths receive only the Vercel protection bypass: the helper
        // cannot mint a release token for /dashboard. redirect:manual keeps an
        // authentication redirect observable rather than following it to 200.
        const requestHeaders = candidateRequestHeaders(probePathname, 'GET', { requestOrigin: base });
        const response = await fetchImpl(`${base}${probe.path}`, {
          headers: {
            ...requestHeaders,
            Accept: probe.contentType === 'text/html' ? 'text/html' : 'application/json',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(30_000),
        });
        const observation = assessSecurityHeaders(probe.name, probe.path, response, probe);
        if (probe.validateBody) {
          let body: unknown = null;
          try {
            body = await response.json();
          } catch {
            observation.problems.push('response body is not valid JSON');
          }
          const bodyProblem = probe.validateBody(body);
          if (bodyProblem) observation.problems.push(bodyProblem);
          observation.pass = observation.problems.length === 0;
        }
        observations.push(observation);
        for (const problem of observation.problems) problems.push(`${probe.name}: ${problem}`);
      } catch (error) {
        const problem = `request failed: ${error instanceof Error ? error.message : String(error)}`;
        observations.push({
          name: probe.name,
          path: probe.path,
          status: null,
          contentType: null,
          headers: responseHeaderSnapshot(new Headers()),
          problems: [problem],
          pass: false,
        });
        problems.push(`${probe.name}: ${problem}`);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    base,
    policy: {
      enforcedCsp: true,
      responseArchetypes: [...SECURITY_HEADER_ARCHETYPES],
      authBoundary: {
        path: '/dashboard',
        authentication: 'unauthenticated',
        releaseGateToken: 'absent',
        redirectMode: 'manual',
        acceptedStatuses: [...PROTECTED_AUTH_BOUNDARY_STATUSES],
      },
    },
    observations,
    problems,
    pass: problems.length === 0,
  };
}

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main() {
  const base = arg('--base') || process.env.CANDIDATE_URL || '';
  const out = arg('--out') || 'security-header-report.json';
  const evidence = await collectSecurityHeaderEvidence(base);
  writeFileSync(out, JSON.stringify(evidence, null, 2));
  process.stdout.write(`Candidate security-header evidence → ${out}\n`);
  if (!evidence.pass) {
    for (const problem of evidence.problems) process.stderr.write(`  ✗ ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write('Enforced security headers passed across all candidate response archetypes.\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`security-header probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
