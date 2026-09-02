import { readFileSync, readdirSync } from 'node:fs';
import { generateKeyPairSync, sign as signPayload } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const requestHeadersMock = vi.hoisted(() => vi.fn());

vi.mock('@clerk/nextjs/server', () => ({
  auth: authMock,
  clerkMiddleware: (handler: unknown) => handler,
}));
vi.mock('next/headers', () => ({ headers: requestHeadersMock }));

import { requireApiAccess } from '../lib/api-auth';
import { getClerkProductionConfigError, isLocalE2eBypass } from '../lib/clerk-config';
import { hasStagedProductionReleaseGateAccess, RELEASE_GATE_HEADER } from '../lib/release-gate-auth';
import proxy, { config, isPublicPath } from '../proxy';
import { NextRequest } from 'next/server';
import sitemap from '../app/sitemap';
import robots from '../app/robots';
import { PUBLIC_API_PATHS, PUBLIC_PAGE_PATHS } from '../config/routes';

function findRouteFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findRouteFiles(path);
    return /^route\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('protected API authorization matrix', () => {
  beforeEach(() => {
    authMock.mockReset();
    requestHeadersMock.mockReset();
    requestHeadersMock.mockResolvedValue(new Headers());
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('CLERK_RESEARCH_FEATURE', 'org:research');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 for a missing Clerk session', async () => {
    authMock.mockResolvedValue({ userId: null, orgId: null, has: vi.fn() });
    const result = await requireApiAccess();
    expect(result.response?.status).toBe(401);
    expect(result.response?.headers.get('cache-control')).toBe('no-store');
  });

  it('returns 403 when the session lacks the configured feature', async () => {
    authMock.mockResolvedValue({ userId: 'user_1', orgId: 'org_1', has: vi.fn(() => false) });
    const result = await requireApiAccess();
    expect(result.response?.status).toBe(403);
  });

  it('returns an identity-scoped cache key for an entitled organization member', async () => {
    const has = vi.fn(() => true);
    authMock.mockResolvedValue({ userId: 'user_1', orgId: 'org_1', has });
    const result = await requireApiAccess();
    expect(result.identity).toEqual({
      userId: 'user_1',
      orgId: 'org_1',
      cacheScope: 'user_1:org_1',
    });
    expect(has).toHaveBeenCalledWith({ feature: 'org:research' });
  });

  it('can require authentication without requiring an entitlement', async () => {
    const has = vi.fn(() => false);
    authMock.mockResolvedValue({ userId: 'user_1', orgId: null, has });
    const result = await requireApiAccess(false);
    expect(result.identity?.cacheScope).toBe('user_1:personal');
    expect(has).not.toHaveBeenCalled();
  });

  it('fails closed when Clerk verification throws', async () => {
    authMock.mockRejectedValue(new Error('Clerk unavailable'));
    const result = await requireApiAccess();
    expect(result.response?.status).toBe(503);
  });

  describe('the staged-production release-gate credential', () => {
    const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const publicKey = keyPair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const deploymentId = 'dpl_test_release';
    const sha = 'a'.repeat(40);
    const host = 'candidate-example.vercel.app';

    function token(
      expires = Math.floor(Date.now() / 1000) + 300,
      pathname = '/api/es-search',
      method = 'GET',
    ): string {
      const normalizedMethod = method.toUpperCase();
      const payload = `v3\n${expires}\n${deploymentId}\n${sha}\n${host}\n${normalizedMethod}\n${pathname}`;
      const signature = signPayload('sha256', Buffer.from(payload), {
        key: keyPair.privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url');
      return `v3.${expires}.${deploymentId}.${sha}.${Buffer.from(host).toString('base64url')}.${normalizedMethod}.${Buffer.from(pathname).toString('base64url')}.${signature}`;
    }

    function configureStagedProduction() {
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('VERCEL_ENV', 'production');
      vi.stubEnv('VERCEL_TARGET_ENV', 'production');
      vi.stubEnv('VERCEL_URL', host);
      vi.stubEnv('VERCEL_DEPLOYMENT_ID', deploymentId);
      vi.stubEnv('VERCEL_GIT_COMMIT_SHA', sha);
      vi.stubEnv('URC_RELEASE_GATE_PUBLIC_KEY', publicKey);
      vi.stubEnv('URC_RELEASE_GATE_NOT_AFTER', new Date(Date.now() + 4 * 60 * 60 * 1_000).toISOString());
      // Exercise the normal Clerk fallback independently of the repository's
      // intentionally deferred live Clerk rollout.
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_example');
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_example');
    }

    it('authorizes the long-running gate only on the canonical staged-production host', async () => {
      configureStagedProduction();
      requestHeadersMock.mockResolvedValue(new Headers({ host, [RELEASE_GATE_HEADER]: token() }));

      const result = await requireApiAccess(true, '/api/es-search', 'GET');
      expect(result.identity).toEqual({
        userId: `release-gate:${deploymentId}`,
        orgId: null,
        cacheScope: `release-gate:${deploymentId}`,
        releaseGate: true,
        releaseGateHost: host,
      });
      expect(authMock).not.toHaveBeenCalled();
    });

    it('rejects wrong, expired, invalid-key, wrong-host, and preview credentials', async () => {
      configureStagedProduction();
      expect(await hasStagedProductionReleaseGateAccess(new Headers({ host, [RELEASE_GATE_HEADER]: `${token()}x` }), '/api/es-search', 'GET')).toBe(false);
      expect(await hasStagedProductionReleaseGateAccess(new Headers({ host, [RELEASE_GATE_HEADER]: token(Math.floor(Date.now() / 1000) - 1) }), '/api/es-search', 'GET')).toBe(false);
      expect(await hasStagedProductionReleaseGateAccess(new Headers({ host: 'production.example.com', [RELEASE_GATE_HEADER]: token() }), '/api/es-search', 'GET')).toBe(false);

      vi.stubEnv('VERCEL_TARGET_ENV', 'preview');
      vi.stubEnv('VERCEL_ENV', 'preview');
      expect(await hasStagedProductionReleaseGateAccess(new Headers({ host, [RELEASE_GATE_HEADER]: token() }), '/api/es-search', 'GET')).toBe(false);
      vi.stubEnv('VERCEL_TARGET_ENV', 'production');
      vi.stubEnv('VERCEL_ENV', 'production');

      vi.stubEnv('URC_RELEASE_GATE_PUBLIC_KEY', 'not-a-public-key');
      expect(await hasStagedProductionReleaseGateAccess(new Headers({ host, [RELEASE_GATE_HEADER]: token() }), '/api/es-search', 'GET')).toBe(false);
    });

    it('cannot authorize a different route or method', async () => {
      configureStagedProduction();
      const requestHeaders = new Headers({ host, [RELEASE_GATE_HEADER]: token() });
      requestHeadersMock.mockResolvedValue(requestHeaders);
      authMock.mockResolvedValue({ userId: null, orgId: null, has: vi.fn() });

      expect(await hasStagedProductionReleaseGateAccess(requestHeaders, '/api/claude', 'GET')).toBe(false);
      expect(await hasStagedProductionReleaseGateAccess(requestHeaders, '/api/es-search', 'POST')).toBe(false);
      const result = await requireApiAccess(true, '/api/claude', 'GET');
      expect(result.response?.status).toBe(401);
    });

    it('rejects a presented invalid release token before deferred Clerk configuration', async () => {
      configureStagedProduction();
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
      vi.stubEnv('CLERK_SECRET_KEY', '');
      const headers = new Headers({ host, [RELEASE_GATE_HEADER]: token() });
      requestHeadersMock.mockResolvedValue(headers);

      const routeResult = await requireApiAccess(true, '/api/filing-text', 'GET');
      expect(routeResult.response?.status).toBe(401);
      await expect(routeResult.response?.json()).resolves.toEqual({
        error: 'Invalid release candidate credential.',
      });
      expect(authMock).not.toHaveBeenCalled();

      const proxyResult = await proxy(
        new NextRequest(`https://${host}/api/filing-text`, { headers }),
        {} as never,
      );
      expect(proxyResult).toBeDefined();
      if (!proxyResult) throw new Error('proxy did not return the explicit denial response');
      expect(proxyResult.status).toBe(401);
      await expect(proxyResult.json()).resolves.toEqual({
        error: 'Invalid release candidate credential.',
      });
      expect(authMock).not.toHaveBeenCalled();
    });

    it('is inert through the public production alias even when the token matches', async () => {
      configureStagedProduction();
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_example');
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_example');
      requestHeadersMock.mockResolvedValue(new Headers({ host: 'production.example.com', [RELEASE_GATE_HEADER]: token() }));
      authMock.mockResolvedValue({ userId: null, orgId: null, has: vi.fn() });

      expect(await hasStagedProductionReleaseGateAccess(new Headers({ host: 'production.example.com', [RELEASE_GATE_HEADER]: token() }), '/api/es-search', 'GET')).toBe(false);
      const result = await requireApiAccess(true, '/api/es-search', 'GET');
      expect(result.response?.status).toBe(401);
    });
  });

  it('rejects keyless production but accepts test keys and no feature (Option A)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');

    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
    vi.stubEnv('CLERK_SECRET_KEY', '');
    expect(getClerkProductionConfigError()).toMatch(/required in production/);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_example');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_example');
    vi.stubEnv('CLERK_RESEARCH_FEATURE', '');
    expect(getClerkProductionConfigError()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('relaxed mode'));
  });

  it('accepts a complete live production configuration', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_example');
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_example');
    vi.stubEnv('CLERK_RESEARCH_FEATURE', 'org:research');
    expect(getClerkProductionConfigError()).toBeNull();
  });

  it('requires the shared authorization helper in every non-public API handler', () => {
    const apiRoot = resolve(process.cwd(), 'src', 'app', 'api');
    const routeFiles = findRouteFiles(apiRoot);
    const routeExceptions = new Set([
      'cron/precompute/route.ts',
      'csp-report/route.ts',
      'health/route.ts',
      'version/route.ts',
    ]);
    const routeNames = new Set(routeFiles.map(file => relative(apiRoot, file).replace(/\\/g, '/')));

    expect(routeFiles.length).toBeGreaterThan(0);
    for (const exception of routeExceptions) {
      expect(routeNames.has(exception), `API exception ${exception} must name an existing route`).toBe(true);
    }
    for (const file of routeFiles) {
      const routeName = relative(apiRoot, file).replace(/\\/g, '/');
      const source = readFileSync(file, 'utf8');
      if (routeExceptions.has(routeName)) continue;
      expect(source, `${routeName} must import requireApiAccess`).toMatch(/import\s+\{[^}]*requireApiAccess[^}]*\}\s+from/);
      expect(source, `${routeName} must invoke requireApiAccess`).toMatch(/await\s+requireApiAccess\s*\(/);
    }
    expect([...routeExceptions]).toEqual([
      'cron/precompute/route.ts',
      'csp-report/route.ts',
      'health/route.ts',
      'version/route.ts',
    ]);
  });

  it('keeps only the intended marketing, legal, support, and metadata paths public', () => {
    for (const path of [
      '/', '/support', '/privacy', '/terms', '/favicon.ico', '/robots.txt', '/sitemap.xml',
      '/manifest.webmanifest', ...PUBLIC_API_PATHS,
    ]) {
      expect(isPublicPath(path), `${path} should be public`).toBe(true);
    }

    for (const path of [
      '/dashboard', '/search', '/filing/1_a.htm', '/company/AAPL', '/accounting',
      '/api/claude', '/api/sec-proxy', '/api/letters', '/api/cron/precompute',
      '/api/og', '/api/og/private', '/_next/static/app.js', '/_next/image',
      '/_next/static-impersonator', '/_next/image-private',
      '/_next/data/build-id/page.json', '/dashboard/app.js', '/company/AAPL.css',
      '/support/getting-started', '/privacy/choices', '/terms/use',
      '/support/%252e%252e/api/claude',
    ]) {
      expect(isPublicPath(path), `${path} should be protected`).toBe(false);
    }

    expect(config.matcher).toEqual(['/((?!_next/static(?:/|$)|_next/image(?:/|$)).*)']);
    expect(PUBLIC_API_PATHS).toEqual(['/api/csp-report', '/api/health', '/api/version']);
  });

  /**
   * isLocalE2eBypass gates FOUR security decisions — proxy.ts route
   * protection, requireApiAccess, and two rate-limit paths — and each one
   * opens fully when it returns true. The only thing keeping that switch out
   * of a deployment is the VERCEL check, and nothing exercised it until now.
   */
  describe('the e2e authentication bypass', () => {
    it('cannot activate on a Vercel deployment even if the flag is set', () => {
      vi.stubEnv('VERCEL', '1');
      vi.stubEnv('URC_E2E_BYPASS_AUTH', '1');
      expect(isLocalE2eBypass()).toBe(false);
    });

    it('stays off locally unless the flag is exactly "1"', () => {
      vi.stubEnv('VERCEL', '');
      for (const value of ['', '0', 'true', 'yes', 'TRUE']) {
        vi.stubEnv('URC_E2E_BYPASS_AUTH', value);
        expect(isLocalE2eBypass(), `"${value}" must not enable the bypass`).toBe(false);
      }
    });

    it('activates only for a local run that explicitly opts in', () => {
      vi.stubEnv('VERCEL', '');
      vi.stubEnv('URC_E2E_BYPASS_AUTH', '1');
      expect(isLocalE2eBypass()).toBe(true);
    });
  });

  it('advertises only public pages to crawlers', () => {
    const sitemapPaths = sitemap().map(entry => new URL(entry.url).pathname);
    expect(sitemapPaths).toEqual([...PUBLIC_PAGE_PATHS]);
    expect(sitemapPaths).not.toContain('/dashboard');

    const rules = robots().rules;
    const crawlerRule = Array.isArray(rules) ? rules[0] : rules;
    expect(crawlerRule.allow).toEqual([...PUBLIC_PAGE_PATHS]);
    expect(crawlerRule.disallow).toEqual(expect.arrayContaining(['/api/', '/company/', '/filing/', '/dashboard']));
  });
});
