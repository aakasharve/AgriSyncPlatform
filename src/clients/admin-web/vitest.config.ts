/// <reference types="vitest" />
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Separate from vite.config.ts on purpose.
 *
 * The app config also loads @tailwindcss/vite, which compiles the token layer
 * on every run. Tests assert on behaviour and on text, never on computed
 * styles, so that work is pure cost — `css: false` below says the same thing
 * from the other side.
 *
 * The `@` alias is therefore declared HERE as well. It now exists in three
 * places (Preservation Register A49): vite.config.ts (bundling),
 * tsconfig.app.json (type resolution) and this file (test resolution).
 * All three must agree; a mismatch produces a suite that resolves imports
 * differently from the app it is meant to be evidence for.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    /**
     * RAISED FROM VITEST'S 5s DEFAULT IN TASK 12, and this is a measurement
     * rather than a preference.
     *
     * This suite is not a unit suite. `deepLink.contract.test.tsx`,
     * `tenancyRouting.contract.test.tsx` and `AdminShell.test.tsx` mount the
     * WHOLE console — router, guards, lazy routes, axios interceptors — and
     * several of them then walk a sign-in or an organisation switch across
     * three sequential round trips. Vitest runs files in parallel processes,
     * so those mounts compete for the same cores as twenty-five other files.
     *
     * Measured on this machine: with file parallelism the suite completes in
     * ~25s and two or three whole-console tests time out at exactly 5000ms,
     * differing run to run; with `--no-file-parallelism` it is green every
     * time and takes 110-260s. Every failure was the TEST timeout expiring,
     * never an assertion — and `deepLink.contract.test.tsx` already asks for
     * `{ timeout: 5_000 }` on individual `findBy` calls, which under the 5s
     * default can never be honoured because the test itself dies first.
     *
     * A required CI job that is 90% reliable is worse than no job: it teaches
     * everyone to re-run it. Raising the ceiling weakens no assertion — a
     * genuinely hung test still fails, fifteen seconds later.
     */
    testTimeout: 20_000,
  },
});
