import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every route handler declares its platform budget and goes through the
 * observability wrapper. Audit 2026-09: ten routes exported no
 * `maxDuration`, so a stalled dependency ran until the platform default
 * killed the function with nothing logged and nothing released. A route
 * that forgets either of these now fails this test, not production.
 */

const API_ROOT = join(process.cwd(), 'src', 'app', 'api');
/** Vercel's ceiling without Fluid compute; every in-route deadline fits under it. */
const MAX_PLATFORM_BUDGET_SECONDS = 300;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [path] : [];
  });
}

describe('route budgets and observability', () => {
  const files = routeFiles(API_ROOT);

  it('finds the route inventory', () => {
    expect(files.length).toBeGreaterThanOrEqual(19);
  });

  it.each(files.map(file => [relative(API_ROOT, file), file] as const))(
    '%s declares a bounded maxDuration and exports its handlers through withRouteObservability',
    (_name, file) => {
      const source = readFileSync(file, 'utf8');

      const budget = source.match(/^export const maxDuration = (\d+);/m);
      expect(budget, 'missing `export const maxDuration`').not.toBeNull();
      const seconds = Number(budget?.[1]);
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(MAX_PLATFORM_BUDGET_SECONDS);

      expect(source, 'handlers must not be exported as bare functions').not.toMatch(
        /^export (?:async )?function (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/m,
      );
      const wrapped = source.match(/^export const (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) = withRouteObservability\(/gm) || [];
      expect(wrapped.length, 'at least one handler exported through withRouteObservability').toBeGreaterThan(0);
    },
  );
});
