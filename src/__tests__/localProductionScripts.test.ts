import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  scripts?: Record<string, string>;
}

const rootFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('local production build/start contract', () => {
  const packageManifest = JSON.parse(rootFile('package.json')) as PackageManifest;

  it('builds and starts from the same local Next.js distDir', () => {
    expect(packageManifest.scripts?.build).toBe('NEXT_LOCAL_BUILD=1 next build');
    expect(packageManifest.scripts?.start).toBe('NEXT_LOCAL_BUILD=1 next start');
  });

  it('keeps Vercel on its platform-default output directory', () => {
    expect(rootFile('next.config.mjs')).toContain(
      "process.env.NEXT_LOCAL_BUILD && !process.env.VERCEL ? '.next-build' : '.next'",
    );
  });

  it('exercises the public start script in production-mode Playwright', () => {
    expect(rootFile('playwright.config.ts')).toContain(
      'npm run build && npm run start -- --hostname 127.0.0.1 --port ${localPort}',
    );
  });
});
