import {
    InputEvent, ActivityExpenseEvent,
    CropProfile, DailyLog, AgriLogResponse, PlannedTask, ObservationSeverity,
    Plot, SelectedCropContext, LabourEvent, MachineryEvent
} from '../../../types';
import { IdGenerator } from '../services/IdGenerator';

/**
 * Pure helper functions extracted from LogFactory to keep that file under the
 * Plan 04 §DoD 800-line cap. Behavior-neutral move: these were `private static`
 * methods on `LogFactory`, all of them pure functions of their arguments. The
 * extraction keeps the call sites identical apart from swapping `this.<fn>(...)`
 * for `<fn>(...)`.
 */

/**
 * "Farm scope: no plot, no crop." Declared here, in `core/domain`, and now
 * IMPORTED by `LogFactory` and the partition builders rather than re-typed in
 * each — one literal, three readers.
 *
 * `costAnalysisHelpers.ts`, `dayState.ts` and `logsReconciler.ts` still declare
 * their own copies. They are in `features/`, and a `core/domain` module may not
 * be imported the other way round without inverting the layering rule; folding
 * those three in is its own change with its own blast radius.
 */
export const FARM_GLOBAL_ID = 'FARM_GLOBAL';

/**
 * Project a DailyLog into the AgriLogResponse shape that scoreVlog reads.
 * scoreVlog only needs the event arrays + dayOutcome + disturbance + observations + summary.
 * DailyLog carries all of these (summary is absent → defaults to '' for scoring).
 *
 * This adapter is pure (no mutation, no allocation beyond the object literal)
 * and intentionally minimal — only maps what scoreVlog actually reads.
 */
export function projectLogForScoring(log: DailyLog): AgriLogResponse {
    return {
        summary: '',
        dayOutcome: log.dayOutcome,
        cropActivities: log.cropActivities,
        irrigation: log.irrigation,
        labour: log.labour,
        inputs: log.inputs,
        machinery: log.machinery,
        activityExpenses: log.activityExpenses ?? [],
        observations: log.observations,
        disturbance: log.disturbance,
        missingSegments: [],
    };
}

/**
 * Count the total distinct plots across all CropProfiles.
 * Used to supply ScoreContext.farm.plotCount for the SCOPE dimension.
 * Falls back to 1 (solo) when crops is empty — waives the SCOPE penalty.
 */
export function countPlots(crops: CropProfile[]): number {
    const count = crops.reduce((sum, c) => sum + c.plots.length, 0);
    return count > 0 ? count : 1;
}

/**
 * Maps PlannedTask priority to ObservationNote severity.
 * 'high' has no direct counterpart in ObservationSeverity; we use 'important'.
 */
export function priorityToSeverity(priority: PlannedTask['priority'] | undefined): ObservationSeverity {
    if (priority === 'urgent') return 'urgent';
    if (priority === 'high') return 'important';
    return 'normal';
}

/**
 * LABOUR_PHASE2 B1b — `plotId` may now be `null`.
 *
 * The `::<plotId>` suffix existed to keep the COPIES apart: one save became one
 * log per plot, so the same event id landed in N records and had to be made
 * unique. A shared engagement is now one record, so there are no copies to
 * disambiguate and no plot to name — the id is already unique and is left
 * exactly as the farmer's entry produced it.
 */
export function scopeChildId(baseId: string, plotId: string | null): string {
    return plotId ? `${baseId}::${plotId}` : baseId;
}

/**
 * LABOUR_PHASE2 B1b — WHICH events belong to a partition of one save.
 *
 * The farmer's own attribution is the only thing that decides this. There is no
 * fourth mode that divides an unattributed event, because dividing one is
 * exactly the invention founder decision O-2 closed.
 *
 * - `ownAndShared` — the selection is ONE plot, so there is nothing to divide
 *   and nothing to withhold. Byte-for-byte the predicate this module has always
 *   used, and the reason the dominant path is untouched by Phase 2b.
 * - `ownOnly` — the selection is several plots and the farmer pinned this event
 *   to THIS plot (`targetPlotName`). That is per-plot evidence he supplied, so
 *   it is recorded per plot.
 * - `sharedOnly` — the selection is several plots and the farmer pinned the
 *   event to none of them. One engagement, one record, scoped to the whole set.
 *
 * An event pinned to a plot name that is in NO partition of this save is
 * dropped, which is exactly what happens today (`!t || t === name` is false for
 * every plot). Recorded here, not fixed here: it is pre-existing, it is not
 * worsened, and changing it is a separate decision about the voice parser's
 * plot-name matching.
 */
