/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Sub-plan 04 (Frontend Restructure) extends this with jsdom + fake-indexeddb
// so React component snapshot tests and Dexie-backed reconciler tests can run
// alongside the existing Sub-plan 02 contract tests.
// Sub-plan 05 (Testing & Ops Maturity) will layer in coverage gates.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      '.git/**',
      'e2e/**',
    ],
  },
});
