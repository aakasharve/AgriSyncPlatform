import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
// Local rule from sync-contract — bans raw mutation-name string literals
// outside the canonical catalog module. See sync-contract/eslint-rules/.
import noStringMutationType from '../../../sync-contract/eslint-rules/no-string-mutation-type.js';

// Sub-plan 01 (CI quick wins) intentionally introduces ESLint as
// informational-only: every existing violation is downgraded to warning so
// CI exits 0 today. Sub-plan 04 (frontend restructure) is responsible for
// driving the warning count to zero and re-promoting select rules to error.

// Build the warning map for react-hooks rules. The canonical rules
// (rules-of-hooks, exhaustive-deps) stay as warnings everywhere; the
// React Compiler experimental rules ship in eslint-plugin-react-hooks
// v5+ but are designed for green-field code, not retrofit, and produce
// hundreds of false positives against AgriSync's existing component tree.
// Sub-plan 04 Task 10: disable the experimental set; keep the canonical
// pair so legitimate hooks bugs still surface.
//
// Re-promotion plan: once the React Compiler is stable AND the team has
// done a dedicated wave-N pass to address its findings, flip these back
// to 'warn' and progressively to 'error'. Tracked in
// _COFOUNDER pending-task T-IGH-04-REACT-COMPILER-RULES.
const REACT_COMPILER_EXPERIMENTAL_RULES = new Set([
  'static-components',
  'immutability',
  'purity',
  'preserve-manual-memoization',
  'set-state-in-effect',
  'set-state-in-render',
  'memo-dependencies',
  'todo',
  'use-memo',
  'hooks',
  'invariant',
  'fbt',
  'globals',
  'preserve-using-static',
  'unsupported-syntax',
  'config',
  'capitalized-calls',
  'gating',
  'refs',
  'incompatible-library',
  'error-boundaries',
  'component-hook-factories',
]);
const reactHooksRules = Object.fromEntries(
  Object.keys(reactHooks.rules || {}).map((name) => [
    `react-hooks/${name}`,
    REACT_COMPILER_EXPERIMENTAL_RULES.has(name) ? 'off' : 'warn',
  ]),
);

export default defineConfig([
  globalIgnores(['dist', 'node_modules', '**/*.cjs', 'scripts']),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'local-rules': {
        rules: {
          'no-string-mutation-type': noStringMutationType,
        },
      },
    },
    rules: {
      // Sub-plan 02: mutation names are catalog-only outside the catalog module.
      'local-rules/no-string-mutation-type': 'error',

      // File-size budget — Sub-plan 04 ratchets this to 800.
      'max-lines': ['warn', { max: 1500, skipBlankLines: true, skipComments: true }],

      // Existing-debt rules (kept on but as warnings until Sub-plan 04).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        // Underscore-prefixed args/vars are an intentional convention:
        // "I know this is unused but the signature requires it" or
        // "destructured, then ignored". Sub-plan 04 Task 10 honors that
        // convention so no-unused-vars only fires on genuinely-unused
        // identifiers. Restores eslint baseline behavior with TS.
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      }],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'no-async-promise-executor': 'warn',
      'no-control-regex': 'off',
      'no-prototype-builtins': 'warn',
      'no-case-declarations': 'warn',
      'no-fallthrough': 'warn',
      'no-misleading-character-class': 'warn',
      'no-empty-pattern': 'warn',
      'prefer-const': 'warn',
      'no-var': 'warn',

      // All react-hooks rules → warn (programmatic; resilient to rule additions).
      ...reactHooksRules,
    },
  },
]);
