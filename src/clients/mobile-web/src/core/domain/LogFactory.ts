import {
    DailyLog, LogScope, FarmerProfile, CropProfile,
    LogVerificationStatus, WeatherStamp,
    IrrigationEvent,
    LabourEvent, InputEvent, ExpenseItem,
    ActivityExpenseEvent, ObservationNote,
    PlannedTask, AgriLogResponse
} from '../../types';
import type { ObservationNoteDraft, ScoreContext } from '../../domain/types/log.types';
import { getDateKey } from './services/DateKeyService';
import { isCompletedIrrigationEvent } from './services/IrrigationCompletionService';
// import { AgriLogResponse } from '../../domain/ai/contracts/AgriLogResponseSchema'; // REMOVED
import { LogProvenance } from '../../domain/ai/LogProvenance';
import { scoreVlog } from '../../features/logs/services/scoreVlog';

// CORE SERVICES
import { idGenerator, IdGenerator } from './services/IdGenerator';
import { systemClock, Clock } from './services/Clock';
import { VersionRegistry } from '../contracts/VersionRegistry';

// Pure plot-allocation / cost-sum helpers extracted to keep this file under
// the Plan 04 §DoD 800-line cap. Behavior-neutral move; see helpers file.
import {
    FARM_GLOBAL_ID,
    resolveSelectedPlots,
    partitionSelectionByFarmerEvidence,
    sumMachineryCost,
    computeReceiptTotal,
    projectLogForScoring,
    countPlots,
    priorityToSeverity
} from './helpers/log-factory-helpers';
// LABOUR_PHASE2 B1b — what ONE partition of a save becomes. Lifted out for the
// same 800-line budget, which CI enforces; a pure move, no logic changed.
import {
    buildManualPartitionLog,
    buildVoicePartitionLog,
    buildPlannedTasksFromObservationCandidates,
    type ManualEntryData,
    type AgriLogPlannedTask
} from './helpers/log-partition-builders';

const FARM_GLOBAL_NAME = 'Entire Farm';

/**
 * LogFactory: Centralized creation of DailyLog entities.
 * Ensures consistent IDs, Metadata, and Trust Layer compliance.
 */
export class LogFactory {
    /**
     * Creates the DailyLogs a Manual Entry save becomes.
     *
     * LABOUR_PHASE2 B1b — ONE record per thing the farmer actually asserted, not
     * one per plot. See `partitionSelectionByFarmerEvidence` for the rule and
     * the defect it removes. A single-plot save — every log in the database
     * today — produces exactly the record it always did.
     */
    static createFromManualEntry(
        data: ManualEntryData,
        logScope: LogScope,
        crops: CropProfile[],
        profile: FarmerProfile,
        clock: Clock = systemClock,
        idGen: IdGenerator = idGenerator
    ): DailyLog[] {
        const targetPlotIds = logScope.selectedPlotIds;
        const nowISO = clock.nowISO();

        const isFarmGlobalScope =
            targetPlotIds.length === 0 && logScope.selectedCropIds.includes(FARM_GLOBAL_ID);

        const plotCount = countPlots(crops);

        if (isFarmGlobalScope) {
            const globalLog = this.createFarmGlobalManualLog(data, profile, nowISO, idGen);
            // Stamp understanding (always, silent — display gated by flag separately)
            const globalCtx: ScoreContext = { farm: { plotCount: 1 } };
            globalLog.understanding = scoreVlog(projectLogForScoring(globalLog), globalCtx);
            return [globalLog];
        }

        const completedIrrigation = (data.irrigation as IrrigationEvent[] | undefined)
            ?.filter(isCompletedIrrigationEvent);

        const partitions = partitionSelectionByFarmerEvidence(
            resolveSelectedPlots(targetPlotIds, crops),
            [
                data.cropActivities,
                completedIrrigation,
                data.labour,
                data.inputs,
                data.machinery,
                // `ActivityExpenseEvent` does not declare `targetPlotName`; the
                // parser emits it and the filter has always honoured it.
                data.activityExpenses as ReadonlyArray<{ targetPlotName?: string }> | undefined,
            ],
            Boolean(
                data.disturbance
                || data.fullTranscript
                || data.manualTotalCost !== undefined
                || data.observations?.length
                || data.plannedTasks?.length
            ),
        );

        return partitions.map(partition => {
            const newLog = buildManualPartitionLog(
                data,
                completedIrrigation,
                partition,
                profile,
                nowISO,
                idGen
            );

            // Stamp Understanding Meter score (always, silent — display gated by flag separately)
            const scoreCtx: ScoreContext = { farm: { plotCount } };
            newLog.understanding = scoreVlog(projectLogForScoring(newLog), scoreCtx);

            return newLog;
        });
    }

