/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * CompareService
 * 
 * Core Purpose: Bridge between Schedule (Plan) and Logs (Execution)
 * 
 * Design Philosophy:
 * - Delta is expected and normalized (farming is unpredictable)
 * - Visibility enables action (hidden gaps cause harvest failure)
 * - Stage-based batching (not day-by-day overwhelm)
 * - "100% effort" becomes measurable
 */

import {
    CropProfile,
    Plot,
    DailyLog,
    PlotScheduleInstance,
    CropScheduleTemplate,
    StageTemplate,
    PlotComparisonSummary,
    StageComparisonUnit,
    ExecutionBucket,
    PlannedItem,
    ExecutedItem,
    IssueSummary
} from '../types';

import {
    getTemplateForCrop,
    getScheduleById,
    calculateDayNumber,
    derivePlannedItemsForStage,
    PlannedTaskDerived
} from '../domain/planning/PlanEngine';

import { getDateKey } from '../domain/system/DateKeyService';

// ============================================
// MAIN COMPARISON GENERATOR
// ============================================

export function generatePlotComparison(
    plot: Plot,
    crop: CropProfile,
    logs: DailyLog[]
): PlotComparisonSummary {

    // 1. Get schedule template and instance
    const template = getScheduleById(crop.activeScheduleId || '')
        || getScheduleById(plot.schedule?.templateId || '')
        || getTemplateForCrop(crop.name);
    const scheduleInstance = plot.schedule;
    const referenceDate = scheduleInstance?.referenceDate || plot.startDate || getDateKey();

    // 2. Calculate current day
    const currentDay = calculateDayNumber(referenceDate, new Date());

    // 3. Filter logs for this plot
    const plotLogs = logs.filter(log =>
        log.context.selection.some(sel =>
            sel.selectedPlotIds.includes(plot.id)
        )
    );

    // 4. Build stage comparisons
    // We pass the full template and instance to allow engine calc
    const stages = template?.stages.map(stage =>
        buildStageComparison(stage, template, scheduleInstance, plotLogs, referenceDate, currentDay)
    ) || [];

    // 5. Find current stage
    const currentStage = stages.find(s =>
        currentDay >= s.plannedStartDay && currentDay <= s.plannedEndDay
    );

    // 6. Calculate totals
    const totalPlanned = stages.reduce((sum, s) =>
        sum + s.buckets.reduce((bs, b) => bs + b.plannedCount, 0), 0
    );
    const totalExecuted = stages.reduce((sum, s) =>
        sum + s.buckets.reduce((bs, b) => bs + b.executedCount, 0), 0
    );
    const totalMissed = stages.reduce((sum, s) =>
        sum + s.buckets.reduce((bs, b) => bs + b.missedCount, 0), 0
    );
    const totalExtra = stages.reduce((sum, s) =>
        sum + s.buckets.reduce((bs, b) => bs + b.extraCount, 0), 0
    );

    // 7. Calculate actual cost (Safeguard optional financialSummary)
    const actualCostSpent = plotLogs.reduce((sum, log) =>
        sum + (log.financialSummary?.grandTotal || 0), 0
    );

    // 8. Determine overall health
    const totalMatched = stages.reduce((sum, s) =>
        sum + s.buckets.reduce((bs, b) => bs + b.matchedCount, 0), 0
    );
    const completionPercent = totalPlanned > 0
        ? Math.min(100, Math.round((totalMatched / totalPlanned) * 100))
        : 0;

    const overallHealth = determineOverallHealth(completionPercent, totalMissed, currentDay, stages);

    return {
        plotId: plot.id,
        plotName: plot.name,
        cropId: crop.id,
        cropName: crop.name,
        referenceDate,
        currentDay,
        currentStage,
        stages,
        overallHealth,
        overallCompletionPercent: completionPercent,
        totalPlanned,
        totalExecuted,
        totalMissed,
        totalExtra,
        actualCostSpent
    };
}

// ============================================
// STAGE COMPARISON BUILDER
// ============================================

