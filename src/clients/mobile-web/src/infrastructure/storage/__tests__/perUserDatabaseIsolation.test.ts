// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE DATA-LOSS DEFECT, AND THE SEVEN THINGS THAT MUST BE TRUE INSTEAD
 * ===================================================================
 *
 * `DataSourceProvider.resetAuthenticatedUserCacheIfNeeded` cleared 21 Dexie
 * tables whenever the signed-in user id changed. A farmer's `PENDING`
 * mutations — work captured offline, never sent — were deleted along with the
 * `db.logs` rows they described, because somebody else signed in on the same
 * handset. Founder ruling: "nothing should get erased by such silly things
 * practically happening things."
 *
 * Every test below is a guard on one of the seven required proofs. If one of
 * them goes green while the wipe is back, it is not doing its job — each was
 * confirmed to FAIL against a restored `db.<table>.clear()` before shipping.
 *
 * WHY THESE TESTS SEED TWENTY-ONE TABLES AND NOT JUST THE QUEUE
 * ------------------------------------------------------------
 * "The queue survived" is not the property. The property is that a second
 * farmer's session cannot READ the first farmer's rows — in any table. A queue
 * row whose `db.logs` parent had been deleted would be unsendable anyway, and
 * a leak through `db.farms` is a leak. So the fixtures write one row into every
 * table the old wipe emptied, and the assertions count every one of them.
 */

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    getDatabase,
    resetDatabase,
    type AgriLogDatabase,
    type DexieLogRecord,
} from '../DexieDatabase';
import { activateDatabaseForUser } from '../activateUserDatabase';
import {
    LEGACY_DATABASE_NAME,
    UNIDENTIFIED_DATABASE_NAME,
    getLegacyDatabaseOwner,
    resolveActiveDatabaseName,
} from '../userDatabaseName';
import { getActiveDatabaseName, setActiveDatabaseName } from '../activeDatabaseName';
import { DemoModeStore } from '../DemoModeStore';
import { storageNamespace } from '../StorageNamespace';
import { MigrationService } from '../MigrationService';
import {
    runLegacyLocalStorageMigration,
    __resetLegacyMigrationFlagForTesting,
} from '../LegacyLocalStorageMigrator';
import { STORAGE_KEYS } from '../schema';
import type { DailyLog } from '../../../types';

const FARMER_A = 'user-aaaa-1111';
const FARMER_B = 'user-bbbb-2222';
const DB_FOR_B = `AgriLogDB_u_${encodeURIComponent(FARMER_B)}`;
const FROZEN_NOW = '2026-08-12T09:00:00.000Z';

/**
 * The 21 tables `resetAuthenticatedUserCacheIfNeeded` used to clear, in the
 * order that function listed them. Hard-coded rather than derived from the
 * database object so that a future table added to the schema cannot silently
 * widen or narrow what this file claims to have proved.
 */
const WIPED_TABLES = [
    'logs', 'outbox', 'mutationQueue', 'attachments', 'uploadQueue',
    'pendingAiJobs', 'voiceClips', 'aiCorrectionEvents', 'auditEvents',
    'syncCursors', 'appMeta', 'referenceData', 'dayLedgers', 'plannedTasks',
    'farms', 'plots', 'cropCycles', 'costEntries', 'financeCorrections',
    'crops', 'farmerProfile',
] as const;

type WipedTable = (typeof WIPED_TABLES)[number];

/**
 * One row in every wiped table, tagged with `owner` so a leak is not merely
 * countable but attributable — a test that only counted rows would pass if
 * user B's own seed happened to be the same size as user A's.
 *
 * `log` is cast rather than built through `LogFactory`: nothing here reads a
 * single field of it, and a storage-isolation fixture has no business
 * depending on the shape of a domain object.
 */
