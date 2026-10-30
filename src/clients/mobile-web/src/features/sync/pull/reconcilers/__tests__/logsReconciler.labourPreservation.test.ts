/**
 * Labour V1 FINAL FIX C1 — a pull must not destroy local labour it was never
 * given.
 *
 * THE GATE THIS LOCKS. This branch made the labour write-complete and
 * read-empty: `buildLabourPayloads` sends structured labour up, but nothing
 * brings it back down, because `DailyLogDto` has NO labour field at all. The
 * reconciler nevertheless rebuilt every pulled log with `labour: []` and wrote
 * it with a full-record `db.logs.put`. Neither guard saves a locally-created
 * log — the pending-mutation guard only covers PENDING/SENDING/FAILED, and the
 * freshness guard needs a `serverModifiedAtUtc` that only this reconciler ever
 * writes — so the farmer's own labour vanished from his own device the first
 * time the log he created synced down.
 *
 * That is not only a display loss. `ReviewSheet` maps a review card to an
 * engagement through `log.labour[].labourAssignmentId`, so the attribution
 * picker disappears with it, and `UpdateLog` builds its correction `before` map
 * from the same array, so the correction path becomes unreachable for any log
 * that has synced. Server rows stay intact, but the "record now → inspect later
 * → correct" journey does not.
 *
 * THE DISTINCTION THE FIX RESTS ON: the wire cannot say "this log has no
 * labour". `DailyLogDto` has no labour property, so absent-from-the-wire is not
 * empty-on-the-wire, and writing `[]` asserted something the server never said.
 * Preserving therefore cannot mask a server-side deletion — there is no
 * deletion signal to mask.
 *
 * This is a holding measure. The real fix is a server-side labour projection
 * plus reconciler hydration, and it is deferred.
 *
 * spec: 2026-07-13-labour-attendance-approval-design
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reconcileLogs } from '../logsReconciler';
import type { AgriLogDatabase, DexieLogRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';

const LOG_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** What the server actually sends: tasks and verification, never labour. */
const dto = (over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: LOG_ID,
    farmId: 'farm-1',
    plotId: 'plot-1',
    cropCycleId: 'cycle-1',
    operatorUserId: 'user-1',
    logDate: '2026-08-11',
    createdAtUtc: '2026-08-11T04:00:00.000Z',
    modifiedAtUtc: '2026-08-11T05:00:00.000Z',
    tasks: [],
    verificationEvents: [],
    ...over,
});

/** A log the farmer created on THIS device, with labour he recorded himself. */
const localLog = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: LOG_ID,
    date: '2026-08-11',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [{
        id: 'l1',
        type: 'HIRED',
        labourAssignmentId: '11111111-1111-4111-8111-111111111111',
        maleCount: 4,
        femaleCount: 2,
        count: 6,
        totalCost: 1600,
        activity: 'छाटणी',
    }],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
    financialSummary: {
        totalLabourCost: 1600,
        totalInputCost: 0,
        totalMachineryCost: 0,
        totalActivityExpenses: 0,
        grandTotal: 1600,
    },
    ...over,
} as unknown as DailyLog);

let store: Map<string, DexieLogRecord>;
let db: AgriLogDatabase;

const seed = (record: Partial<DexieLogRecord> & { id: string; log: DailyLog }) => {
    store.set(record.id, { schemaVersion: 1, date: record.log.date, isDeleted: 0, ...record } as DexieLogRecord);
};

const run = (dtos: DailyLogDto[]) =>
    reconcileLogs(db, { dailyLogs: dtos } as unknown as SyncPullResponse, new Map(), new Set());

const written = () => store.get(LOG_ID)!.log;

