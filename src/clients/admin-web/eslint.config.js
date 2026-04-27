import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Sub-plan 01 (CI quick wins, post-cross-verify) demotes the 12 existing
// admin-web `@typescript-eslint/no-unused-expressions` errors to warnings
// so admin-web lint participates in CI without `|| true`. Sub-plan 04
// drives both mobile-web and admin-web warning counts to zero.

// Programmatically downgrade every react-hooks rule the plugin ships,
// matching mobile-web's approach (resilient to plugin updates).
const reactHooksRules = Object.fromEntries(
  Object.keys(reactHooks.rules || {}).map((name) => [`react-hooks/${name}`, 'warn']),
)

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'warn',
      'react-refresh/only-export-components': 'warn',
      ...reactHooksRules,
    },
  },
])
