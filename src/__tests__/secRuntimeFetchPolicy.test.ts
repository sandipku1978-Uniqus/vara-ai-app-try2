import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RUNTIME_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const DIRECT_SEC_FETCH = /fetch\s*\(\s*['"`]https:\/\/[^\s'"`]*sec\.gov/gu;

function runtimeSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__') return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return runtimeSourceFiles(path);
    return RUNTIME_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

describe('SEC runtime fetch policy', () => {
  it('forbids literal SEC network fetches outside the central paced upstream helper', () => {
    const sourceRoot = join(process.cwd(), 'src');
    const violations = runtimeSourceFiles(sourceRoot).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(DIRECT_SEC_FETCH)].map(match => (
        `${relative(process.cwd(), file)}: ${match[0]}`
      ));
    });

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
