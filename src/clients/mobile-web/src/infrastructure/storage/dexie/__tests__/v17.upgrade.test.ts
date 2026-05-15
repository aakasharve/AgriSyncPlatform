// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DATA_PRINCIPLE_SPINE sub-phase 02.7 — Dexie v16 → v17 upgrade.
 *
 * Locks the upgrade contract from the spec + Conflict-Resolver R0
 * verdict (2026-05-15 `_COFOUNDER/memory/decisions-log.md`):
 *
 *   1. Each `costEntries.payload` row whose payload has a free-text
 *      `category` (and no canonical `categoryId`) gets a `categoryId`
 *      stamped, with the legacy `category` field DELETED.
 *
 *   2. The Labour split is BINDING — the plan's draft hook at §02.7.1
 *      L752-768 collapsed everything containing 'labour' to
 *      `labour_payout`, but the R0 verdict overrides that:
 *        - has `jobCardId`  → `labour_payout` (CEI-I8 payout path)
 *        - no `jobCardId`   → `labour_misc` (generic / UI-entered)
 *
 *   3. Substring precedence:
 *        - "Equipment" → `equipment` (NOT `machinery_rent`)
 *        - "Fuel" / "Diesel" / "Petrol" → `fuel` (NOT `other`)
 *        - "Seeds" / "Biyane" → `seeds`
 *
 *   4. Rows already at the canonical shape (have `categoryId`) are
 *      LEFT UNTOUCHED — re-running the upgrade is a no-op.
 *
 *   5. Rows without `category` AND without `categoryId` are skipped
 *      (no crash on transient / partial records).
 *
 *   6. The mutationQueue table is also migrated: any pending
 *      `add_cost_entry` mutation gets its payload rewritten.
 *
 * Setup mirrors the v16 test harness: open at v16 only, seed rows,
 * close, re-open at v17 to trigger the upgrade callback, then assert.
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
import { applyV17 } from '../versions/v17';
import { SyncMutationName } from '../../../sync/SyncMutationCatalog';

const DB_NAME = 'AgriLogDB_v17_upgrade_test';

interface LegacyCostEntryPayload {
    id: string;
    farmId: string;
    category?: string;
    categoryId?: string;
    jobCardId?: string | null;
    description?: string;
    amount?: number;
    entryDate?: string;
    [key: string]: unknown;
}

interface CostEntryRow {
    id: string;
    farmId: string;
    payload: LegacyCostEntryPayload;
    updatedAt: string;
    modifiedAtUtc?: string;
}

