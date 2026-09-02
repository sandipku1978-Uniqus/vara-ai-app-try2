import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function workflow(name: string): string {
  return readFileSync(resolve(process.cwd(), '.github', 'workflows', name), 'utf8');
}

function job(source: string, name: string): string {
  const marker = `  ${name}:\n`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`workflow job ${name} was not found`);
  const remainder = source.slice(start + marker.length);
  const next = remainder.search(/^  [a-zA-Z0-9_-]+:\n/m);
  return source.slice(start, next < 0 ? source.length : start + marker.length + next);
}

describe('privileged workflow trust boundaries', () => {
  it('keeps PR authentication checks secretless and runs the real lifecycle only from protected main', () => {
    const prAuth = job(workflow('ci.yml'), 'auth-browser');
    expect(prAuth).toContain('src/__tests__/apiAuth.test.ts');
    expect(prAuth).not.toContain('${{ secrets.');
    expect(prAuth).not.toContain('playwright.auth.config.ts');

    const lifecycleSource = workflow('auth-lifecycle.yml');
    const lifecycle = job(lifecycleSource, 'auth-lifecycle');
    const install = lifecycle.indexOf('npm ci --ignore-scripts');
    const firstSecret = lifecycle.indexOf('${{ secrets.');

    expect(lifecycleSource).toContain('push:');
    expect(lifecycleSource).toContain('branches: [main]');
    expect(lifecycleSource).not.toContain('pull_request');
    expect(lifecycle).toContain('ref: ${{ github.sha }}');
    expect(install).toBeGreaterThan(0);
    expect(firstSecret).toBeGreaterThan(install);
    expect(lifecycle).not.toMatch(/^    env:/m);
    expect(lifecycle).toContain('[ -z "${CLERK_TEST_EMAIL}" ]');
    expect(lifecycle).toContain('CLERK_TEST_EMAIL: ${{ secrets.CLERK_TEST_EMAIL }}');
    expect(lifecycle).toContain('playwright.auth.config.ts');
    expect(lifecycleSource).not.toMatch(/\bnpx (?!--no-install)/);
  });

  it('does not retain credentialed browser traces in uploaded auth artifacts', () => {
    const authConfig = readFileSync(resolve(process.cwd(), 'playwright.auth.config.ts'), 'utf8');
    const lifecycle = job(workflow('auth-lifecycle.yml'), 'auth-lifecycle');

    expect(authConfig).toContain("trace: 'off'");
    expect(authConfig).not.toMatch(/trace:\s*['"](?:on|retain-on-failure|on-first-retry)['"]/);
    expect(lifecycle).toContain('path: ${{ runner.temp }}/urc-playwright-auth/report');
    expect(lifecycle).not.toMatch(/path:.*(?:results|trace|storage)/i);
  });

  it('never interpolates a raw page URL into a credentialed-suite failure message', () => {
    // The hosted Clerk URL carries the dev-instance browser token in its
    // query; these messages are printed into public Actions logs and
    // failure artifacts. Messages must go through describeLocation().
    const specs = readdirSync('tests/e2e-auth').filter(name => name.endsWith('.spec.ts'));
    expect(specs.length).toBeGreaterThan(0);
    for (const name of specs) {
      const source = readFileSync(`tests/e2e-auth/${name}`, 'utf8');
      expect(source, `${name} interpolates page.url() into a message`).not.toMatch(/\$\{\s*page\.url\(\)\s*\}/);
    }
  });

  it('runs production data jobs only from trusted revisions with inert installs', () => {
    const refreshSource = workflow('data-refresh.yml');
    const lettersSource = workflow('letters-backfill.yml');

    for (const source of [refreshSource, lettersSource]) {
      expect(source).toContain("github.event_name == 'schedule' || github.ref == 'refs/heads/main'");
      expect(source).toContain('ref: ${{ github.sha }}');
      expect(source).toContain('npm ci --ignore-scripts');
      expect(source).not.toMatch(/npm ci(?! --ignore-scripts)/);
      expect(source).not.toMatch(/\bnpx (?!--no-install)/);
    }

    const ownership = job(refreshSource, 'backfill-ownership-forms');
    const ownershipBeforeSteps = ownership.slice(0, ownership.indexOf('    steps:'));
    expect(ownershipBeforeSteps).not.toContain('URC_SUPABASE_SERVICE_KEY');

    const letters = job(lettersSource, 'fetch-text');
    const lettersBeforeSteps = letters.slice(0, letters.indexOf('    steps:'));
    expect(lettersBeforeSteps).not.toContain('URC_SUPABASE_SERVICE_KEY');
  });
});
