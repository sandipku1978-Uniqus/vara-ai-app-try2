import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ci = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
const auth = readFileSync(resolve(process.cwd(), '.github/workflows/auth-lifecycle.yml'), 'utf8');
const mainConfig = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');
const authConfig = readFileSync(resolve(process.cwd(), 'playwright.auth.config.ts'), 'utf8');

describe('UI action execution evidence workflows', () => {
  it('emits and validates complementary development and production browser reports', () => {
    expect(mainConfig).toContain("'./scripts/ui-actions/playwright-reporter.ts'");
    expect(mainConfig).toContain("suite: 'browser'");
    expect(ci).toContain('QA_ACTION_RUN_LABEL: browser-development');
    expect(ci).toContain('QA_ACTION_RUN_LABEL: browser-production');
    expect(ci).toContain('scripts/ui-actions/validate.ts');
    expect(ci).toContain('--scope browser');
    expect(ci).toContain('--expect-sha "$GITHUB_SHA"');
    expect(ci).toContain('ui-action-evidence-browser-${{ github.sha }}');
    expect(ci).toContain('if-no-files-found: error');
  });

  it('keeps credentialed auth execution separate while retaining only metadata evidence', () => {
    expect(authConfig).toContain("'./scripts/ui-actions/playwright-reporter.ts'");
    expect(authConfig).toContain("suite: 'auth'");
    expect(auth).toContain('QA_ACTION_RUN_LABEL: auth-production');
    expect(auth).toContain('--scope auth');
    expect(auth).toContain('--expect-sha "$GITHUB_SHA"');
    expect(auth).toContain('ui-action-evidence-auth-${{ github.sha }}');
    expect(auth).toContain('${{ runner.temp }}/urc-playwright-auth/ui-action-run.json');
    expect(auth).not.toContain('${{ runner.temp }}/urc-playwright-auth/results');
  });
});
