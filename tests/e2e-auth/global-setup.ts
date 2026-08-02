import { clerkSetup } from '@clerk/testing/playwright';

/**
 * Fetches a Clerk testing token so the suite is not blocked by bot detection.
 *
 * clerkSetup() reads NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (or
 * CLERK_PUBLISHABLE_KEY) and CLERK_SECRET_KEY, and throws if the secret key
 * belongs to a PRODUCTION instance — a deliberate guard on Clerk's side, and
 * the reason this harness must be pointed at a development instance.
 */
export default async function globalSetup() {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error(
      'CLERK_SECRET_KEY is not set. The authentication suite needs a Clerk ' +
        'DEVELOPMENT instance key pair (pk_test_… / sk_test_…). See ' +
        'docs/pending-keys-checklist.md. Run the main suite with ' +
        '`npx playwright test` if you only need the non-auth journeys.'
    );
  }
  await clerkSetup();
}