    private static createFarmGlobalManualLog(
        data: ManualEntryData,
        profile: FarmerProfile,
        nowISO: string,
        idGen: IdGenerator
    ): DailyLog {
        const labour = data.labour || [];
        const irrigation = (data.irrigation || []).filter(isCompletedIrrigationEvent);
        const inputs = data.inputs || [];
        const machinery = data.machinery || [];
        const activityExpenses = data.activityExpenses || [];

        const labourCost = labour.reduce((s: number, l: LabourEvent) => s + (l.totalCost || 0), 0);
        const machineCost = sumMachineryCost(machinery);
        const inputCost = inputs.reduce((s: number, i: InputEvent) => s + (i.cost || 0), 0);
        const expenseCost = activityExpenses.reduce((s: number, e: ActivityExpenseEvent) => s + (e.totalAmount || 0), 0);
        const grandTotal = computeReceiptTotal({ labourCost, machineCost, inputCost, expenseCost });

        const mirroredTasks: PlannedTask[] = data.plannedTasks?.map((t: PlannedTask) => ({
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
                severity: priorityToSeverity(t.priority),
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
        const laborCostGlobal = response.labour?.reduce((s: number, x: LabourEvent) => s + (x.totalCost || 0), 0) || 0;
        const machineCostGlobal = sumMachineryCost(response.machinery || []);
        const inputCostGlobal = response.inputs?.reduce((s: number, x: InputEvent) => s + (x.cost || 0), 0) || 0;
        const expenseCostGlobal = response.activityExpenses?.reduce((s: number, x: ActivityExpenseEvent) => s + (x.totalAmount || 0), 0) || 0;

        // Expense Item Casting Fix
        const mappedExpenses: ActivityExpenseEvent[] = (response.activityExpenses || []).map((exp: ActivityExpenseEvent) => ({
            ...exp,
            items: (exp.items || []).map((item: ExpenseItem) => ({
                ...item,
                qty: item.qty || 1, // Default to 1 if missing to satisfy strict type
                unit: item.unit || 'unit'
            }))
        }));

        const isFarmGlobalScope =
            targetPlotIds.length === 0 && logScope.selectedCropIds.includes(FARM_GLOBAL_ID);

        const voicePlotCount = countPlots(crops);

        if (isFarmGlobalScope) {
            const globalVoiceLog = this.createFarmGlobalVoiceLog(
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
            );
            // Stamp understanding (always, silent — display gated by flag separately)
            const globalVoiceCtx: ScoreContext = { farm: { plotCount: 1 } };
            globalVoiceLog.understanding = scoreVlog(projectLogForScoring(globalVoiceLog), globalVoiceCtx);
            newLogs.push(globalVoiceLog);
            return newLogs;
        }

        const completedIrrigation = response.irrigation?.filter(isCompletedIrrigationEvent);

        const partitions = partitionSelectionByFarmerEvidence(
            resolveSelectedPlots(targetPlotIds, crops),
            [
                response.cropActivities,
                completedIrrigation,
                response.labour,
                response.inputs,
                response.machinery,
                mappedExpenses as ReadonlyArray<{ targetPlotName?: string }>,
            ],
            Boolean(
                response.disturbance
                || response.fullTranscript
                || response.observations?.length
                || response.plannedTasks?.length
            ),
        );

        partitions.forEach(partition => {
            const newLog = buildVoicePartitionLog(
                response,
                completedIrrigation,
                mappedExpenses,
                partition,
                profile,
                weatherStamps,
                provenance,
                nowISO,
                idGen
            );

            // Stamp Understanding Meter score (always, silent — display gated by flag separately)
            const voiceScoreCtx: ScoreContext = { farm: { plotCount: voicePlotCount } };
            newLog.understanding = scoreVlog(projectLogForScoring(newLog), voiceScoreCtx);

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

        const mirroredTasks: PlannedTask[] = response.plannedTasks?.map((pt: AgriLogPlannedTask) => ({
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
            ...(response.observations?.map((obs: ObservationNoteDraft): ObservationNote => ({
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

        const reminderDerivedTasks = buildPlannedTasksFromObservationCandidates(
            mirroredObservations,
            FARM_GLOBAL_ID,
            FARM_GLOBAL_ID,
            FARM_GLOBAL_ID,
            nowISO,
            idGen
        );
        const finalPlannedTasks = [...mirroredTasks, ...reminderDerivedTasks];

        const grandTotal = computeReceiptTotal({ labourCost: laborCostGlobal, machineCost: machineCostGlobal, inputCost: inputCostGlobal, expenseCost: expenseCostGlobal });

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
