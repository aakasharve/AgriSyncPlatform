/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LABOUR_PHASE2 B1b — the per-record builders, moved out of `LogFactory` for
 * the same reason `log-factory-helpers.ts` exists: the Plan 04 §DoD 800-line
 * budget, which CI enforces (`npm run check:file-sizes`, `eslint.yml`).
 *
 * A pure move of two methods and one private helper — no logic changed in the
 * lift. `LogFactory` keeps the entry points and the two farm-wide branches;
 * this file holds what one PARTITION of a save becomes. See
 * `partitionSelectionByFarmerEvidence` for what a partition is and which
 * founder decision produced it.
 */
import {
    DailyLog, FarmContext, FarmerProfile, WeatherStamp,
    LogVerificationStatus,
    CropActivityEvent, IrrigationEvent,
    LabourEvent, InputEvent, MachineryEvent,
    ActivityExpenseEvent, ObservationNote,
    PlannedTask, AgriLogResponse, DisturbanceEvent
} from '../../../types';
import type { ObservationNoteDraft } from '../../../domain/types/log.types';
import { getPhaseAndDay } from '../../../shared/utils/timelineUtils';
import { getDateKey } from '../services/DateKeyService';
import { LogProvenance } from '../../../domain/ai/LogProvenance';
import { IdGenerator } from '../services/IdGenerator';
import { VersionRegistry } from '../../contracts/VersionRegistry';
import {
    FARM_GLOBAL_ID,
    scopeChildId,
    selectEventsForPartition,
    selectInputsForPartition,
    selectActivityExpensesForPartition,
    buildSelectionForPlots,
    soleCropId,
    sumLabourCost,
    sumInputCost,
    sumMachineryCost,
    sumExpenseCost,
    computeReceiptTotal,
    priorityToSeverity,
    type LogPartition
} from './log-factory-helpers';

/**
 * Shape of the raw form data accepted by createFromManualEntry /
 * createFarmGlobalManualLog. All event arrays are the real domain types;
 * individual fields are optional so callers may omit unused sections.
 */
export interface ManualEntryData {
    date: string;
    cropActivities?: CropActivityEvent[];
    irrigation?: IrrigationEvent[];
    labour?: LabourEvent[];
    inputs?: InputEvent[];
    machinery?: MachineryEvent[];
    activityExpenses?: ActivityExpenseEvent[];
    observations?: ObservationNote[];
    plannedTasks?: PlannedTask[];
    disturbance?: DisturbanceEvent;
    fullTranscript?: string;
    manualTotalCost?: number;
}

/** Inline type for a single element of AgriLogResponse.plannedTasks. */
export type AgriLogPlannedTask = NonNullable<AgriLogResponse['plannedTasks']>[number];

/**
 * LABOUR_PHASE2 B1b — `cropId` is now `string | undefined` and the id-scope
 * plot is passed separately.
 *
 * A record covering plots of two crops has no single crop, and `cropId` is
 * optional on `PlannedTask`, so silence is expressible — and it is the
 * truth. `childScopePlotId` is `null` on such a record because there is no
 * plot to scope an id to; it stays `FARM_GLOBAL_ID` on the farm-wide branch,
 * whose ids are unchanged.
 */
export function buildPlannedTasksFromObservationCandidates(
    observations: ObservationNote[] | undefined,
    plotId: string,
    cropId: string | undefined,
    childScopePlotId: string | null,
    nowISO: string,
    idGen: IdGenerator
): PlannedTask[] {
    return (observations || [])
        .filter(observation => observation.noteType === 'reminder' && (observation.extractedTasks?.length || 0) > 0)
        .flatMap(observation => (observation.extractedTasks || []).map(task => ({
            id: scopeChildId(task.id || idGen.generate(), childScopePlotId),
            title: task.title,
            description: task.rawText || observation.textCleaned || observation.textRaw,
            dueDate: task.dueDate,
            dueWindow: task.dueWindow,
            plotId,
            cropId,
            priority: task.priority === 'high' ? 'high' : 'normal',
            status: task.status === 'done' ? 'done' : 'suggested',
            sourceType: 'observation_derived' as const,
            sourceObservationId: observation.id,
            aiConfidence: task.confidence || observation.aiConfidence,
            sourceText: task.rawText || observation.sourceText || observation.textRaw,
            systemInterpretation: observation.systemInterpretation,
            createdAt: nowISO,
        })));
}

