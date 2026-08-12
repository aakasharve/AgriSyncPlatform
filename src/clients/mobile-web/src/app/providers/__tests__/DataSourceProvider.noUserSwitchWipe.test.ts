/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE WIPE IS GONE — AND MUST NOT COME BACK ANYWHERE
 * ==================================================
 *
 * `DataSourceProvider.resetAuthenticatedUserCacheIfNeeded` cleared 21 Dexie
 * tables whenever the signed-in user id changed, destroying `PENDING` mutations
 * that had never left the handset along with the `db.logs` rows they described.
 * It is deleted, and `activateDatabaseForUser` — a change of ADDRESS, not a
 * deletion — stands in its place.
 *
 * WHAT THIS FILE IS, STATED PLAINLY (`W6`)
 * ----------------------------------------
 * A STATIC guard over production source text. It is NOT a runtime assertion
 * through a mounted provider, and it does not prove that a user switch behaves
 * correctly — `perUserDatabaseIsolation.test.ts` and
 * `SyncStatusService.userSwitch.test.ts` do that against real Dexie, and L5b
 * drove the activation live in-tab.
 *
 * What only this file can do is prove the DELETION is real and stays real. The
 * sibling suites exercise the replacement mechanism; every one of them would
 * still pass if somebody re-added a `db.mutationQueue.clear()` to a provider,
 * because they never mount one. This is the guard they could not reach.
 *
 * Its blind spot, so nobody mistakes it for more than it is: it matches source
 * text, so a dynamic form — `db.table(name).clear()` with a computed `name` —
 * would slip past assertion 1. Assertion 3 is the backstop for that: it pins
 * the ENTIRE inventory of Dexie `.clear()` calls in production, so a new one of
 * any shape has to be added here deliberately, with a reason.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROVIDER = fileURLToPath(new URL('../DataSourceProvider.tsx', import.meta.url));

const SKIP_DIRS = new Set(['__tests__', '__mocks__', '__snapshots__', 'node_modules', 'dist']);

/**
 * The tables that hold a farmer's captured work, or the parents of it. Clearing
 * any of these in client code is data loss by definition — there is no cache to
 * rebuild them from, because for `PENDING` rows the handset IS the only copy.
 *
 * The other twelve the old wipe emptied (`crops`, `farms`, `referenceData`,
 * `attentionCards`, ...) are server-derived caches; they are covered by
 * assertion 3 rather than banned outright, because a legitimate refresh may
 * need to replace one wholesale.
 */
const WORK_BEARING_TABLES = [
    'logs',
    'mutationQueue',
    'outbox',
    'attachments',
    'uploadQueue',
    'pendingAiJobs',
    'voiceClips',
    'aiCorrectionEvents',
    'auditEvents',
] as const;

/**
 * Every Dexie `.clear()` on a production path, pinned. Each entry is a cache
 * that can be rebuilt from the server or from localStorage — none is a farmer's
 * record. A new entry here is a deliberate act that must justify itself.
 */
const ALLOWED_DEXIE_CLEARS: ReadonlyArray<{ file: string; table: string; why: string }> = [
    {
        file: 'app/providers/DataSourceProvider.tsx',
        table: 'crops',
        why: 'demo-seed version reset — re-seeded immediately by seedDemoDataIfNeeded',
    },
    {
        file: 'features/sync/pull/reconcilers/attentionBoardReconciler.ts',
        table: 'attentionCards',
        why: 'server-computed board, replaced wholesale on every pull',
    },
    {
        file: 'infrastructure/storage/DexieCropsRepository.ts',
        table: 'crops',
        why: 'replaceAll semantics inside one transaction — cleared and re-written together',
    },
    {
        file: 'infrastructure/storage/LegacyLocalStorageMigrator.ts',
        table: 'crops',
        why: 'one-time localStorage import, cleared and re-filled in the same transaction',
    },
];

function productionSourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            productionSourceFiles(join(dir, entry.name), out);
        } else if (['.ts', '.tsx'].includes(extname(entry.name))) {
            if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
            out.push(join(dir, entry.name));
        }
    }
    return out;
}

const posix = (p: string) => relative(SRC_ROOT, p).replace(/\\/g, '/');

describe('the user-switch wipe is gone from production code', () => {
    const files = productionSourceFiles(SRC_ROOT);

    it('scans a real, non-empty production tree (guard against a vacuous pass)', () => {
        // Without this, a broken path would make every assertion below pass by
        // finding nothing — the exact way a "green" suite lies.
        expect(files.length).toBeGreaterThan(300);
        expect(files.some(f => posix(f) === 'app/providers/DataSourceProvider.tsx')).toBe(true);
    });

    it('1: no production module clears a table that holds a farmer\'s work', () => {
        const offenders: string[] = [];

        for (const file of files) {
            const src = readFileSync(file, 'utf8');
            for (const table of WORK_BEARING_TABLES) {
                // `db.mutationQueue.clear()`, `getDatabase().logs.clear()`, and
                // any whitespace/line-break between the accessor and the call.
                const pattern = new RegExp(`\\.${table}\\s*\\.\\s*clear\\s*\\(`, 'g');
                const hits = (src.match(pattern) || []).length;
                if (hits > 0) {
                    offenders.push(`${posix(file)} -> ${table}.clear() x${hits}`);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it('2: DataSourceProvider changes ADDRESS on a user switch, it does not delete', () => {
        const src = readFileSync(PROVIDER, 'utf8');

        // The wipe, by name and by shape.
        expect(src).not.toContain('resetAuthenticatedUserCacheIfNeeded');
        expect(src).not.toContain('mutationQueue');
        expect(src).not.toMatch(/db\.transaction\(\s*'rw'\s*,\s*\[/);
        // It also no longer destroys the legacy localStorage safety net on a
        // switch; the migrator's own guard provides that isolation instead.
        expect(src).not.toContain('clearLegacyFarmerProfile');

        // And the replacement is actually wired, before anything reads or writes.
        expect(src).toContain("from '../../infrastructure/storage/activateUserDatabase'");
        expect(src).toMatch(/activateDatabaseForUser\(session\.userId\)/);
        expect(src.indexOf('activateDatabaseForUser(session.userId)'))
            .toBeLessThan(src.indexOf('await dataSource.initialize()'));
        expect(src.indexOf('activateDatabaseForUser(session.userId)'))
            .toBeLessThan(src.indexOf('await MigrationService.migrate()'));
        expect(src.indexOf('activateDatabaseForUser(session.userId)'))
            .toBeLessThan(src.indexOf('await runLegacyLocalStorageMigration()'));
    });

    it('3: the full inventory of Dexie table clears is pinned to the allow-list', () => {
        // The backstop for assertion 1's blind spot: ANY new `.clear()` on a
        // Dexie table — including a dynamic one this file cannot name — changes
        // this list and fails here until somebody writes down why.
        const found: string[] = [];

        for (const file of files) {
            const src = readFileSync(file, 'utf8');
            for (const match of src.matchAll(/\.(\w+)\s*\.\s*clear\s*\(/g)) {
                const table = match[1];
                // In-memory Set/Map clears are not Dexie; they carry no rows.
                if (['registry', 'listeners', 'unqueueableLogIds', 'cache'].includes(table)) continue;
                found.push(`${posix(file)}::${table}`);
            }
            if (/\.table\(\s*[^'"]/.test(src) && /\.clear\s*\(/.test(src)) {
                found.push(`${posix(file)}::<dynamic table>`);
            }
        }

        const expected = ALLOWED_DEXIE_CLEARS.map(a => `${a.file}::${a.table}`);
        expect(found.sort()).toEqual(expected.sort());
    });
});
