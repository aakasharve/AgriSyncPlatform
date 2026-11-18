// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P, founder D-146 / D-148) - Dexie v29 adds the `schedulePictures` store and
 * takes nothing away: a phone at v28 (lane L8c-1) opens at v29 with every store it had, the new one empty, and its rows survive. (The number
 * itself and the contiguity of the chain are `dexieVersionIntegrity.test.ts`.)
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

const NAME = 'agrisync-v29-test';

/** A database exactly as v28 left it. */
function openAtV28(): Dexie {
    const db = new Dexie(NAME);
    [applyV1, applyV2, applyV3, applyV4, applyV5, applyV6, applyV7, applyV8, applyV9, applyV10, applyV11, applyV12, applyV13, applyV14,
        applyV15, applyV16, applyV17, applyV18, applyV19, applyV20, applyV21, applyV22, applyV23, applyV24, applyV25, applyV26, applyV27, applyV28].forEach(apply => apply(db));
    return db;
}

beforeEach(async () => { await Dexie.delete(NAME); });
afterEach(async () => { await Dexie.delete(NAME); });

describe('Dexie v29 - the pictures of schedule makers', () => {
    it('is the current version and declares the schedulePictures store, keyed by the picture id', () => {
        expect(DATABASE_VERSION).toBe(29);
        const db = new AgriLogDatabase(NAME);
        expect(db.verno).toBe(29);
        const store = db.table('schedulePictures');
        expect(store.schema.primKey.name).toBe('pictureId');
        expect(store.schema.indexes.map(i => i.name)).toEqual(['kind', 'fetchedAt']);
        // v28 (lane L8c-1) keeps its store, unchanged.
        expect(db.table('plannedWork').schema.indexes.map(i => i.name)).toEqual(['farmId', 'status', 'assigneeUserId', 'modifiedAtUtc']);
        db.close();
    });

    it('a v28 phone opens at v29 with every store it had and its rows intact; the new store is empty', async () => {
        const old = openAtV28();
        await old.open();
        const before = old.tables.map(t => t.name).sort();
        expect(before).toContain('plannedWork');
        expect(before).toContain('scheduleSubscriptions');
        expect(before).not.toContain('schedulePictures');
        await old.table('appMeta').put({ key: 'kept', value: 1, updatedAt: 'x' });
        await old.table('plannedWork').put({ id: 'task-1', farmId: 'f', status: 'Open', assigneeUserId: null, modifiedAtUtc: 'x' });
        await old.table('scheduleSubscriptions').put({ id: 'sub-1', farmId: 'f', plotId: 'p', cropCycleId: 'c', state: 'Active' });
        old.close();

        const db = new AgriLogDatabase(NAME);
        await db.open();
        expect(db.verno).toBe(29);
        expect(db.tables.map(t => t.name).sort()).toEqual([...before, 'schedulePictures'].sort());
        expect((await db.appMeta.get('kept'))?.value).toBe(1);
        expect((await db.plannedWork.get('task-1'))?.status).toBe('Open');
        expect((await db.scheduleSubscriptions.get('sub-1'))?.state).toBe('Active');
        expect(await db.schedulePictures.count()).toBe(0);
        db.close();
    });
});
