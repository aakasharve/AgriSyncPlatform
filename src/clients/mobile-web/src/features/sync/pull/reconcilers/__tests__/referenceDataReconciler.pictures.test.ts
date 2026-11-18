// @vitest-environment node
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-P; founder D-146, D-148) - the server's reference-data version hash covers the
 * schedules' content but not their picture fields. A photo added, replaced or removed (the hash unchanged) must still reach the stored schedule list,
 * so a phone that restarts offline keeps the picture on its schedules. Nothing else is rewritten for a picture-only change.
 */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { reconcileReferenceData } from '../referenceDataReconciler';

const NAME = 'agrisync-refdata-pictures-test';
const ID = '3f2a1c9e-5b7d-4e21-8a90-1c2d3e4f5a6b';
const SHA = 'b'.repeat(64);
const SHA2 = 'c'.repeat(64);

const schedule = (extra: Record<string, unknown> = {}) => ({ id: 'tpl-1', name: 'द्राक्ष', cropType: 'grape', totalDays: 120, stages: [], activities: [], ...extra });
const payload = (templates: unknown[], hash = 'H1') => ({ scheduleTemplates: templates, cropTypes: [], activityCategories: [], costCategories: [], referenceDataVersionHash: hash }) as never;

let db: AgriLogDatabase;
beforeEach(async () => { await Dexie.delete(NAME); db = new AgriLogDatabase(NAME); await db.open(); });
afterEach(async () => { db.close(); await Dexie.delete(NAME); });

const stored = async () => (await db.referenceData.get('scheduleTemplates'))!;

describe('the stored schedule list follows the pictures the pull names (the version hash does not)', () => {
    it('the same hash with a picture newly named rewrites ONLY the schedule list; an identical pull rewrites nothing', async () => {
        expect(await reconcileReferenceData(db, payload([schedule()]), 't1')).toBe(true);
        expect((await stored()).updatedAt).toBe('t1');

        // The owner adds his photo: same schedule content, same hash.
        const withPicture = [schedule({ pictureId: ID, pictureSha256: SHA, pictureKind: 'PERSON' })];
        expect(await reconcileReferenceData(db, payload(withPicture), 't2')).toBe(false);
        expect(((await stored()).data as Array<Record<string, unknown>>)[0].pictureId).toBe(ID);
        expect((await stored()).updatedAt).toBe('t2');
        expect((await db.referenceData.get('cropTypes'))!.updatedAt).toBe('t1');

        // The next pull says the same: nothing is written.
        await reconcileReferenceData(db, payload(withPicture), 't3');
        expect((await stored()).updatedAt).toBe('t2');
    });

    it('a replaced picture (new sha) and a removed one (no fields) are carried the same way', async () => {
        await reconcileReferenceData(db, payload([schedule({ pictureId: ID, pictureSha256: SHA, pictureKind: 'PERSON' })]), 't1');
        await reconcileReferenceData(db, payload([schedule({ pictureId: ID, pictureSha256: SHA2, pictureKind: 'PERSON' })]), 't2');
        expect(((await stored()).data as Array<Record<string, unknown>>)[0].pictureSha256).toBe(SHA2);

        await reconcileReferenceData(db, payload([schedule({ pictureId: null, pictureSha256: null, pictureKind: null })]), 't3');
        expect(((await stored()).data as Array<Record<string, unknown>>)[0].pictureSha256).toBeNull();
        expect((await stored()).updatedAt).toBe('t3');
    });

    it('a pull with no pictures at all, on a phone that never had any, writes nothing beyond the first copy', async () => {
        await reconcileReferenceData(db, payload([schedule()]), 't1');
        await reconcileReferenceData(db, payload([schedule()]), 't2');
        expect((await stored()).updatedAt).toBe('t1');
    });

    it('a changed hash still rewrites all four rows, as before', async () => {
        await reconcileReferenceData(db, payload([schedule()], 'H1'), 't1');
        expect(await reconcileReferenceData(db, payload([schedule({ name: 'डाळिंब' })], 'H2'), 't2')).toBe(true);
        expect((await db.referenceData.get('cropTypes'))!.updatedAt).toBe('t2');
    });
});
