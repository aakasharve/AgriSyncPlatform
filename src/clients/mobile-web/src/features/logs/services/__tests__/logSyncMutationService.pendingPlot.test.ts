// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3, acceptance e)
//
// Written by test-writer from the spec alone.
//
// A plot made on this phone is in the phone's own "made here, not yet confirmed" list until
// the server sends it back. A log on such a plot used to be refused ("plot not pulled") and
// stayed on the phone forever. The spec says: a plot not in `db.plots` but in the pending
// list resolves to the farm recorded when the plot was made, and with no server cycle the
// log is attributed to `cropCycleIdForPlot(plotId)` — for ANY log date, including one before
// the plot was added.
//
// Through the REAL MutationQueue + payload validator over fake-indexeddb. Only the sync
// worker is replaced, so no network cycle runs.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { triggerNow } = vi.hoisted(() => ({ triggerNow: vi.fn() }));

vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow },
}));

import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SessionStore } from '../../../../infrastructure/storage/SessionStore';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { validatePayload } from '../../../../infrastructure/sync/PayloadValidator';
import {
    PENDING_PLOT_REGISTRATIONS_KEY,
    cropCycleIdForPlot,
    registerNewPlotOnServer,
} from '../../../sync/plots/registerNewPlotOnServer';
import { reconcileStrandedLogs } from '../../../sync/recovery/strandedLogReconciler';
import { enqueueLogsForSync } from '../logSyncMutationService';
import type { DailyLog, Plot } from '../../../../types';

const FARM_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FARM_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PENDING_PLOT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
/** A plot this phone neither pulled from the server nor made itself. */
const UNKNOWN_PLOT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LOG_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CROP_ID = 'c_11111111-1111-4111-8111-111111111111';

/** The day the farmer added the plot in the wizard. */
const PLOT_START_ISO = '2026-10-25T06:00:00.000Z';
const PLOT_START_DAY = '2026-10-25';
/** A week BEFORE the plot was added — work he is back-filling. */
const WEEK_BEFORE_DAY = '2026-10-18';

const newPlot = (): Plot => ({
    id: PENDING_PLOT,
    name: 'नवीन बाग',
    startDate: PLOT_START_ISO,
    createdAt: PLOT_START_ISO,
    baseline: { totalArea: 20, unit: 'Guntha' },
} as Plot);

const logOn = (plotId: string, date: string, farmId?: string): DailyLog => ({
    id: LOG_ID,
    date,
    context: {
        selection: [{
            cropId: CROP_ID,
            cropName: 'Grapes',
            selectedPlotIds: [plotId],
            selectedPlotNames: ['नवीन बाग'],
        }],
    },
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    meta: {
        createdAtISO: `${date}T04:00:00.000Z`,
        ...(farmId ? { farmId } : {}),
    },
} as unknown as DailyLog);

interface DailyLogWire {
    dailyLogId: string;
    farmId: string;
    plotId?: string;
    cropCycleId?: string;
    logDate: string;
}

async function queuedLogs(): Promise<DailyLogWire[]> {
    const rows = await getDatabase().mutationQueue
        .where('mutationType').equals(SyncMutationName.CreateDailyLog).toArray();
    return rows.map((r) => r.payload as DailyLogWire);
}

/** The farmer adds the plot on farm A; the server has not answered yet. */
async function addPlotOnFarmA(): Promise<void> {
    SessionStore.setCurrentFarmId(FARM_A);
    expect(await registerNewPlotOnServer({ plot: newPlot(), cropName: 'Grapes' })).toBe('queued');
    // The precondition the whole file rests on: the plot is ONLY in the pending list.
    expect(await getDatabase().plots.get(PENDING_PLOT)).toBeUndefined();
    expect(await getDatabase().cropCycles.count()).toBe(0);
}

