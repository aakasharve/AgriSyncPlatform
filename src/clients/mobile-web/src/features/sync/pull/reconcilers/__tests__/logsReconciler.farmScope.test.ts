/**
 * LABOUR_PHASE2 P2.3 — the pull must not turn a log with no plot into a log
 * with a plot.
 *
 * `ssf.daily_logs` can now record what the farmer actually asserted about
 * location — `Plot` / `MultiPlot` / `Farm` — and the server's `DailyLogDto`
 * widened `PlotId`/`CropCycleId` to `Guid?` rather than sending
 * `?? Guid.Empty`, which would have put a fabricated plot on the wire. No
 * client can produce a farm-scoped log until Phase 2b, so everything below is
 * wrong-but-unreachable today and goes live the moment 2b lands.
 *
 * WHAT THIS LOCKS. `toDailyLog` built `selectedPlotIds: [source.plotId]`
 * unconditionally. With no plot that is a length-1 array containing
 * `undefined` — the worst available answer, because it is not "no plot", it is
 * "one plot, whose id is a hole". `ContextSelectors.ts:72` reads
 * `selectedPlotIds.length === 1` as PLOT mode, so a farm-wide log round-trips
 * as plot-scoped; every `.includes(plotId)` reader then compares a real plot id
 * against that hole. `selectedPlotNames` carried the same defect one step
 * further, substituting the literal 'Unknown Plot' for a plot the farmer never
 * named.
 *
 * WHAT IT MUST NOT DO INSTEAD (founder decision O-1, closed): no first-plot, no
 * every-plot, no `Guid.Empty`, no invented crop cycle. "None" is the only
 * honest answer, and empty is how this codebase already writes it
 * (`LogFactory.ts:405`).
 *
 * NOTE AFTER A2b (2026-08-13). The fixtures below carry NO `scope` and NO
 * `plotIds` key, because neither existed on the wire when they were written.
 * They are left that way ON PURPOSE: they now pin the behaviour against a
 * server build predating A2a, where `plotId` is the only location the response
 * carries. The wire shape shipped TODAY — `scope` + `plotIds`, including the
 * MultiPlot case this file cannot express — is covered by
 * `logsReconciler.multiPlotRoundTrip.test.ts`.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reconcileLogs } from '../logsReconciler';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';
import type { AgriLogDatabase, DexieLogRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';

const LOG_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** A plot-scoped log, exactly as the server sends one today. */
const plotScopedDto = (over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: LOG_ID,
    farmId: 'farm-1',
    plotId: 'plot-1',
    cropCycleId: 'cycle-1',
    operatorUserId: 'user-1',
    logDate: '2026-08-12',
    createdAtUtc: '2026-08-12T04:00:00.000Z',
    modifiedAtUtc: '2026-08-12T05:00:00.000Z',
    tasks: [],
    verificationEvents: [],
    ...over,
});

/**
 * A farm-scoped log: `plot_id` and `crop_cycle_id` are null in the row, so they
 * are null on the wire. Phase 2b makes this producible; the readers have to be
 * right before it does.
 */
const farmScopedDto = (over: Partial<DailyLogDto> = {}): DailyLogDto =>
    plotScopedDto({ plotId: null, cropCycleId: null, ...over });

const plotLookup = (): Map<string, PlotLookupEntry> => new Map<string, PlotLookupEntry>([
    ['plot-1', { cropId: 'crop-1', cropName: 'द्राक्ष', plotName: 'उत्तर प्लॉट' }],
]);

let store: Map<string, DexieLogRecord>;
let db: AgriLogDatabase;

const run = (dtos: DailyLogDto[], lookup: Map<string, PlotLookupEntry> = plotLookup()) =>
    reconcileLogs(db, { dailyLogs: dtos } as unknown as SyncPullResponse, lookup, new Set());

const written = (): DailyLog => store.get(LOG_ID)!.log;
const selection = () => written().context.selection[0];
/** `DailyLog.observations` is optional, so read it without asserting it exists. */
const observations = () => written().observations ?? [];

/**
 * `isObservationActivity` (normalizeActivityType.ts:41-45) matches on the
 * ASCII keywords the server sends, so the activity type has to be one of
 * those for the task to be bucketed as an observation at all.
 */
