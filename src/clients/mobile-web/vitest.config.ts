/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// Minimal Vitest config for mobile-web. Sub-plan 02 (Sync Contract
// Hardening) requires `npx vitest run` to pass the SyncMutationCatalog
// contract tests. Sub-plan 04 (Frontend Restructure) and Sub-plan 05
// (Testing & Ops Maturity) will extend this with jsdom environment,
// setup files, snapshot config, and coverage gates.
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      // DWC v2 §2.5/§2.6 — telemetry specs live under tests/unit per plan boundary.
      'tests/unit/**/*.spec.ts',
      'tests/unit/**/*.spec.tsx',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      '.git/**',
    ],
  },
});
