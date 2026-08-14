// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P0.1 — THE HALF OF THE ISOLATION BOUNDARY `REPRO-A2` DOES NOT ASSERT
 * ====================================================================
 *
 * `REPRO-A2` proves the leak is closed: farmer B, on the same handset, reads
 * none of farmer A's localStorage. That is one of the two properties this
 * change has to hold. The other is that closing it cost farmer A NOTHING —
 * harvest, procurement and finance have no server home, so a containment fix
 * that strands them is data loss wearing containment's clothes.
 *
 * So this file asserts the other direction, plus the two boundaries that have
 * no reproduction of their own:
 *
 *   1. ADOPTION IS A COPY. The incumbent's un-scoped keys are readable under
 *      their own scope afterwards, AND the originals are still physically
 *      present. Nothing is moved, nothing is cleared.
 *   2. RECOVERY. A -> logout -> B -> A returns, with A's every value intact,
 *      including the Dexie row, and B seeing none of it in between.
 *   3. THE DEVICE ID IS NOT FARMER STATE. Both server dedupe layers key on it;
 *      re-minting it per farmer would strand every unsent mutation.
 *   4. ATTACHMENT BYTES follow the same ownership answer as the database, and
 *      an unidentified session gets no bucket at all.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { getDatabase, resetDatabase } from '../DexieDatabase';
import { activateDatabaseForUser } from '../activateUserDatabase';
import { clearAuthSession } from '../AuthTokenStore';
import {
    LEGACY_DATABASE_NAME,
    UNIDENTIFIED_DATABASE_NAME,
    perUserDatabaseName,
} from '../userDatabaseName';
import { getActiveDatabaseName, setActiveDatabaseName } from '../activeDatabaseName';
import { storageNamespace } from '../StorageNamespace';
import {
    adoptUnscopedBusinessKeys,
    scopedKeyFor,
    __resetBusinessKeyAdoptionForTesting,
} from '../businessKeyScope';
import { getOrCreateDeviceId, readDeviceId } from '../DeviceIdStore';
import { SessionStore } from '../SessionStore';
import { readHarvestConfigRaw, writeHarvestConfigRaw, readOtherIncomeRaw, writeOtherIncomeRaw } from '../HarvestLegacyStore';
import { readProcurementExpensesRaw, writeProcurementExpensesRaw } from '../ProcurementLegacyStore';
import { readFinanceSettingsRaw, writeFinanceSettingsRaw } from '../FinanceLegacyStore';
import { readVocabRaw, writeVocabRaw } from '../VocabStore';
import { readInviteStoreRaw, writeInviteStoreRaw } from '../FarmInviteStore';
import {
    LEGACY_LOCAL_FILE_CACHE_NAME,
    ownedLocalFileCacheName,
} from '../../device/localFileCache';

const FARMER_A = 'user-aaaa-1111';
const FARMER_B = 'user-bbbb-2222';
const PLOT = 'plot-7';

async function fullWipe(): Promise<void> {
    await resetDatabase();
    for (const name of [
        LEGACY_DATABASE_NAME,
        UNIDENTIFIED_DATABASE_NAME,
        perUserDatabaseName(FARMER_A),
        perUserDatabaseName(FARMER_B),
    ]) {
        await Dexie.delete(name);
    }
    localStorage.clear();
    storageNamespace.setNamespace('user');
    await resetDatabase();
}