/**
 * What ONE partition of a MANUAL save becomes.
 *
 * This is what `LogFactory.createFromManualEntry`'s per-plot loop body became.
 * The loop used to run once per selected plot and copy every unattributed event
 * into each pass; it now runs once per PARTITION, and the partition decides
 * which events belong to it and whether it is about one plot or a set.
 */
export function buildManualPartitionLog(
    data: ManualEntryData,
    completedIrrigation: IrrigationEvent[] | undefined,
    partition: LogPartition,
    profile: FarmerProfile,
    nowISO: string,
    idGen: IdGenerator
): DailyLog {
    const { plot: only, plots, carriesDayFacts } = partition;

    // `null` when the record asserts a SET of plots: there is no plot to scope
    // a child id to. For a single-plot record it is the plot, as always. The
    // plot NAME an event's `targetPlotName` is matched against is read off the
    // partition inside the selectors (`partitionSelector`), so it is no longer
    // threaded through here.
    const childPlotId = only ? only.plotId : null;

    // A plot-keyed field on a record that names several plots has no honest
    // single value. `FARM_GLOBAL_ID` is this codebase's existing encoding
    // for "not one plot" — every plot-keyed reader (`plotLookup.get`,
    // `selectedPlotIds.includes`) already treats it as no match — and the
    // record's own `context` carries the real assertion. Naming the first
    // plot instead would be the fabrication founder decision O-1 closed.
    const anchorPlotId = only ? only.plotId : FARM_GLOBAL_ID;
    const anchorCropId = only ? only.crop.id : soleCropId(plots);

    // `getPhaseAndDay` answers for ONE plot's own timeline. Three plots do
    // not share one phase or one day number, so a multi-plot record states
    // neither rather than borrowing the first plot's — both fields are
    // optional, and the farm-wide branch already leaves them unset.
    const timeline = only ? getPhaseAndDay(only.plot, data.date) : undefined;

    const specificContext: FarmContext = { selection: buildSelectionForPlots(plots) };

    const plotCropActivities = selectEventsForPartition<CropActivityEvent>(
        data.cropActivities as CropActivityEvent[] | undefined,
        partition
    );
    const plotIrrigation = selectEventsForPartition<IrrigationEvent>(completedIrrigation, partition);
    const plotLabour = selectEventsForPartition<LabourEvent>(data.labour, partition);
    const plotInputs = selectInputsForPartition(data.inputs, partition);
    const plotMachinery = selectEventsForPartition<MachineryEvent>(data.machinery, partition);
    const plotActivityExpenses = selectActivityExpensesForPartition(data.activityExpenses, partition);

    // Costs for THIS record — its own events, summed, never divided.
    const labourCost = sumLabourCost(plotLabour);
    const machineCost = sumMachineryCost(plotMachinery);
    const inputCost = 0;
    const expenseCost = sumExpenseCost(plotActivityExpenses);
    const plotGrandTotal = computeReceiptTotal({ labourCost, machineCost, inputCost, expenseCost });

    // MIRROR: Handle Planned Tasks from Manual Entry
    const sourcePlannedTasks = carriesDayFacts ? data.plannedTasks : undefined;
    const sourceObservations = carriesDayFacts ? data.observations : undefined;

    const mirroredTasks: PlannedTask[] = sourcePlannedTasks?.map((t: PlannedTask) => ({
        ...t,
        id: scopeChildId(t.id || idGen.generate(), childPlotId),
        plotId: anchorPlotId,
        cropId: anchorCropId,
        createdAt: t.createdAt || nowISO
    })) || [];

    const normalizedObservations: ObservationNote[] = (sourceObservations || []).map((obs: ObservationNote) => ({
        ...obs,
        id: scopeChildId(obs.id || idGen.generate(), childPlotId),
        plotId: anchorPlotId,
        cropId: obs.cropId || anchorCropId,
        dateKey: obs.dateKey || data.date,
        timestamp: obs.timestamp || nowISO
    }));

    const mirroredObservations: ObservationNote[] = [
        ...normalizedObservations,
        ...mirroredTasks.map(t => ({
            id: idGen.generate(),
            plotId: anchorPlotId,
            dateKey: data.date,
            timestamp: nowISO,
            source: 'manual' as const,
            textRaw: t.title,
            textCleaned: `Planned Task: ${t.title}`,
            noteType: 'reminder' as const,
            severity: priorityToSeverity(t.priority),
            aiConfidence: 100,
            tags: ['manual_task']
        }))
    ];

    // MIRROR: Also handle Observation (type reminder) -> Planned Task
    const manualRemindersAsTasks: PlannedTask[] = normalizedObservations
        .filter((obs: ObservationNote) => obs.noteType === 'reminder')
        .map((obs: ObservationNote) => ({
            id: idGen.generate(),
            title: obs.textRaw,
            plotId: anchorPlotId,
            cropId: anchorCropId,
            status: 'pending' as const,
            priority: (obs.severity === 'important' || obs.severity === 'urgent') ? 'high' : 'normal',
            sourceType: 'observation_derived' as const,
            sourceObservationId: obs.id,
            createdAt: nowISO,
            dueDate: data.date
        }));

    const finalPlannedTasks = [...mirroredTasks, ...manualRemindersAsTasks];
    const hasExecution = [
        plotCropActivities,
        plotIrrigation,
        plotLabour,
        plotInputs,
        plotMachinery,
        plotActivityExpenses,
    ].some(events => events.length > 0);

    // The day-level facts belong to the save, so exactly one record carries
    // them. Copying the disturbance and the farmer's stated total onto every
    // plot recorded one of each as three.
    const disturbance = carriesDayFacts ? data.disturbance : undefined;

    // Trust & Verification Logic
    const isOwner = profile.activeOperatorId === 'owner';
    const autoApproveAll = profile.trust?.reviewPolicy === 'AUTO_APPROVE_ALL';

    let verificationStatus = LogVerificationStatus.PENDING;
    if (isOwner || autoApproveAll) {
        verificationStatus = LogVerificationStatus.APPROVED;
    }

    return {
        id: idGen.generate(),
        date: data.date,
        context: specificContext,
        dayOutcome: disturbance && !hasExecution ? 'DISTURBANCE_RECORDED' : 'WORK_RECORDED',

        weatherStamp: undefined,

        phaseAtLogTime: timeline?.phase,
        dayNumberAtLogTime: timeline?.day,

        cropActivities: plotCropActivities,
        irrigation: plotIrrigation,
        labour: plotLabour,
        inputs: plotInputs,
        machinery: plotMachinery,
        activityExpenses: plotActivityExpenses,
        observations: mirroredObservations,
        plannedTasks: finalPlannedTasks,
        disturbance,

        fullTranscript: carriesDayFacts ? data.fullTranscript : undefined,
        manualTotalCost: carriesDayFacts ? data.manualTotalCost : undefined,

        financialSummary: {
            totalLabourCost: labourCost,
            totalInputCost: inputCost,
            totalMachineryCost: machineCost,
            totalActivityExpenses: expenseCost,
            grandTotal: plotGrandTotal
        },

        meta: {
            createdAtISO: nowISO,
            createdByOperatorId: profile.activeOperatorId,
            appVersion: VersionRegistry.APP_VERSION
        },
        verification: {
            status: verificationStatus,
            required: !isOwner,
            verifiedByOperatorId: isOwner ? 'owner' : undefined,
            verifiedAtISO: isOwner ? nowISO : undefined
        }
    };
}

