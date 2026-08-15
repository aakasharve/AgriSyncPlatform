// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE GUARD FOR THE v23 COLLISION — the half that can gate TODAY.
 *
 * `feat/server-authoritative-architecture` and `feat/dfes-companion` both
 * declared `DATABASE_VERSION = 23` for two different schemas. Each branch was
 * internally consistent and fully green, so no gate in this repository could
 * see it: nothing here compares two branches.
 *
 * The consequence is not a merge conflict, which is why it is dangerous. Dexie
 * runs an upgrade only for versions ABOVE the one recorded on the device, so
 * whichever branch shipped SECOND would have had its upgrade silently skipped
 * on every handset that took the first — here leaving §P0.4's transcript strip
 * un-run and the farmer's raw speech in unencrypted IndexedDB, under a fix that
 * looked shipped.
 *
 * TWO GUARDS EXIST AND THEY ANSWER DIFFERENT QUESTIONS.
 *
 *   `scripts/check-dexie-version.mjs` does the CROSS-BRANCH comparison, which
 *   is the one that was missing. It needs git refs, so it belongs in CI.
 *
 *   THIS FILE does the LOCAL COHERENCE half, and it lives here rather than
 *   only in that script for one reason: it runs on every `npm run test`, today,
 *   without anyone wiring a workflow step. A guard that depends on someone
 *   remembering to add it is the same shape as the defect.
 *
 * Local coherence is what a hand-renumber breaks. Moving `v23.ts` to `v24.ts`
 * touches a file name, an exported function name, a `db.version(N)` call, an
 * import, a call site and a constant. Miss any one and you get a file that
 * looks renumbered and behaves as though it never was — which is the original
 * bug back again, now with a misleading filename on top.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATABASE_VERSION } from '../../DexieDatabase';

const STORAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));
const VERSIONS_DIR = join(STORAGE_DIR, 'dexie', 'versions');
const DB_SOURCE = readFileSync(join(STORAGE_DIR, 'DexieDatabase.ts'), 'utf8');

/** Every `vN.ts` present, ascending. Gaps are legal — see the last test. */
const VERSION_FILES = readdirSync(VERSIONS_DIR)
    .map(name => ({ name, m: /^v(\d+)\.ts$/.exec(name) }))
    .filter((e): e is { name: string; m: RegExpExecArray } => e.m !== null)
    .map(e => ({ name: e.name, n: Number(e.m[1]), source: readFileSync(join(VERSIONS_DIR, e.name), 'utf8') }))
    .sort((a, b) => a.n - b.n);

describe('Dexie schema version integrity', () => {
    it('there is at least one version file to check', () => {
        expect(VERSION_FILES.length).toBeGreaterThan(0);
    });

    it('DATABASE_VERSION equals the highest version file present', () => {
        const highest = VERSION_FILES[VERSION_FILES.length - 1].n;
        // The constant is what Dexie compares against the number on the device.
        // If it lags the files, the newest upgrade never runs; if it leads them,
        // Dexie opens a version nothing defines.
        expect(DATABASE_VERSION).toBe(highest);
    });

    it.each(VERSION_FILES.map(f => [f.name, f.n] as const))(
        '%s exports applyV%i and declares that same number',
        (name, n) => {
            const { source } = VERSION_FILES.find(f => f.name === name)!;
            expect(new RegExp(`export function applyV${n}\\s*\\(`).test(source)).toBe(true);

            const declared = source.match(/db\.version\(\s*(\d+)\s*\)/);
            expect(declared, `${name} never calls db.version(...)`).not.toBeNull();
            // Dexie reads the CALL, not the file name. A renumber that moves the
            // file and forgets this line is the silent half of the bug.
            expect(Number(declared![1])).toBe(n);
        },
    );

    it.each(VERSION_FILES.map(f => [f.n] as const))(
        'DexieDatabase imports and applies applyV%i',
        (n) => {
            expect(new RegExp(`from '\\./dexie/versions/v${n}'`).test(DB_SOURCE)).toBe(true);
            expect(new RegExp(`applyV${n}\\s*\\(this\\)`).test(DB_SOURCE)).toBe(true);
        },
    );

    it('applies its versions in ascending order', () => {
        // Dexie requires ascending declaration. Out of order, the upgrade chain
        // a device walks is not the one the files describe.
        const positions = VERSION_FILES.map(f => DB_SOURCE.indexOf(`applyV${f.n}(this)`));
        expect(positions.every(p => p >= 0)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it('23 is deliberately absent — it belongs to feat/dfes-companion', () => {
        // Not an accident and not to be tidied up. §P0.4 shipped as v23, and was
        // renumbered to 24 because DFES owns 23 and ships first. Reusing 23 here
        // would mean Dexie compares 23 to 23 on a DFES handset and runs nothing.
        // Gaps are legal in Dexie; a re-used number is not recoverable.
        expect(VERSION_FILES.map(f => f.n)).not.toContain(23);
        expect(DATABASE_VERSION).toBeGreaterThan(23);
    });
});
