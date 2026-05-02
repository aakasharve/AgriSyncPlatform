import {
    DailyLog, FarmContext, LogScope, FarmerProfile, CropProfile,
    LogVerificationStatus, WeatherStamp,
    CropActivityEvent, IrrigationEvent,
    ActivityExpenseEvent, ObservationNote, PlannedTask, AgriLogResponse
} from '../../types';
import { getPhaseAndDay } from '../../shared/utils/timelineUtils';
import { getDateKey } from './services/DateKeyService';
import { isCompletedIrrigationEvent } from './services/IrrigationCompletionService';
// import { AgriLogResponse } from '../../domain/ai/contracts/AgriLogResponseSchema'; // REMOVED
import { LogProvenance } from '../../domain/ai/LogProvenance';

// CORE SERVICES
import { idGenerator, IdGenerator } from './services/IdGenerator';
import { systemClock, Clock } from './services/Clock';
import { VersionRegistry } from '../contracts/VersionRegistry';

// Pure plot-allocation / cost-sum helpers extracted to keep this file under
// the Plan 04 §DoD 800-line cap. Behavior-neutral move; see helpers file.
import {
    scopeChildId,
    filterEventsForPlot,
    allocateLabourForPlot,
    allocateInputsForPlot,
    allocateMachineryForPlot,
    allocateActivityExpensesForPlot,
    sumLabourCost,
    sumInputCost,
    sumMachineryCost,
    sumExpenseCost
} from './helpers/log-factory-helpers';

const FARM_GLOBAL_ID = 'FARM_GLOBAL';
const FARM_GLOBAL_NAME = 'Entire Farm';

/**
 * LogFactory: Centralized creation of DailyLog entities.
 * Ensures consistent IDs, Metadata, and Trust Layer compliance.
 */