async function seedEveryTable(db: AgriLogDatabase, owner: string): Promise<void> {
    const logRecord: DexieLogRecord = {
        id: `log-${owner}`,
        schemaVersion: 2,
        log: { id: `log-${owner}`, date: '2026-08-12', owner } as unknown as DailyLog,
        date: '2026-08-12',
        isDeleted: 0,
    };

    await db.logs.put(logRecord);
    await db.outbox.add({
        idempotencyKey: `log-${owner}_CREATE_LOG_1`,
        action: 'CREATE_LOG',
        resourceId: `log-${owner}`,
        payload: { owner },
        status: 'PENDING',
        createdAt: FROZEN_NOW,
        retryCount: 0,
    });
    await db.mutationQueue.add({
        deviceId: 'device-1',
        clientRequestId: `req-${owner}`,
        clientCommandId: `cmd-${owner}`,
        mutationType: 'CreateDailyLog',
        // The parent pointer proof 6 follows across the boundary.
        payload: { logId: `log-${owner}`, owner },
        status: 'PENDING',
        createdAt: FROZEN_NOW,
        updatedAt: FROZEN_NOW,
        retryCount: 0,
    });
    await db.attachments.put({
        id: `att-${owner}`, farmId: `farm-${owner}`, localPath: '/tmp/a.jpg',
        originalFileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1,
        status: 'pending', createdAt: FROZEN_NOW, updatedAt: FROZEN_NOW, retryCount: 0,
    });
    await db.uploadQueue.add({
        attachmentId: `att-${owner}`, status: 'pending', retryCount: 0,
        createdAt: FROZEN_NOW, updatedAt: FROZEN_NOW,
    });
    await db.pendingAiJobs.add({
        operationType: 'voice_parse', context: { userId: owner }, status: 'pending',
        createdAt: FROZEN_NOW, updatedAt: FROZEN_NOW, retryCount: 0,
    });
    await db.voiceClips.put({
        id: `clip-${owner}`, farmId: `farm-${owner}`, recordedAtUtc: FROZEN_NOW,
        mimeType: 'audio/webm', sizeBytes: 1, status: 'recorded',
        retentionPolicy: 'processing_30d', expiresAtUtc: FROZEN_NOW,
        createdAt: FROZEN_NOW, updatedAt: FROZEN_NOW,
    });
    await db.aiCorrectionEvents.put({
        id: `corr-${owner}`, extractionId: `ext-${owner}`, timestamp: FROZEN_NOW,
        correctionType: 'field_edit', fieldPath: 'quantity',
    } as unknown as Parameters<typeof db.aiCorrectionEvents.put>[0]);
    await db.auditEvents.put({
        id: `audit-${owner}`, timestamp: FROZEN_NOW, actorId: owner,
        action: 'CREATE_LOG', resourceId: `log-${owner}`, details: 'seed',
    });
    await db.syncCursors.put({ tableName: `cursor-${owner}`, lastSyncAt: FROZEN_NOW, version: 1 });
    await db.appMeta.put({ key: `meta-${owner}`, value: owner, updatedAt: FROZEN_NOW });
    await db.referenceData.put({
        key: 'cropTypes', data: [owner], versionHash: owner, updatedAt: FROZEN_NOW,
    });
    await db.dayLedgers.put({
        id: `ledger-${owner}`, farmId: `farm-${owner}`, dateKey: '2026-08-12',
        payload: { owner }, updatedAt: FROZEN_NOW,
    });
    await db.plannedTasks.put({
        id: `task-${owner}`, cropCycleId: `cycle-${owner}`, plannedDate: '2026-08-12',
        payload: { owner }, updatedAt: FROZEN_NOW,
    });
    await db.farms.put({ id: `farm-${owner}`, payload: { owner }, updatedAt: FROZEN_NOW });
    await db.plots.put({
        id: `plot-${owner}`, farmId: `farm-${owner}`, payload: { owner }, updatedAt: FROZEN_NOW,
    });
    await db.cropCycles.put({
        id: `cycle-${owner}`, farmId: `farm-${owner}`, plotId: `plot-${owner}`,
        payload: { owner }, updatedAt: FROZEN_NOW,
    });
    await db.costEntries.put({
        id: `cost-${owner}`, farmId: `farm-${owner}`, payload: { owner }, updatedAt: FROZEN_NOW,
    });
    await db.financeCorrections.put({
        id: `fix-${owner}`, costEntryId: `cost-${owner}`, payload: { owner }, updatedAt: FROZEN_NOW,
    });
    await db.crops.put({ id: `crop-${owner}`, data: { owner }, updatedAtMs: 1 });
    await db.farmerProfile.put({ id: 'self', data: { owner }, updatedAtMs: 1 });
}

/** Row count per wiped table, so an assertion can name the table that leaked. */
async function countEveryTable(db: AgriLogDatabase): Promise<Record<WipedTable, number>> {
    const counts = {} as Record<WipedTable, number>;
    for (const table of WIPED_TABLES) {
        counts[table] = await db.table(table).count();
    }
    return counts;
}

