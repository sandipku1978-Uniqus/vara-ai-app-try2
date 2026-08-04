import { afterEach, describe, expect, it, vi } from 'vitest';

import nextConfig from '../../next.config.mjs';
import {
  buildContentSecurityPolicy,
  contentSecurityPolicyHeader,
  reportingEndpointsHeader,
} from '../../config/content-security-policy.mjs';
import { POST } from '../app/api/csp-report/route';
import { sanitizeCspReports } from '../lib/csp-report';
import { assessContentSecurityPolicy } from '../../scripts/accuracy/security-headers';

vi.mock('../lib/rate-limit', () => ({
  checkResourceRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
  rateLimitResponse: vi.fn(() => new Response(null, { status: 429 })),
}));

describe('content security policy', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enforces the production policy and declares its same-origin report endpoint', async () => {
    const groups = await nextConfig.headers?.();
    const headers = new Map(groups?.[0]?.headers.map(header => [header.key, header.value]));
    const csp = headers.get('Content-Security-Policy');
    const connectSources = csp?.split('; ')
      .find(directive => directive.startsWith('connect-src '))
      ?.split(' ')
      .slice(1);

    expect(csp).toBeDefined();
    expect(headers.has('Content-Security-Policy-Report-Only')).toBe(false);
    expect(headers.get('Reporting-Endpoints')).toBe('csp-endpoint="/api/csp-report"');
    expect(headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains; preload');
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
    expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com");
    expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com https://*.clerk.accounts.dev");
    expect(connectSources).not.toContain('https://api.adviserinfo.sec.gov');
    expect(connectSources).not.toContain('https://adviserinfo.sec.gov');
    expect(connectSources).not.toContain('https://*.adviserinfo.sec.gov');
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain('report-to csp-endpoint');
    expect(csp).not.toContain("'unsafe-eval'");
    expect(assessContentSecurityPolicy(csp || null)).toEqual([]);
  });

  it('limits development relaxations to a report-only policy', () => {
    const csp = buildContentSecurityPolicy({ development: true });

    expect(contentSecurityPolicyHeader({ development: true })).toBe('Content-Security-Policy-Report-Only');
    expect(contentSecurityPolicyHeader()).toBe('Content-Security-Policy');
    expect(reportingEndpointsHeader()).toBe('csp-endpoint="/api/csp-report"');
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain('ws: wss:');
  });

  it('redacts queries, credentials, and dynamic filing identifiers from reports', () => {
    const [report] = sanitizeCspReports({
      'csp-report': {
        'document-uri': 'https://user:secret@example.test/company/AAPL?query=private#result',
        'blocked-uri': 'https://evil.test/tracker.js?token=secret',
        'source-file': 'https://example.test/_next/static/chunk.js?build=secret',
        'effective-directive': 'script-src-elem',
        'line-number': 19,
      },
    });

    expect(report).toEqual(expect.objectContaining({
      document: 'https://example.test/company/[redacted]',
      blocked: 'https://evil.test/tracker.js',
      source: 'https://example.test/_next/static/chunk.js',
      directive: 'script-src-elem',
      line: 19,
    }));
    expect(JSON.stringify(report)).not.toMatch(/secret|private|AAPL/);
  });

  it('accepts Reporting API arrays and discards samples and original policies', () => {
    const [report] = sanitizeCspReports([{
      type: 'csp-violation',
      url: 'https://example.test/search?q=confidential',
      body: {
        blockedURL: 'inline',
        effectiveDirective: 'script-src-elem',
        disposition: 'enforce',
        sample: 'confidential script body',
        originalPolicy: 'secret policy',
        statusCode: 200,
      },
    }]);

    expect(report).toEqual(expect.objectContaining({
      document: 'https://example.test/search',
      blocked: 'inline',
      disposition: 'enforce',
      statusCode: 200,
    }));
    expect(report).not.toHaveProperty('sample');
    expect(report).not.toHaveProperty('originalPolicy');
  });

  it('accepts a bounded report and writes only its sanitized representation', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await POST(new Request('https://example.test/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', 'x-real-ip': '203.0.113.1' },
      body: JSON.stringify({
        'csp-report': {
          'document-uri': 'https://example.test/search?q=confidential',
          'blocked-uri': 'https://evil.test/a.js?token=secret',
          'violated-directive': 'script-src',
        },
      }),
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).not.toMatch(/confidential|secret/);
  });

  it('rejects unsupported and oversized reports without logging them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unsupported = await POST(new Request('https://example.test/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    }));
    const oversized = await POST(new Request('https://example.test/api/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '20000' },
      body: '{}',
    }));

    expect(unsupported.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });
});