export class LogFactory {
    private static buildPlannedTasksFromObservationCandidates(
        observations: ObservationNote[] | undefined,
        plotId: string,
        cropId: string,
        nowISO: string,
        idGen: IdGenerator
    ): PlannedTask[] {
        return (observations || [])
            .filter(observation => observation.noteType === 'reminder' && (observation.extractedTasks?.length || 0) > 0)
            .flatMap(observation => (observation.extractedTasks || []).map(task => ({
                id: scopeChildId(task.id || idGen.generate(), plotId),
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
     * Creates a set of DailyLogs (one per plot) from a Manual Entry form data.
     */
    static createFromManualEntry(
        data: any, // Raw form data (typed as any during transition)
        logScope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        clock: Clock = systemClock,
        idGen: IdGenerator = idGenerator
    ): DailyLog[] {
        const targetPlotIds = logScope.selectedPlotIds;
        const newLogs: DailyLog[] = [];
        const nowISO = clock.nowISO();

        const isFarmGlobalScope =
            targetPlotIds.length === 0 && logScope.selectedCropIds.includes(FARM_GLOBAL_ID);

        if (isFarmGlobalScope) {
            newLogs.push(this.createFarmGlobalManualLog(data, profile, nowISO, idGen));
            return newLogs;
        }

        targetPlotIds.forEach((plotId, index) => {
            const crop = crops.find(c => c.plots.some(p => p.id === plotId));
            if (!crop) return;

            const plot = crop.plots.find(p => p.id === plotId)!;
            const timeline = getPhaseAndDay(plot, data.date);

            // Context Selection
            const specificContext: FarmContext = {
                selection: [{
                    cropId: crop.id,
                    cropName: crop.name,
                    selectedPlotIds: [plotId],
                    selectedPlotNames: [plot.name]
                }]
            };

            const plotCropActivities = filterEventsForPlot<CropActivityEvent>(
                data.cropActivities as CropActivityEvent[] | undefined,
                plot.name,
                plotId
            );
            const plotIrrigation = filterEventsForPlot<IrrigationEvent>(
                (data.irrigation as IrrigationEvent[] | undefined)?.filter(isCompletedIrrigationEvent),
                plot.name,
                plotId
            );
            const plotLabour = allocateLabourForPlot(
                data.labour,
                plot.name,
                plotId,
                index,
                targetPlotIds.length
            );
            const plotInputs = allocateInputsForPlot(
                data.inputs,
                plot.name,
                plotId,
                index,
                targetPlotIds.length
            );
            const plotMachinery = allocateMachineryForPlot(
                data.machinery,
                plot.name,
                plotId,
                index,
                targetPlotIds.length
            );
            const plotActivityExpenses = allocateActivityExpensesForPlot(
                data.activityExpenses,
                plot.name,
                plotId,
                index,
                targetPlotIds.length
            );

            // Recalculate Costs for this Plot
            const labourCost = sumLabourCost(plotLabour);
            const machineCost = sumMachineryCost(plotMachinery);
            const inputCost = 0;
            const expenseCost = sumExpenseCost(plotActivityExpenses);
            const plotGrandTotal = labourCost + machineCost + inputCost + expenseCost;

            // MIRROR: Handle Planned Tasks from Manual Entry
            const mirroredTasks: PlannedTask[] = data.plannedTasks?.map((t: any) => ({
                ...t,
                id: scopeChildId(t.id || idGen.generate(), plotId),
                plotId: plotId,
                cropId: crop.id,
                createdAt: t.createdAt || nowISO
            })) || [];

            const normalizedObservations: ObservationNote[] = (data.observations || []).map((obs: ObservationNote) => ({
                ...obs,
                id: scopeChildId(obs.id || idGen.generate(), plotId),
                plotId,
                cropId: obs.cropId || crop.id,
                dateKey: obs.dateKey || data.date,
                timestamp: obs.timestamp || nowISO
            }));

            const mirroredObservations: ObservationNote[] = [
                ...normalizedObservations,
                ...mirroredTasks.map(t => ({
                    id: idGen.generate(),
                    plotId: plotId,
                    dateKey: data.date,
                    timestamp: nowISO,
                    source: 'manual' as const,
                    textRaw: t.title,
                    textCleaned: `Planned Task: ${t.title}`,
                    noteType: 'reminder' as const,
                    severity: (t.priority || 'normal') as any,
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
                    plotId: plotId,
                    cropId: crop.id,
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

            // Trust & Verification Logic
            const isOwner = profile.activeOperatorId === 'owner';
            const autoApproveAll = profile.trust?.reviewPolicy === 'AUTO_APPROVE_ALL';

            let verificationStatus = LogVerificationStatus.PENDING;
            if (isOwner || autoApproveAll) {
                verificationStatus = LogVerificationStatus.APPROVED;
            }

            const newLog: DailyLog = {
                id: idGen.generate(),
                date: data.date,
                context: specificContext,
                dayOutcome: data.disturbance && !hasExecution ? 'DISTURBANCE_RECORDED' : 'WORK_RECORDED',

                weatherStamp: undefined,

                phaseAtLogTime: timeline.phase,
                dayNumberAtLogTime: timeline.day,

                cropActivities: plotCropActivities,
                irrigation: plotIrrigation,
                labour: plotLabour,
                inputs: plotInputs,
                machinery: plotMachinery,
                activityExpenses: plotActivityExpenses,
                observations: mirroredObservations,
                plannedTasks: finalPlannedTasks,
                disturbance: data.disturbance,

                fullTranscript: data.fullTranscript,
                manualTotalCost: data.manualTotalCost,

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

            newLogs.push(newLog);
        });

        return newLogs;
    }

    private static createFarmGlobalManualLog(
        data: any,
        profile: FarmerProfile,
        nowISO: string,
        idGen: IdGenerator
    ): DailyLog {
        const labour = data.labour || [];
        const irrigation = (data.irrigation || []).filter(isCompletedIrrigationEvent);
        const inputs = data.inputs || [];
        const machinery = data.machinery || [];
        const activityExpenses = data.activityExpenses || [];

        const labourCost = labour.reduce((s: number, l: any) => s + (l.totalCost || 0), 0);
        const machineCost = machinery.reduce((s: number, m: any) => s + (m.rentalCost || m.fuelCost || 0), 0);
        const inputCost = inputs.reduce((s: number, i: any) => s + (i.cost || 0), 0);
        const expenseCost = activityExpenses.reduce((s: number, e: any) => s + (e.totalAmount || 0), 0);
        const grandTotal = labourCost + machineCost + inputCost + expenseCost;

        const mirroredTasks: PlannedTask[] = data.plannedTasks?.map((t: any) => ({
            ...t,
            id: t.id || idGen.generate(),
            plotId: t.plotId || FARM_GLOBAL_ID,
            cropId: t.cropId || FARM_GLOBAL_ID,
            createdAt: t.createdAt || nowISO
        })) || [];

        const normalizedObservations: ObservationNote[] = (data.observations || []).map((obs: ObservationNote) => ({
            ...obs,
            plotId: obs.plotId || FARM_GLOBAL_ID,
            dateKey: obs.dateKey || data.date,
            timestamp: obs.timestamp || nowISO
        }));

        const mirroredObservations: ObservationNote[] = [
            ...normalizedObservations,
            ...mirroredTasks.map(t => ({
                id: idGen.generate(),
                plotId: FARM_GLOBAL_ID,
                dateKey: data.date,
                timestamp: nowISO,
                source: 'manual' as const,
                textRaw: t.title,
                textCleaned: `Planned Task: ${t.title}`,
                noteType: 'reminder' as const,
                severity: (t.priority || 'normal') as any,
                aiConfidence: 100,
                tags: ['manual_task']
            }))
        ];

        const manualRemindersAsTasks: PlannedTask[] = normalizedObservations
            .filter((obs: ObservationNote) => obs.noteType === 'reminder')
            .map((obs: ObservationNote) => ({
                id: idGen.generate(),
                title: obs.textRaw,
                plotId: FARM_GLOBAL_ID,
                cropId: FARM_GLOBAL_ID,
                status: 'pending' as const,
                priority: (obs.severity === 'important' || obs.severity === 'urgent') ? 'high' : 'normal',
                sourceType: 'observation_derived' as const,
                sourceObservationId: obs.id,
                createdAt: nowISO,
                dueDate: data.date
            }));

        const finalPlannedTasks = [...mirroredTasks, ...manualRemindersAsTasks];
        const hasExecution = [
            data.cropActivities || [],
            irrigation,
            labour,
            inputs,
            machinery,
            activityExpenses,
        ].some(events => events.length > 0);

        const isOwner = profile.activeOperatorId === 'owner';
        const autoApproveAll = profile.trust?.reviewPolicy === 'AUTO_APPROVE_ALL';
        const verificationStatus = (isOwner || autoApproveAll)
            ? LogVerificationStatus.APPROVED
            : LogVerificationStatus.PENDING;

        return {
            id: idGen.generate(),
            date: data.date,
            context: {
                selection: [{
                    cropId: FARM_GLOBAL_ID,
                    cropName: FARM_GLOBAL_NAME,
                    selectedPlotIds: [],
                    selectedPlotNames: []
                }]
            },
            dayOutcome: data.disturbance && !hasExecution ? 'DISTURBANCE_RECORDED' : 'WORK_RECORDED',
            weatherStamp: undefined,
            cropActivities: data.cropActivities || [],
            irrigation,
            labour,
            inputs,
            machinery,
            activityExpenses,
            observations: mirroredObservations,
            plannedTasks: finalPlannedTasks,
            disturbance: data.disturbance,
            fullTranscript: data.fullTranscript,
            manualTotalCost: data.manualTotalCost,
            financialSummary: {
                totalLabourCost: labourCost,
                totalInputCost: inputCost,
                totalMachineryCost: machineCost,
                totalActivityExpenses: expenseCost,
                grandTotal
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
     * Creates Logs from Voice Response (AgriLogResponse)
     */
    static createFromVoiceResult(
        response: AgriLogResponse,
        logScope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        weatherStamps?: Record<string, WeatherStamp>,
        provenance?: LogProvenance,
        clock: Clock = systemClock,
        idGen: IdGenerator = idGenerator
    ): DailyLog[] {
        const targetPlotIds = logScope.selectedPlotIds;
        const newLogs: DailyLog[] = [];
        const nowISO = clock.nowISO();

        // Shared Costs
        const laborCostGlobal = response.labour?.reduce((s: number, x: any) => s + (x.totalCost || 0), 0) || 0;
        const machineCostGlobal = response.machinery?.reduce((s: number, x: any) => s + (x.rentalCost || 0), 0) || 0;
        const inputCostGlobal = response.inputs?.reduce((s: number, x: any) => s + (x.cost || 0), 0) || 0;
        const expenseCostGlobal = response.activityExpenses?.reduce((s: number, x: any) => s + (x.totalAmount || 0), 0) || 0;

        // Expense Item Casting Fix
        const mappedExpenses: ActivityExpenseEvent[] = (response.activityExpenses || []).map((exp: any) => ({
            ...exp,
            items: (exp.items || []).map((item: any) => ({
                ...item,
                qty: item.qty || 1, // Default to 1 if missing to satisfy strict type
                unit: item.unit || 'unit'
            }))
        }));

        const isFarmGlobalScope =
            targetPlotIds.length === 0 && logScope.selectedCropIds.includes(FARM_GLOBAL_ID);

        if (isFarmGlobalScope) {
            newLogs.push(this.createFarmGlobalVoiceLog(
                response,
                profile,
                mappedExpenses,
                laborCostGlobal,
                inputCostGlobal,
                machineCostGlobal,
                expenseCostGlobal,
                weatherStamps,
                provenance,
                nowISO,
                idGen
            ));
            return newLogs;
        }

        targetPlotIds.forEach((plotId, index) => {
            const crop = crops.find(c => c.plots.some(p => p.id === plotId));
            if (!crop) return;

            const plot = crop.plots.find(p => p.id === plotId)!;
            const timeline = getPhaseAndDay(plot); // Implicit Today

            const specificContext: FarmContext = {
                selection: [{
                    cropId: crop.id, cropName: crop.name,
                    selectedPlotIds: [plotId], selectedPlotNames: [plot.name]
                }]
            };

            const myLabour = allocateLabourForPlot(
                response.labour,
                plot.name,
                plotId,
                index,
                targetPlotIds.length
            );
            const myInputs = allocateInputsForPlot(
                response.inputs,
                plot.name,
                plotId,
                index,
                targetPlotIds.length
            );
            const myMachine = allocateMachineryForPlot(
                response.machinery,
                plot.name,
                plotId,
                index,
                targetPlotIds.length
            );
            const myExpenses = allocateActivityExpensesForPlot(
                mappedExpenses,
                plot.name,
                plotId,
                index,
                targetPlotIds.length
            );

            // Recalculate cost for this plot
            const lCost = sumLabourCost(myLabour);
            const iCost = sumInputCost(myInputs);
            const mCost = sumMachineryCost(myMachine);
            const eCost = sumExpenseCost(myExpenses);

            const isOwner = profile.activeOperatorId === 'owner';
            const autoApprove = profile.trust?.reviewPolicy === 'AUTO_APPROVE_ALL' ||
                (profile.trust?.reviewPolicy === 'AUTO_APPROVE_OWNER' && isOwner);

            // MIRROR: Handle Planned Tasks from Voice
            const mirroredTasks: PlannedTask[] = response.plannedTasks?.map((pt: any) => ({
                id: idGen.generate(),
                title: pt.title,
                status: 'pending',
                priority: 'normal',
                createdAt: nowISO,
                dueHint: pt.dueHint,
                sourceType: 'ai_extracted',
                plotId: plotId,
                cropId: crop.id
            })) || [];

            const mirroredObservations: ObservationNote[] = [
                ...(response.observations?.map((obs: any) => ({
                    ...obs,
                    id: scopeChildId(obs.id || idGen.generate(), plotId),
                    plotId,
                    cropId: obs.cropId || crop.id,
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
                    plotId: plotId,
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

            const reminderDerivedTasks = this.buildPlannedTasksFromObservationCandidates(
                mirroredObservations,
                plotId,
                crop.id,
                nowISO,
                idGen
            );
            const finalPlannedTasks = [...mirroredTasks, ...reminderDerivedTasks];

            const gTotal = lCost + iCost + mCost + eCost;

            const newLog: DailyLog = {
                id: idGen.generate(),
                date: getDateKey(),
                context: specificContext,
                dayOutcome: response.dayOutcome,

                weatherStamp: weatherStamps ? weatherStamps[plotId] : undefined,
                phaseAtLogTime: timeline.phase,
                dayNumberAtLogTime: timeline.day,

                cropActivities: filterEventsForPlot<CropActivityEvent>(response.cropActivities, plot.name, plotId),
                irrigation: filterEventsForPlot<IrrigationEvent>(
                    response.irrigation?.filter(isCompletedIrrigationEvent),
                    plot.name,
                    plotId
                ),
                labour: myLabour,
                inputs: myInputs,
                machinery: myMachine,
                activityExpenses: myExpenses,
                observations: mirroredObservations,
                plannedTasks: finalPlannedTasks,
                disturbance: response.disturbance,

                fullTranscript: response.fullTranscript,

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

            newLogs.push(newLog);
        });

        return newLogs;
    }

    private static createFarmGlobalVoiceLog(
        response: AgriLogResponse,
        profile: FarmerProfile,
        mappedExpenses: ActivityExpenseEvent[],
        laborCostGlobal: number,
        inputCostGlobal: number,
        machineCostGlobal: number,
        expenseCostGlobal: number,
        weatherStamps: Record<string, WeatherStamp> | undefined,
        provenance: LogProvenance | undefined,
        nowISO: string,
        idGen: IdGenerator
    ): DailyLog {
        const isOwner = profile.activeOperatorId === 'owner';
        const autoApprove = profile.trust?.reviewPolicy === 'AUTO_APPROVE_ALL' ||
            (profile.trust?.reviewPolicy === 'AUTO_APPROVE_OWNER' && isOwner);

        const mirroredTasks: PlannedTask[] = response.plannedTasks?.map((pt: any) => ({
            id: idGen.generate(),
            title: pt.title,
            status: 'pending',
            priority: 'normal',
            createdAt: nowISO,
            dueHint: pt.dueHint,
            sourceType: 'ai_extracted',
            plotId: FARM_GLOBAL_ID,
            cropId: FARM_GLOBAL_ID
        })) || [];

        const mirroredObservations: ObservationNote[] = [
            ...(response.observations?.map((obs: any) => ({
                ...obs,
                id: obs.id || idGen.generate(),
                plotId: obs.plotId || FARM_GLOBAL_ID,
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
                plotId: FARM_GLOBAL_ID,
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

        const reminderDerivedTasks = this.buildPlannedTasksFromObservationCandidates(
            mirroredObservations,
            FARM_GLOBAL_ID,
            FARM_GLOBAL_ID,
            nowISO,
            idGen
        );
        const finalPlannedTasks = [...mirroredTasks, ...reminderDerivedTasks];

        const grandTotal = laborCostGlobal + inputCostGlobal + machineCostGlobal + expenseCostGlobal;

        return {
            id: idGen.generate(),
            date: getDateKey(),
            context: {
                selection: [{
                    cropId: FARM_GLOBAL_ID,
                    cropName: FARM_GLOBAL_NAME,
                    selectedPlotIds: [],
                    selectedPlotNames: []
                }]
            },
            dayOutcome: response.dayOutcome,
            weatherStamp: weatherStamps ? weatherStamps[FARM_GLOBAL_ID] : undefined,
            cropActivities: response.cropActivities || [],
            irrigation: (response.irrigation || []).filter(isCompletedIrrigationEvent),
            labour: response.labour || [],
            inputs: response.inputs || [],
            machinery: response.machinery || [],
            activityExpenses: mappedExpenses,
            observations: mirroredObservations,
            plannedTasks: finalPlannedTasks,
            disturbance: response.disturbance,
            fullTranscript: response.fullTranscript,
            financialSummary: {
                totalLabourCost: laborCostGlobal,
                totalInputCost: inputCostGlobal,
                totalMachineryCost: machineCostGlobal,
                totalActivityExpenses: expenseCostGlobal,
                grandTotal
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

}
