export const CSP_REPORT_ENDPOINT = '/api/csp-report';
export const CSP_REPORTING_GROUP = 'csp-endpoint';

/**
 * Build one auditable policy for Next.js headers and security tests.
 *
 * Production builds enforce the policy. Local `next dev` remains report-only
 * and receives only the two allowances required by the development runtime:
 * eval for source maps and websocket connections for hot reload.
 */
export function buildContentSecurityPolicy({ development = false } = {}) {
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    'https://*.clerk.accounts.dev',
    'https://challenges.cloudflare.com',
  ];
  const connectSources = [
    "'self'",
    'https://*.clerk.accounts.dev',
    'https://clerk-telemetry.com',
    'https://us.i.posthog.com',
    'https://us-assets.i.posthog.com',
  ];

  if (development) {
    scriptSources.push("'unsafe-eval'");
    connectSources.push('ws:', 'wss:');
  }

  const directives = [
    ['default-src', "'self'"],
    ['script-src', ...scriptSources],
    ['style-src', "'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    ['img-src', "'self'", 'data:', 'blob:', 'https://img.clerk.com'],
    ['font-src', "'self'", 'data:', 'https://fonts.gstatic.com'],
    ['connect-src', ...connectSources],
    // Filing detail and search preview sanitized documents from /api/sec-proxy.
    ['frame-src', "'self'", 'https://challenges.cloudflare.com', 'https://*.clerk.accounts.dev'],
    ['worker-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'", 'https://*.clerk.accounts.dev'],
    ['frame-ancestors', "'self'"],
    ['report-uri', CSP_REPORT_ENDPOINT],
    ['report-to', CSP_REPORTING_GROUP],
  ];

  return directives.map(parts => parts.join(' ')).join('; ');
}

export function contentSecurityPolicyHeader({ development = false } = {}) {
  return development
    ? 'Content-Security-Policy-Report-Only'
    : 'Content-Security-Policy';
}

export function reportingEndpointsHeader() {
  return `${CSP_REPORTING_GROUP}="${CSP_REPORT_ENDPOINT}"`;
}
