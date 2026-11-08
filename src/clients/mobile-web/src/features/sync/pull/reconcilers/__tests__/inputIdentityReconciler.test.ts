// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 2; founders D-92 / D-95, doctrine P7, P10) - his हो / नाही / फोटो
 * answers, from the pull onto the record they are about. An overlay: nothing else on the record changes, the record's own pull
 * keeps what the phone holds, an answer made on this phone and not yet acknowledged is neither lost nor doubled.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VersionRegistry } from '../../../../../core/contracts/VersionRegistry';
import type { DailyLog, InputIdentityAnswer } from '../../../../../domain/types/log.types';
import type { DailyLogDto, InputIdentityAssertionDto, SyncPullResponse } from '../../../../../infrastructure/api/dtos';
import { getDatabase, resetDatabase, type AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { readPendingLogIds } from '../../internal/pendingMutations';
import { reconcileInputIdentityAnswers, mergeInputIdentities } from '../inputIdentityReconciler';
import { reconcileLogs } from '../logsReconciler';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';

const LOG = 'c3c3c3c3-0000-4000-8000-000000000003';
const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';

const dto = (over: Partial<InputIdentityAssertionDto> = {}): InputIdentityAssertionDto => ({
    assertionId: 'as-1', farmId: FARM, dailyLogId: LOG, inputEventId: 'ev-1', mixIndex: 0, spokenName: 'कॉन्फिडॉर',
    catalogProductId: 'p-imidacloprid-17-8-sl', verdict: 'confirmed', catalogVersion: 'inputs-2',
    assertedByUserId: 'user-1', assertedAtUtc: '2026-11-09T05:00:00.000Z', isCheck: false, ...over,
});
const pull = (rows: unknown[]): SyncPullResponse => ({ inputIdentityAssertions: rows }) as unknown as SyncPullResponse;
const mine = (over: Partial<InputIdentityAnswer> = {}): InputIdentityAnswer => ({
    assertionId: 'as-local', inputEventId: 'ev-1', mixIndex: 0, verdict: 'confirmed', catalogProductId: 'p-imidacloprid-17-8-sl',
    catalogVersion: 'inputs-2', assertedByUserId: 'user-1', assertedAtUtc: '2026-11-09T05:00:00.000Z', isCheck: false, pending: true, ...over,
});

const deviceLog = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: LOG, date: '2026-11-09', context: { selection: [] }, dayOutcome: 'WORK_RECORDED',
    cropActivities: [], irrigation: [], labour: [], machinery: [],
    inputs: [{ id: 'ev-1', method: 'Spray', mix: [{ id: 'm1', productName: 'कॉन्फिडॉर', dose: 1, unit: 'ml' }] }],
    ...over,
}) as unknown as DailyLog;

const seed = async (db: AgriLogDatabase, log: DailyLog, serverModifiedAtUtc?: string) => {
    await db.logs.put({ id: log.id, schemaVersion: VersionRegistry.DB_SCHEMA_VERSION, log, date: log.date, isDeleted: 0, ...(serverModifiedAtUtc ? { serverModifiedAtUtc } : {}) });
};
const apply = (db: AgriLogDatabase, rows: unknown[]) => db.transaction('rw', [db.logs, db.mutationQueue], () => reconcileInputIdentityAnswers(db, pull(rows)));

