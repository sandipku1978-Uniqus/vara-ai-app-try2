import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * Authentication e2e — a SEPARATE harness from playwright.config.ts.
 *
 * The main suite runs behind URC_E2E_BYPASS_AUTH, which makes proxy.ts return
 * next() for every request. That is deliberate (it removes the Clerk identity
 * flakes documented in tests/e2e/critical-actions.spec.ts) but it also means
 * the main suite CANNOT observe authentication at all: nothing is protected,
 * and with no publishable key in CI the Sign In / Get Started controls never
 * render either.
 *
 * This config runs its own server with the bypass explicitly OFF and real
 * Clerk keys, so the identity surface is the real one. It is a separate
 * config rather than a second project because the two need different server
 * environments, and because an auth outage must not be able to take the main
 * release-evidence suite down with it.
 *
 * REQUIRES (see docs/pending-keys-checklist.md):
 *   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY  pk_test_… from a Clerk DEVELOPMENT instance
 *   CLERK_SECRET_KEY                   sk_test_… from the same instance
 * @clerk/testing refuses production keys outright, by design.
 *
 * Verified empirically: with the bypass off and NO secret key, every route —
 * including public ones — returns 500, because clerkMiddleware initialises
 * before proxy.ts's public-path check runs.
 */

const localPort = Number(process.env.QA_AUTH_PORT || 4318);
const baseURL = `http://127.0.0.1:${localPort}`;
const artifactRoot = process.env.QA_OUTPUT_DIR || join(tmpdir(), 'urc-playwright-auth');

// Checked at CONFIG LOAD, before Playwright starts the web server. Without a
// secret key the server 500s on every route, and Clerk's own "Missing
// secretKey" error floods the output long before globalSetup could report
// anything useful — so the actionable message has to come first.
if (!process.env.CLERK_SECRET_KEY || !(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || process.env.CLERK_PUBLISHABLE_KEY)) {
  throw new Error(
    'The authentication suite needs a Clerk DEVELOPMENT instance key pair.\n' +
      '  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_…\n' +
      '  CLERK_SECRET_KEY=sk_test_…\n' +
      'Optionally CLERK_TEST_EMAIL=<user>+clerk_test@example.com to include the\n' +
      'sign-in/sign-out round trip. Setup steps: docs/pending-keys-checklist.md.\n' +
      'The main suite is unaffected — run `npx playwright test` for that.'
  );
}

export default defineConfig({
  testDir: './tests/e2e-auth',
  outputDir: join(artifactRoot, 'results'),
  globalSetup: './tests/e2e-auth/global-setup.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: join(artifactRoot, 'report'), open: 'never' }]]
    : [['list'], ['html', { outputFolder: join(artifactRoot, 'report'), open: 'never' }]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev --hostname 127.0.0.1 --port ${localPort}`,
    url: `${baseURL}/privacy`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // Explicitly '0', not merely absent: .env.local sets this to '1', and
      // Next reads .env.local into process.env. Unsetting the shell variable
      // is not enough to turn the bypass off.
      URC_E2E_BYPASS_AUTH: '0',
      NEXT_PUBLIC_URC_E2E_BYPASS_AUTH: '0',
      NEXT_PUBLIC_SITE_URL: baseURL,
    },
  },
});