export type PlotEventScope = 'ownAndShared' | 'ownOnly' | 'sharedOnly';

function belongsToPartition(
    targetPlotName: string | undefined,
    plotName: string | null,
    eventScope: PlotEventScope
): boolean {
    switch (eventScope) {
        case 'ownOnly':
            return Boolean(targetPlotName) && targetPlotName === plotName;
        case 'sharedOnly':
            return !targetPlotName;
        case 'ownAndShared':
        default:
            return !targetPlotName || targetPlotName === plotName;
    }
}

export function filterEventsForPlot<T extends { id: string; targetPlotName?: string }>(
    events: T[] | undefined,
    plotName: string | null,
    plotId: string | null,
    eventScope: PlotEventScope
): T[] {
    return (events || [])
        .filter(event => belongsToPartition(event.targetPlotName, plotName, eventScope))
        .map(event => ({
            ...event,
            id: scopeChildId(event.id, plotId)
        }));
}

/**
 * Labour V1 Task 7.3 — mints the stable `labourAssignmentId` on every labour
 * event that does not already carry one.
 *
 * WHY IT LIVES HERE AND NOT IN THE PER-PARTITION EVENT SELECTION: that runs on
 * only 2 of LogFactory's 4 branches. `createFarmGlobalManualLog` and
 * `createFarmGlobalVoiceLog` pass `data.labour` / `response.labour` straight
 * through, so a whole-farm log minted inside the plot split would reach the
 * server with no id at all. The single shared boundary that all four branches
 * pass through is `LogCommandServiceImpl.confirmAndSave`, which is the one and
 * only call site.
 *
 * MUTATION SEMANTICS — IN PLACE, AND THIS IS LOAD-BEARING, NOT AN OVERSIGHT.
 * The function mutates each `LabourEvent` object and returns `void`.
 * `confirmAndSave` also returns `Promise<void>`, and all four of its callers
 * (`useLogCommands`: `handleConfirm`, `handleAutoSave`, `handleManualSubmit`,
 * `handleWizardSubmit` — named, not line-numbered, because the lines have
 * already drifted ~90 once) then hand *their own* `newLogs` reference to
 * `enqueueLogsForSync`. If this returned a fresh array instead of mutating, the
 * ids would reach Dexie but never reach the wire, and the server's `Guid.Empty`
 * rejection would then fire on every single log a farmer writes. Do not
 * "purify" this into a copying function unless `confirmAndSave`'s signature and
 * all four call sites change in the same edit.
 *
 * IDEMPOTENT: an event that already has an id keeps it untouched, so a
 * re-entrant call can never renumber an engagement that is already on the wire.
 *
 * LABOUR_PHASE2 B1b — un-splitting is what collapses today's THREE ids for one
 * engagement into one. Nothing here changed; it is the input that did.
 */
export function ensureLabourAssignmentIds(logs: DailyLog[], idGen: IdGenerator): void {
    logs.forEach(log => {
        (log.labour || []).forEach(event => {
            if (!event.labourAssignmentId) {
                event.labourAssignmentId = idGen.generate();
            }
        });
    });
}