/**
 * P0.1 — ONE EXTRA `appMeta` ROW, AND WHY IT IS NOT A LEAK
 * ---------------------------------------------------------
 * The ownership claim (`appMeta.owner_user_id`) now lives INSIDE the database
 * it describes, written by `activateDatabaseForUser`. So every database a
 * farmer has activated holds exactly one `appMeta` row more than this fixture
 * seeded into it. That row is the app's own, not a farmer's record, and it
 * names the farmer who is looking at it — `theOwnershipClaimNames` below
 * asserts that, which is a stronger statement than the count it replaces.
 *
 * This does NOT weaken the wipe guard. If `resetAuthenticatedUserCacheIfNeeded`
 * came back, `appMeta` would read 0 where these expect 1 or 2, and every proof
 * still fails.
 */
const OWNERSHIP_CLAIM_ROWS = 1;

function expectedCounts(seededPerTable: number): Record<WipedTable, number> {
    return Object.fromEntries(WIPED_TABLES.map(t => [
        t,
        t === 'appMeta' ? seededPerTable + OWNERSHIP_CLAIM_ROWS : seededPerTable,
    ])) as Record<WipedTable, number>;
}

/** No seeded rows — only the claim written by the activation under test. */
const ALL_EMPTY: Record<WipedTable, number> = expectedCounts(0);
/** One seeded row per table, plus the claim. */
const ALL_ONE: Record<WipedTable, number> = expectedCounts(1);

/** The claim inside the currently-open database, or null if there is none. */
async function theOwnershipClaimNames(db: AgriLogDatabase): Promise<unknown> {
    return (await db.appMeta.get('owner_user_id'))?.value ?? null;
}

async function wipeEverything(): Promise<void> {
    await resetDatabase();
    for (const name of [LEGACY_DATABASE_NAME, DB_FOR_B, `AgriLogDB_u_${encodeURIComponent(FARMER_A)}`]) {
        await Dexie.delete(name);
    }
    localStorage.clear();
    storageNamespace.setNamespace('user');
    await resetDatabase();
}