function buildStageComparison(
    stageTemplate: StageTemplate,
    template: CropScheduleTemplate,
    instance: PlotScheduleInstance | undefined,
    logs: DailyLog[],
    referenceDate: string,
    currentDay: number
): StageComparisonUnit {

    // Apply any overrides from instance
    const stageOverride = instance?.stageOverrides?.find(o => o.stageId === stageTemplate.id);
    const startDay = stageOverride?.customDayStart ?? stageTemplate.dayStart;
    const endDay = stageOverride?.customDayEnd ?? stageTemplate.dayEnd;

    // Filter logs within this stage's time window
    const refDate = new Date(referenceDate);
    const stageStartDate = new Date(refDate);
    stageStartDate.setDate(stageStartDate.getDate() + startDay);
    const stageEndDate = new Date(refDate);
    stageEndDate.setDate(stageEndDate.getDate() + endDay);
    // Include end day full range
    stageEndDate.setHours(23, 59, 59, 999);
    stageStartDate.setHours(0, 0, 0, 0);

    const stageLogs = logs.filter(log => {
        const logDate = new Date(log.date);
        return logDate >= stageStartDate && logDate <= stageEndDate;
    });

    // START PLAN ENGINE INTEGRATION
    // Get all planned items for this stage from the Engine
    const allPlannedDerived = instance
        ? derivePlannedItemsForStage(template, instance, stageTemplate.id)
        : [];

    // Filter by Category
    const plannedSpray = allPlannedDerived.filter(i => i.category === 'FOLIAR_SPRAY');
    const plannedFert = allPlannedDerived.filter(i => i.category === 'FERTIGATION');
    const plannedIrrig = allPlannedDerived.filter(i => i.category === 'IRRIGATION');
    const plannedActivity = allPlannedDerived.filter(i =>
        i.category !== 'FOLIAR_SPRAY' &&
        i.category !== 'FERTIGATION' &&
        i.category !== 'IRRIGATION'
    );

    // Build execution buckets
    const buckets: ExecutionBucket[] = [
        buildSprayBucket(plannedSpray, stageLogs, referenceDate),
        buildFertigationBucket(plannedFert, stageLogs, referenceDate),
        buildIrrigationBucket(plannedIrrig, stageLogs, referenceDate),
        buildActivityBucket(plannedActivity, stageLogs, referenceDate)
    ];

    // Determine stage status
    const status = determineStageStatus(startDay, endDay, currentDay, buckets);

    // Calculate completion
    const totalPlanned = buckets.reduce((sum, b) => sum + b.plannedCount, 0);
    const totalMatched = buckets.reduce((sum, b) => sum + b.matchedCount, 0);
    const completionPercent = totalPlanned > 0
        ? Math.min(100, Math.round((totalMatched / totalPlanned) * 100))
        : 0;

    // Extract issues
    const issues = buildStageIssues(stageLogs, referenceDate);

    // Find actual dates
    const allExecutedDates = stageLogs.map(l => l.date).sort();

    return {
        stageId: stageTemplate.id,
        stageName: stageTemplate.name,
        stageCode: stageTemplate.code,
        plannedStartDay: startDay,
        plannedEndDay: endDay,
        actualStartDate: allExecutedDates[0],
        actualEndDate: allExecutedDates[allExecutedDates.length - 1],
        status,
        completionPercent,
        buckets,
        issues
    };
}

// ============================================
// BUCKET BUILDERS
// ============================================

function mapDerivedToPlannedItem(derived: PlannedTaskDerived, currentDay: number): PlannedItem {
    let status: 'UPCOMING' | 'PENDING' | 'OVERDUE' | 'COMPLETED' | 'MISSED' = 'UPCOMING';

    if (derived.dueDate !== undefined) {
        if (derived.dueDate < currentDay) status = 'OVERDUE';
        else if (derived.dueDate === currentDay) status = 'PENDING';
        else status = 'UPCOMING';
    }

    return {
        id: derived.id,
        name: derived.name,
        expectedDay: derived.dueDate, // Defined for One-Time
        frequency: derived.type === 'PERIODIC' ? 'Routine' : 'Once',
        notes: derived.notes,
        isMatched: false,
        status: status
    };
}

