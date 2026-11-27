/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1d (founder Q-A, 28 Nov: "Save after बरोबर").
 * The FIRST record of a farm on this phone is saved only on "बरोबर". It is the first only when BOTH hold, read from the phone:
 *   - the farm's once-only mark is not set (the same per-farm mark the first record's setup-hub line uses, 1b);
 *   - the phone holds NO record of this farm (a record with no farm on it counts as this farm's: today's auto-save wins).
 * So an installed phone whose farm already has records, but no mark (it never had this build), is past its first (P11).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../types';
import { FIRST_RECORD_OFFER_DONE, FIRST_RECORD_SAVED, firstRecordOfferKey } from '../firstRecord';
import { isFirstRecordOnPhone, markFirstRecordSaved } from '../firstRecordGate';

const FARM = 'farm-1';
const storeLog = async (id: string, farmId?: string) => getDatabase().logs.put({
    id, schemaVersion: 1, date: '2026-11-28', isDeleted: 0,
    log: { id, date: '2026-11-28', meta: farmId ? { farmId } : {} } as unknown as DailyLog,
});
const markOf = async () => (await getDatabase().uiPrefs.get(firstRecordOfferKey(FARM)))?.value;

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});

describe('R1-g 1d — is the record about to be saved this farm\'s FIRST on this phone?', () => {
    it('a new farm: no mark and no record of it on the phone — first', async () => {
        expect(await isFirstRecordOnPhone(FARM)).toBe(true);
    });

    it('P11: an installed phone whose farm already has records, but no mark (it never had this build) — past its first', async () => {
        await storeLog('old-1', FARM);
        expect(await markOf()).toBeUndefined();
        expect(await isFirstRecordOnPhone(FARM)).toBe(false);
    });

    it('the mark set (the first was saved on "बरोबर", or its setup-hub line was answered) — past its first, even with no record', async () => {
        for (const value of [FIRST_RECORD_SAVED, FIRST_RECORD_OFFER_DONE, 'clip-first|T']) {
            await getDatabase().uiPrefs.put({ key: firstRecordOfferKey(FARM), value });
            expect(await isFirstRecordOnPhone(FARM), value).toBe(false);
        }
    });

    it('only ANOTHER farm\'s records on the phone — still this farm\'s first; a record with no farm on it — not (fails to today\'s save)', async () => {
        await storeLog('other-1', 'farm-2');
        expect(await isFirstRecordOnPhone(FARM)).toBe(true);
        await storeLog('nofarm-1');
        expect(await isFirstRecordOnPhone(FARM)).toBe(false);
    });

    it('no farm open: never gated (today\'s auto-save)', async () => {
        expect(await isFirstRecordOnPhone(null)).toBe(false);
        expect(await isFirstRecordOnPhone(undefined)).toBe(false);
    });

    it('"बरोबर" saved it: the mark is set once, and the next record of the farm is not the first', async () => {
        await markFirstRecordSaved(FARM);
        expect(await markOf()).toBe(FIRST_RECORD_SAVED);
        await storeLog('first-1', FARM);
        expect(await isFirstRecordOnPhone(FARM)).toBe(false);
    });

    it('the mark never overwrites a later answer (the setup-hub line already showing or answered)', async () => {
        for (const value of ['clip-first|T', FIRST_RECORD_OFFER_DONE]) {
            await getDatabase().uiPrefs.put({ key: firstRecordOfferKey(FARM), value });
            await markFirstRecordSaved(FARM);
            expect(await markOf(), value).toBe(value);
        }
    });
});