/**
 * The voice twin of `buildManualPartitionLog`. Same rule, same reasons; see
 * `partitionSelectionByFarmerEvidence`.
 */
export function buildVoicePartitionLog(
    response: AgriLogResponse,
    completedIrrigation: IrrigationEvent[] | undefined,
    mappedExpenses: ActivityExpenseEvent[],
    partition: LogPartition,
    profile: FarmerProfile,
    weatherStamps: Record<string, WeatherStamp> | undefined,
    provenance: LogProvenance | undefined,
    nowISO: string,
    idGen: IdGenerator
): DailyLog {
    const { plot: only, plots, carriesDayFacts } = partition;

    const childPlotId = only ? only.plotId : null;
    const anchorPlotId = only ? only.plotId : FARM_GLOBAL_ID;
    const anchorCropId = only ? only.crop.id : soleCropId(plots);
    const timeline = only ? getPhaseAndDay(only.plot) : undefined; // Implicit Today

    const specificContext: FarmContext = { selection: buildSelectionForPlots(plots) };

    const myLabour = selectEventsForPartition<LabourEvent>(response.labour, partition);
    const myInputs = selectInputsForPartition(response.inputs, partition);
    const myMachine = selectEventsForPartition<MachineryEvent>(response.machinery, partition);
    const myExpenses = selectActivityExpensesForPartition(mappedExpenses, partition);

    // Cost for THIS record — its own events, summed, never divided.
    const lCost = sumLabourCost(myLabour);
    const iCost = sumInputCost(myInputs);
    const mCost = sumMachineryCost(myMachine);
    const eCost = sumExpenseCost(myExpenses);

    const isOwner = profile.activeOperatorId === 'owner';
    const autoApprove = profile.trust?.reviewPolicy === 'AUTO_APPROVE_ALL' ||
        (profile.trust?.reviewPolicy === 'AUTO_APPROVE_OWNER' && isOwner);

    // MIRROR: Handle Planned Tasks from Voice
    const mirroredTasks: PlannedTask[] = (carriesDayFacts ? response.plannedTasks : undefined)
        ?.map((pt: AgriLogPlannedTask) => ({
            id: idGen.generate(),
            title: pt.title,
            status: 'pending' as const,
            priority: 'normal' as const,
            createdAt: nowISO,
            dueHint: pt.dueHint,
            sourceType: 'ai_extracted' as const,
            plotId: anchorPlotId,
            cropId: anchorCropId
        })) || [];

    const mirroredObservations: ObservationNote[] = [
        ...((carriesDayFacts ? response.observations : undefined)
            ?.map((obs: ObservationNoteDraft): ObservationNote => ({
                ...obs,
                id: scopeChildId(obs.id || idGen.generate(), childPlotId),
                plotId: anchorPlotId,
                cropId: obs.cropId || anchorCropId,
                dateKey: obs.dateKey || getDateKey(),
                timestamp: obs.timestamp || nowISO,
                status: obs.status || 'open',
                source: obs.source || 'voice',
                textRaw: obs.textRaw || obs.textCleaned || 'No text',
                textCleaned: obs.textCleaned || obs.textRaw,
                noteType: obs.noteType || 'observation',
                severity: obs.severity || 'normal',
                aiConfidence: obs.aiConfidence || 90,
                tags: obs.tags || []
            })) || []),
        ...mirroredTasks.map(t => ({
            id: idGen.generate(),
            plotId: anchorPlotId,
            dateKey: getDateKey(),
            timestamp: nowISO,
            source: 'voice' as const,
            textRaw: t.title,
            textCleaned: `Reminder: ${t.title} (Extracted from Voice)`,
            noteType: 'reminder' as const,
            severity: 'normal' as const,
            aiConfidence: 100,
            tags: ['planned_task']
        }))
    ];

    const reminderDerivedTasks = buildPlannedTasksFromObservationCandidates(
        mirroredObservations,
        anchorPlotId,
        anchorCropId,
        childPlotId,
        nowISO,
        idGen
    );
    const finalPlannedTasks = [...mirroredTasks, ...reminderDerivedTasks];

    const gTotal = computeReceiptTotal({ labourCost: lCost, machineCost: mCost, inputCost: iCost, expenseCost: eCost });

    return {
        id: idGen.generate(),
        date: getDateKey(),
        context: specificContext,
        dayOutcome: response.dayOutcome,

        // Keyed by plot, so a record naming several plots has no entry to
        // read. Borrowing one plot's reading and presenting it as the
        // record's own is the same first-plot pick O-1 closed.
        weatherStamp: weatherStamps && childPlotId ? weatherStamps[childPlotId] : undefined,
        phaseAtLogTime: timeline?.phase,
        dayNumberAtLogTime: timeline?.day,

        cropActivities: selectEventsForPartition<CropActivityEvent>(response.cropActivities, partition),
        irrigation: selectEventsForPartition<IrrigationEvent>(completedIrrigation, partition),
        labour: myLabour,
        inputs: myInputs,
        machinery: myMachine,
        activityExpenses: myExpenses,
        observations: mirroredObservations,
        plannedTasks: finalPlannedTasks,
        disturbance: carriesDayFacts ? response.disturbance : undefined,

        fullTranscript: carriesDayFacts ? response.fullTranscript : undefined,

        financialSummary: {
            totalLabourCost: lCost,
            totalInputCost: iCost,
            totalMachineryCost: mCost,
            totalActivityExpenses: eCost,
            grandTotal: gTotal
        },

        meta: {
            createdAtISO: nowISO,
            createdByOperatorId: profile.activeOperatorId,
            appVersion: VersionRegistry.APP_VERSION,
            provenance: provenance
        },
        verification: {
            status: autoApprove ? LogVerificationStatus.APPROVED : LogVerificationStatus.PENDING,
            required: !isOwner,
            verifiedByOperatorId: isOwner ? 'owner' : undefined,
            verifiedAtISO: isOwner ? nowISO : undefined
        }
    };
}
