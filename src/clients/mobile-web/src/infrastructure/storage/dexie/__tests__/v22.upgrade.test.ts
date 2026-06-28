// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * W1.P2 — Dexie v21 → v22 upgrade tests.
 *
 * spec: ai-intelligence-plan-2026-06-25
 *
 * Locks the following contracts:
 *
 *   1. DATABASE_VERSION constant is 22.
 *   2. v22's store list has the same number of stores as v21 (completeness
 *      guard — a partial list on a new version causes silent data loss on
 *      devices that have never seen the omitted stores).
 *   3. A `logs` row written at v21 survives the v21 → v22 upgrade intact
 *      (no data loss on upgrade).
 *   4. A `logs` row with `provenance` on event items round-trips correctly
 *      through the upgrade (provenance is preserved in the JSON blob).
 *
 * GAP NOTE: a full in-browser IndexedDB upgrade harness (open at v21, write
 * a row, close, re-open at v22, assert) requires fake-indexeddb + the full
 * v1-through-v22 chain. This test uses that pattern (following v16/v17
 * upgrade tests) for the data-survival and provenance round-trip assertions.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { DATABASE_VERSION } from '../../DexieDatabase';
import { applyV1 } from '../versions/v1';
import { applyV2 } from '../versions/v2';
import { applyV3 } from '../versions/v3';
import { applyV4 } from '../versions/v4';
import { applyV5 } from '../versions/v5';
import { applyV6 } from '../versions/v6';
import { applyV7 } from '../versions/v7';
import { applyV8 } from '../versions/v8';
import { applyV9 } from '../versions/v9';
import { applyV10 } from '../versions/v10';
import { applyV11 } from '../versions/v11';
import { applyV12 } from '../versions/v12';
import { applyV13 } from '../versions/v13';
import { applyV14 } from '../versions/v14';
import { applyV15 } from '../versions/v15';
import { applyV16 } from '../versions/v16';
import { applyV17 } from '../versions/v17';
import { applyV18 } from '../versions/v18';
import { applyV19 } from '../versions/v19';
import { applyV20 } from '../versions/v20';
import { applyV21 } from '../versions/v21';
import { applyV22 } from '../versions/v22';

const DB_NAME = 'AgriLogDB_v22_upgrade_test';

/** Minimal log row shape for the `logs` store. */
interface MinimalLogRow {
    id: string;
    date: string;
    verificationStatus: string;
    createdByOperatorId?: string;
    isDeleted: 0 | 1;
    log: {
        id: string;
        cropActivities: Array<{
            id: string;
            title: string;
            provenance?: string;
        }>;
        [key: string]: unknown;
    };
}

async function openV21(): Promise<Dexie> {
    const db = new Dexie(DB_NAME);
    applyV1(db);
    applyV2(db);
    applyV3(db);
    applyV4(db);
    applyV5(db);
    applyV6(db);
    applyV7(db);
    applyV8(db);
    applyV9(db);
    applyV10(db);
    applyV11(db);
    applyV12(db);
    applyV13(db);
    applyV14(db);
    applyV15(db);
    applyV16(db);
    applyV17(db);
    applyV18(db);
    applyV19(db);
    applyV20(db);
    applyV21(db);
    await db.open();
    return db;
}

async function openV22(): Promise<Dexie> {
    const db = new Dexie(DB_NAME);
    applyV1(db);
    applyV2(db);
    applyV3(db);
    applyV4(db);
    applyV5(db);
    applyV6(db);
    applyV7(db);
    applyV8(db);
    applyV9(db);
    applyV10(db);
    applyV11(db);
    applyV12(db);
    applyV13(db);
    applyV14(db);
    applyV15(db);
    applyV16(db);
    applyV17(db);
    applyV18(db);
    applyV19(db);
    applyV20(db);
    applyV21(db);
    applyV22(db);
    await db.open();
    return db;
}

async function deleteDb(): Promise<void> {
    await Dexie.delete(DB_NAME);
}

// ============================================================================
// Constant guard
// ============================================================================

describe('W1.P2 — Dexie v22: DATABASE_VERSION constant', () => {
    it('DATABASE_VERSION is 22', () => {
        expect(DATABASE_VERSION).toBe(22);
    });
});

// ============================================================================
// Store-completeness guard (v21 vs v22 store count)
// ============================================================================