describe('a log on a plot made on this phone is sent, not stranded', () => {
    beforeEach(async () => {
        const db = getDatabase();
        await db.mutationQueue.clear();
        await db.plots.clear();
        await db.cropCycles.clear();
        await db.logs.clear();
        await db.farms.clear();
        await db.uiPrefs.delete(PENDING_PLOT_REGISTRATIONS_KEY);
        // The farm itself came down from the server long ago — only the plot is new.
        await db.farms.put({ id: FARM_A, payload: { id: FARM_A }, updatedAt: '2026-10-01T00:00:00Z' });
        SessionStore.clearCurrentFarmId();
        triggerNow.mockReset().mockResolvedValue(undefined);
    });
    afterEach(() => SessionStore.clearCurrentFarmId());

    it('the save path queues create_daily_log with the plot, the recorded farm and the plot\'s derived cycle', async () => {
        await addPlotOnFarmA();

        const result = await enqueueLogsForSync([logOn(PENDING_PLOT, PLOT_START_DAY, FARM_A)]);

        expect(result.queuedLogIds).toEqual([LOG_ID]);
        expect(result.skippedLogIds).toEqual([]);
        const sent = await queuedLogs();
        expect(sent).toHaveLength(1);
        expect(sent[0].dailyLogId).toBe(LOG_ID);
        expect(sent[0].plotId).toBe(PENDING_PLOT);
        expect(sent[0].farmId).toBe(FARM_A);
        expect(sent[0].cropCycleId).toBe(await cropCycleIdForPlot(PENDING_PLOT));
        expect(validatePayload(SyncMutationName.CreateDailyLog, sent[0])).toEqual({ ok: true });
    });

    it('a log dated a week BEFORE the plot was added is still queued against the derived cycle', async () => {
        await addPlotOnFarmA();

        const result = await enqueueLogsForSync([logOn(PENDING_PLOT, WEEK_BEFORE_DAY, FARM_A)]);

        expect(result.queuedLogIds).toEqual([LOG_ID]);
        const sent = await queuedLogs();
        expect(sent).toHaveLength(1);
        expect(sent[0].plotId).toBe(PENDING_PLOT);
        expect(sent[0].farmId).toBe(FARM_A);
        expect(sent[0].cropCycleId).toBe(await cropCycleIdForPlot(PENDING_PLOT));
        // Sent with the day the work happened — not moved to the plot's start.
        expect(sent[0].logDate).toBe(WEEK_BEFORE_DAY);
    });

    it('the farm is the one RECORDED when the plot was made, even after the farmer switched farms', async () => {
        await addPlotOnFarmA();
        SessionStore.setCurrentFarmId(FARM_B);

        const result = await enqueueLogsForSync([logOn(PENDING_PLOT, PLOT_START_DAY)]);

        expect(result.queuedLogIds).toEqual([LOG_ID]);
        const sent = await queuedLogs();
        expect(sent).toHaveLength(1);
        expect(sent[0].farmId).toBe(FARM_A);
        expect(sent[0].farmId).not.toBe(FARM_B);
    });

    it('the stranded-log recovery mode (\'from-log-date\') also routes it — including a back-dated log', async () => {
        await addPlotOnFarmA();

        const result = await enqueueLogsForSync(
            [logOn(PENDING_PLOT, WEEK_BEFORE_DAY, FARM_A)],
            { cycleResolution: 'from-log-date', triggerSync: false },
        );

        expect(result.queuedLogIds).toEqual([LOG_ID]);
        expect(result.skippedLogIds).toEqual([]);
        const sent = await queuedLogs();
        expect(sent).toHaveLength(1);
        expect(sent[0].plotId).toBe(PENDING_PLOT);
        expect(sent[0].farmId).toBe(FARM_A);
        expect(sent[0].cropCycleId).toBe(await cropCycleIdForPlot(PENDING_PLOT));
    });

    it('a log already stuck on the phone is re-queued by the stranded-log recovery', async () => {
        await addPlotOnFarmA();
        // Saved earlier, never queued (the old refusal) — sitting only in the log table.
        const stuck = logOn(PENDING_PLOT, WEEK_BEFORE_DAY, FARM_A);
        await getDatabase().logs.put({ id: LOG_ID, schemaVersion: 1, date: stuck.date, isDeleted: 0, log: stuck });

        const outcome = await reconcileStrandedLogs();

        expect(outcome.requeued).toBe(1);
        expect(outcome.unroutable).toBe(0);
        const sent = await queuedLogs();
        expect(sent).toHaveLength(1);
        expect(sent[0].dailyLogId).toBe(LOG_ID);
        expect(sent[0].farmId).toBe(FARM_A);
        expect(sent[0].cropCycleId).toBe(await cropCycleIdForPlot(PENDING_PLOT));
    });

    it('a plot that is neither pulled nor pending still refuses — nothing queued', async () => {
        await addPlotOnFarmA();

        const result = await enqueueLogsForSync([logOn(UNKNOWN_PLOT, PLOT_START_DAY, FARM_A)]);

        expect(result.queuedLogIds).toEqual([]);
        expect(result.skippedLogIds).toEqual([LOG_ID]);
        expect(await queuedLogs()).toEqual([]);
    });

    it('the recovery mode refuses it too', async () => {
        await addPlotOnFarmA();

        const result = await enqueueLogsForSync(
            [logOn(UNKNOWN_PLOT, WEEK_BEFORE_DAY, FARM_A)],
            { cycleResolution: 'from-log-date', triggerSync: false },
        );

        expect(result.skippedLogIds).toEqual([LOG_ID]);
        expect(await queuedLogs()).toEqual([]);
    });
});
