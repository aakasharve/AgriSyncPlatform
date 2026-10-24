// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-5)
 *
 * The pull must not erase the companion's memory on the farmer's own phone.
 *
 * `DailyLogDto` (infrastructure/api/dtos.ts:127) carries only identity, plot
 * context, `tasks[]` and `verificationEvents[]`. Everything else on `DailyLog`
 * — the understanding stamp, the day outcome, labour, machinery, the money
 * totals, the transcript, the weather stamp, the deletion tombstone — has no
 * channel on the wire at all. `toDailyLog` therefore *invents* those fields
 * (empty arrays, zeroed money, a hardcoded `dayOutcome: 'WORK_RECORDED'`), and
 * before this change the reconciler wrote that invention straight over the
 * device row on the first pull after a successful sync.
 *
 * These tests lock the three farmer-visible consequences named in the plan,
 * plus the counterweight: the server must still win on what the server
 * actually owns.
 *
 * `fake-indexeddb/auto` gives a real IndexedDB, so the Dexie writes here are
 * the writes the phone performs.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

import { VersionRegistry } from '../../../../../core/contracts/VersionRegistry';
import { LogVerificationStatus, type DailyLog, type WeatherStamp } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/dtos';
import {
    getDatabase,
    resetDatabase,
    type AgriLogDatabase,
} from '../../../../../infrastructure/storage/DexieDatabase';
import { reconcileLogs } from '../logsReconciler';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';

const PLOT_ID = 'plot-1';

const plotLookup = new Map<string, PlotLookupEntry>([
    [PLOT_ID, { cropId: 'crop-1', cropName: 'Grapes', plotName: 'North Field' }],
]);

const WEATHER_STAMP: WeatherStamp = {
    id: 'ws-1',
    plotId: PLOT_ID,
    timestampLocal: '2026-08-14T09:30:00+05:30',
    timestampProvider: '2026-08-14T04:00:00.000Z',
    provider: 'tomorrow.io',
    tempC: 29,
    humidity: 71,
    windKph: 8,
    precipMm: 0,
    cloudCoverPct: 20,
    conditionText: 'Clear',
    iconCode: '1000',
    rainProbNext6h: 5,
};

/** A DailyLogDto carrying only what the real wire contract carries. */
function serverLog(overrides: Partial<DailyLogDto> & { id: string }): DailyLogDto {
    return {
        farmId: 'farm-1',
        plotId: PLOT_ID,
        cropCycleId: 'cycle-1',
        operatorUserId: 'user-1',
        logDate: '2026-08-14',
        createdAtUtc: '2026-08-14T04:00:00.000Z',
        modifiedAtUtc: '2026-08-14T06:00:00.000Z',
        tasks: [],
        verificationEvents: [],
        ...overrides,
    };
}

function pullPayloadWith(...dailyLogs: DailyLogDto[]): SyncPullResponse {
    return {
        serverTimeUtc: '2026-08-14T06:00:00.000Z',
        nextCursorUtc: '2026-08-14T06:00:00.000Z',
        farms: [],
        plots: [],
        cropCycles: [],
        dailyLogs,
        attachments: [],
        costEntries: [],
        financeCorrections: [],
        dayLedgers: [],
        priceConfigs: [],
        plannedActivities: [],
        auditEvents: [],
    };
}

/** A DailyLog as it exists on the phone after a local save. */
function deviceLog(overrides: Partial<DailyLog> & { id: string }): DailyLog {
    return {
        date: '2026-08-14',
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            grandTotal: 0,
        },
        ...overrides,
    };
}

async function seed(db: AgriLogDatabase, log: DailyLog): Promise<void> {
    await db.logs.put({
        id: log.id,
        schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
        log,
        date: log.date,
        isDeleted: log.deletion ? 1 : 0,
    });
}

