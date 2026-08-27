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
        seed({ id: LOG_ID, log: localLog() });

        await run([dto()]);

        // Zeroing these is the identical false assertion, and preserving only
        // totalLabourCost would leave a grandTotal contradicting its own
        // labour line.
        expect(written().financialSummary.totalLabourCost).toBe(1600);
        expect(written().financialSummary.grandTotal).toBe(1600);
    });

    it('still lets everything the server DOES send overwrite the local copy', async () => {
        // Preservation must be scoped to the fields the wire cannot express —
        // otherwise it would be a different bug, one that ignores the server.
        seed({ id: LOG_ID, log: localLog({ cropActivities: [{ id: 'stale', title: 'Stale' }] } as Partial<DailyLog>) });

        await run([dto({
            tasks: [{ id: 't1', activityType: 'Pruning', occurredAtUtc: '2026-08-11T06:00:00.000Z' }],
            lastVerificationStatus: 'VERIFIED',
        })]);

        expect(written().cropActivities.map(a => a.title)).toEqual(['Pruning']);
        expect(written().verification?.status).toBeDefined();
        expect(store.get(LOG_ID)!.serverModifiedAtUtc).toBe('2026-08-11T05:00:00.000Z');
        // …while the labour still survives that same write.
        expect(written().labour).toHaveLength(1);
    });

    it('a genuinely NEW pulled log still reconciles normally', async () => {
        // Nothing local to preserve: the empties are honest here, and
        // `financialSummary` is non-optional on DailyLog and is dereferenced
        // directly by display code, so it must still be an object.
        await run([dto({ tasks: [{ id: 't1', activityType: 'Pruning', occurredAtUtc: '2026-08-11T06:00:00.000Z' }] })]);

        expect(store.has(LOG_ID)).toBe(true);
        expect(written().labour).toEqual([]);
        expect(written().cropActivities.map(a => a.title)).toEqual(['Pruning']);
        expect(written().financialSummary.grandTotal).toBe(0);
    });

    it('a legacy local record with no labour array does not break the write', async () => {
        seed({ id: LOG_ID, log: localLog({ labour: undefined, financialSummary: undefined } as Partial<DailyLog>) });

        await run([dto()]);

        expect(written().labour).toEqual([]);
        expect(written().financialSummary.grandTotal).toBe(0);
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
