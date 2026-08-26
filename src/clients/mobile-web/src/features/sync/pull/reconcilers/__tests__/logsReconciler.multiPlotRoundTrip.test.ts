/**
 * LABOUR_PHASE2 A2b — the pull must not rewrite what the farmer said about
 * WHERE the work happened.
 *
 * THE DEFECT THIS LOCKS OUT. `toDailyLog` rebuilt a pulled log's context as
 * `selectedPlotIds: plotId ? [plotId] : []`. `DailyLogDto.plotId` is null for
 * BOTH `MultiPlot` and `Farm`, so a log the farmer recorded against three
 * plots came back down as a log against none — i.e. as a FARM-WIDE log — and
 * `db.logs.put` (`logsReconciler.ts:101-110`) is a full-record write, so that
 * rewrite landed on the originating device. Neither guard stopped it: the
 * pending-mutation guard (`:81`) lapses the moment the server ACKs the save,
 * and `preserveLocalOnlyFields` preserved only `labour` and
 * `financialSummary`. The farmer said "these three plots"; the app quietly
 * changed it to "the whole farm", and `cropId` collapsed to FARM_GLOBAL with
 * it.
 *
 * WHY IT IS WORSE THAN AN HONEST GAP. A farm-wide log is not merely a vaguer
 * plot log: `getNonGlobalSelections` (costAnalysisHelpers.ts:114) STRIPS
 * FARM_GLOBAL selections, so the cost of that work leaves every crop and plot
 * total, and `appContentContextDisplay.tsx:29` captions it "Entire Farm".
 * Nothing in the app would ever show the farmer his three plots again, and
 * there is no backfill job in this system.
 *
 * WHAT IT MUST NOT DO INSTEAD (founder decision O-1, closed): no first-plot, no
 * every-plot, no `Guid.Empty`, no invented crop cycle.
 *
 * THE SERVER CONTRACT THESE FIXTURES MIRROR (DailyLogDto.cs:53-82, enforced by
 * the domain AND a database CHECK):
 *   "Plot"      => plotIds = [plotId], cropCycleId != null
 *   "MultiPlot" => plotIds.length >= 2, plotId == null, cropCycleId == null
 *   "Farm"      => plotIds = [],       plotId == null, cropCycleId == null
 *
 * Nothing can PRODUCE a MultiPlot log until Phase 2b, so everything below is
 * wrong-but-unreachable today and goes live the moment 2b lands. That is the
 * point: 2b is unsafe to attempt until this holds.
 *
 * spec: 2026-08-12-labour-phase2-server-truth-farm-context
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reconcileLogs } from '../logsReconciler';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';
import type { AgriLogDatabase, DexieLogRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import { getNonGlobalSelections } from '../../../../analysis/components/costAnalysisHelpers';

const LOG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PLOT_A = 'plot-a';
const PLOT_B = 'plot-b';
const PLOT_C = 'plot-c';

/** A plot-scoped log, exactly as the server sends one. */
const plotScopedDto = (over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: LOG_ID,
    farmId: 'farm-1',
    scope: 'Plot',
    plotIds: [PLOT_A],
    plotId: PLOT_A,
    cropCycleId: 'cycle-1',
    operatorUserId: 'user-1',
    logDate: '2026-08-12',
    createdAtUtc: '2026-08-12T04:00:00.000Z',
    modifiedAtUtc: '2026-08-12T05:00:00.000Z',
    tasks: [],
    verificationEvents: [],
    ...over,
});

/** Three plots the farmer named. No single plot, and no crop cycle, is true of it. */
const multiPlotDto = (plotIds: string[] = [PLOT_A, PLOT_B, PLOT_C]): DailyLogDto =>
    plotScopedDto({ scope: 'MultiPlot', plotIds, plotId: null, cropCycleId: null });

/** The empty set IS the assertion, not a gap to fill. */
const farmDto = (): DailyLogDto =>
    plotScopedDto({ scope: 'Farm', plotIds: [], plotId: null, cropCycleId: null });

/**
 * A server build predating A2a: no `scope` key and no `plotIds` key at all.
 * Silence about location — NOT a statement that there is none.
 */
const preScopeDto = (over: Partial<DailyLogDto> = {}): DailyLogDto => {
    const dto = plotScopedDto(over);
    delete dto.scope;
    delete dto.plotIds;
    return dto;
};

/** Two crops, so grouping is exercised rather than assumed. */
const plotLookup = (): Map<string, PlotLookupEntry> => new Map<string, PlotLookupEntry>([
    [PLOT_A, { cropId: 'crop-1', cropName: 'द्राक्ष', plotName: 'उत्तर प्लॉट' }],
    [PLOT_B, { cropId: 'crop-1', cropName: 'द्राक्ष', plotName: 'दक्षिण प्लॉट' }],
    [PLOT_C, { cropId: 'crop-2', cropName: 'ऊस', plotName: 'पूर्व प्लॉट' }],
]);

/**
 * The log as Phase 2b will write it locally at save time: ONE log, the whole
 * plot set, grouped per crop the way `LogContext.tsx:88-116` and `LogFactory`
 * both build a selection.
 */