describe('per-farmer databases — a second farmer signing in erases nothing', () => {
    beforeEach(wipeEverything);
    afterEach(wipeEverything);

    it('PROOF 1: farmer A\'s offline records survive farmer B signing in, still PENDING', async () => {
        activateDatabaseForUser(FARMER_A);
        await seedEveryTable(getDatabase(), FARMER_A);

        // Farmer B signs in on the same handset. This is the exact event that
        // used to run `db.mutationQueue.clear()` and 20 siblings.
        activateDatabaseForUser(FARMER_B);

        const aDb = new Dexie(LEGACY_DATABASE_NAME) as unknown as AgriLogDatabase;
        await (aDb as unknown as Dexie).open();
        const queued = await (aDb as unknown as Dexie).table('mutationQueue').toArray();
        expect(queued).toHaveLength(1);
        expect(queued[0].status).toBe('PENDING');
        expect(queued[0].payload).toMatchObject({ owner: FARMER_A });
        (aDb as unknown as Dexie).close();
    });

    it('PROOF 2: farmer B sees none of farmer A\'s rows — asserted table by table', async () => {
        activateDatabaseForUser(FARMER_A);
        await seedEveryTable(getDatabase(), FARMER_A);
        expect(await countEveryTable(getDatabase())).toEqual(ALL_ONE);

        activateDatabaseForUser(FARMER_B);

        // Not "the queue is empty" — every one of the 21 tables the wipe used
        // to clear is empty for B, because B is not looking at A's database.
        expect(getActiveDatabaseName()).toBe(DB_FOR_B);
        expect(await countEveryTable(getDatabase())).toEqual(ALL_EMPTY);
        // ...and the single `appMeta` row B can see is B's own claim, not A's.
        expect(await theOwnershipClaimNames(getDatabase())).toBe(FARMER_B);
    });

    it('PROOF 2b: what B writes stays out of A\'s database, in both directions', async () => {
        activateDatabaseForUser(FARMER_A);
        await seedEveryTable(getDatabase(), FARMER_A);

        activateDatabaseForUser(FARMER_B);
        await seedEveryTable(getDatabase(), FARMER_B);
        expect(await countEveryTable(getDatabase())).toEqual(ALL_ONE);
        expect((await getDatabase().logs.toArray()).map(r => r.id)).toEqual([`log-${FARMER_B}`]);

        activateDatabaseForUser(FARMER_A);
        expect((await getDatabase().logs.toArray()).map(r => r.id)).toEqual([`log-${FARMER_A}`]);
        expect(await countEveryTable(getDatabase())).toEqual(ALL_ONE);
    });

    it('PROOF 3: farmer A signs back in and their records are there, and still sendable', async () => {
        activateDatabaseForUser(FARMER_A);
        await seedEveryTable(getDatabase(), FARMER_A);

        activateDatabaseForUser(FARMER_B);
        activateDatabaseForUser(FARMER_A);

        expect(await countEveryTable(getDatabase())).toEqual(ALL_ONE);

        // "Sendable" is not "present": the row must still be in the state the
        // sync worker picks up, with its retry budget untouched.
        const pending = await getDatabase().mutationQueue.where('status').equals('PENDING').toArray();
        expect(pending).toHaveLength(1);
        expect(pending[0].retryCount).toBe(0);
        expect(pending[0].clientRequestId).toBe(`req-${FARMER_A}`);
    });

    it('PROOF 4: the same farmer logging out and back in changes nothing', async () => {
        activateDatabaseForUser(FARMER_A);
        await seedEveryTable(getDatabase(), FARMER_A);

        // Logout leaves `agrisync_active_user_id_v1` in place (it always did —
        // there is no production `localStorage.clear()`), so signing back in is
        // the no-change case the old code also declined to wipe.
        const again = activateDatabaseForUser(FARMER_A);

        expect(again.switched).toBe(false);
        expect(again.databaseName).toBe(LEGACY_DATABASE_NAME);
        expect(await countEveryTable(getDatabase())).toEqual(ALL_ONE);
    });

    it('PROOF 6: no queue row is ever separated from its log — the pair moves together', async () => {
        activateDatabaseForUser(FARMER_A);
        await seedEveryTable(getDatabase(), FARMER_A);
        activateDatabaseForUser(FARMER_B);
        await seedEveryTable(getDatabase(), FARMER_B);

        // For each farmer, every queued mutation's parent log is in the SAME
        // database. An orphan here would mean a record queued for sending whose
        // content lives somewhere the sender cannot read.
        for (const farmer of [FARMER_A, FARMER_B]) {
            activateDatabaseForUser(farmer);
            const db = getDatabase();
            const rows = await db.mutationQueue.toArray();
            expect(rows).toHaveLength(1);
            for (const row of rows) {
                const { logId } = row.payload as { logId: string };
                expect(logId).toBe(`log-${farmer}`);
                await expect(db.logs.get(logId)).resolves.toBeDefined();
            }
            // ...and the other farmer's log is not reachable from here.
            const other = farmer === FARMER_A ? FARMER_B : FARMER_A;
            await expect(db.logs.get(`log-${other}`)).resolves.toBeUndefined();
        }
    });
});

