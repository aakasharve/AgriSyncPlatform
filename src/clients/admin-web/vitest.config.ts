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
  },
});
