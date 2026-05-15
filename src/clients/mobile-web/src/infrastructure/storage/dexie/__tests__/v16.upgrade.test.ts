// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DATA_PRINCIPLE_SPINE sub-phase 01.6 — Dexie v15 -> v16 provenance backfill.
 *
 * Locks the upgrade contract from the spec:
 *   1. Each `logs` row whose `record.log.meta.provenance` is ABSENT gets
 *      stamped with `{ source: 'pre_spine', modelVersion: 'unknown',
 *      promptVersion: 'unknown', promptContentHash: null, appVersion: null,
 *      timestamp: <existing-lastModified-or-now> }`.
 *   2. Rows that already carry a `meta.provenance` are LEFT UNTOUCHED.
 *   3. Rows whose `log.meta` itself is missing are NOT crashed by the
 *      upgrade (it must be defensive — `pre_spine` legacy rows pre-date
 *      the meta shape on some devices).
 *
 * Setup: open the DB at version 15 only (mount `applyV1..applyV15`), seed
 * a mix of with/without-provenance logs, close, then re-open at version
 * 16 (mount through `applyV16`) so Dexie runs the upgrade callback. Read
 * the rows back and assert the stamp landed honestly.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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

const DB_NAME = 'AgriLogDB_v16_upgrade_test';

interface SeededProvenance {
    source: string;
    modelVersion?: string;
    promptVersion?: string;
    promptContentHash?: string | null;
    appVersion?: string | null;
    timestamp: string;
    [key: string]: unknown;
}

