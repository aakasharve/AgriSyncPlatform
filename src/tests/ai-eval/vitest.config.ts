/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Self-contained config for the @agrisync/ai-eval-runner package.
// Scoped to the runner unit tests only — never reaches the sibling
// mobile-web package (D-W1P1-4).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['runner/__tests__/**/*.test.ts'],
    exclude: ['node_modules/**'],
  },
});
