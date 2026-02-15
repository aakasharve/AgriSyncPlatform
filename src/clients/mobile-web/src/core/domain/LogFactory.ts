import {
    DailyLog, FarmContext, LogScope, FarmerProfile, CropProfile,
    LogVerificationStatus, CropPhase, WeatherStamp,
    CropActivityEvent, IrrigationEvent, LabourEvent, InputEvent, MachineryEvent,
    ActivityExpenseEvent, ObservationNote, DisturbanceEvent,
    LogSegment, PlannedTask, AgriLogResponse
} from '../../types';
import { getPhaseAndDay } from '../../shared/utils/timelineUtils';
import { getDateKey } from '../../domain/system/DateKeyService';
// import { AgriLogResponse } from '../../domain/ai/contracts/AgriLogResponseSchema'; // REMOVED
import { LogProvenance } from '../../domain/ai/LogProvenance';

// CORE SERVICES
import { idGenerator, IdGenerator } from './services/IdGenerator';
import { systemClock, Clock } from './services/Clock';
import { VersionRegistry } from '../contracts/VersionRegistry';

const FARM_GLOBAL_ID = 'FARM_GLOBAL';
const FARM_GLOBAL_NAME = 'Entire Farm';

/**
 * LogFactory: Centralized creation of DailyLog entities.
 * Ensures consistent IDs, Metadata, and Trust Layer compliance.
 */
export class LogFactory {

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

            const plotCropActivities = this.filterEventsForPlot<CropActivityEvent>(
                data.cropActivities as CropActivityEvent[] | undefined,
                plot.name
            );
            const plotIrrigation = this.filterEventsForPlot<IrrigationEvent>(
                data.irrigation as IrrigationEvent[] | undefined,
                plot.name
            );
            const plotLabour = this.allocateLabourForPlot(
                data.labour,
                plot.name,
                index,
                targetPlotIds.length
            );
            const plotInputs = this.allocateInputsForPlot(
                data.inputs,
                plot.name,
                index,
                targetPlotIds.length
            );
            const plotMachinery = this.allocateMachineryForPlot(
                data.machinery,
                plot.name,
                index,
                targetPlotIds.length
            );
            const plotActivityExpenses = this.allocateActivityExpensesForPlot(
                data.activityExpenses,
                plot.name,
                index,
                targetPlotIds.length
            );

            // Recalculate Costs for this Plot
            const labourCost = this.sumLabourCost(plotLabour);
            const machineCost = this.sumMachineryCost(plotMachinery);
            const inputCost = 0;
            const expenseCost = this.sumExpenseCost(plotActivityExpenses);
            const plotGrandTotal = labourCost + machineCost + inputCost + expenseCost;

            // MIRROR: Handle Planned Tasks from Manual Entry
            const mirroredTasks: PlannedTask[] = data.plannedTasks?.map((t: any) => ({
                ...t,
                id: t.id || idGen.generate(),
                plotId: plotId,
                cropId: crop.id,
                createdAt: t.createdAt || nowISO
            })) || [];