interface SeededRecord {
    id: string;
    schemaVersion: number;
    date: string;
    isDeleted: 0 | 1;
    log: {
        id: string;
        meta?: {
            createdAtISO?: string;
            lastModified?: string;
            provenance?: SeededProvenance;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
}

async function openV15(): Promise<Dexie> {
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
    await db.open();
    return db;
}

async function openV16(): Promise<Dexie> {
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
    await db.open();
    return db;
}

async function deleteDb(): Promise<void> {
    await Dexie.delete(DB_NAME);
}

describe('Dexie v15 -> v16 upgrade (DATA_PRINCIPLE_SPINE 01.6 — pre_spine backfill)', () => {
    beforeEach(async () => {
        await deleteDb();
    });

    afterEach(async () => {
        await deleteDb();
    });

    it('stamps pre_spine provenance on a log that lacks meta.provenance', async () => {
        // ---- Seed at v15 ----
        const dbV15 = await openV15();
        const seedDate = '2026-04-10';
        const lastModified = '2026-04-10T11:22:33.000Z';

        const seed: SeededRecord = {
            id: 'log-legacy-no-prov',
            schemaVersion: 14,
            date: seedDate,
            isDeleted: 0,
            log: {
                id: 'log-legacy-no-prov',
                meta: {
                    createdAtISO: lastModified,
                    lastModified,
                },
            },
        };

        await dbV15.table('logs').put(seed);
        dbV15.close();

        // ---- Re-open at v16 (runs upgrade) ----
        const dbV16 = await openV16();
        const after = await dbV16.table('logs').get('log-legacy-no-prov') as SeededRecord | undefined;
        dbV16.close();

        expect(after).toBeDefined();
        expect(after!.log.meta).toBeDefined();
        const provenance = after!.log.meta!.provenance;
        expect(provenance).toBeDefined();
        expect(provenance!.source).toBe('pre_spine');
        expect(provenance!.modelVersion).toBe('unknown');
        expect(provenance!.promptVersion).toBe('unknown');
        expect(provenance!.promptContentHash).toBeNull();
        expect(provenance!.appVersion).toBeNull();
        // Timestamp falls back to meta.lastModified when present.
        expect(provenance!.timestamp).toBe(lastModified);
    });

    it('leaves an already-stamped provenance untouched (idempotent re-run safe)', async () => {
        // ---- Seed at v15 with an existing AI provenance ----
        const dbV15 = await openV15();
        const existingProvenance: SeededProvenance = {
            source: 'ai',
            modelVersion: 'gemini-2.5-flash',
            promptVersion: 'v2026-04-01',
            promptContentHash: 'b'.repeat(64),
            appVersion: '0.8.5',
            timestamp: '2026-04-10T09:00:00.000Z',
        };

        const seed: SeededRecord = {
            id: 'log-ai-already-stamped',
            schemaVersion: 14,
            date: '2026-04-10',
            isDeleted: 0,
            log: {
                id: 'log-ai-already-stamped',
                meta: {
                    createdAtISO: '2026-04-10T09:00:00.000Z',
                    lastModified: '2026-04-10T09:00:00.000Z',
                    provenance: existingProvenance,
                },
            },
        };

        await dbV15.table('logs').put(seed);
        dbV15.close();

        // ---- Re-open at v16 ----
        const dbV16 = await openV16();
        const after = await dbV16.table('logs').get('log-ai-already-stamped') as SeededRecord | undefined;
        dbV16.close();

        expect(after).toBeDefined();
        const provenance = after!.log.meta!.provenance;
        expect(provenance).toEqual(existingProvenance);
        // Specifically: source did NOT get overwritten to 'pre_spine'.
        expect(provenance!.source).toBe('ai');
        expect(provenance!.modelVersion).toBe('gemini-2.5-flash');
    });

    it('falls back to a synthesized timestamp when meta.lastModified is absent', async () => {
        const dbV15 = await openV15();
        const seed: SeededRecord = {
            id: 'log-no-lastmodified',
            schemaVersion: 14,
            date: '2026-04-11',
            isDeleted: 0,
            log: {
                id: 'log-no-lastmodified',
                meta: {
                    // intentionally no lastModified
                    createdAtISO: '2026-04-11T00:00:00.000Z',
                },
            },
        };

        await dbV15.table('logs').put(seed);
        dbV15.close();

        const beforeUpgradeMs = Date.now();
        const dbV16 = await openV16();
        const after = await dbV16.table('logs').get('log-no-lastmodified') as SeededRecord | undefined;
        const afterUpgradeMs = Date.now();
        dbV16.close();

        expect(after).toBeDefined();
        const provenance = after!.log.meta!.provenance;
        expect(provenance).toBeDefined();
        expect(provenance!.source).toBe('pre_spine');
        // Timestamp must be a parseable ISO string in the upgrade window.
        const stampedMs = Date.parse(provenance!.timestamp);
        expect(Number.isNaN(stampedMs)).toBe(false);
        expect(stampedMs).toBeGreaterThanOrEqual(beforeUpgradeMs - 1000);
        expect(stampedMs).toBeLessThanOrEqual(afterUpgradeMs + 1000);
    });

    it('processes a mix of legacy + already-stamped rows in one upgrade pass', async () => {
        const dbV15 = await openV15();
        const legacy: SeededRecord = {
            id: 'log-mix-legacy',
            schemaVersion: 14,
            date: '2026-04-12',
            isDeleted: 0,
            log: {
                id: 'log-mix-legacy',
                meta: { createdAtISO: '2026-04-12T01:00:00.000Z', lastModified: '2026-04-12T01:00:00.000Z' },
            },
        };
        const stamped: SeededRecord = {
            id: 'log-mix-manual',
            schemaVersion: 14,
            date: '2026-04-12',
            isDeleted: 0,
            log: {
                id: 'log-mix-manual',
                meta: {
                    createdAtISO: '2026-04-12T02:00:00.000Z',
                    lastModified: '2026-04-12T02:00:00.000Z',
                    provenance: {
                        source: 'manual',
                        timestamp: '2026-04-12T02:00:00.000Z',
                    },
                },
            },
        };

        await dbV15.table('logs').bulkPut([legacy, stamped]);
        dbV15.close();

        const dbV16 = await openV16();
        const afterLegacy = await dbV16.table('logs').get('log-mix-legacy') as SeededRecord | undefined;
        const afterStamped = await dbV16.table('logs').get('log-mix-manual') as SeededRecord | undefined;
        dbV16.close();

        expect(afterLegacy!.log.meta!.provenance!.source).toBe('pre_spine');
        expect(afterLegacy!.log.meta!.provenance!.modelVersion).toBe('unknown');
        expect(afterLegacy!.log.meta!.provenance!.promptContentHash).toBeNull();
        expect(afterLegacy!.log.meta!.provenance!.appVersion).toBeNull();

        expect(afterStamped!.log.meta!.provenance!.source).toBe('manual');
        // No new fields silently appended on already-stamped rows.
        expect(afterStamped!.log.meta!.provenance!.modelVersion).toBeUndefined();
    });

    it('does not crash when a row lacks log.meta entirely (defensive backfill)', async () => {
        const dbV15 = await openV15();
        // Row with no `meta` at all — represents older, pre-meta logs that
        // may still exist on long-lived devices.
        const seed: SeededRecord = {
            id: 'log-no-meta',
            schemaVersion: 1,
            date: '2026-04-13',
            isDeleted: 0,
            log: {
                id: 'log-no-meta',
                // meta intentionally omitted
            },
        };

        await dbV15.table('logs').put(seed);
        dbV15.close();

        // Should not throw on open — the upgrade must skip meta-less rows.
        const dbV16 = await openV16();
        const after = await dbV16.table('logs').get('log-no-meta') as SeededRecord | undefined;
        dbV16.close();

        expect(after).toBeDefined();
        // The row survived; we don't require the upgrade to add `meta` —
        // only that it didn't crash and didn't corrupt the row.
        expect(after!.id).toBe('log-no-meta');
    });
});