describe('the upgrade path — an existing AgriLogDB is adopted, never orphaned', () => {
    beforeEach(wipeEverything);
    afterEach(wipeEverything);

    it('PROOF 5: rows written before this change are still reachable afterwards', async () => {
        // An install as it exists today: data in `AgriLogDB`, an active user id
        // written by the old provider, and no notion of per-farmer routing.
        //
        // P0.1: the old build reached `AgriLogDB` by simply booting; this one
        // never does, so the fixture names the database the old build wrote to
        // instead of relying on an unidentified boot to land there.
        setActiveDatabaseName(LEGACY_DATABASE_NAME);
        await seedEveryTable(getDatabase(), FARMER_A);
        DemoModeStore.setActiveUserId(FARMER_A);
        expect(getLegacyDatabaseOwner()).toBeNull();

        // First boot on the new code.
        const activation = activateDatabaseForUser(FARMER_A);

        expect(activation.databaseName).toBe(LEGACY_DATABASE_NAME);
        expect(activation.switched).toBe(false);
        expect(getLegacyDatabaseOwner()).toBe(FARMER_A);
        // Nothing was copied, exported or re-keyed — the same database, same
        // name, same rows.
        expect(await countEveryTable(getDatabase())).toEqual(ALL_ONE);
    });

    it('PROOF 5b: a DIFFERENT farmer booting first still cannot strand the owner\'s data', async () => {
        // Same pre-existing install as PROOF 5 (see the note there on why the
        // database is named rather than booted into).
        setActiveDatabaseName(LEGACY_DATABASE_NAME);
        await seedEveryTable(getDatabase(), FARMER_A);
        DemoModeStore.setActiveUserId(FARMER_A);

        // The riskiest ordering: the new code's first run is farmer B's login,
        // which is precisely the moment the old code destroyed everything.
        const bActivation = activateDatabaseForUser(FARMER_B);

        expect(bActivation.databaseName).toBe(DB_FOR_B);
        // The adoption went to the id the handset was already carrying, not to
        // whoever happened to sign in first after the upgrade.
        expect(getLegacyDatabaseOwner()).toBe(FARMER_A);
        expect(await countEveryTable(getDatabase())).toEqual(ALL_EMPTY);

        activateDatabaseForUser(FARMER_A);
        expect(getActiveDatabaseName()).toBe(LEGACY_DATABASE_NAME);
        expect(await countEveryTable(getDatabase())).toEqual(ALL_ONE);
    });

    it('PROOF 5c: on a handset no one has signed into, the data is adopted, not deleted', async () => {
        // An install whose active-user id never got written — an older build
        // that wrote into `AgriLogDB` without recording whose it was. The old
        // code treated `null -> someone` as a user CHANGE and wiped. There is
        // no other claimant, so the farmer signing in adopts it.
        //
        // P0.1: "pre-auth capture" is no longer one of the ways rows get here.
        // An unidentified session cannot open `AgriLogDB` at all, so this
        // fixture names it directly.
        setActiveDatabaseName(LEGACY_DATABASE_NAME);
        await seedEveryTable(getDatabase(), 'anonymous');
        expect(DemoModeStore.getActiveUserId()).toBeNull();

        const activation = activateDatabaseForUser(FARMER_B);

        expect(activation.databaseName).toBe(LEGACY_DATABASE_NAME);
        expect(getLegacyDatabaseOwner()).toBe(FARMER_B);
        expect(await countEveryTable(getDatabase())).toEqual(ALL_ONE);
    });

    it('the adoption is recorded once and cannot be re-answered later', async () => {
        DemoModeStore.setActiveUserId(FARMER_A);
        activateDatabaseForUser(FARMER_B);
        expect(getLegacyDatabaseOwner()).toBe(FARMER_A);

        // Repeated switching must never re-open the question — a second answer
        // would hand one farmer's database to another.
        activateDatabaseForUser(FARMER_A);
        activateDatabaseForUser(FARMER_B);
        activateDatabaseForUser(FARMER_A);
        expect(getLegacyDatabaseOwner()).toBe(FARMER_A);
    });

    it('two farmers can never be folded onto one database name', () => {
        DemoModeStore.setActiveUserId(FARMER_A);
        const a = activateDatabaseForUser(FARMER_A).databaseName;
        const b = activateDatabaseForUser(FARMER_B).databaseName;
        const c = activateDatabaseForUser('user/bbbb 2222').databaseName;

        expect(new Set([a, b, c]).size).toBe(3);
    });
});

/**
 * P0.1 — TWO ANCHORS IN THIS BLOCK DELIBERATELY FLIPPED
 * -----------------------------------------------------
 * They asserted the fail-open the founder ruling closes: that a boot with no
 * established identity lands on `AgriLogDB`. Both were correct descriptions of
 * the old behaviour and are now assertions of the OPPOSITE property — an
 * unidentified session reaches no farmer's database — because "AgriLogDB" and
 * "the previous active user" are both named forbidden fallbacks. A green run of
 * the old wording would now mean the leak is back.
 */