            const mirroredObservations: ObservationNote[] = [
                ...(data.observations || []),
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
            const manualRemindersAsTasks: PlannedTask[] = (data.observations || [])
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
                dayOutcome: 'WORK_RECORDED', // Default for manual

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
            dayOutcome: 'WORK_RECORDED',
            weatherStamp: undefined,
            cropActivities: data.cropActivities || [],
            irrigation: data.irrigation || [],
            labour,
            inputs,
            machinery,
            activityExpenses,
            observations: mirroredObservations,
            plannedTasks: finalPlannedTasks,
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

            const myLabour = this.allocateLabourForPlot(
                response.labour,
                plot.name,
                index,
                targetPlotIds.length
            );
            const myInputs = this.allocateInputsForPlot(
                response.inputs,
                plot.name,
                index,
                targetPlotIds.length
            );
            const myMachine = this.allocateMachineryForPlot(
                response.machinery,
                plot.name,
                index,
                targetPlotIds.length
            );
            const myExpenses = this.allocateActivityExpensesForPlot(
                mappedExpenses,
                plot.name,
                index,
                targetPlotIds.length
            );

            // Recalculate cost for this plot
            const lCost = this.sumLabourCost(myLabour);
            const iCost = this.sumInputCost(myInputs);
            const mCost = this.sumMachineryCost(myMachine);
            const eCost = this.sumExpenseCost(myExpenses);

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
                    id: obs.id || idGen.generate(),
                    plotId: obs.plotId || plotId,
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

            const gTotal = lCost + iCost + mCost + eCost;

            const newLog: DailyLog = {
                id: idGen.generate(),
                date: getDateKey(),
                context: specificContext,
                dayOutcome: response.dayOutcome,

                weatherStamp: weatherStamps ? weatherStamps[plotId] : undefined,
                phaseAtLogTime: timeline.phase,
                dayNumberAtLogTime: timeline.day,

                cropActivities: this.filterEventsForPlot<CropActivityEvent>(response.cropActivities, plot.name),
                irrigation: this.filterEventsForPlot<IrrigationEvent>(response.irrigation, plot.name),
                labour: myLabour,
                inputs: myInputs,
                machinery: myMachine,
                activityExpenses: myExpenses,
                observations: mirroredObservations,
                plannedTasks: mirroredTasks,
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
            irrigation: response.irrigation || [],
            labour: response.labour || [],
            inputs: response.inputs || [],
            machinery: response.machinery || [],
            activityExpenses: mappedExpenses,
            observations: mirroredObservations,
            plannedTasks: mirroredTasks,
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

    private static filterEventsForPlot<T extends { targetPlotName?: string }>(
        events: T[] | undefined,
        plotName: string
    ): T[] {
        return (events || []).filter(event => !event.targetPlotName || event.targetPlotName === plotName);
    }

    private static allocateLabourForPlot(
        labourEvents: LabourEvent[] | undefined,
        plotName: string,
        plotIndex: number,
        plotCount: number
    ): LabourEvent[] {
        return (labourEvents || [])
            .filter(event => !event.targetPlotName || event.targetPlotName === plotName)
            .map(event => {
                const isShared = !event.targetPlotName;
                return {
                    ...event,
                    totalCost: this.allocateOptionalAmount(event.totalCost, isShared, plotIndex, plotCount)
                };
            });
    }

    private static allocateInputsForPlot(
        inputEvents: InputEvent[] | undefined,
        plotName: string,
        plotIndex: number,
        plotCount: number
    ): InputEvent[] {
        return (inputEvents || [])
            .filter(event => !event.targetPlotName || event.targetPlotName === plotName)
            .map(event => {
                const isShared = !event.targetPlotName;
                return {
                    ...event,
                    cost: this.allocateOptionalAmount(event.cost, isShared, plotIndex, plotCount)
                };
            });
    }

    private static allocateMachineryForPlot(
        machineryEvents: MachineryEvent[] | undefined,
        plotName: string,
        plotIndex: number,
        plotCount: number
    ): MachineryEvent[] {
        return (machineryEvents || [])
            .filter(event => !event.targetPlotName || event.targetPlotName === plotName)
            .map(event => {
                const isShared = !event.targetPlotName;
                return {
                    ...event,
                    rentalCost: this.allocateOptionalAmount(event.rentalCost, isShared, plotIndex, plotCount),
                    fuelCost: this.allocateOptionalAmount(event.fuelCost, isShared, plotIndex, plotCount)
                };
            });
    }

    private static allocateActivityExpensesForPlot(
        expenseEvents: ActivityExpenseEvent[] | undefined,
        plotName: string,
        plotIndex: number,
        plotCount: number
    ): ActivityExpenseEvent[] {
        return (expenseEvents || [])
            .filter(event => {
                const targetPlotName = (event as any).targetPlotName as string | undefined;
                return !targetPlotName || targetPlotName === plotName;
            })
            .map(event => {
                const targetPlotName = (event as any).targetPlotName as string | undefined;
                const isShared = !targetPlotName;

                return {
                    ...event,
                    totalAmount: this.allocateOptionalAmount(event.totalAmount, isShared, plotIndex, plotCount),
                    items: (event.items || []).map(item => ({
                        ...item,
                        total: this.allocateOptionalAmount(item.total, isShared, plotIndex, plotCount)
                    }))
                };
            });
    }

    private static allocateOptionalAmount(
        value: number | null | undefined,
        isShared: boolean,
        plotIndex: number,
        plotCount: number
    ): number | null | undefined {
        if (value === null || value === undefined) return value;
        if (!isShared || plotCount <= 1) return value;
        return this.allocateAmountAcrossPlots(value, plotIndex, plotCount);
    }

    private static allocateAmountAcrossPlots(total: number, plotIndex: number, plotCount: number): number {
        if (plotCount <= 1) return total;

        const totalCents = Math.round(total * 100);
        const baseShare = Math.trunc(totalCents / plotCount);
        const remainder = totalCents - (baseShare * plotCount);
        const shareCents = baseShare + (plotIndex < remainder ? 1 : 0);

        return shareCents / 100;
    }

    private static sumLabourCost(events: LabourEvent[]): number {
        return events.reduce((sum, event) => sum + (event.totalCost || 0), 0);
    }

    private static sumInputCost(events: InputEvent[]): number {
        return events.reduce((sum, event) => sum + (event.cost || 0), 0);
    }

    private static sumMachineryCost(events: MachineryEvent[]): number {
        return events.reduce((sum, event) => sum + (event.rentalCost || event.fuelCost || 0), 0);
    }

    private static sumExpenseCost(events: ActivityExpenseEvent[]): number {
        return events.reduce((sum, event) => sum + (event.totalAmount || 0), 0);
    }
}
