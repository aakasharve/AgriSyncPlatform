/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

/**
 * THE OPEN-DEFECT SUITE.
 *
 * Runs only the `REPRO-*.test.ts` reproductions, which `vitest.config.ts`
 * deliberately excludes from the merge gate — see the long note there for why
 * that is an exclusion rather than a skip or an `it.fails`.
 *
 * These files are RED ON PURPOSE. Each failing assertion is a defect that is
 * reproduced at runtime, named, and tracked in
 * `docs/superpowers/plans/FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN.md`.
 * A green run here means every reproduced defect is fixed — at which point the
 * files should be renamed out of the `REPRO-` prefix so they join the gate as
 * permanent regression guards.
 *
 * Run: `npm run test:repro`. Non-zero exit is expected while defects remain, so
 * CI runs this step with `continue-on-error` and reports the tally rather than
 * blocking. The tally is the thing to watch: it must only ever go down.
 */
export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/REPRO-*.test.ts'],
        exclude: ['node_modules/**', 'dist/**', '.git/**'],
    },
});