describe('W1.P2 — Dexie v22: store-completeness guard', () => {
    /**
     * Count stores declared in a version object by opening a fresh DB
     * at that exact version and inspecting db.tables.
     *
     * We use separate DB names so they don't interfere.
     */
    it('v22 re-lists the same number of stores as v21 (no store dropped)', async () => {
        // Count v21 stores
        const dbV21Name = 'AgriLogDB_v22_storecount_v21';
        const dbV21 = new Dexie(dbV21Name);
        applyV1(dbV21);
        applyV2(dbV21);
        applyV3(dbV21);
        applyV4(dbV21);
        applyV5(dbV21);
        applyV6(dbV21);
        applyV7(dbV21);
        applyV8(dbV21);
        applyV9(dbV21);
        applyV10(dbV21);
        applyV11(dbV21);
        applyV12(dbV21);
        applyV13(dbV21);
        applyV14(dbV21);
        applyV15(dbV21);
        applyV16(dbV21);
        applyV17(dbV21);
        applyV18(dbV21);
        applyV19(dbV21);
        applyV20(dbV21);
        applyV21(dbV21);
        await dbV21.open();
        const v21StoreCount = dbV21.tables.length;
        dbV21.close();
        await Dexie.delete(dbV21Name);

        // Count v22 stores
        const dbV22Name = 'AgriLogDB_v22_storecount_v22';
        const dbV22 = new Dexie(dbV22Name);
        applyV1(dbV22);
        applyV2(dbV22);
        applyV3(dbV22);
        applyV4(dbV22);
        applyV5(dbV22);
        applyV6(dbV22);
        applyV7(dbV22);
        applyV8(dbV22);
        applyV9(dbV22);
        applyV10(dbV22);
        applyV11(dbV22);
        applyV12(dbV22);
        applyV13(dbV22);
        applyV14(dbV22);
        applyV15(dbV22);
        applyV16(dbV22);
        applyV17(dbV22);
        applyV18(dbV22);
        applyV19(dbV22);
        applyV20(dbV22);
        applyV21(dbV22);
        applyV22(dbV22);
        await dbV22.open();
        const v22StoreCount = dbV22.tables.length;
        dbV22.close();
        await Dexie.delete(dbV22Name);

        // v22 must have AT LEAST as many stores as v21 (additive only).
        expect(v22StoreCount).toBeGreaterThanOrEqual(v21StoreCount);
        // And since this is a no-new-store bump, they should be equal.
        expect(v22StoreCount).toBe(v21StoreCount);
    });
});

// ============================================================================
// Data-survival and provenance round-trip through v21 → v22 upgrade
// ============================================================================

describe('W1.P2 — Dexie v21 → v22 upgrade: data survival + provenance round-trip', () => {
    beforeEach(async () => {
        await deleteDb();
    });

    afterEach(async () => {
        await deleteDb();
    });

    it('a log row written at v21 survives the upgrade to v22 intact', async () => {
        // --- seed at v21 ---
        const db21 = await openV21();
        const row: MinimalLogRow = {
            id: 'test-log-v21',
            date: '2026-06-27',
            verificationStatus: 'DRAFT',
            isDeleted: 0,
            log: {
                id: 'test-log-v21',
                cropActivities: [
                    { id: 'ca-1', title: 'Pruning' },
                ],
            },
        };
        await db21.table('logs').add(row);
        db21.close();

        // --- upgrade to v22 ---
        const db22 = await openV22();
        const recovered = await db22.table('logs').get('test-log-v21') as MinimalLogRow | undefined;
        db22.close();

        expect(recovered).toBeDefined();
        expect(recovered?.id).toBe('test-log-v21');
        expect(recovered?.date).toBe('2026-06-27');
        expect(recovered?.log.cropActivities[0]?.title).toBe('Pruning');
    });

    it('a log row with provenance on event items round-trips through v21 → v22', async () => {
        // --- seed at v21 with provenance already on event items ---
        const db21 = await openV21();
        const rowWithProvenance: MinimalLogRow = {
            id: 'test-log-provenance',
            date: '2026-06-27',
            verificationStatus: 'CONFIRMED',
            isDeleted: 0,
            log: {
                id: 'test-log-provenance',
                cropActivities: [
                    {
                        id: 'ca-prov-1',
                        title: 'Spraying',
                        provenance: 'spoken',
                    },
                ],
            },
        };
        await db21.table('logs').add(rowWithProvenance);
        db21.close();

        // --- upgrade to v22 ---
        const db22 = await openV22();
        const recovered = await db22.table('logs').get('test-log-provenance') as MinimalLogRow | undefined;
        db22.close();

        expect(recovered).toBeDefined();
        // Provenance on the event item must survive the upgrade unchanged.
        expect(recovered?.log.cropActivities[0]?.provenance).toBe('spoken');
    });

    it('a log row without provenance survives with undefined provenance (correct default)', async () => {
        // --- seed at v21 without provenance (pre-W1.P2 data) ---
        const db21 = await openV21();
        const rowWithoutProvenance: MinimalLogRow = {
            id: 'test-log-no-provenance',
            date: '2026-06-27',
            verificationStatus: 'DRAFT',
            isDeleted: 0,
            log: {
                id: 'test-log-no-provenance',
                cropActivities: [
                    { id: 'ca-noprov-1', title: 'Weeding' },
                ],
            },
        };
        await db21.table('logs').add(rowWithoutProvenance);
        db21.close();

        // --- upgrade to v22 ---
        const db22 = await openV22();
        const recovered = await db22.table('logs').get('test-log-no-provenance') as MinimalLogRow | undefined;
        db22.close();

        expect(recovered).toBeDefined();
        // No provenance on the item = undefined (correct; not stamped by upgrade).
        expect(recovered?.log.cropActivities[0]?.provenance).toBeUndefined();
    });
});
