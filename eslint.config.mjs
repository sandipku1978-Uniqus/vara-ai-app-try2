import { defineConfig, globalIgnores } from 'eslint/config';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    // Keep correctness rules (including rules-of-hooks) enabled. These rules
    // are intentionally relaxed while the legacy codebase is incrementally
    // typed and migrated to React 19 patterns.
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react/no-unescaped-entities': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    '.next-build/**',
    'coverage/**',
    'node_modules/**',
    'next-env.d.ts',
    // Claude Code worktrees are full checkouts (build output included) living
    // under .claude/. The patterns above are root-relative, so they do not
    // match the same directories one level down, and `npm run lint` fails with
    // ENOENT on a worktree's build manifest whenever one exists. CI never sees
    // this — it lints a fresh checkout — so it only ever breaks local runs.
    '.claude/**',
  ]),
]);
