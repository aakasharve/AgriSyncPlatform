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

// Build a "all rules → warn" map for every react-hooks rule the plugin ships.
// Programmatic so future rule additions in the plugin don't require config edits.
const reactHooksRules = Object.fromEntries(
  Object.keys(reactHooks.rules || {}).map((name) => [`react-hooks/${name}`, 'warn']),
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
      '@typescript-eslint/no-unused-vars': 'warn',
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