const observationTask = {
    id: 'task-obs',
    activityType: 'Observation',
    notes: 'पाने पिवळी पडली',
    occurredAtUtc: '2026-08-12T06:00:00.000Z',
};

describe('reconcileLogs — a log with no plot must not come back down as a log with a plot', () => {
    beforeEach(() => {
        store = new Map();
        db = {
            logs: {
                get: async (id: string) => store.get(id),
                put: async (record: DexieLogRecord) => { store.set(record.id, record); },
            },
        } as unknown as AgriLogDatabase;
    });

    it('gives a farm-scoped log NO plot ids — never a length-1 array holding a hole', async () => {
        await run([farmScopedDto()]);

        expect(selection().selectedPlotIds).toEqual([]);
        // The specific failure the length-1 array causes: one id means PLOT
        // mode, so a farm-wide log would be read back as plot-scoped.
        expect(selection().selectedPlotIds).toHaveLength(0);
        expect(selection().selectedPlotIds).not.toContain(undefined);
        expect(selection().selectedPlotIds).not.toContain(null);
    });

    it('gives a farm-scoped log NO plot names either, rather than "Unknown Plot"', async () => {
        // Names travel with ids or they out-number them, and the farmer is
        // shown a plot name for a plot he never named.
        await run([farmScopedDto()]);

        expect(selection().selectedPlotNames).toEqual([]);
    });

    it('marks a farm-scoped log FARM_GLOBAL and does not borrow a crop from any plot', async () => {
        // The lookup is populated. Nothing in it may be attached to a log whose
        // row carries no plot_id and no crop_cycle_id.
        await run([farmScopedDto()]);

        expect(selection().cropId).toBe('FARM_GLOBAL');
        expect(selection().cropId).not.toBe('crop-1');
    });

    it('anchors an observation on a farm-scoped log to the farm, not to undefined', async () => {
        // `ObservationNote.plotId` is non-optional (log.types.ts:372). Writing
        // `undefined` there is a typed lie that survives to Dexie; the local
        // write path already encodes this exact case as FARM_GLOBAL
        // (LogFactory.ts:345), so the pull path must agree with it.
        await run([farmScopedDto({ tasks: [observationTask] })]);

        expect(observations()).toHaveLength(1);
        expect(observations()[0].plotId).toBe('FARM_GLOBAL');
        expect(observations()[0].plotId).toBeDefined();
        expect(observations()[0].cropId).toBeUndefined();
    });

    it('still reconciles a farm-scoped log at all — it is not dropped on the floor', async () => {
        await run([farmScopedDto({ tasks: [{ id: 't1', activityType: 'छाटणी', occurredAtUtc: '2026-08-12T06:00:00.000Z' }] })]);

        expect(store.has(LOG_ID)).toBe(true);
        expect(written().cropActivities.map(a => a.title)).toEqual(['छाटणी']);
    });

    // ---- the regression that matters most: ordinary single-plot behaviour ----

    it('leaves an ordinary single-plot log exactly as before', async () => {
        await run([plotScopedDto()]);

        expect(selection().selectedPlotIds).toEqual(['plot-1']);
        expect(selection().selectedPlotNames).toEqual(['उत्तर प्लॉट']);
        expect(selection().cropId).toBe('crop-1');
        expect(selection().cropName).toBe('द्राक्ष');
    });

    it('still anchors an observation on a plot-scoped log to that plot', async () => {
        await run([plotScopedDto({ tasks: [observationTask] })]);

        expect(observations()[0].plotId).toBe('plot-1');
        expect(observations()[0].cropId).toBe('crop-1');
    });

    it('still falls back to Unknown Plot when a plot id IS present but unknown to the lookup', async () => {
        // Unchanged behaviour, and deliberately different from the no-plot
        // case: the server named a plot, this device just has not pulled it
        // yet. Dropping the id here would lose a real attribution.
        await run([plotScopedDto({ plotId: 'plot-not-yet-pulled' })]);

        expect(selection().selectedPlotIds).toEqual(['plot-not-yet-pulled']);
        expect(selection().selectedPlotNames).toEqual(['Unknown Plot']);
    });
});