describe('an unidentified boot reaches no farmer\'s database, and demo mode moves nothing', () => {
    beforeEach(wipeEverything);
    afterEach(wipeEverything);

    it('a device that has never routed per farmer opens nobody\'s database', () => {
        expect(getLegacyDatabaseOwner()).toBeNull();
        expect(resolveActiveDatabaseName()).toBe(UNIDENTIFIED_DATABASE_NAME);
        expect(getActiveDatabaseName()).toBe(UNIDENTIFIED_DATABASE_NAME);
        expect(getDatabase().name).toBe(UNIDENTIFIED_DATABASE_NAME);
    });

    it('an active user id alone does NOT re-open that farmer\'s database', async () => {
        // The handset remembers who used it last. That is not authentication,
        // and the ruling names "the previous active user" as a forbidden
        // fallback: nobody is signed in, so nobody's database opens.
        DemoModeStore.setActiveUserId(FARMER_B);
        await resetDatabase();

        expect(resolveActiveDatabaseName()).toBe(UNIDENTIFIED_DATABASE_NAME);
        expect(getDatabase().name).toBe(UNIDENTIFIED_DATABASE_NAME);

        // ...and the moment that same farmer authenticates, they get theirs.
        activateDatabaseForUser(FARMER_B);
        expect(getActiveDatabaseName()).toBe(LEGACY_DATABASE_NAME);
    });

    it('PROOF 7: demo mode neither moves the database nor is moved by it', async () => {
        activateDatabaseForUser(FARMER_A);
        await seedEveryTable(getDatabase(), FARMER_A);

        // Demo mode is a localStorage-namespace and seeding concern; it never
        // decided which Dexie database was open and still does not.
        storageNamespace.setNamespace('demo');
        expect(getActiveDatabaseName()).toBe(LEGACY_DATABASE_NAME);
        // The boot-time answer is the unidentified boundary in BOTH namespaces
        // — demo mode does not change which database an unidentified session
        // may open, which is the same property this line always asserted.
        expect(resolveActiveDatabaseName()).toBe(UNIDENTIFIED_DATABASE_NAME);
        expect(await countEveryTable(getDatabase())).toEqual(ALL_ONE);

        storageNamespace.setNamespace('user');
        expect(getActiveDatabaseName()).toBe(LEGACY_DATABASE_NAME);
    });

    it('PROOF 7b: demo mode on a second farmer\'s handset stays inside that farmer\'s database', async () => {
        DemoModeStore.setActiveUserId(FARMER_A);
        activateDatabaseForUser(FARMER_B);

        storageNamespace.setNamespace('demo');
        // Demo seeding writes `crops`; it must land in B's database, not in the
        // one B is not allowed to touch.
        await getDatabase().crops.put({ id: 'crop_demo', data: {}, updatedAtMs: 1 });

        expect(getActiveDatabaseName()).toBe(DB_FOR_B);
        setActiveDatabaseName(LEGACY_DATABASE_NAME);
        expect(await getDatabase().crops.count()).toBe(0);
    });
});

describe('localStorage imports cannot cross into a second farmer\'s database', () => {
    beforeEach(wipeEverything);
    afterEach(wipeEverything);

    it('MigrationService will not pour one handset\'s legacy logs into farmer B', async () => {
        // These localStorage logs pre-date per-farmer databases: they belong to
        // whoever adopted AgriLogDB. `MigrationService`'s "already done" marker
        // lives in Dexie `appMeta`, which is per-database now — so without a
        // guard B's empty database would look un-migrated and import them.
        localStorage.setItem(
            STORAGE_KEYS.LOGS,
            JSON.stringify([{ id: 'legacy-log-1', date: '2026-08-01' }])
        );
        DemoModeStore.setActiveUserId(FARMER_A);
        activateDatabaseForUser(FARMER_B);

        const result = await MigrationService.migrate();

        expect(result.logsMigrated).toBe(0);
        expect(await getDatabase().logs.count()).toBe(0);
        // And the marker was NOT written, so the owner is still owed the import.
        expect(await getDatabase().appMeta.get('dexie_migration_complete')).toBeUndefined();
    });

    it('...and still imports them for the farmer who owns that database', async () => {
        localStorage.setItem(
            STORAGE_KEYS.LOGS,
            JSON.stringify([{ id: 'legacy-log-1', date: '2026-08-01' }])
        );
        DemoModeStore.setActiveUserId(FARMER_A);
        activateDatabaseForUser(FARMER_B);
        await MigrationService.migrate();

        activateDatabaseForUser(FARMER_A);
        const result = await MigrationService.migrate();

        expect(result.success).toBe(true);
        await expect(getDatabase().logs.get('legacy-log-1')).resolves.toBeDefined();
    });

    it('the legacy crops/profile import is skipped for B without consuming its one shot', async () => {
        __resetLegacyMigrationFlagForTesting();
        localStorage.setItem('crops', JSON.stringify([{ id: 'crop_grapes' }]));
        DemoModeStore.setActiveUserId(FARMER_A);
        activateDatabaseForUser(FARMER_B);

        expect((await runLegacyLocalStorageMigration()).skipped).toBe(true);
        expect(await getDatabase().crops.count()).toBe(0);

        // The flag was not burned, so the owner's import still happens.
        activateDatabaseForUser(FARMER_A);
        expect((await runLegacyLocalStorageMigration()).cropsImported).toBe(1);
        await expect(getDatabase().crops.get('crop_grapes')).resolves.toBeDefined();
    });
});