describe('P0.1 — the incumbent keeps everything the isolation boundary takes away from everybody else', () => {
    beforeEach(fullWipe);
    afterEach(fullWipe);

    it('adopts the incumbent\'s un-scoped keys AND leaves the originals in place', () => {
        // A handset as it exists today: business keys with no farmer on them.
        localStorage.setItem('harvest_other_income', '[{"amount":7000}]');
        localStorage.setItem('harvest_config_plot-7', '{"ratePerKg":42}');
        localStorage.setItem('dfes_procurement_expenses', '[{"amount":12345}]');
        localStorage.setItem('finance_settings', '{"gstNumber":"A-GST-27"}');
        localStorage.setItem('agrilog_vocab_db_v2', '{"mappings":{}}');
        localStorage.setItem('agrisync_active_user_id_v1', FARMER_A);

        activateDatabaseForUser(FARMER_A);

        for (const key of [
            'harvest_other_income', 'harvest_config_plot-7', 'dfes_procurement_expenses',
            'finance_settings', 'agrilog_vocab_db_v2',
        ]) {
            // The incumbent can read it under their own scope...
            expect(localStorage.getItem(scopedKeyFor(key, FARMER_A))).toBe(
                localStorage.getItem(key)
            );
            // ...and the original is STILL THERE. Not moved. Not cleared.
            expect(localStorage.getItem(key)).not.toBeNull();
        }
    });

    it('reads the incumbent\'s existing values back through the ordinary stores', () => {
        localStorage.setItem('harvest_other_income', '[{"amount":7000}]');
        localStorage.setItem('harvest_config_plot-7', '{"ratePerKg":42}');
        localStorage.setItem('dfes_procurement_expenses', '[{"amount":12345}]');
        localStorage.setItem('finance_settings', '{"gstNumber":"A-GST-27"}');
        localStorage.setItem('agrilog_vocab_db_v2', '{"mappings":{"भात":"rice"}}');
        localStorage.setItem('agrisync_active_user_id_v1', FARMER_A);

        activateDatabaseForUser(FARMER_A);

        // This is the test that would have caught a "scope the keys and move
        // on" change: every one of these reads a NEW key and must still answer.
        expect(readOtherIncomeRaw()).toBe('[{"amount":7000}]');
        expect(readHarvestConfigRaw(PLOT)).toBe('{"ratePerKg":42}');
        expect(readProcurementExpensesRaw()).toBe('[{"amount":12345}]');
        expect(readFinanceSettingsRaw()).toBe('{"gstNumber":"A-GST-27"}');
        expect(readVocabRaw()).toBe('{"mappings":{"भात":"rice"}}');
    });

    it('adopts once per device — a later farmer does not inherit the incumbent\'s keys', () => {
        localStorage.setItem('finance_settings', '{"gstNumber":"A-GST-27"}');
        localStorage.setItem('agrisync_active_user_id_v1', FARMER_A);

        activateDatabaseForUser(FARMER_A);
        activateDatabaseForUser(FARMER_B);

        expect(localStorage.getItem(scopedKeyFor('finance_settings', FARMER_B))).toBeNull();
        expect(readFinanceSettingsRaw()).toBeNull();
        // Re-arming the flag must not copy into whoever is active now either —
        // the adoption takes an explicit owner, it never guesses "current".
        __resetBusinessKeyAdoptionForTesting();
        adoptUnscopedBusinessKeys(FARMER_A);
        expect(localStorage.getItem(scopedKeyFor('finance_settings', FARMER_B))).toBeNull();
    });

    it('never overwrites a value the farmer already has under their own scope', () => {
        localStorage.setItem('finance_settings', '{"gstNumber":"OLD"}');
        localStorage.setItem(scopedKeyFor('finance_settings', FARMER_A), '{"gstNumber":"NEW"}');
        localStorage.setItem('agrisync_active_user_id_v1', FARMER_A);

        activateDatabaseForUser(FARMER_A);

        expect(readFinanceSettingsRaw()).toBe('{"gstNumber":"NEW"}');
    });

    it('leaves the device id alone — it is device state, and the queue keys on it', () => {
        const deviceId = getOrCreateDeviceId();

        activateDatabaseForUser(FARMER_A);
        expect(readDeviceId()).toBe(deviceId);
        activateDatabaseForUser(FARMER_B);
        expect(readDeviceId()).toBe(deviceId);
        clearAuthSession();
        expect(readDeviceId()).toBe(deviceId);
        // ...and it is reachable under its own literal key, never a scoped one.
        expect(localStorage.getItem('agrisync_device_id_v1')).toBe(deviceId);
    });
});