function buildSprayBucket(
    derivedPlan: PlannedTaskDerived[],
    logs: DailyLog[],
    referenceDate: string
): ExecutionBucket {
    const currentDay = calculateDayNumber(referenceDate, new Date());
    const plannedSprays = derivedPlan.map(d => mapDerivedToPlannedItem(d, currentDay));

    // Get executed sprays from logs
    const executedSprays: ExecutedItem[] = [];
    logs.forEach(log => {
        log.inputs.forEach(input => {
            if (input.method === 'Spray' || input.type === 'pesticide' || input.type === 'fungicide') {
                executedSprays.push({
                    id: `exec_${input.id}`,
                    sourceLogId: log.id,
                    sourceEventId: input.id,
                    name: input.productName || input.mix?.[0]?.productName || 'Spray',
                    executedDate: log.date,
                    executedDay: calculateDayNumber(referenceDate, log.date),
                    quantity: input.quantity || input.carrierCount,
                    unit: input.unit || input.carrierType,
                    cost: input.cost,
                    isMatchedToPlan: false,
                    isExtra: false
                });
            }
        });
    });

    // Match executed to planned
    const { matched, missed, extra } = matchItems(plannedSprays, executedSprays);

    return {
        bucketType: 'SPRAY',
        bucketLabel: 'Sprays & Pesticides',
        planned: plannedSprays,
        executed: executedSprays,
        plannedCount: plannedSprays.length,
        executedCount: executedSprays.length,
        matchedCount: matched,
        missedCount: missed,
        extraCount: extra,
        health: determineBucketHealth(plannedSprays.length, matched, missed)
    };
}

function buildFertigationBucket(
    derivedPlan: PlannedTaskDerived[],
    logs: DailyLog[],
    referenceDate: string
): ExecutionBucket {
    const currentDay = calculateDayNumber(referenceDate, new Date());
    const plannedFertigation = derivedPlan.map(d => mapDerivedToPlannedItem(d, currentDay));

    const executedFertigation: ExecutedItem[] = [];
    logs.forEach(log => {
        log.inputs.forEach(input => {
            // Skip items classified as spray
            if (input.method === 'Spray' || input.type === 'pesticide' || input.type === 'fungicide') {
                return;
            }
            // Everything else is nutrition/fertigation
            if (input.method === 'Drip' || input.method === 'Drenching' || input.method === 'Soil'
                || input.type === 'fertilizer' || input.type === 'bio' || input.type === 'other' || input.type === 'unknown') {
                executedFertigation.push({
                    id: `exec_${input.id}`,
                    sourceLogId: log.id,
                    sourceEventId: input.id,
                    name: input.productName || input.mix?.[0]?.productName || 'Fertigation',
                    executedDate: log.date,
                    executedDay: calculateDayNumber(referenceDate, log.date),
                    quantity: input.quantity,
                    unit: input.unit,
                    cost: input.cost,
                    isMatchedToPlan: false,
                    isExtra: false
                });
            }
        });
    });

    const { matched, missed, extra } = matchItems(plannedFertigation, executedFertigation);

    return {
        bucketType: 'FERTIGATION',
        bucketLabel: 'Fertigation & Nutrients',
        planned: plannedFertigation,
        executed: executedFertigation,
        plannedCount: plannedFertigation.length,
        executedCount: executedFertigation.length,
        matchedCount: matched,
        missedCount: missed,
        extraCount: extra,
        health: determineBucketHealth(plannedFertigation.length, matched, missed)
    };
}

function buildIrrigationBucket(
    derivedPlan: PlannedTaskDerived[],
    logs: DailyLog[],
    referenceDate: string
): ExecutionBucket {
    const currentDay = calculateDayNumber(referenceDate, new Date());
    const plannedIrrigation = derivedPlan.map(d => mapDerivedToPlannedItem(d, currentDay));

    const executedIrrigation: ExecutedItem[] = [];
    logs.forEach(log => {
        log.irrigation.forEach(irrig => {
            executedIrrigation.push({
                id: `exec_${irrig.id}`,
                sourceLogId: log.id,
                sourceEventId: irrig.id,
                name: `${irrig.method} - ${irrig.durationHours || 0}hrs`,
                executedDate: log.date,
                executedDay: calculateDayNumber(referenceDate, log.date),
                quantity: irrig.durationHours,
                unit: 'hours',
                isMatchedToPlan: false,
                isExtra: false
            });
        });
    });

    // Loose matching for irrigation: If specific type matches or if generic "Irrigation"
    const { matched, missed, extra } = matchItems(plannedIrrigation, executedIrrigation);

    return {
        bucketType: 'IRRIGATION',
        bucketLabel: 'Irrigation',
        planned: plannedIrrigation,
        executed: executedIrrigation,
        plannedCount: plannedIrrigation.length,
        executedCount: executedIrrigation.length,
        matchedCount: matched,
        missedCount: missed,
        extraCount: extra,
        health: determineBucketHealth(plannedIrrigation.length, matched, missed)
    };
}

