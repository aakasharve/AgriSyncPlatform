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
      // ── THE OPEN-DEFECT SUITE IS NOT THE REGRESSION GATE ─────────────────
      //
      // `REPRO-*.test.ts` files are runtime REPRODUCTIONS of defects that are
      // known, open and tracked in
      // `docs/superpowers/plans/FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN.md`.
      // They are red on purpose until the named task lands. They run in CI as
      // their own step — `npm run test:repro` — so nothing is hidden and no
      // count is fudged; they simply do not block the trunk, because a merge
      // gate must answer "did this change break something?", not "is the
      // backlog empty?".
      //
      // THIS IS NOT A SKIP AND NOT AN `it.fails`. Both were considered and
      // rejected: a skipped test reports Passed while asserting nothing (a
      // failure mode this repo has already shipped once, for months), and
      // `it.fails` turns ANY non-pass green — including a fixture TypeError or
      // an import error — and on a multi-assertion test it reads green when a
      // fix repairs six assertions of seven. Every assertion in these files
      // still runs, still fails loudly, and is still counted.
      //
      // WHEN A REPRO FILE GOES FULLY GREEN, DELETE THIS EXCLUSION FOR IT by
      // renaming the file out of the `REPRO-` prefix, so it joins the gate and
      // becomes the permanent regression guard it was always meant to be.
      'src/**/REPRO-*.test.ts',
    ],
  },
});
