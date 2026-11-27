// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, phone task P1) - Dexie v33 adds the four stores of the farm's setup as the server holds
 * it (`farmWaterSources`, `farmMachines`, `farmPowerTimes`, `plotWater`: a server cache, P10) and takes nothing away: a phone at v32 opens at v33 with
 * every store it had and its rows (its one-row phone profile and its queued changes included) intact.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgriLogDatabase, DATABASE_VERSION } from '../../DexieDatabase';
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
import { applyV23 } from '../versions/v23';
import { applyV24 } from '../versions/v24';
import { applyV25 } from '../versions/v25';
import { applyV26 } from '../versions/v26';
import { applyV27 } from '../versions/v27';
import { applyV28 } from '../versions/v28';
import { applyV29 } from '../versions/v29';
import { applyV30 } from '../versions/v30';
import { applyV31 } from '../versions/v31';
import { applyV32 } from '../versions/v32';

const NAME = 'agrisync-v33-test';
const NEW_STORES = ['farmMachines', 'farmPowerTimes', 'farmWaterSources', 'plotWater'];

/** A database exactly as v32 left it. */
function openAtV32(): Dexie {
    const db = new Dexie(NAME);
    [applyV1, applyV2, applyV3, applyV4, applyV5, applyV6, applyV7, applyV8, applyV9, applyV10, applyV11, applyV12, applyV13, applyV14,
        applyV15, applyV16, applyV17, applyV18, applyV19, applyV20, applyV21, applyV22, applyV23, applyV24, applyV25, applyV26, applyV27, applyV28,
        applyV29, applyV30, applyV31, applyV32].forEach(apply => apply(db));
    return db;
}

beforeEach(async () => { await Dexie.delete(NAME); });
afterEach(async () => { await Dexie.delete(NAME); });

describe('Dexie v33 - the farm setup as the server holds it', () => {
    it('is the current version and keys the four stores as the paper says', () => {
        expect(DATABASE_VERSION).toBe(33);
        const db = new AgriLogDatabase(NAME);
        expect(db.verno).toBe(33);
        expect(db.table('farmWaterSources').schema.primKey.name).toBe('id');
        expect(db.table('farmWaterSources').schema.indexes.map(i => i.name)).toEqual(['farmId']);
        expect(db.table('farmMachines').schema.primKey.name).toBe('id');
        expect(db.table('farmMachines').schema.indexes.map(i => i.name)).toEqual(['farmId']);
        expect(db.table('farmPowerTimes').schema.primKey.name).toBe('farmId');
        expect(db.table('plotWater').schema.primKey.name).toBe('plotId');
        expect(db.table('plotWater').schema.indexes.map(i => i.name)).toEqual(['farmId']);
        db.close();
    });

    it('v33 keeps every v32 store', async () => {
        const old = openAtV32();
        await old.open();
        const before = old.tables.map(t => t.name).sort();
        // every v32 store keeps its own keys and indexes, word for word
        const v32Schemas = Object.fromEntries(old.tables.map(t => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map(i => i.src).sort()]]));
        await old.table('farmerProfile').put({ id: 'self', updatedAtMs: 1, profile: { waterResources: [{ id: 'w_1' }] } });
        await old.table('scheduleDayCards').put({ templateId: 't1', contentHash: 'h', fetchedAtUtc: 'x', detail: {} });
        await old.table('mutationQueue').add({ deviceId: 'd', clientRequestId: 'r', clientCommandId: 'r', mutationType: 'x', payload: {}, status: 'PENDING', createdAt: 'x', updatedAt: 'x', retryCount: 0 });
        old.close();

        const db = new AgriLogDatabase(NAME);
        await db.open();
        expect(db.tables.map(t => t.name).sort()).toEqual([...before, ...NEW_STORES].sort());
        for (const t of db.tables.filter(t => !NEW_STORES.includes(t.name))) {
            expect([t.schema.primKey.src, ...t.schema.indexes.map(i => i.src).sort()]).toEqual(v32Schemas[t.name]);
        }
        expect((await db.table('farmerProfile').get('self')).profile.waterResources).toEqual([{ id: 'w_1' }]);
        expect((await db.table('scheduleDayCards').get('t1')).contentHash).toBe('h');
        expect(await db.table('mutationQueue').count()).toBe(1);
        for (const store of NEW_STORES) expect(await db.table(store).count()).toBe(0);
        db.close();
    });
});
