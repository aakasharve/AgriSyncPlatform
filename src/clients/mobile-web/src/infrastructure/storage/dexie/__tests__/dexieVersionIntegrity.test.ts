// @vitest-environment jsdom
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
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AgriLogDatabase, DATABASE_VERSION } from '../../DexieDatabase';

// Resolved from the vitest root (`src/clients/mobile-web`) rather than
// `import.meta.url`, which is not a file: URL under the jsdom environment this
// file needs for the real-database check below. Asserted rather than assumed —
// a wrong cwd would otherwise make every scan read nothing and pass vacuously.
const STORAGE_DIR = join(process.cwd(), 'src', 'infrastructure', 'storage');
const VERSIONS_DIR = join(STORAGE_DIR, 'dexie', 'versions');
/**
 * Comments stripped before every check below.
 *
 * Found by this guard failing on itself: DFES's `v23.ts` header contains the
 * literal `db.version(24))` in prose instructing the sibling branch to renumber,
 * and a first-match regex over raw source read that comment as the declaration.
 * A guard that can be satisfied — or broken — by a sentence is not checking the
 * code. The version files' index strings contain no comment tokens, so this is
 * safe on them.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^[ 	]*\/\/.*$/gm, ' ')
        .replace(/([^:])\/\/.*$/gm, '$1');
}

const DB_SOURCE = stripComments(readFileSync(join(STORAGE_DIR, 'DexieDatabase.ts'), 'utf8'));

/** Every `vN.ts` present, ascending. Gaps are legal — see the last test. */
const VERSION_FILES = readdirSync(VERSIONS_DIR)
    .map(name => ({ name, m: /^v(\d+)\.ts$/.exec(name) }))
    .filter((e): e is { name: string; m: RegExpExecArray } => e.m !== null)
    .map(e => ({
        name: e.name,
        n: Number(e.m[1]),
        source: stripComments(readFileSync(join(VERSIONS_DIR, e.name), 'utf8')),
    }))
    .sort((a, b) => a.n - b.n);

describe('Dexie schema version integrity', () => {
    it('the scan actually found the source it is meant to check', () => {
        // Guards against the whole file passing vacuously on a wrong cwd.
        expect(existsSync(VERSIONS_DIR), `${VERSIONS_DIR} not found`).toBe(true);
        expect(VERSION_FILES.length).toBeGreaterThan(20);
        expect(DB_SOURCE).toContain('export const DATABASE_VERSION');
        // stripComments must not have eaten the code it is meant to leave.
        expect(DB_SOURCE).toContain('applyV1(this)');
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

    it('the version chain has NO GAPS below DATABASE_VERSION', () => {
        // §P0.7 review C1 — THE ASSERTION THAT REPLACED "23 IS ABSENT", and the
        // inversion is the point.
        //
        // The old version of this test asserted that v23 must NOT exist, because
        // 23 belongs to feat/dfes-companion. That was backwards in the most
        // dangerous way available: the day DFES's v23.ts lands this test would go
        // red, and the quickest way to green it would be to DELETE DFES's v23 —
        // which is precisely the change that silently destroys
        // `pendingInterpretations` on every handset that took DFES first. A guard
        // whose simplest resolution is the catastrophe is worse than no guard.
        //
        // Dexie's schema is the UNION of the versions the running build DECLARES.
        // A gap is not inert: every store introduced at the missing version is
        // absent from the union, and `deleteRemovedTables` drops it, with the
        // upgrade reporting success. So the invariant is contiguity, and it fails
        // in the direction that ASKS FOR the missing file rather than inviting
        // someone to remove another.
        const numbers = VERSION_FILES.map(f => f.n);
        const expected = Array.from({ length: DATABASE_VERSION }, (_, i) => i + 1);
        expect(numbers).toEqual(expected);
    });
});

/**
 * Every store name any version file declares, from the `.stores({...})` blocks.
 * Deliberately parsed from source rather than imported: the question being asked
 * is whether the WIRING loses something the FILES declare, and importing the
 * assembled result would beg it.
 */
function declaredStoreNames(source: string): string[] {
    const block = /\.stores\(\{([\s\S]*?)\}\)/g;
    const names: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = block.exec(source)) !== null) {
        for (const line of m[1].split(/\r?\n/)) {
            const key = /^\s*([A-Za-z_$][\w$]*)\s*:/.exec(line);
            if (key) names.push(key[1]);
        }
    }
    return names;
}

const ALL_DECLARED_STORES = [...new Set(VERSION_FILES.flatMap(f => declaredStoreNames(f.source)))].sort();

describe('the shipped chain keeps every store its own versions declare', () => {
    const PROBE_DB = 'AgriLogDB_version_integrity_probe';

    afterAll(async () => { await Dexie.delete(PROBE_DB); });

    it('parsed at least the stores we know exist, so the check is not vacuous', () => {
        expect(ALL_DECLARED_STORES).toContain('logs');
        expect(ALL_DECLARED_STORES).toContain('mutationQueue');
        expect(ALL_DECLARED_STORES.length).toBeGreaterThan(25);
    });

    it('C1 — the real AgriLogDatabase exposes every store the version files declare', async () => {
        // THE GUARD FOR THE DEFECT THAT WAS SHIPPED. A version file can declare a
        // store and the assembled chain can still lose it — that is exactly what
        // happened when `DexieDatabase.ts` skipped v23: `pendingInterpretations`
        // was declared in `versions/`, absent from the union the build produced,
        // and deleted off farmers' handsets with the upgrade reporting success.
        //
        // This opens the REAL production class. No locally assembled chain can
        // answer this question, which is the mistake the C1 test made.
        await Dexie.delete(PROBE_DB);
        const db = new AgriLogDatabase(PROBE_DB);
        await db.open();
        const live = db.tables.map(t => t.name).sort();
        db.close();

        const missing = ALL_DECLARED_STORES.filter(name => !live.includes(name));
        expect(
            missing,
            'A store is declared by a version file but absent from the database the app '
            + 'actually builds. Almost always a version missing from the applyVN chain in '
            + 'DexieDatabase.ts — Dexie unions only the versions it is GIVEN, and drops the rest.',
        ).toEqual([]);
    }, 60000);
});
