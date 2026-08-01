/** @type {import('next').NextConfig} */
const nextConfig = {
  // Local `npm run build` writes to .next-build so it never clobbers the
  // dev server's .next (which killed the dev server on every build).
  // Vercel keeps the default .next.
  distDir: process.env.NEXT_LOCAL_BUILD && !process.env.VERCEL ? '.next-build' : '.next',
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    // CSP starts REPORT-ONLY (handoff WP6): the directive set below is the
    // exact-origin inventory of what the app actually loads — Clerk auth
    // (dev-instance domains today; add the production Clerk domain when that
    // instance is provisioned), optional PostHog analytics, and self. All SEC
    // and Supabase traffic flows through same-origin API routes, so no other
    // connect targets exist. 'unsafe-inline' is required by Next.js inline
    // hydration scripts and inline styles; 'unsafe-eval' is deliberately
    // absent. Watch violations in the browser console / Vercel logs across
    // preview and authenticated production use, then move to enforcing
    // Content-Security-Policy once the report stream is clean.
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://img.clerk.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.clerk.accounts.dev https://clerk-telemetry.com https://us.i.posthog.com https://us-assets.i.posthog.com",
      "frame-src https://challenges.cloudflare.com https://*.clerk.accounts.dev",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https://*.clerk.accounts.dev",
      "frame-ancestors 'self'",
    ].join('; ');
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy-Report-Only', value: csp },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