const localMultiPlotLog = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: LOG_ID,
    date: '2026-08-12',
    context: {
        selection: [
            { cropId: 'crop-1', cropName: 'द्राक्ष', selectedPlotIds: [PLOT_A, PLOT_B], selectedPlotNames: ['उत्तर प्लॉट', 'दक्षिण प्लॉट'] },
            { cropId: 'crop-2', cropName: 'ऊस', selectedPlotIds: [PLOT_C], selectedPlotNames: ['पूर्व प्लॉट'] },
        ],
    },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
    financialSummary: {
        totalLabourCost: 0,
        totalInputCost: 0,
        totalMachineryCost: 0,
        totalActivityExpenses: 0,
        grandTotal: 0,
    },
    ...over,
} as unknown as DailyLog);

let store: Map<string, DexieLogRecord>;
let db: AgriLogDatabase;

const seed = (log: DailyLog) => {
    store.set(LOG_ID, { id: LOG_ID, schemaVersion: 1, date: log.date, isDeleted: 0, log } as DexieLogRecord);
};

const run = (dtos: DailyLogDto[], lookup: Map<string, PlotLookupEntry> = plotLookup()) =>
    reconcileLogs(db, { dailyLogs: dtos } as unknown as SyncPullResponse, lookup, new Set());

const written = (): DailyLog => store.get(LOG_ID)!.log;
const allPlotIds = (): string[] => written().context.selection.flatMap(s => s.selectedPlotIds);
const allCropIds = (): string[] => written().context.selection.map(s => s.cropId);