describe('P0.1 — A records, logs out, B signs in, A comes back', () => {
    beforeEach(fullWipe);
    afterEach(fullWipe);

    it('shows B nothing of A\'s, and gives A every bit of it back', async () => {
        // --- farmer A works -------------------------------------------------
        activateDatabaseForUser(FARMER_A);
        writeOtherIncomeRaw('[{"amount":7000,"owner":"A"}]');
        writeHarvestConfigRaw(PLOT, '{"ratePerKg":42,"owner":"A"}');
        writeProcurementExpensesRaw('[{"amount":12345,"owner":"A"}]');
        writeFinanceSettingsRaw('{"gstNumber":"A-GST-27"}');
        writeVocabRaw('{"mappings":{"भात":"rice"}}');
        writeInviteStoreRaw('{"code":"A-INVITE"}');
        SessionStore.setCurrentFarmId('farm-belonging-to-A');
        await getDatabase().appMeta.put({
            key: 'a_private_marker', value: 'FARMER_A_PRIVATE_PAYLOAD',
            updatedAt: '2026-08-15T00:00:00.000Z',
        });
        const aDatabase = getActiveDatabaseName();

        // --- A logs out -----------------------------------------------------
        // The real teardown every logout path goes through.
        clearAuthSession();
        expect(getActiveDatabaseName()).toBe(UNIDENTIFIED_DATABASE_NAME);
        expect(SessionStore.getCurrentFarmId()).toBeNull();

        // --- farmer B signs in ----------------------------------------------
        activateDatabaseForUser(FARMER_B);

        expect(readOtherIncomeRaw()).toBeNull();
        expect(readHarvestConfigRaw(PLOT)).toBeNull();
        expect(readProcurementExpensesRaw()).toBeNull();
        expect(readFinanceSettingsRaw()).toBeNull();
        expect(readVocabRaw()).toBeNull();
        expect(readInviteStoreRaw()).toBeNull();
        expect(SessionStore.getCurrentFarmId()).toBeNull();
        expect(getActiveDatabaseName()).not.toBe(aDatabase);
        await expect(getDatabase().appMeta.get('a_private_marker')).resolves.toBeUndefined();

        // --- A comes back ---------------------------------------------------
        clearAuthSession();
        activateDatabaseForUser(FARMER_A);

        expect(readOtherIncomeRaw()).toBe('[{"amount":7000,"owner":"A"}]');
        expect(readHarvestConfigRaw(PLOT)).toBe('{"ratePerKg":42,"owner":"A"}');
        expect(readProcurementExpensesRaw()).toBe('[{"amount":12345,"owner":"A"}]');
        expect(readFinanceSettingsRaw()).toBe('{"gstNumber":"A-GST-27"}');
        expect(readVocabRaw()).toBe('{"mappings":{"भात":"rice"}}');
        expect(readInviteStoreRaw()).toBe('{"code":"A-INVITE"}');
        expect(getActiveDatabaseName()).toBe(aDatabase);
        await expect(
            getDatabase().appMeta.get('a_private_marker').then(row => row?.value)
        ).resolves.toBe('FARMER_A_PRIVATE_PAYLOAD');
        // The farm pointer is the ONE thing that does not come back, on
        // purpose: it is session context, and a record stamped with a farm the
        // farmer has not re-chosen is filed under a guess.
        expect(SessionStore.getCurrentFarmId()).toBeNull();
    });
});

describe('P0.1 — attachment bytes belong to whoever the database belongs to', () => {
    beforeEach(fullWipe);
    afterEach(fullWipe);

    it('gives the incumbent the bucket their photos are already in', () => {
        localStorage.setItem('agrisync_active_user_id_v1', FARMER_A);
        activateDatabaseForUser(FARMER_A);

        expect(getActiveDatabaseName()).toBe(LEGACY_DATABASE_NAME);
        // Not a new bucket: the SAME one, so no existing attachment is orphaned
        // and nothing has to be copied to keep the incumbent's media readable.
        expect(ownedLocalFileCacheName()).toBe(LEGACY_LOCAL_FILE_CACHE_NAME);
    });

    it('gives a second farmer a bucket of their own, and no way into the first', () => {
        localStorage.setItem('agrisync_active_user_id_v1', FARMER_A);
        activateDatabaseForUser(FARMER_A);
        const incumbentBucket = ownedLocalFileCacheName();

        activateDatabaseForUser(FARMER_B);
        const secondBucket = ownedLocalFileCacheName();

        expect(secondBucket).not.toBe(incumbentBucket);
        expect(secondBucket).toContain(perUserDatabaseName(FARMER_B));
    });

    it('gives an unidentified session no bucket at all', () => {
        expect(getActiveDatabaseName()).toBe(UNIDENTIFIED_DATABASE_NAME);
        expect(ownedLocalFileCacheName()).toBeNull();

        // ...including immediately after a session ends.
        activateDatabaseForUser(FARMER_A);
        expect(ownedLocalFileCacheName()).not.toBeNull();
        clearAuthSession();
        expect(ownedLocalFileCacheName()).toBeNull();

        // And the shared bucket is quarantined, not deleted: its name is still
        // the name the incumbent's rows point at.
        setActiveDatabaseName(LEGACY_DATABASE_NAME);
        expect(ownedLocalFileCacheName()).toBe(LEGACY_LOCAL_FILE_CACHE_NAME);
    });
});
