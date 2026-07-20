const LIVE_PUBLISHABLE_KEY_PREFIX = 'pk_live_';
const LIVE_SECRET_KEY_PREFIX = 'sk_live_';
const FEATURE_PATTERN = /^(?:user|org):[A-Za-z0-9_-]+$/;

export type ClerkFeature = `user:${string}` | `org:${string}`;

export function isProductionDeployment(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
}

export function getResearchFeature(): ClerkFeature | null {
  const value = process.env.CLERK_RESEARCH_FEATURE?.trim();
  return value && FEATURE_PATTERN.test(value) ? (value as ClerkFeature) : null;
}

/**
 * Production must never silently fall back to Clerk keyless/development mode or
 * to an unconfigured entitlement. Local development and tests may use Clerk's
 * keyless flow, but a production request fails closed until all three values are
 * configured with live credentials.
 */
export function getClerkProductionConfigError(): string | null {
  if (!isProductionDeployment()) return null;

  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || '';
  const secretKey = process.env.CLERK_SECRET_KEY?.trim() || '';
  const configuredFeature = process.env.CLERK_RESEARCH_FEATURE?.trim() || '';

  if (!publishableKey.startsWith(LIVE_PUBLISHABLE_KEY_PREFIX)) {
    return 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a live Clerk key in production.';
  }
  if (!secretKey.startsWith(LIVE_SECRET_KEY_PREFIX)) {
    return 'CLERK_SECRET_KEY must be a live Clerk key in production.';
  }
  if (!FEATURE_PATTERN.test(configuredFeature)) {
    return 'CLERK_RESEARCH_FEATURE must name a Clerk user or organization feature in production.';
  }
  return null;
}