function buildActivityBucket(
    derivedPlan: PlannedTaskDerived[],
    logs: DailyLog[],
    referenceDate: string
): ExecutionBucket {
    const currentDay = calculateDayNumber(referenceDate, new Date());
    const plannedActivities = derivedPlan.map(d => mapDerivedToPlannedItem(d, currentDay));

    const executedActivities: ExecutedItem[] = [];
    logs.forEach(log => {
        // Crop Activities
        log.cropActivities?.forEach(act => {
            executedActivities.push({
                id: `exec_act_${act.id}`,
                sourceLogId: log.id,
                sourceEventId: act.id,
                name: act.title,
                executedDate: log.date,
                executedDay: calculateDayNumber(referenceDate, log.date),
                cost: 0, // Costs are usually in labour/machinery
                isMatchedToPlan: false,
                isExtra: false
            });
        });

        // Labour logic removed for now - focus on Activity logs
    });

    const { matched, missed, extra } = matchItems(plannedActivities, executedActivities);

    return {
        bucketType: 'ACTIVITY',
        bucketLabel: 'Cultural Operations',
        planned: plannedActivities,
        executed: executedActivities,
        plannedCount: plannedActivities.length,
        executedCount: executedActivities.length,
        matchedCount: matched,
        missedCount: missed,
        extraCount: extra,
        health: determineBucketHealth(plannedActivities.length, matched, missed)
    };
}


// ============================================
// MATCHING LOGIC
// ============================================

function matchItems(planned: PlannedItem[], executed: ExecutedItem[]) {
    let matchedCount = 0;

    // 1. Try name-based matching first
    executed.forEach(exec => {
        // Normalize names for fuzzy match
        const execName = exec.name.toLowerCase();

        // Find match
        const match = planned.find(p => {
            // If already matched, skip
            if (p.isMatched) return false;

            const planName = p.name.toLowerCase();

            // Direct inclusion (e.g. Plan: "Foliar Spray", Exec: "Foliar Spray with ...")
            if (execName.includes(planName) || planName.includes(execName)) return true;

            // Common aliases can be added here
            return false;
        });

        if (match) {
            match.isMatched = true;
            match.matchedExecutionId = exec.id;
            match.status = 'COMPLETED';
            exec.isMatchedToPlan = true;
            exec.matchedPlanItemId = match.id;
            matchedCount++;
        } else {
            exec.isExtra = true;
        }
    });

    // 2. Fallback to stage-level quantity matching for the remaining items
    const unmatchedPlanned = planned
        .filter(p => !p.isMatched)
        .sort((a, b) => (a.expectedDay ?? Number.MAX_SAFE_INTEGER) - (b.expectedDay ?? Number.MAX_SAFE_INTEGER));
    const unmatchedExecuted = executed
        .filter(e => !e.isMatchedToPlan)
        .sort((a, b) => a.executedDay - b.executedDay);

    const fallbackMatches = Math.min(unmatchedPlanned.length, unmatchedExecuted.length);
    for (let i = 0; i < fallbackMatches; i++) {
        const p = unmatchedPlanned[i];
        const e = unmatchedExecuted[i];

        p.isMatched = true;
        p.matchedExecutionId = e.id;
        p.status = 'COMPLETED';
        e.isMatchedToPlan = true;
        e.matchedPlanItemId = p.id;
        e.isExtra = false;
        matchedCount++;
    }

    // 3. Mark remaining due items as missed
    planned.forEach(p => {
        if (!p.isMatched && p.status !== 'UPCOMING') {
            p.status = 'MISSED';
        }
    });

    // 4. Count deltas
    const missedCount = planned.filter(p => !p.isMatched).length;
    const extraCount = executed.filter(e => e.isExtra).length;

    return { matched: matchedCount, missed: missedCount, extra: extraCount };
}

// ============================================
// STATUS & HEALTH LOGIC
// ============================================