/**
 * LABOUR_PHASE2 B1c — records WHICH FARM the farmer was working in, on the log
 * itself, at the moment the log is saved.
 *
 * WHY THE RECORD HAS TO CARRY IT. Every other log answers "which farm?" through
 * its plots: `logSyncMutationService.resolveLogPlots` reads
 * `db.plots[].payload.farmId`. A `Farm`-scoped log (संपूर्ण शेत) has no plot BY
 * DEFINITION, so that route cannot answer for it — the record fell into
 * `skippedLogIds` and never left the phone. This is the non-plot answer.
 *
 * WHY CAPTURED HERE AND NOT RESOLVED AT PUSH TIME. The push runs whenever
 * `BackgroundSyncWorker` next fires, which may be minutes or days later, on a
 * phone whose farm context has since been switched. Reading "the current farm"
 * then answers a question about the PAST with a fact about the PRESENT — and on
 * this product multi-farm-per-login is a CORE use case, not an edge case. That
 * is precisely how one farm's labour lands in another's ledger. Stamped at the
 * save boundary, the value records what was true when the farmer spoke.
 *
 * WHY `meta` AND NOT `SelectedCropContext.farmId`, which already exists. A log
 * has exactly ONE farm: `create_daily_log.farmId` is single-valued,
 * `resolveLogPlots` refuses a plot set spanning two farms, and cross-farm
 * mutation is forbidden. Hanging it off the per-crop selection entries admits a
 * shape where two entries name two farms — an invalid state made representable,
 * the same failure `ResolvedLogSyncTarget` is a discriminated union to avoid.
 * `meta` is where this codebase already records creation-time facts about a
 * record (who, when, which build, which parse job), which is exactly what this
 * is. `SelectedCropContext.farmId` is left untouched and unpopulated, so the
 * finance capture that reads it behaves identically to before.
 *
 * IT LIVES BESIDE `ensureLabourAssignmentIds`, AND FOR THE SAME REASON. The one
 * boundary every log-creating path passes through is
 * `LogCommandServiceImpl.confirmAndSave` — all four `LogFactory` branches
 * (manual+plot, manual+entire-farm, voice+plot, voice+entire-farm) AND the
 * wizard, which builds its `DailyLog[]` itself and never touches `LogFactory`.
 * Stamping inside `LogFactory` would silently miss the wizard.
 *
 * MUTATES IN PLACE, RETURNS `void` — load-bearing, exactly as its sibling
 * documents: every caller of `confirmAndSave` hands its OWN `logs` reference on
 * to `enqueueLogsForSync` afterwards, so a copying version would put the farm in
 * Dexie and never on the wire, which is the whole point of the field.
 *
 * PURE, and the farm id is a PARAMETER. The value is read from `SessionStore`
 * (infrastructure) by the application service; `core/domain` acquires no
 * infrastructure import for it.
 *
 * `null` / empty is a NO-OP, not a placeholder. If the app cannot say which farm
 * it is in, the record says nothing — an unstamped farm-scoped log is refused at
 * the push boundary and reported, which is the honest outcome. Writing a
 * sentinel, an empty string, or a guessed farm here would turn "we do not know"
 * into a cross-farm write.
 *
 * IDEMPOTENT AND NEVER OVERWRITES. A log that already names a farm keeps it —
 * including one that came back from the server on a pull, where the value is the
 * server's own record and outranks anything this device can assert.
 */
export function stampCreationFarmId(logs: DailyLog[], farmId: string | null | undefined): void {
    if (!farmId) {
        return;
    }

    logs.forEach(log => {
        if (log.meta?.farmId) {
            return;
        }

        if (log.meta) {
            log.meta.farmId = farmId;
            return;
        }

        // `meta` is optional on `DailyLog`, and the wizard path builds its own
        // records — so it can genuinely be absent. `createdAtISO` is required on
        // `LogMeta`; the log's own date at midday is the only non-invented value
        // available, and it is the same fallback `captureMoneyEventsFromLog`
        // already uses when `meta.createdAtISO` is missing.
        log.meta = { createdAtISO: `${log.date}T12:00:00`, farmId };
    });
}

/**
 * LABOUR_PHASE2 B1b — `selectInputsForPlot` / `selectActivityExpensesForPlot`
 * are what is LEFT of `allocateInputsForPlot` / `allocateActivityExpensesForPlot`
 * once the invented per-plot division is gone: select the events that belong to
 * this partition, and scope their child ids.
 *
 * Renamed, not kept: a function still called `allocate…` that allocates nothing
 * is the kind of stale name the next reader reasons from.
 *
 * `allocateLabourForPlot` and `allocateMachineryForPlot` are GONE rather than
 * renamed — with the division removed, both were `filterEventsForPlot`
 * character for character, and two spellings of one rule is how they drift.
 *
 * These two survive as their own functions only because they carry CHILD
 * collections (`mix`, `items`) whose ids must be scoped with the parent's.
 */
