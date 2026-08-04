import { expect, test, type APIResponse } from '@playwright/test';

const productionBuild = Boolean(process.env.QA_BASE_URL) || process.env.PW_PROD_BUILD === '1';

function expectProductionSecurityHeaders(response: APIResponse, archetype: string) {
  const headers = response.headers();
  const csp = headers['content-security-policy'];

  expect(csp, `${archetype} must carry an enforced CSP`).toBeTruthy();
  expect(
    headers['content-security-policy-report-only'],
    `${archetype} must not downgrade production CSP to report-only`,
  ).toBeUndefined();

  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    'report-uri /api/csp-report',
    'report-to csp-endpoint',
  ]) {
    expect(csp, `${archetype} CSP must retain ${directive}`).toContain(directive);
  }
  expect(csp, `${archetype} production CSP must not allow eval`).not.toContain("'unsafe-eval'");

  expect(headers['reporting-endpoints'], `${archetype} must retain CSP reporting`).toBe(
    'csp-endpoint="/api/csp-report"',
  );
  expect(headers['x-frame-options'], `${archetype} must retain clickjacking protection`).toBe('SAMEORIGIN');
  expect(headers['x-content-type-options'], `${archetype} must disable MIME sniffing`).toBe('nosniff');
  expect(headers['referrer-policy'], `${archetype} must constrain referrer data`).toBe(
    'strict-origin-when-cross-origin',
  );
  expect(headers['permissions-policy'], `${archetype} must disable unused browser capabilities`).toContain(
    'camera=()',
  );
  expect(headers['permissions-policy']).toContain('microphone=()');
  expect(headers['permissions-policy']).toContain('geolocation=()');
  expect(headers['strict-transport-security'], `${archetype} must retain HSTS`).toContain(
    'max-age=31536000',
  );
  expect(headers['strict-transport-security']).toContain('includeSubDomains');
}

test.describe('production security-header response archetypes', () => {
  test.skip(!productionBuild, 'Enforced CSP exists only on a production build; next dev is deliberately report-only.');

  test('successful public page keeps the enforced policy', async ({ request }) => {
    const response = await request.get('/support');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expectProductionSecurityHeaders(response, 'successful public page');
  });

  test('public version API keeps the enforced policy', async ({ request }) => {
    const response = await request.get('/api/version');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expectProductionSecurityHeaders(response, 'public version API');
  });

  test('not-found response keeps the enforced policy', async ({ request }) => {
    // _next/static is intentionally outside the auth proxy matcher, which
    // makes this a stable, genuine 404 even when a remote target has no Clerk
    // session. next.config headers still apply before filesystem routing.
    const response = await request.get('/_next/static/security-header-archetype-missing.js');
    expect(response.status()).toBe(404);
    expectProductionSecurityHeaders(response, 'not-found response');
  });

  test('protected route response keeps the enforced policy', async ({ request }) => {
    // The managed local production-build fixture supplies the repository's
    // localhost-only identity bypass. It exercises the protected route without
    // inventing a Clerk session; Clerk lifecycle remains in the auth suite.
    const response = await request.get('/dashboard', { maxRedirects: 0 });
    if (!process.env.QA_BASE_URL) {
      expect(response.status()).toBe(200);
    } else {
      // Remote production may render for an authenticated storage state or
      // return its normal anonymous auth boundary. Both must retain headers.
      expect([200, 302, 303, 307, 308, 401, 403]).toContain(response.status());
    }
    expectProductionSecurityHeaders(response, 'protected route response');
  });

  test('typed protected-API error keeps the enforced policy', async ({ request }) => {
    test.skip(Boolean(process.env.QA_BASE_URL), 'The invalid-query probe relies on the local deterministic auth fixture.');
    const response = await request.post('/api/boolean-validate', {
      data: { query: 'lease AND', candidates: [] },
    });

    expect(response.status()).toBe(400);
    expect(response.headers()['content-type']).toContain('application/json');
    expectProductionSecurityHeaders(response, 'typed protected-API error');
  });
});