describe('the pull lays his answers on the record (lane IT4)', () => {
    let db: AgriLogDatabase;
    beforeEach(async () => {
        await getDatabase().delete();
        await resetDatabase();
        db = getDatabase();
    });

    it('lays the answers on the record and changes nothing else, not even the server stamp (P7)', async () => {
        const log = deviceLog();
        await seed(db, log, '2026-11-09T04:00:00.000Z');
        const changed = await apply(db, [dto(), dto({ assertionId: 'as-ck', assertedByUserId: 'user-2', isCheck: true, assertedAtUtc: '2026-11-09T06:00:00.000Z' })]);
        expect(changed).toBe(1);
        const after = (await db.logs.get(LOG))!;
        expect(after.serverModifiedAtUtc).toBe('2026-11-09T04:00:00.000Z');
        const { inputIdentities, ...rest } = after.log;
        expect(rest).toEqual(log);
        expect(inputIdentities?.map(a => [a.assertionId, a.isCheck, a.verdict])).toEqual([['as-1', false, 'confirmed'], ['as-ck', true, 'confirmed']]);
        // Nothing in the pull leaves the record changed twice.
        expect(await apply(db, [dto()])).toBe(0);
    });

    it('a record this phone does not hold is skipped; an older server (no list) changes nothing', async () => {
        expect(await apply(db, [dto()])).toBe(0);
        expect(await db.logs.get(LOG)).toBeUndefined();
        await seed(db, deviceLog());
        await db.transaction('rw', [db.logs, db.mutationQueue], () => reconcileInputIdentityAnswers(db, {} as SyncPullResponse));
        expect((await db.logs.get(LOG))!.log.inputIdentities).toBeUndefined();
    });

    it('a malformed row is dropped, never guessed at', async () => {
        await seed(db, deviceLog());
        await apply(db, [{ ...dto(), verdict: 'maybe' }, { ...dto(), mixIndex: 'x' }, { nonsense: true }, dto({ assertionId: 'as-ok' })]);
        expect((await db.logs.get(LOG))!.log.inputIdentities?.map(a => a.assertionId)).toEqual(['as-ok']);
    });

    it('an answer made here and not yet acknowledged is REPLACED by the server\'s row of the same id - even when the server says it is the check', () => {
        const merged = mergeInputIdentities([mine({ assertionId: 'as-1' })], [{
            assertionId: 'as-1', inputEventId: 'ev-1', mixIndex: 0, verdict: 'confirmed', catalogVersion: 'inputs-2',
            assertedByUserId: 'user-1', assertedAtUtc: '2026-11-09T05:00:01.000Z', isCheck: true,
        }]);
        expect(merged).toHaveLength(1);
        expect(merged[0].isCheck).toBe(true);
        expect(merged[0].pending).toBeUndefined();
    });

    it('his newer, not-yet-acknowledged answer is not undone by an older one arriving late (P10)', () => {
        const newer = mine({ assertionId: 'as-new', verdict: 'rejected', assertedAtUtc: '2026-11-09T07:00:00.000Z' });
        const merged = mergeInputIdentities([newer], [{ ...mine({ assertionId: 'as-old' }), pending: undefined, assertedAtUtc: '2026-11-09T05:00:00.000Z' }]);
        expect(merged.map(a => a.assertionId)).toEqual(['as-new']);
        // ... and a newer pulled answer does replace an older one of the same kind.
        const replaced = mergeInputIdentities([mine({ assertionId: 'as-old' })], [{ ...mine({ assertionId: 'as-2' }), pending: undefined, assertedAtUtc: '2026-11-09T08:00:00.000Z' }]);
        expect(replaced.map(a => a.assertionId)).toEqual(['as-2']);
    });

    it('the speaker\'s answer and the check are kept side by side; a different product is a different answer', () => {
        const merged = mergeInputIdentities([], [
            { ...mine(), pending: undefined, assertionId: 'a' },
            { ...mine(), pending: undefined, assertionId: 'b', isCheck: true },
            { ...mine(), pending: undefined, assertionId: 'c', mixIndex: 1 },
        ]);
        expect(merged.map(a => a.assertionId)).toEqual(['a', 'b', 'c']);
    });

    it('the record\'s own pull keeps the answers the phone holds', async () => {
        const plotLookup = new Map<string, PlotLookupEntry>([['plot-1', { cropId: 'crop-1', cropName: 'Grapes', plotName: 'North Field' }]]);
        await seed(db, deviceLog({ inputIdentities: [mine({ assertionId: 'as-1', pending: undefined })] }), '2026-11-09T04:00:00.000Z');
        const serverLog: DailyLogDto = {
            id: LOG, farmId: FARM, plotId: 'plot-1', cropCycleId: 'cycle-1', operatorUserId: 'user-1', logDate: '2026-11-09',
            createdAtUtc: '2026-11-09T03:00:00.000Z', modifiedAtUtc: '2026-11-09T09:00:00.000Z', tasks: [], verificationEvents: [],
        };
        const payload = { dailyLogs: [serverLog] } as unknown as SyncPullResponse;
        await db.transaction('rw', [db.logs], async () => { await reconcileLogs(db, payload, plotLookup, new Set<string>()); });
        const after = (await db.logs.get(LOG))!;
        expect(after.serverModifiedAtUtc).toBe('2026-11-09T09:00:00.000Z'); // the log itself did advance
        expect(after.log.inputIdentities?.map(a => a.assertionId)).toEqual(['as-1']); // and the answers survived it
    });

    it('RefusedAnswer_PendingRowIsClearedFromTheRecord (lane IT4 fix 1, F4)', async () => {
        const queue = (id: string, status: string) => ({
            deviceId: 'd', clientRequestId: `assert_input_identity:${id}`, mutationType: SyncMutationName.AssertInputIdentity,
            payload: { assertionId: id, dailyLogId: LOG }, createdAt: 'T', updatedAt: 'T', status, retryCount: 0,
        });
        await seed(db, deviceLog({ inputIdentities: [
            mine({ assertionId: 'as-refused', mixIndex: 0 }),
            mine({ assertionId: 'as-waiting', mixIndex: 1 }),
            mine({ assertionId: 'as-dropped', mixIndex: 2 }),
            { ...mine({ assertionId: 'as-server', mixIndex: 3 }), pending: undefined },
        ] }), '2026-11-09T04:00:00.000Z');
        await db.mutationQueue.bulkAdd([queue('as-refused', 'REJECTED_USER_REVIEW'), queue('as-waiting', 'PENDING'), queue('as-dropped', 'REJECTED_DROPPED')] as never);
        // A pull that carries no answers at all still clears what the server turned down.
        await db.transaction('rw', [db.logs, db.mutationQueue], () => reconcileInputIdentityAnswers(db, {} as SyncPullResponse));
        const after = (await db.logs.get(LOG))!;
        expect(after.log.inputIdentities?.map(a => a.assertionId)).toEqual(['as-waiting', 'as-server']); // waiting stays; server rows stay
        expect(after.serverModifiedAtUtc).toBe('2026-11-09T04:00:00.000Z');
        expect(after.log.inputs).toEqual(deviceLog().inputs);
    });

    it('a queued answer does not hold its record back from the pull (it is an overlay, not an edit)', async () => {
        await db.mutationQueue.bulkAdd([
            { deviceId: 'd', clientRequestId: 'assert_input_identity:as-9', mutationType: SyncMutationName.AssertInputIdentity, payload: { dailyLogId: LOG }, createdAt: 'T', updatedAt: 'T', status: 'REJECTED_USER_REVIEW', retryCount: 0 },
            { deviceId: 'd', clientRequestId: 'assert_input_identity:as-8', mutationType: SyncMutationName.AssertInputIdentity, payload: { dailyLogId: LOG }, createdAt: 'T', updatedAt: 'T', status: 'PENDING', retryCount: 0 },
        ] as never);
        expect([...(await readPendingLogIds(db))]).toEqual([]);
        // ... while a real edit of the same record still holds it.
        await db.mutationQueue.add({ deviceId: 'd', clientRequestId: 'r-edit', mutationType: SyncMutationName.ReviseLogContent, payload: { dailyLogId: LOG }, createdAt: 'T', updatedAt: 'T', status: 'PENDING', retryCount: 0 } as never);
        expect([...(await readPendingLogIds(db))]).toEqual([LOG]);
    });
});
