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

let warnedRelaxedConfig = false;

/**
 * Production requires Clerk keys, but — by explicit decision (Option A,
 * 2026-07-20) — runs like the other Uniqus apps: a development-instance key
 * pair and no entitlement feature are accepted, with a logged warning.
 * The strict posture (live keys + CLERK_RESEARCH_FEATURE) reactivates by
 * simply providing those values; nothing else changes. Auth still fails
 * closed when NO keys are configured at all.
 */
export function getClerkProductionConfigError(): string | null {
  if (!isProductionDeployment()) return null;

  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || '';
  const secretKey = process.env.CLERK_SECRET_KEY?.trim() || '';
  const configuredFeature = process.env.CLERK_RESEARCH_FEATURE?.trim() || '';

  if (!publishableKey) {
    return 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is required in production.';
  }
  if (!secretKey) {
    return 'CLERK_SECRET_KEY is required in production.';
  }

  if (!warnedRelaxedConfig) {
    const relaxations: string[] = [];
    if (!publishableKey.startsWith(LIVE_PUBLISHABLE_KEY_PREFIX) || !secretKey.startsWith(LIVE_SECRET_KEY_PREFIX)) {
      relaxations.push('development-instance Clerk keys (user cap + dev banner apply)');
    }
    if (!FEATURE_PATTERN.test(configuredFeature)) {
      relaxations.push('no CLERK_RESEARCH_FEATURE — signed-in users are not entitlement-gated');
    }
    if (relaxations.length > 0) {
      console.warn(`[clerk-config] Running production auth in relaxed mode: ${relaxations.join('; ')}. Provide live keys and CLERK_RESEARCH_FEATURE to activate the strict posture.`);
      warnedRelaxedConfig = true;
    }
  }
  return null;
}