describe('reconcileLogs — device-only truth survives a pull', () => {
    let db: AgriLogDatabase;

    beforeEach(async () => {
        await getDatabase().delete();
        await resetDatabase();
        db = getDatabase();
    });

    it('preserves the understanding stamp across a pull, so the familiarity counter never regresses', async () => {
        await seed(db, deviceLog({
            id: 'log-1',
            understanding: { score: 72, outcome: 'SCORED', dimensions: [] },
        }));

        await reconcileLogs(db, pullPayloadWith(serverLog({ id: 'log-1' })), plotLookup, new Set());

        const after = await db.logs.get('log-1');
        expect(after!.log.understanding).toEqual({ score: 72, outcome: 'SCORED', dimensions: [] });
    });

    it('preserves an honest no-work declaration when the server makes no statement about it', async () => {
        // The real DayOutcome union (domain/types/log.types.ts:467) has no
        // NO_WORK_DECLARED; the honest-no-work value is NO_WORK_PLANNED.
        //
        // task-0b — `serverLog()` does not set `dayOutcome` at all, so the DTO
        // key is genuinely ABSENT: this simulates a server build that predates
        // the field (`serverStatedDayOutcome` reads exactly that absence).
        // That is the ONLY case where local still wins — see the sibling test
        // below for what happens when the server DOES state a value.
        await seed(db, deviceLog({ id: 'log-3', dayOutcome: 'NO_WORK_PLANNED' }));

        await reconcileLogs(db, pullPayloadWith(serverLog({ id: 'log-3' })), plotLookup, new Set());

        const after = await db.logs.get('log-3');
        expect(after!.log.dayOutcome).toBe('NO_WORK_PLANNED');
    });

    // task-0b (spec 2026-08-28-labour-v2-release-1) — THE BUG THIS RELEASE
    // EXISTS TO FIX: a farmer declares "no work today" on one device, opens
    // the app on ANOTHER device (or after a reinstall — no local row at all),
    // and it must come back as a no-work day, not a fabricated work day.
    it('a pulled NO_WORK_PLANNED log is not silently converted to WORK_RECORDED on a device with no local row', async () => {
        await reconcileLogs(
            db,
            pullPayloadWith(serverLog({ id: 'log-7', dayOutcome: 'NO_WORK_PLANNED' })),
            plotLookup,
            new Set(),
        );

        const after = await db.logs.get('log-7');
        expect(after!.log.dayOutcome).toBe('NO_WORK_PLANNED');
    });

    // The counterweight: once the wire CAN say `dayOutcome`, it must be
    // believed like `context`/`verification` — a STALE local declaration must
    // not outlive a genuine server correction (e.g. a late voice confirmation
    // that re-classified the day after the farmer's first, mistaken tap).
    it('lets a STATED server dayOutcome overwrite a stale local one', async () => {
        await seed(db, deviceLog({ id: 'log-8', dayOutcome: 'NO_WORK_PLANNED' }));

        await reconcileLogs(
            db,
            pullPayloadWith(serverLog({ id: 'log-8', dayOutcome: 'WORK_RECORDED' })),
            plotLookup,
            new Set(),
        );

        const after = await db.logs.get('log-8');
        expect(after!.log.dayOutcome).toBe('WORK_RECORDED');
    });

    it('preserves a local deletion, so a deleted log does not resurrect', async () => {
        await seed(db, deviceLog({
            id: 'log-2',
            deletion: {
                deletedAtISO: '2026-08-14T05:00:00.000Z',
                deletedByOperatorId: 'user-1',
                reason: 'logged the wrong plot',
            },
        }));

        await reconcileLogs(db, pullPayloadWith(serverLog({ id: 'log-2' })), plotLookup, new Set());

        const after = await db.logs.get('log-2');
        expect(after!.log.deletion).toBeDefined();
        expect(after!.isDeleted).toBe(1);
    });

    it('preserves every other field the wire contract cannot carry', async () => {
        await seed(db, deviceLog({
            id: 'log-4',
            labour: [{ id: 'lab-1', type: 'HIRED', count: 3, activity: 'Pruning' }],
            machinery: [{ id: 'mac-1', type: 'tractor', ownership: 'rented' }],
            plannedTasks: [{
                id: 'pt-1',
                title: 'Order urea',
                plotId: PLOT_ID,
                priority: 'normal',
                status: 'pending',
                sourceType: 'manual',
                createdAt: '2026-08-14T04:00:00.000Z',
            }],
            fullTranscript: 'आज तीन माणसं छाटणीला होती',
            manualTotalCost: 1200,
            phaseAtLogTime: 'CROP_CYCLE',
            dayNumberAtLogTime: 41,
            weatherStamp: WEATHER_STAMP,
            financialSummary: {
                totalLabourCost: 900,
                totalInputCost: 300,
                totalMachineryCost: 0,
                grandTotal: 1200,
            },
            meta: {
                createdAtISO: '2026-08-14T04:00:00.000Z',
                deviceId: 'device-abc',
                appVersion: '1.4.0',
            },
        }));

        await reconcileLogs(db, pullPayloadWith(serverLog({ id: 'log-4' })), plotLookup, new Set());

        const after = (await db.logs.get('log-4'))!.log;
        expect(after.labour).toHaveLength(1);
        expect(after.machinery).toHaveLength(1);
        expect(after.plannedTasks).toHaveLength(1);
        expect(after.fullTranscript).toBe('आज तीन माणसं छाटणीला होती');
        expect(after.manualTotalCost).toBe(1200);
        expect(after.phaseAtLogTime).toBe('CROP_CYCLE');
        expect(after.dayNumberAtLogTime).toBe(41);
        expect(after.weatherStamp).toEqual(WEATHER_STAMP);
        expect(after.financialSummary.grandTotal).toBe(1200);
        // Device-only meta keys survive alongside the server's meta keys.
        expect(after.meta?.deviceId).toBe('device-abc');
        expect(after.meta?.appVersion).toBe('1.4.0');
    });

    it('still lets the server win on what the server actually owns', async () => {
        await seed(db, deviceLog({
            id: 'log-5',
            understanding: { score: 72, outcome: 'SCORED', dimensions: [] },
            cropActivities: [{ id: 'stale', title: 'Stale activity', workTypes: ['Stale'] }],
            verification: { required: true, status: LogVerificationStatus.DRAFT },
        }));

        await reconcileLogs(
            db,
            pullPayloadWith(serverLog({
                id: 'log-5',
                // LABOUR_PHASE2 A2b — `context` is overwritten on exactly the
                // condition that the RESPONSE STATED IT, and `serverStatedContext`
                // reads `Array.isArray(dto.plotIds)`. A live server sends this on
                // every log; without it here the pull makes no spatial statement,
                // so the guard correctly keeps the device's own `selection` and
                // this test's "the server wins" premise never applies.
                plotIds: [PLOT_ID],
                tasks: [{
                    id: 'task-1',
                    activityType: 'Pruning',
                    notes: 'server side',
                    occurredAtUtc: '2026-08-14T05:00:00.000Z',
                }],
                lastVerificationStatus: 'Approved',
            })),
            plotLookup,
            new Set(),
        );

        const after = (await db.logs.get('log-5'))!;
        expect(after.log.cropActivities).toHaveLength(1);
        expect(after.log.cropActivities[0].id).toBe('task-1');
        expect(after.log.verification?.status).toBe(LogVerificationStatus.VERIFIED);
        expect(after.verificationStatus).toBe(LogVerificationStatus.VERIFIED);
        expect(after.log.context.selection[0].cropName).toBe('Grapes');
        expect(after.log.meta?.createdByOperatorId).toBe('user-1');
        expect(after.createdByOperatorId).toBe('user-1');
        // ...without giving up the device-only stamp.
        expect(after.log.understanding?.score).toBe(72);
    });

    it('writes the server projection unchanged when the phone has no row yet', async () => {
        await reconcileLogs(db, pullPayloadWith(serverLog({ id: 'log-6' })), plotLookup, new Set());

        const after = (await db.logs.get('log-6'))!;
        // task-0b — `serverLog()` does not set `dayOutcome`, simulating a
        // server response that makes no statement about it (see
        // `serverStatedDayOutcome`). This USED to assert `'WORK_RECORDED'`,
        // which was the bug pinned as a passing test: `toDailyLog` fabricated
        // that literal for EVERY pulled log, including one the farmer declared
        // NO_WORK_PLANNED. `null` is the honest "we were not told" state.
        expect(after.log.dayOutcome).toBeNull();
        expect(after.log.understanding).toBeUndefined();
        expect(after.isDeleted).toBe(0);
        expect(after.serverModifiedAtUtc).toBe('2026-08-14T06:00:00.000Z');
    });
});