interface QueuedMutationRow {
    id?: number;
    deviceId: string;
    clientRequestId: string;
    clientCommandId: string;
    mutationType: string;
    payload: LegacyCostEntryPayload;
    status: string;
    createdAt: string;
    updatedAt: string;
    retryCount: number;
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

async function openV17(): Promise<Dexie> {
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
    await db.open();
    return db;
}

async function deleteDb(): Promise<void> {
    await Dexie.delete(DB_NAME);
}

function buildCostEntryRow(
    id: string,
    payload: Partial<LegacyCostEntryPayload>,
): CostEntryRow {
    return {
        id,
        farmId: payload.farmId ?? 'farm_test',
        payload: {
            id,
            farmId: payload.farmId ?? 'farm_test',
            description: 'seed',
            amount: 100,
            entryDate: '2026-04-10',
            ...payload,
        },
        updatedAt: '2026-04-10T00:00:00.000Z',
    };
}

describe('Dexie v16 → v17 upgrade (DATA_PRINCIPLE_SPINE 02.7 — cost category FK migration)', () => {
    beforeEach(async () => {
        await deleteDb();
    });

    afterEach(async () => {
        await deleteDb();
    });

    it('Labour + jobCardId → labour_payout (CEI-I8 payout path)', async () => {
        const dbV16 = await openV16();
        const row = buildCostEntryRow('ce-labour-payout', {
            category: 'Labour',
            jobCardId: 'jc-abc-123',
        });
        await dbV16.table('costEntries').put(row);
        dbV16.close();

        const dbV17 = await openV17();
        const after = await dbV17.table('costEntries').get('ce-labour-payout') as CostEntryRow | undefined;
        dbV17.close();

        expect(after).toBeDefined();
        expect(after!.payload.categoryId).toBe('labour_payout');
        // Legacy field is removed once we've decided the canonical id.
        expect(after!.payload.category).toBeUndefined();
        // jobCardId itself is left untouched.
        expect(after!.payload.jobCardId).toBe('jc-abc-123');
    });

    it('Labour without jobCardId → labour_misc (generic UI-entered)', async () => {
        const dbV16 = await openV16();
        const row = buildCostEntryRow('ce-labour-misc', {
            category: 'Labour',
            // intentionally no jobCardId
        });
        await dbV16.table('costEntries').put(row);
        dbV16.close();

        const dbV17 = await openV17();
        const after = await dbV17.table('costEntries').get('ce-labour-misc') as CostEntryRow | undefined;
        dbV17.close();

        expect(after).toBeDefined();
        expect(after!.payload.categoryId).toBe('labour_misc');
        expect(after!.payload.category).toBeUndefined();
        // The plan's draft hook (collapsed all labour → labour_payout)
        // would have failed this assertion — Conflict-Resolver R0
        // override is verified here.
        expect(after!.payload.categoryId).not.toBe('labour_payout');
    });

    it('Labour with empty-string jobCardId → labour_misc (defensive)', async () => {
        // An empty-string jobCardId must NOT be treated as a CEI-I8
        // payout — the field is "set but blank" which is indistinguishable
        // from "not set" for purposes of the payout path.
        const dbV16 = await openV16();
        const row = buildCostEntryRow('ce-labour-empty-jc', {
            category: 'labour expenses',
            jobCardId: '',
        });
        await dbV16.table('costEntries').put(row);
        dbV16.close();

        const dbV17 = await openV17();
        const after = await dbV17.table('costEntries').get('ce-labour-empty-jc') as CostEntryRow | undefined;
        dbV17.close();

        expect(after!.payload.categoryId).toBe('labour_misc');
    });

    it('Fuel / Diesel / Petrol → fuel (NOT other)', async () => {
        const dbV16 = await openV16();
        await dbV16.table('costEntries').bulkPut([
            buildCostEntryRow('ce-fuel-1', { category: 'Fuel' }),
            buildCostEntryRow('ce-fuel-2', { category: 'Diesel for tractor' }),
            buildCostEntryRow('ce-fuel-3', { category: 'Petrol' }),
        ]);
        dbV16.close();

        const dbV17 = await openV17();
        const r1 = await dbV17.table('costEntries').get('ce-fuel-1') as CostEntryRow;
        const r2 = await dbV17.table('costEntries').get('ce-fuel-2') as CostEntryRow;
        const r3 = await dbV17.table('costEntries').get('ce-fuel-3') as CostEntryRow;
        dbV17.close();

        expect(r1.payload.categoryId).toBe('fuel');
        expect(r2.payload.categoryId).toBe('fuel');
        expect(r3.payload.categoryId).toBe('fuel');
        // Plan-draft "else → other" would have mapped these to 'other'.
        for (const r of [r1, r2, r3]) {
            expect(r.payload.categoryId).not.toBe('other');
        }
    });

    it('Equipment → equipment (NOT machinery_rent)', async () => {
        // Substring precedence guard: 'equipment' must be matched
        // BEFORE 'machine'/'tractor', otherwise "Equipment Rental" would
        // mis-map to machinery_rent.
        const dbV16 = await openV16();
        await dbV16.table('costEntries').bulkPut([
            buildCostEntryRow('ce-equip-1', { category: 'Equipment' }),
            buildCostEntryRow('ce-equip-2', { category: 'Equipment Repair' }),
        ]);
        dbV16.close();

        const dbV17 = await openV17();
        const r1 = await dbV17.table('costEntries').get('ce-equip-1') as CostEntryRow;
        const r2 = await dbV17.table('costEntries').get('ce-equip-2') as CostEntryRow;
        dbV17.close();

        expect(r1.payload.categoryId).toBe('equipment');
        expect(r2.payload.categoryId).toBe('equipment');
        expect(r1.payload.categoryId).not.toBe('machinery_rent');
        expect(r2.payload.categoryId).not.toBe('machinery_rent');
    });

    it('maps the seed-fidelity vocabulary in the spec (seeds/fert/khat/pesticide/...)', async () => {
        const dbV16 = await openV16();
        await dbV16.table('costEntries').bulkPut([
            buildCostEntryRow('ce-seed-en', { category: 'Seeds' }),
            buildCostEntryRow('ce-seed-mr', { category: 'biyane purchase' }),
            buildCostEntryRow('ce-fert-en', { category: 'Fertilizer' }),
            buildCostEntryRow('ce-fert-mr', { category: 'khat application' }),
            buildCostEntryRow('ce-pesti', { category: 'Pesticide' }),
            buildCostEntryRow('ce-spray', { category: 'spray treatment' }),
            buildCostEntryRow('ce-machine', { category: 'Machinery hire' }),
            buildCostEntryRow('ce-tractor', { category: 'Tractor rent' }),
            buildCostEntryRow('ce-irrig', { category: 'Irrigation' }),
            buildCostEntryRow('ce-water', { category: 'water pump' }),
            buildCostEntryRow('ce-transp', { category: 'Transport' }),
            buildCostEntryRow('ce-elec', { category: 'Electricity bill' }),
            buildCostEntryRow('ce-vij', { category: 'vij bill' }),
            buildCostEntryRow('ce-pack', { category: 'Packaging' }),
            buildCostEntryRow('ce-misc', { category: 'gibberish category xyz' }),
        ]);
        dbV16.close();

        const dbV17 = await openV17();
        const get = async (id: string): Promise<CostEntryRow> =>
            await dbV17.table('costEntries').get(id) as CostEntryRow;

        expect((await get('ce-seed-en')).payload.categoryId).toBe('seeds');
        expect((await get('ce-seed-mr')).payload.categoryId).toBe('seeds');
        expect((await get('ce-fert-en')).payload.categoryId).toBe('fertilizer');
        expect((await get('ce-fert-mr')).payload.categoryId).toBe('fertilizer');
        expect((await get('ce-pesti')).payload.categoryId).toBe('pesticide');
        expect((await get('ce-spray')).payload.categoryId).toBe('pesticide');
        expect((await get('ce-machine')).payload.categoryId).toBe('machinery_rent');
        expect((await get('ce-tractor')).payload.categoryId).toBe('machinery_rent');
        expect((await get('ce-irrig')).payload.categoryId).toBe('irrigation');
        expect((await get('ce-water')).payload.categoryId).toBe('irrigation');
        expect((await get('ce-transp')).payload.categoryId).toBe('transport');
        expect((await get('ce-elec')).payload.categoryId).toBe('electricity');
        expect((await get('ce-vij')).payload.categoryId).toBe('electricity');
        expect((await get('ce-pack')).payload.categoryId).toBe('packaging');
        expect((await get('ce-misc')).payload.categoryId).toBe('other');

        dbV17.close();
    });

    it('rows already at canonical shape are LEFT UNTOUCHED (idempotent)', async () => {
        const dbV16 = await openV16();
        // Row written by the 02.5.5 frontend code path — already has
        // canonical categoryId. We must not flip it.
        const row = buildCostEntryRow('ce-already-canonical', {
            categoryId: 'labour_payout',
            // Note: NO `category` field, just like the new write-path emits.
            jobCardId: 'jc-zzz',
        });
        await dbV16.table('costEntries').put(row);
        dbV16.close();

        const dbV17 = await openV17();
        const after = await dbV17.table('costEntries').get('ce-already-canonical') as CostEntryRow | undefined;
        dbV17.close();

        expect(after!.payload.categoryId).toBe('labour_payout');
        expect(after!.payload.category).toBeUndefined();
    });

    it('rows already canonical do NOT have a wrong-but-canonical categoryId overwritten', async () => {
        // Even if some intermediate-state row carries BOTH a canonical
        // `categoryId` and a stale `category`, the upgrade must trust
        // the categoryId (it's the canonical source) — do NOT re-derive.
        const dbV16 = await openV16();
        const row = buildCostEntryRow('ce-both-fields', {
            categoryId: 'other',
            category: 'Labour',     // would otherwise map to labour_misc
            jobCardId: undefined,
        });
        await dbV16.table('costEntries').put(row);
        dbV16.close();

        const dbV17 = await openV17();
        const after = await dbV17.table('costEntries').get('ce-both-fields') as CostEntryRow | undefined;
        dbV17.close();

        expect(after!.payload.categoryId).toBe('other');
    });

    it('rows with neither category nor categoryId are skipped without crashing', async () => {
        const dbV16 = await openV16();
        const row = buildCostEntryRow('ce-no-category', {
            // no `category`, no `categoryId`
        });
        delete (row.payload as Record<string, unknown>)['category'];
        delete (row.payload as Record<string, unknown>)['categoryId'];
        await dbV16.table('costEntries').put(row);
        dbV16.close();

        // Upgrade must not throw.
        const dbV17 = await openV17();
        const after = await dbV17.table('costEntries').get('ce-no-category') as CostEntryRow | undefined;
        dbV17.close();

        expect(after).toBeDefined();
        expect(after!.payload.categoryId).toBeUndefined();
        expect(after!.payload.category).toBeUndefined();
    });

    it('also migrates pending `add_cost_entry` rows in the mutationQueue', async () => {
        const dbV16 = await openV16();
        const pending: QueuedMutationRow = {
            deviceId: 'dev-1',
            clientRequestId: 'req-1',
            clientCommandId: 'cmd-1',
            mutationType: SyncMutationName.AddCostEntry,
            payload: {
                id: 'ce-pending',
                farmId: 'farm_test',
                category: 'Fuel',
                amount: 500,
            },
            status: 'PENDING',
            createdAt: '2026-04-10T00:00:00.000Z',
            updatedAt: '2026-04-10T00:00:00.000Z',
            retryCount: 0,
        };
        // Also seed an unrelated mutation that must be left alone.
        const unrelated: QueuedMutationRow = {
            deviceId: 'dev-1',
            clientRequestId: 'req-2',
            clientCommandId: 'cmd-2',
            mutationType: SyncMutationName.CreateDailyLog,
            payload: {
                id: 'log-x',
                farmId: 'farm_test',
                // category field on a log payload is irrelevant to this
                // migration — the where('mutationType') filter must
                // skip it entirely.
                category: 'Labour',
            },
            status: 'PENDING',
            createdAt: '2026-04-10T00:00:00.000Z',
            updatedAt: '2026-04-10T00:00:00.000Z',
            retryCount: 0,
        };

        await dbV16.table('mutationQueue').bulkAdd([pending, unrelated]);
        dbV16.close();

        const dbV17 = await openV17();
        const allRows = await dbV17.table('mutationQueue').toArray() as QueuedMutationRow[];
        dbV17.close();

        const after = allRows.find(r => r.clientRequestId === 'req-1');
        const afterUnrelated = allRows.find(r => r.clientRequestId === 'req-2');

        expect(after).toBeDefined();
        expect(after!.payload.categoryId).toBe('fuel');
        expect(after!.payload.category).toBeUndefined();

        // Unrelated mutation must be untouched — the filter only
        // targets `add_cost_entry`.
        expect(afterUnrelated).toBeDefined();
        expect(afterUnrelated!.payload.category).toBe('Labour');
        expect(afterUnrelated!.payload.categoryId).toBeUndefined();
    });
});