export function selectInputsForPlot(
    inputEvents: InputEvent[] | undefined,
    plotName: string | null,
    plotId: string | null,
    eventScope: PlotEventScope
): InputEvent[] {
    return (inputEvents || [])
        .filter(event => belongsToPartition(event.targetPlotName, plotName, eventScope))
        .map(event => ({
            ...event,
            id: scopeChildId(event.id, plotId),
            mix: (event.mix || []).map(item => ({
                ...item,
                id: scopeChildId(item.id, plotId)
            }))
        }));
}

export function selectActivityExpensesForPlot(
    expenseEvents: ActivityExpenseEvent[] | undefined,
    plotName: string | null,
    plotId: string | null,
    eventScope: PlotEventScope
): ActivityExpenseEvent[] {
    return (expenseEvents || [])
        // `ActivityExpenseEvent` does not declare `targetPlotName`, but the
        // parser emits it and the filter has always honoured it. Kept as-is.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter(event => belongsToPartition((event as any).targetPlotName, plotName, eventScope))
        .map(event => ({
            ...event,
            id: scopeChildId(event.id, plotId),
            items: (event.items || []).map(item => ({
                ...item,
                id: scopeChildId(item.id, plotId)
            }))
        }));
}

/** A selected plot that this device can actually place on a crop. */
export interface ResolvedLogPlot {
    plotId: string;
    plot: Plot;
    crop: CropProfile;
}

/**
 * The selected plot ids, paired with the crop each belongs to.
 *
 * A plot no crop claims is DROPPED, which is what the per-plot loop already did
 * (`if (!crop) return;`) — it cannot be given a context, a timeline or a crop
 * cycle, and inventing any of those is the fabrication O-1 closed.
 */
export function resolveSelectedPlots(plotIds: string[], crops: CropProfile[]): ResolvedLogPlot[] {
    const resolved: ResolvedLogPlot[] = [];

    plotIds.forEach(plotId => {
        const crop = crops.find(c => c.plots.some(p => p.id === plotId));
        if (!crop) return;

        const plot = crop.plots.find(p => p.id === plotId);
        if (!plot) return;

        resolved.push({ plotId, plot, crop });
    });

    return resolved;
}

/** One record a save becomes, and the spatial assertion behind it. */
export interface LogPartition {
    /** The one plot this record is about, or `null` when it is about a set. */
    plot: ResolvedLogPlot | null;
    /** Every plot the record asserts, in the order the farmer selected them. */
    plots: ResolvedLogPlot[];
    eventScope: PlotEventScope;
    /**
     * Whether this record carries the facts that belong to the SAVE rather than
     * to a plot: observations, planned tasks, the disturbance, the transcript,
     * the farmer's stated total. Exactly one partition carries them, or a
     * three-plot save would record one disturbance three times and one stated
     * total three times — the headcount fault in another costume.
     */
    carriesDayFacts: boolean;
}

/**
 * LABOUR_PHASE2 B1b — THE SPLIT, replaced.
 *
 * WHAT IT USED TO DO. `targetPlotIds.forEach(...)` emitted one `DailyLog` per
 * selected plot and copied every unattributed event into each of them. For a
 * shared engagement that meant the SAME object was read two contradictory ways
 * at once: the money was divided ("one pool, split") while the headcount was
 * copied verbatim ("this many on EACH plot"). Eight workers on three plots were
 * stored as three rows of eight and summed to twenty-four, and the engagement
 * was minted as three unrelated `labourAssignmentId`s that no correction or
 * attribution could ever address as one thing.
 *
 * WHAT IT DOES NOW — founder decision O-2. The farmer's own attribution is the
 * only thing that partitions a save:
 *
 *   - ONE plot selected: one record, and the predicate is unchanged. This is
 *     every log in the database today, and it comes out identical.
 *   - SEVERAL plots, event pinned to a plot (`targetPlotName`): that is per-plot
 *     evidence the farmer supplied, so it keeps its own per-plot record.
 *   - SEVERAL plots, event pinned to none: ONE record, scoped to the whole set.
 *     `8 workers across A+B+C` = one engagement, `WorkerCount 8`, context
 *     `{A,B,C}`. Never 8/8/8, and never an invented 3/3/2.
 *
 * The shared record comes FIRST: it is the one that exists in the ordinary case,
 * and it is the one carrying the transcript and the observations.
 *
 * It is emitted even when there is nothing unattributed to put in it, IF there
 * is no other record — so an empty save still produces exactly the one empty log
 * it produces today, and `useLogCommands` does not mistake it for "no plots
 * selected".
 *
 * `hasDayLevelFacts` is the OTHER reason it must exist. The disturbance, the
 * transcript, the observations, the planned tasks and the farmer's own stated
 * total belong to the save, not to a plot, so exactly one record carries them —
 * and if every event happened to be pinned to a plot, that record would not have
 * been built at all and those facts would have been silently dropped. Caught by
 * `LogFactory.oneEngagementOneQuantity.test.ts`, not by reading.
 */