describe('reconcileLogs — pulled logs must not wipe local labour', () => {
    beforeEach(() => {
        store = new Map();
        db = {
            logs: {
                get: async (id: string) => store.get(id),
                put: async (record: DexieLogRecord) => { store.set(record.id, record); },
            },
        } as unknown as AgriLogDatabase;
    });

    it('keeps the labour the farmer recorded when the same log comes back down', async () => {
        seed({ id: LOG_ID, log: localLog() });

        await run([dto()]);

        // The whole array, untouched — including the engagement id ReviewSheet
        // and UpdateLog both key off.
        expect(written().labour).toHaveLength(1);
        expect(written().labour[0].labourAssignmentId).toBe('11111111-1111-4111-8111-111111111111');
        expect(written().labour[0].maleCount).toBe(4);
        expect(written().labour[0].totalCost).toBe(1600);
    });

    it('keeps the labour across REPEATED pulls, not just the first one', async () => {
        seed({ id: LOG_ID, log: localLog() });

        await run([dto()]);
        // Second pull reports a later server timestamp, so the freshness guard
        // lets it through and the record is rewritten again.
        await run([dto({ modifiedAtUtc: '2026-08-11T09:00:00.000Z' })]);

        expect(written().labour).toHaveLength(1);
        expect(written().labour[0].count).toBe(6);
    });

    it('keeps the local cost totals, which the DTO also has no field for', async () => {
        // lane F1 (review N9) — totals are kept for a log THIS phone made, which every local factory stamps with
        // `meta.appVersion` (a pulled log's "totals" were the old rebuild's five zeros and are not kept).
        seed({ id: LOG_ID, log: localLog({ meta: { createdAtISO: '2026-08-11T04:00:00.000Z', appVersion: '1.0.18' } } as Partial<DailyLog>) });

        await run([dto()]);

        // Zeroing these is the identical false assertion, and preserving only
        // totalLabourCost would leave a grandTotal contradicting its own
        // labour line.
        expect(written().financialSummary!.totalLabourCost).toBe(1600);
        expect(written().financialSummary!.grandTotal).toBe(1600);
    });

    it('still lets everything the server DOES send overwrite the local copy', async () => {
        // Preservation must be scoped to the fields the wire cannot express —
        // otherwise it would be a different bug, one that ignores the server.
        //
        // lane F1 — WHICH field states the crop work changed, not the principle. Task lines never
        // stated it (REPRO-A1: their "overwrite" was the guessed rebuild being locked in); the
        // stored details do (`DailyLogDto.content`), so the server's statement is sent as content
        // and must still win over the local copy. A task line alone is pinned in the next test.
        seed({ id: LOG_ID, log: localLog({ cropActivities: [{ id: 'stale', title: 'Stale' }] } as Partial<DailyLog>) });

        await run([dto({
            tasks: [{ id: 't1', activityType: 'Pruning', occurredAtUtc: '2026-08-11T06:00:00.000Z' }],
            lastVerificationStatus: 'VERIFIED',
            content: { version: 2, schema: 1, document: { schema: 1, cropActivities: [{ id: 't1', title: 'Pruning' }] } },
        })]);

        expect(written().cropActivities.map(a => a.title)).toEqual(['Pruning']);
        expect(written().verification?.status).toBeDefined();
        expect(store.get(LOG_ID)!.serverModifiedAtUtc).toBe('2026-08-11T05:00:00.000Z');
        // …while the labour still survives that same write.
        expect(written().labour).toHaveLength(1);
    });

    it('lane F1: a TASK LINE alone never overwrites crop work this phone recorded itself', async () => {
        // The sibling of the test above. A task line says a job was done, not what it was, so a
        // server that holds no details makes no statement about them — the phone's own record
        // (every local factory stamps `meta.appVersion`) is kept, exactly as labour is.
        seed({ id: LOG_ID, log: localLog({
            cropActivities: [{ id: 'own', title: 'छाटणी', workTypes: ['Pruning'], quantity: 2, unit: 'acre', sourceText: 'दोन एकर छाटणी' }],
            meta: { createdAtISO: '2026-08-11T04:00:00.000Z', appVersion: '1.0.18' },
        } as Partial<DailyLog>) });

        await run([dto({ tasks: [{ id: 't1', activityType: 'Pruning', occurredAtUtc: '2026-08-11T06:00:00.000Z' }] })]);

        expect(written().cropActivities).toEqual([
            { id: 'own', title: 'छाटणी', workTypes: ['Pruning'], quantity: 2, unit: 'acre', sourceText: 'दोन एकर छाटणी' },
        ]);
        expect(written().legacyPartial).toBeUndefined();
    });

    it('a genuinely NEW pulled log still reconciles normally', async () => {
        // Nothing local to preserve. lane F1 / REPRO-A1: `financialSummary` is now optional and
        // every reader says "not stated" for it, so a log this phone has never seen carries NONE —
        // never five zeros presented as his costs. The task line still arrives as what it says.
        await run([dto({ tasks: [{ id: 't1', activityType: 'Pruning', occurredAtUtc: '2026-08-11T06:00:00.000Z' }] })]);

        expect(store.has(LOG_ID)).toBe(true);
        expect(written().labour).toEqual([]);
        expect(written().cropActivities.map(a => a.title)).toEqual(['Pruning']);
        expect(written().financialSummary).toBeUndefined();
        expect(written().legacyPartial).toBe(true);
    });

    it('a legacy local record with no labour array does not break the write', async () => {
        seed({ id: LOG_ID, log: localLog({ labour: undefined, financialSummary: undefined } as Partial<DailyLog>) });

        await run([dto()]);

        expect(written().labour).toEqual([]);
        // lane F1: a record that never had totals keeps having none — the wire states none either.
        expect(written().financialSummary).toBeUndefined();
    });

    it('leaves a log with pending local mutations alone entirely, as before', async () => {
        seed({ id: LOG_ID, log: localLog() });

        await reconcileLogs(
            db,
            { dailyLogs: [dto()] } as unknown as SyncPullResponse,
            new Map(),
            new Set([LOG_ID]),
        );

        expect(written().labour).toHaveLength(1);
        expect(store.get(LOG_ID)!.serverModifiedAtUtc).toBeUndefined();
    });
});
