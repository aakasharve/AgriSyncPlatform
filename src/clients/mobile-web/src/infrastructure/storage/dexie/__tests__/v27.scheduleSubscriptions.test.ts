// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8b-2, founder D-32) - Dexie v27 adds the `scheduleSubscriptions`
 * store and takes nothing away: a phone at v26 (lane IT1c) opens at v27 with every store it had, the new one empty, and its
 * rows survive. (The number itself and the contiguity of the chain are `dexieVersionIntegrity.test.ts`.)
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

const NAME = 'agrisync-v27-test';

/** A database exactly as v26 left it. */
function openAtV26(): Dexie {
    const db = new Dexie(NAME);
    [applyV1, applyV2, applyV3, applyV4, applyV5, applyV6, applyV7, applyV8, applyV9, applyV10, applyV11, applyV12, applyV13, applyV14,
        applyV15, applyV16, applyV17, applyV18, applyV19, applyV20, applyV21, applyV22, applyV23, applyV24, applyV25, applyV26].forEach(apply => apply(db));
    return db;
}

beforeEach(async () => { await Dexie.delete(NAME); });
afterEach(async () => { await Dexie.delete(NAME); });

describe('Dexie v27 - the plot\'s chosen schedule', () => {
    it('is the current version and declares the scheduleSubscriptions store, keyed by id and indexed by plot', () => {
        expect(DATABASE_VERSION).toBe(27);
        const db = new AgriLogDatabase(NAME);
        expect(db.verno).toBe(27);
        const store = db.table('scheduleSubscriptions');
        expect(store.schema.primKey.name).toBe('id');
        expect(store.schema.indexes.map(i => i.name)).toEqual(['farmId', 'plotId', 'cropCycleId', 'state']);
        db.close();
    });

    it('a v26 phone opens at v27 with every store it had and its rows intact; the new store is empty', async () => {
        const old = openAtV26();
        await old.open();
        const before = old.tables.map(t => t.name).sort();
        expect(before).toContain('inputLibrary');
        await old.table('appMeta').put({ key: 'kept', value: 1, updatedAt: 'x' });
        await old.table('inputLibrary').put({ id: 'current', version: 'inputs-2.1', library: {}, updatedAtUtc: 'x' });
        old.close();

        const db = new AgriLogDatabase(NAME);
        await db.open();
        expect(db.verno).toBe(27);
        expect(db.tables.map(t => t.name).sort()).toEqual([...before, 'scheduleSubscriptions'].sort());
        expect((await db.appMeta.get('kept'))?.value).toBe(1);
        expect(await db.table('inputLibrary').get('current')).toBeDefined();
        expect(await db.scheduleSubscriptions.count()).toBe(0);
        db.close();
    });
});