export function partitionSelectionByFarmerEvidence(
    resolved: ResolvedLogPlot[],
    eventGroups: ReadonlyArray<ReadonlyArray<{ targetPlotName?: string }> | undefined>,
    hasDayLevelFacts: boolean,
): LogPartition[] {
    if (resolved.length === 0) {
        return [];
    }

    if (resolved.length === 1) {
        return [{
            plot: resolved[0],
            plots: resolved,
            eventScope: 'ownAndShared',
            carriesDayFacts: true,
        }];
    }

    const partitions: LogPartition[] = [];
    const shared: LogPartition = {
        plot: null,
        plots: resolved,
        eventScope: 'sharedOnly',
        carriesDayFacts: true,
    };

    const targeted = resolved.filter(candidate => eventGroups.some(group =>
        (group || []).some(event => Boolean(event.targetPlotName)
            && event.targetPlotName === candidate.plot.name)));

    const hasUnattributedWork = eventGroups.some(group =>
        (group || []).some(event => !event.targetPlotName));

    if (hasUnattributedWork || hasDayLevelFacts || targeted.length === 0) {
        partitions.push(shared);
    }

    targeted.forEach(plot => partitions.push({
        plot,
        plots: [plot],
        eventScope: 'ownOnly',
        carriesDayFacts: false,
    }));

    return partitions;
}

/**
 * The spatial assertion, in the shape this app already represents a selection:
 * ONE ENTRY PER CROP, each carrying that crop's plots.
 *
 * The same grouping `LogContext` builds live and `logsReconciler.buildSelection`
 * rebuilds from the wire, so a locally-created log and the same log pulled back
 * describe themselves identically.
 */
export function buildSelectionForPlots(plots: ResolvedLogPlot[]): SelectedCropContext[] {
    const byCropId = new Map<string, SelectedCropContext>();

    plots.forEach(({ plotId, plot, crop }) => {
        const entry = byCropId.get(crop.id) ?? {
            cropId: crop.id,
            cropName: crop.name,
            selectedPlotIds: [],
            selectedPlotNames: [],
        };
        entry.selectedPlotIds.push(plotId);
        entry.selectedPlotNames.push(plot.name);
        byCropId.set(crop.id, entry);
    });

    return [...byCropId.values()];
}

/**
 * The crop a record can honestly name, or `undefined`.
 *
 * A record covering plots of two different crops has no single crop, and naming
 * the first one would attribute the work to a crop the farmer did not single
 * out. `cropId` is optional on both `ObservationNote` and `PlannedTask`, so
 * silence is expressible — and silence is the truth here.
 */
export function soleCropId(plots: ResolvedLogPlot[]): string | undefined {
    const cropIds = new Set(plots.map(({ crop }) => crop.id));
    return cropIds.size === 1 ? [...cropIds][0] : undefined;
}

export function sumLabourCost(events: LabourEvent[]): number {
    return events.reduce((sum, event) => sum + (event.totalCost || 0), 0);
}

export function sumInputCost(events: InputEvent[]): number {
    return events.reduce((sum, event) => sum + (event.cost || 0), 0);
}

export function sumMachineryCost(events: MachineryEvent[]): number {
    return events.reduce((sum, event) => sum + (event.rentalCost ?? 0) + (event.fuelCost ?? 0), 0);
}

export function computeReceiptTotal(parts: {
    labourCost: number;
    machineCost: number;
    inputCost: number;
    expenseCost: number;
}): number {
    return parts.labourCost + parts.machineCost + parts.inputCost + parts.expenseCost;
}

export function sumExpenseCost(events: ActivityExpenseEvent[]): number {
    return events.reduce((sum, event) => sum + (event.totalAmount || 0), 0);
}
