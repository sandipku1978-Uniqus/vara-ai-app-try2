import { describe, expect, it } from 'vitest';
import {
  assessSecurityHeaders,
  PROTECTED_AUTH_BOUNDARY_STATUSES,
  SECURITY_HEADER_ARCHETYPES,
} from '../../scripts/accuracy/security-headers';

function secureHeaders(overrides: Record<string, string> = {}) {
  return new Headers({
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://img.clerk.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.clerk.accounts.dev https://clerk-telemetry.com https://us.i.posthog.com https://us-assets.i.posthog.com",
      "frame-src 'self' https://challenges.cloudflare.com https://*.clerk.accounts.dev",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://*.clerk.accounts.dev",
      "frame-ancestors 'self'",
      'report-uri /api/csp-report',
      'report-to csp-endpoint',
    ].join('; '),
    'content-type': 'application/json',
    'reporting-endpoints': 'csp-endpoint="/api/csp-report"',
    'x-frame-options': 'SAMEORIGIN',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
    ...overrides,
  });
}

describe('immutable candidate security-header assessment', () => {
  it('defines all five release response archetypes', () => {
    expect([...SECURITY_HEADER_ARCHETYPES]).toEqual([
      'public-html',
      'public-api',
      'not-found',
      'protected-route',
      'typed-bad-request',
    ]);
  });

  it('accepts an enforced production policy with the complete header set', () => {
    const result = assessSecurityHeaders(
      'typed-bad-request',
      '/api/es-search?size=0',
      { status: 400, headers: secureHeaders() },
      { acceptedStatuses: [400], contentType: 'application/json' },
    );

    expect(result.pass).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('accepts a documented unauthenticated boundary but rejects a fail-open dashboard', () => {
    const denied = assessSecurityHeaders(
      'protected-route',
      '/dashboard',
      { status: 404, headers: secureHeaders() },
      { acceptedStatuses: PROTECTED_AUTH_BOUNDARY_STATUSES },
    );
    const failOpen = assessSecurityHeaders(
      'protected-route',
      '/dashboard',
      { status: 200, headers: secureHeaders() },
      { acceptedStatuses: PROTECTED_AUTH_BOUNDARY_STATUSES },
    );

    expect(denied.pass).toBe(true);
    expect(failOpen.pass).toBe(false);
    expect(failOpen.problems).toContain('HTTP 200; expected 301/302/303/307/308/401/403/404');
  });

  it('fails closed on report-only/eval CSP, a wrong status or missing hardening headers', () => {
    const headers = secureHeaders({
      'content-security-policy': "default-src 'self'; script-src 'unsafe-eval'",
      'content-security-policy-report-only': "default-src 'self'",
      'x-content-type-options': '',
      'strict-transport-security': '',
    });
    const result = assessSecurityHeaders(
      'public-api',
      '/api/version',
      { status: 503, headers },
      { acceptedStatuses: [200], contentType: 'application/json' },
    );

    expect(result.pass).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      'HTTP 503; expected 200',
      'production response includes report-only CSP',
      "production CSP permits 'unsafe-eval'",
      'X-Content-Type-Options is not nosniff',
      'Strict-Transport-Security is missing',
    ]));
  });

  it('rejects CSP token smuggling, duplicate directives, permissive capabilities, and approximate HSTS', () => {
    const result = assessSecurityHeaders(
      'public-api',
      '/api/version',
      {
        status: 200,
        headers: secureHeaders({
          'content-security-policy': [
            "default-src 'self'",
            "script-src * 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: blob: https://img.clerk.com",
            "font-src 'self' data: https://fonts.gstatic.com",
            'connect-src *',
            'frame-src *',
            "worker-src 'self' blob:",
            "manifest-src 'self'",
            "object-src 'none' https://evil.example",
            "object-src 'none'",
            "base-uri 'self'",
            'form-action *',
            "frame-ancestors 'self'",
            'report-uri /api/csp-report',
            'report-to csp-endpoint',
          ].join('; '),
          'permissions-policy': 'camera=(self), microphone=(), geolocation=()',
          'strict-transport-security': 'max-age=315360000; includeSubDomains; preload',
        }),
      },
      { acceptedStatuses: [200], contentType: 'application/json' },
    );

    expect(result.pass).toBe(false);
    expect(result.problems).toEqual(expect.arrayContaining([
      'CSP contains duplicate directive object-src',
      expect.stringContaining('CSP script-src must be exactly'),
      expect.stringContaining('CSP connect-src must be exactly'),
      expect.stringContaining('CSP frame-src must be exactly'),
      expect.stringContaining('CSP form-action must be exactly'),
      "CSP object-src combines 'none' with another source",
      "CSP object-src must be exactly 'none'",
      'Permissions-Policy must disable exactly camera, microphone, and geolocation',
      'Strict-Transport-Security must be exactly max-age=31536000, includeSubDomains, and preload',
    ]));
  });
});
