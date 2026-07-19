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
    return [
      {
        source: '/(.*)',
        headers: [
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