describe('reconcileLogs — a multi-plot log must come back as the plots the farmer named', () => {
    beforeEach(() => {
        store = new Map();
        db = {
            logs: {
                get: async (id: string) => store.get(id),
                put: async (record: DexieLogRecord) => { store.set(record.id, record); },
            },
        } as unknown as AgriLogDatabase;
    });

    // ---- the full round trip: save -> ack -> pull ----

    it('survives save -> ack -> pull with all three plots intact', async () => {
        // `pendingLogIds` is EMPTY here on purpose: that is the post-ACK state,
        // and it is exactly when the old code overwrote the record.
        seed(localMultiPlotLog());

        await run([multiPlotDto()]);

        expect(allPlotIds()).toEqual([PLOT_A, PLOT_B, PLOT_C]);
        expect(allPlotIds()).not.toEqual([]);
        expect(allPlotIds()).toHaveLength(3);
    });

    it('does NOT come back as a farm-wide log', async () => {
        seed(localMultiPlotLog());

        await run([multiPlotDto()]);

        // The proxy…
        expect(allCropIds()).not.toContain('FARM_GLOBAL');
        // …and the consequence, through the real reader: a FARM_GLOBAL
        // selection is STRIPPED here, so a mislabelled multi-plot log would
        // leave every crop and plot cost total.
        const scoped = getNonGlobalSelections(written());
        expect(scoped.flatMap(s => s.plotIds).sort()).toEqual([PLOT_A, PLOT_B, PLOT_C]);
    });

    it('keeps the plots grouped under the crop each plot actually grows', async () => {
        await run([multiPlotDto()]);

        // One entry per distinct crop, each holding only its own plots — the
        // same shape `LogContext.tsx:93-116` produces for the live selection.
        // The crop is read off the PLOT, from reference data already pulled;
        // it is never inferred from the log and never borrowed from a sibling
        // plot. Order is stored order within a crop.
        expect(written().context.selection).toEqual([
            { cropId: 'crop-1', cropName: 'द्राक्ष', selectedPlotIds: [PLOT_A, PLOT_B], selectedPlotNames: ['उत्तर प्लॉट', 'दक्षिण प्लॉट'] },
            { cropId: 'crop-2', cropName: 'ऊस', selectedPlotIds: [PLOT_C], selectedPlotNames: ['पूर्व प्लॉट'] },
        ]);
    });

    it('keeps the plot set across REPEATED pulls, not just the first one', async () => {
        seed(localMultiPlotLog());

        await run([multiPlotDto()]);
        // A later server timestamp lets the freshness guard through, so the
        // record is rewritten again.
        await run([{ ...multiPlotDto(), modifiedAtUtc: '2026-08-12T09:00:00.000Z' }]);

        expect(allPlotIds()).toEqual([PLOT_A, PLOT_B, PLOT_C]);
    });

    it('reads the plot set from plotIds, never from plotId', async () => {
        // A shape the server CANNOT produce — the invariants forbid a plotId
        // alongside a MultiPlot set, and a database CHECK enforces them. It is
        // built here for one reason: to isolate WHICH field this code reads.
        // If `plotId` were consulted at all, 'plot-a' would appear alone.
        await run([plotScopedDto({ scope: 'MultiPlot', plotIds: [PLOT_B, PLOT_C], plotId: PLOT_A })]);

        expect(allPlotIds().sort()).toEqual([PLOT_B, PLOT_C]);
        expect(allPlotIds()).not.toContain(PLOT_A);
    });

    it('never produces a plot id that is a hole', async () => {
        await run([multiPlotDto()]);

        expect(allPlotIds()).not.toContain(undefined);
        expect(allPlotIds()).not.toContain(null);
        expect(allPlotIds().every(id => typeof id === 'string' && id.length > 0)).toBe(true);
    });

    // ---- Farm scope: the empty set is the assertion ----

    it('round-trips a farm-scoped log as farm-scoped with an empty plot set', async () => {
        seed(localMultiPlotLog());

        await run([farmDto()]);

        expect(allPlotIds()).toEqual([]);
        expect(written().context.selection).toEqual([
            { cropId: 'FARM_GLOBAL', cropName: 'Farm', selectedPlotIds: [], selectedPlotNames: [] },
        ]);
    });

    it('lets an EMPTY plot set overwrite a local plot set — it is a statement, not a gap', async () => {
        // The predicate is "the response carried the field", never "the value
        // came back non-empty". Reading empty as "no statement" would silently
        // discard a genuine farm-wide correction made on another device, which
        // is the mirror image of the defect this file exists for.
        seed(localMultiPlotLog());

        await run([farmDto()]);

        expect(allPlotIds()).toEqual([]);
        expect(allCropIds()).toEqual(['FARM_GLOBAL']);
    });

    // ---- the regression that matters most: ordinary single-plot behaviour ----

    it('round-trips an ordinary single-plot log exactly as before', async () => {
        await run([plotScopedDto()]);

        expect(written().context.selection).toEqual([
            { cropId: 'crop-1', cropName: 'द्राक्ष', selectedPlotIds: [PLOT_A], selectedPlotNames: ['उत्तर प्लॉट'] },
        ]);
    });

    it('still falls back to Unknown Plot when a plot id IS present but unknown to the lookup', async () => {
        // Unchanged behaviour, and deliberately different from the no-plot
        // case: the server named a real plot, this device just has not pulled
        // it yet. Dropping the id would lose a real attribution.
        await run([plotScopedDto({ plotIds: ['plot-not-yet-pulled'], plotId: 'plot-not-yet-pulled' })]);

        expect(written().context.selection).toEqual([
            { cropId: 'FARM_GLOBAL', cropName: 'Farm', selectedPlotIds: ['plot-not-yet-pulled'], selectedPlotNames: ['Unknown Plot'] },
        ]);
    });

    it('keeps every named plot even when the crop of some of them is unknown', async () => {
        // A pull where plots and logs arrive together normally populates the
        // lookup (`reconcileProfileAndCrops` runs first and builds it from the
        // SAME payload), so this is the edge, not the norm. What matters is
        // that no plot the farmer named is dropped because its crop is
        // missing — the crop is the unknown, not the plot.
        const partial = new Map<string, PlotLookupEntry>([
            [PLOT_A, { cropId: 'crop-1', cropName: 'द्राक्ष', plotName: 'उत्तर प्लॉट' }],
        ]);

        await run([multiPlotDto()], partial);

        expect(allPlotIds().sort()).toEqual([PLOT_A, PLOT_B, PLOT_C]);
    });

    // ---- silence from an older server is not an empty assertion ----

    it('keeps the local plot set when the response carried no plotIds at all', async () => {
        // A server build predating A2a cannot express the assertion, so it is
        // not making one. Overwriting from `plotId` here is what turned {A,B,C}
        // into a single plot; overwriting with [] would turn it farm-wide.
        // Neither is what the response said, because the response said nothing.
        seed(localMultiPlotLog());

        await run([preScopeDto()]);

        expect(allPlotIds()).toEqual([PLOT_A, PLOT_B, PLOT_C]);
        expect(written().context.selection).toEqual(localMultiPlotLog().context.selection);
    });

    it('still reconciles a NEW log from an older server using the only plot it named', async () => {
        // Nothing local to preserve. Such a server has no MultiPlot row to
        // mis-describe — migration ① classified every pre-existing row as
        // scope='Plot' with plot_ids = ARRAY[plot_id] — so its `plotId` IS the
        // whole assertion, and this reproduces exactly what shipped before.
        await run([preScopeDto()]);

        expect(written().context.selection).toEqual([
            { cropId: 'crop-1', cropName: 'द्राक्ष', selectedPlotIds: [PLOT_A], selectedPlotNames: ['उत्तर प्लॉट'] },
        ]);
    });

    it('still lets everything the server DOES send overwrite the local copy', async () => {
        // Preservation must stay scoped to what the wire cannot express,
        // otherwise it becomes a different bug — one that ignores the server.
        seed(localMultiPlotLog({ cropActivities: [{ id: 'stale', title: 'Stale' }] } as Partial<DailyLog>));

        await run([preScopeDto({ tasks: [{ id: 't1', activityType: 'छाटणी', occurredAtUtc: '2026-08-12T06:00:00.000Z' }] })]);

        expect(written().cropActivities.map(a => a.title)).toEqual(['छाटणी']);
        expect(allPlotIds()).toEqual([PLOT_A, PLOT_B, PLOT_C]);
    });
});