function determineStageStatus(
    startDay: number,
    endDay: number,
    currentDay: number,
    buckets: ExecutionBucket[]
): 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'OVERDUE' | 'SKIPPED' {
    if (currentDay < startDay) return 'NOT_STARTED';

    const totalPlanned = buckets.reduce((s, b) => s + b.plannedCount, 0);
    const totalExecuted = buckets.reduce((s, b) => s + b.executedCount, 0);

    // If we are past end day
    if (currentDay > endDay) {
        if (totalExecuted >= totalPlanned && totalPlanned > 0) return 'COMPLETED';
        if (totalExecuted === 0 && totalPlanned > 0) return 'SKIPPED';
        return 'OVERDUE'; // Partial
    }

    // Currently in window
    if (totalExecuted > 0) return 'IN_PROGRESS';

    return 'IN_PROGRESS'; // Default if started but no log yet
}

function determineOverallHealth(
    completion: number,
    totalMissed: number,
    currentDay: number,
    stages: StageComparisonUnit[]
): 'EXCELLENT' | 'GOOD' | 'NEEDS_ATTENTION' | 'CRITICAL' {
    const overdueStages = stages.filter(s => s.status === 'OVERDUE' || s.status === 'SKIPPED');

    if (overdueStages.length > 2) return 'CRITICAL';
    if (totalMissed > 5) return 'NEEDS_ATTENTION';
    if (completion > 85) return 'EXCELLENT';
    if (completion > 60) return 'GOOD';

    return 'NEEDS_ATTENTION';
}

function determineBucketHealth(planned: number, matched: number, missed: number): 'ON_TRACK' | 'SLIGHT_LAG' | 'SIGNIFICANT_LAG' | 'CRITICAL' {
    if (planned === 0) return 'ON_TRACK';
    const ratio = matched / planned;
    if (ratio >= 0.8) return 'ON_TRACK';
    if (ratio >= 0.5) return 'SLIGHT_LAG';
    if (ratio >= 0.2) return 'SIGNIFICANT_LAG';
    return 'CRITICAL';
}

function buildStageIssues(logs: DailyLog[], referenceDate: string): IssueSummary[] {
    const issues: IssueSummary[] = [];

    logs.forEach(log => {
        const dayNumber = calculateDayNumber(referenceDate, log.date);

        // 1. Observation Issues
        log.observations?.forEach(obs => {
            if (obs.noteType === 'issue') {
                issues.push({
                    id: obs.id,
                    date: log.date,
                    dayNumber,
                    description: obs.textRaw,
                    severity: obs.severity === 'urgent' ? 'HIGH' : obs.severity === 'important' ? 'MEDIUM' : 'LOW',
                    source: 'OBSERVATION',
                    logId: log.id
                });
            }
        });

        // 2. Event Issues
        // Sprays
        log.inputs?.forEach(i => {
            if (i.issue) {
                issues.push({
                    id: `iss_input_${i.id}`,
                    date: log.date,
                    dayNumber,
                    description: `${i.issue.issueType}: ${i.issue.reason}`,
                    severity: i.issue.severity,
                    source: 'EVENT',
                    logId: log.id
                });
            }
        });

        // Irrigation
        log.irrigation?.forEach(i => {
            if (i.issue) {
                issues.push({
                    id: `iss_irrig_${i.id}`,
                    date: log.date,
                    dayNumber,
                    description: `${i.issue.issueType}: ${i.issue.reason}`,
                    severity: i.issue.severity,
                    source: 'EVENT',
                    logId: log.id
                });
            }
        });

        // Machinery
        log.machinery?.forEach(m => {
            if (m.issue) {
                issues.push({
                    id: `iss_mach_${m.id}`,
                    date: log.date,
                    dayNumber,
                    description: `${m.issue.issueType}: ${m.issue.reason}`,
                    severity: m.issue.severity,
                    source: 'EVENT',
                    logId: log.id
                });
            }
        });

        // Labour
        log.labour?.forEach(l => {
            if (l.issue) {
                issues.push({
                    id: `iss_lab_${l.id}`,
                    date: log.date,
                    dayNumber,
                    description: `${l.issue.issueType}: ${l.issue.reason}`,
                    severity: l.issue.severity,
                    source: 'EVENT',
                    logId: log.id
                });
            }
        });
    });

    return issues;
}
