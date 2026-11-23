// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3) - Dexie v30 adds `ownScheduleItems` and `ownScheduleItemRevisions` and takes nothing away: a
 * phone at v29 opens at v30 with every store it had, the new ones empty, and its rows (and its queued changes) survive.
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

const NAME = 'agrisync-v30-test';

/** A database exactly as v29 left it. */
function openAtV29(): Dexie {
    const db = new Dexie(NAME);
    [applyV1, applyV2, applyV3, applyV4, applyV5, applyV6, applyV7, applyV8, applyV9, applyV10, applyV11, applyV12, applyV13, applyV14,
        applyV15, applyV16, applyV17, applyV18, applyV19, applyV20, applyV21, applyV22, applyV23, applyV24, applyV25, applyV26, applyV27, applyV28,
        applyV29].forEach(apply => apply(db));
    return db;
}

beforeEach(async () => { await Dexie.delete(NAME); });
afterEach(async () => { await Dexie.delete(NAME); });

describe('Dexie v30 - a plot-season own schedule (server cache)', () => {
    it('is the current version and declares the two stores with their keys', () => {
        expect(DATABASE_VERSION).toBe(30);
        const db = new AgriLogDatabase(NAME);
        expect(db.verno).toBe(30);
        const items = db.table('ownScheduleItems');
        expect(items.schema.primKey.name).toBe('id');
        expect(items.schema.indexes.map(i => i.name)).toEqual(['farmId', 'plotId', 'cropCycleId', '[cropCycleId+taskKey]', 'state']);
        const revisions = db.table('ownScheduleItemRevisions');
        expect(revisions.schema.primKey.name).toBe('id');
        expect(revisions.schema.indexes.map(i => i.name)).toEqual(['itemId', 'farmId', 'cropCycleId', 'atUtc']);
        expect(db.table('schedulePictures').schema.indexes.map(i => i.name)).toEqual(['kind', 'fetchedAt']);
        db.close();
    });

    it('a v29 phone opens at v30 with every store it had and its rows intact; the new stores are empty', async () => {
        const old = openAtV29();
        await old.open();
        const before = old.tables.map(t => t.name).sort();
        expect(before).toContain('schedulePictures');
        expect(before).not.toContain('ownScheduleItems');
        await old.table('appMeta').put({ key: 'kept', value: 1, updatedAt: 'x' });
        await old.table('plannedWork').put({ id: 'task-1', farmId: 'f', status: 'Open', assigneeUserId: null, modifiedAtUtc: 'x' });
        await old.table('mutationQueue').add({ deviceId: 'd', clientRequestId: 'r', clientCommandId: 'r', mutationType: 'x', payload: {}, status: 'PENDING', createdAt: 'x', updatedAt: 'x', retryCount: 0 });
        old.close();

        const db = new AgriLogDatabase(NAME);
        await db.open();
        expect(db.verno).toBe(30);
        expect(db.tables.map(t => t.name).sort()).toEqual([...before, 'ownScheduleItemRevisions', 'ownScheduleItems'].sort());
        expect((await db.appMeta.get('kept'))?.value).toBe(1);
        expect((await db.plannedWork.get('task-1'))?.status).toBe('Open');
        expect(await db.mutationQueue.count()).toBe(1);
        expect(await db.ownScheduleItems.count()).toBe(0);
        expect(await db.ownScheduleItemRevisions.count()).toBe(0);
        db.close();
    });
});
