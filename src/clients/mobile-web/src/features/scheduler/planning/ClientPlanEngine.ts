/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * PlanEngine.ts
 * 
 * The Single Point of Truth for Planning.
 * Responsibilities:
 * 1. Template Registry (Get correct template for crop)
 * 2. Operation Registry (Categorize operations)
 * 3. Schedule Derivation (Turn templates + instances into daily/stage plans)
 */

import {
    CropScheduleTemplate,
    PlotScheduleInstance,
    StageTemplate,
    OperationType,
    OperationCategory,
    FrequencyMode,
    PeriodicExpectation,
    OneTimeExpectation
} from '../scheduler.types';

import {
    getPrimaryTemplateForCrop as fetchTemplate,
    getTemplateById,
} from '../../../infrastructure/reference/TemplateCatalog';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

// ============================================
// 1. OPERATION REGISTRY
// ============================================

const OPS: Record<string, OperationType> = {
    // Irrigation
    'op_irrig_drip': { id: 'op_irrig_drip', category: 'IRRIGATION', name: 'Drip Irrigation' },
    'op_irrig_flood': { id: 'op_irrig_flood', category: 'IRRIGATION', name: 'Flood Irrigation' },

    // Fertigation
    'op_fert_gen': { id: 'op_fert_gen', category: 'FERTIGATION', name: 'Fertigation' },

    // Sprays
    'op_spray_gen': { id: 'op_spray_gen', category: 'FOLIAR_SPRAY', name: 'Foliar Spray' },

    // Cultural Operations
    'op_weed_man': { id: 'op_weed_man', category: 'WEED_CONTROL', name: 'Manual Weeding' },
    'op_pruning': { id: 'op_pruning', category: 'CULTURAL_OPERATION', name: 'Pruning' },
    'op_thinning': { id: 'op_thinning', category: 'CULTURAL_OPERATION', name: 'Thinning' },
    'op_harvest': { id: 'op_harvest', category: 'CULTURAL_OPERATION', name: 'Harvesting' },
    'op_pest_scout': { id: 'op_pest_scout', category: 'CULTURAL_OPERATION', name: 'Pest Scouting' },
    'op_field_prep': { id: 'op_field_prep', category: 'CULTURAL_OPERATION', name: 'Field Preparation' },
    'op_drainage_audit': { id: 'op_drainage_audit', category: 'CULTURAL_OPERATION', name: 'Drainage Audit' },
    'op_gap_fill': { id: 'op_gap_fill', category: 'CULTURAL_OPERATION', name: 'Gap Filling' },
    'op_earthing_up': { id: 'op_earthing_up', category: 'CULTURAL_OPERATION', name: 'Earthing Up' },
    'op_growth_check': { id: 'op_growth_check', category: 'CULTURAL_OPERATION', name: 'Growth Check' },
    'op_quality_check': { id: 'op_quality_check', category: 'CULTURAL_OPERATION', name: 'Quality Check' },
    'op_harvest_plan': { id: 'op_harvest_plan', category: 'CULTURAL_OPERATION', name: 'Harvest Planning' },
    'op_post_harvest_cleanup': { id: 'op_post_harvest_cleanup', category: 'CULTURAL_OPERATION', name: 'Post Harvest Cleanup' },
    'op_phi_watch': { id: 'op_phi_watch', category: 'CULTURAL_OPERATION', name: 'PHI Countdown Check' }
};

export const getOperationRegistry = (): Record<string, OperationType> => OPS;

export const getOperationCategory = (opId: string): OperationCategory | 'UNKNOWN' => {
    return OPS[opId]?.category || 'UNKNOWN';
};

export const getOperationName = (opId: string): string => {
    return OPS[opId]?.name || opId;
};

/**
 * Calculates day number relative to a reference date.
 * Day 0 = Reference Date.
 */
export const calculateDayNumber = (referenceDateStr: string, targetDateStr: string | Date): number => {
    const start = new Date(referenceDateStr);
    start.setHours(0, 0, 0, 0);

    const target = new Date(targetDateStr);
    target.setHours(0, 0, 0, 0);

    const diff = target.getTime() - start.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
};

// ============================================
// 2. TEMPLATE ACCESS
// ============================================

export const getTemplateForCrop = (cropName: string): CropScheduleTemplate => {
    return fetchTemplate(cropName);
};

export { getTemplateById as getScheduleById };

// ============================================
// 3. PLAN DERIVATION (CORE ENGINE)
// ============================================

export interface DailyPlan {
    dayNumber: number;
    stage: StageTemplate | null;
    plannedItems: PlannedTaskDerived[];
}

export interface PlannedTaskDerived {
    id: string; // plan_xxx
    originalId: string; // pe_xxx or ot_xxx
    type: 'PERIODIC' | 'ONE_TIME';
    operationId: string;
    category: OperationCategory;
    name: string;
    notes?: string;
    isDueToday: boolean;
    dueDate?: number; // Day number
}

/**
 * Returns the plan for a specific day.
 * Replaces schedulerUtils.getExpectationsForDay
 */
export const derivePlannedItemsForDay = (
    template: CropScheduleTemplate,
    instance: PlotScheduleInstance,
    dayNumber: number
): DailyPlan => {

    const stage = getCurrentStage(template, instance, dayNumber);
    if (!stage) return { dayNumber, stage: null, plannedItems: [] };

    const items: PlannedTaskDerived[] = [];

    // 1. Periodic Expectations
    const periodic = template.periodicExpectations.filter(pe => {
        if (pe.stageId !== stage.id) return false;

        // Apply Overrides
        const override = instance.expectationOverrides.find(o => o.expectationId === pe.id);
        const mode = override?.customFrequencyMode ?? pe.frequencyMode;
        const value = override?.customFrequencyValue ?? pe.frequencyValue;

        if (mode === 'EVERY_N_DAYS') {
            // Calculate relative to stage start
            const stageStart = getStageStartDay(stage, instance);
            const relDay = dayNumber - stageStart;
            return relDay >= 0 && relDay % value === 0;
        }
        if (mode === 'PER_WEEK') {
            // Logic for "Per Week" is tricky in day-view. 
            // Usually suggests "Anytime this week". 
            // For now, we map it to specific days for visibility or leave generic?
            // Current schedulerUtils just returned 'true' which means "Show every day".
            // Implementation: Show it every day as "Due this week"? 
            // Or pick a specific day? 
            // Existing app behavior matches "Available Today".
            return true;
        }
        return false;
    });

    periodic.forEach(pe => {
        items.push({
            id: `plan_${pe.id}_day_${dayNumber}`,
            originalId: pe.id,
            type: 'PERIODIC',
            operationId: pe.operationTypeId,
            category: getOperationCategory(pe.operationTypeId) as OperationCategory,
            name: `${getOperationName(pe.operationTypeId)} (Routine)`,
            notes: pe.notes,
            isDueToday: true,
            dueDate: dayNumber
        });
    });

    // 2. One Time Expectations
    const oneTime = template.oneTimeExpectations.filter(ot => {
        // Strict match for "Due Date"
        const diff = ot.targetDayFromRef - dayNumber;
        return Math.abs(diff) < 0.5;
    });

    oneTime.forEach(ot => {
        items.push({
            id: `plan_${ot.id}`,
            originalId: ot.id,
            type: 'ONE_TIME',
            operationId: ot.operationTypeId,
            category: getOperationCategory(ot.operationTypeId) as OperationCategory,
            name: getOperationName(ot.operationTypeId),
            notes: ot.notes,
            isDueToday: true,
            dueDate: ot.targetDayFromRef
        });
    });

    return {
        dayNumber,
        stage,
        plannedItems: items
    };
};

/**
 * Returns all planned items for a stage (for Comparison).
 * Replaces compareService.getPlannedItemsForBucket
 */
export const derivePlannedItemsForStage = (
    template: CropScheduleTemplate,
    instance: PlotScheduleInstance,
    stageId: string
    // categoryFilter? : OperationCategory
): PlannedTaskDerived[] => {

    const items: PlannedTaskDerived[] = [];
    const stage = template.stages.find(s => s.id === stageId);
    if (!stage) return [];
    const stageStart = getStageStartDay(stage, instance);
    const stageEnd = getStageEndDay(stage, instance);
    const currentDay = calculateDayNumber(instance.referenceDate, new Date());
    const effectiveEndDay = Math.min(stageEnd, currentDay);

    // If stage has not started yet, nothing is due.
    if (effectiveEndDay < stageStart) return [];

    const derivePeriodicDueDays = (mode: FrequencyMode, value: number): number[] => {
        const safeValue = Math.max(1, value);
        const interval = mode === 'EVERY_N_DAYS'
            ? safeValue
            : Math.max(1, Math.floor(7 / safeValue));
        const dueDays: number[] = [];

        for (let day = stageStart; day <= effectiveEndDay; day += interval) {
            dueDays.push(day);
        }

        return dueDays;
    };

    // 1. Periodic (expanded to expected occurrences up to today)
    const periodic = template.periodicExpectations.filter(pe => pe.stageId === stageId);
    periodic.forEach(pe => {
        const override = instance.expectationOverrides.find(o => o.expectationId === pe.id);
        const mode = override?.customFrequencyMode ?? pe.frequencyMode;
        const value = override?.customFrequencyValue ?? pe.frequencyValue;
        const dueDays = derivePeriodicDueDays(mode, value);

        dueDays.forEach((dueDay, idx) => {
            items.push({
                id: `plan_${pe.id}_day_${dueDay}`,
                originalId: pe.id,
                type: 'PERIODIC',
                operationId: pe.operationTypeId,
                category: getOperationCategory(pe.operationTypeId) as OperationCategory,
                name: `${getOperationName(pe.operationTypeId)} #${idx + 1}`,
                notes: pe.notes,
                isDueToday: dueDay === currentDay,
                dueDate: dueDay
            });
        });
    });

    // 2. One Time (only include what is due up to today)
    const oneTime = template.oneTimeExpectations.filter(ot =>
        ot.stageId === stageId
        && ot.targetDayFromRef >= stageStart
        && ot.targetDayFromRef <= effectiveEndDay
    );
    oneTime.forEach(ot => {
        items.push({
            id: `plan_${ot.id}`,
            originalId: ot.id,
            type: 'ONE_TIME',
            operationId: ot.operationTypeId,
            category: getOperationCategory(ot.operationTypeId) as OperationCategory,
            name: `${getOperationName(ot.operationTypeId)}`,
            notes: ot.notes,
            isDueToday: false,
            dueDate: ot.targetDayFromRef
        });
    });

    return items.sort((a, b) => (a.dueDate ?? Number.MAX_SAFE_INTEGER) - (b.dueDate ?? Number.MAX_SAFE_INTEGER));
};


// ============================================
// HELPERS
// ============================================

export const getStageStartDay = (stage: StageTemplate, instance: PlotScheduleInstance): number => {
    const override = instance.stageOverrides.find(o => o.stageId === stage.id);
    return override?.customDayStart ?? stage.dayStart;
};

export const getStageEndDay = (stage: StageTemplate, instance: PlotScheduleInstance): number => {
    const override = instance.stageOverrides.find(o => o.stageId === stage.id);
    return override?.customDayEnd ?? stage.dayEnd;
};

export const getCurrentStage = (
    template: CropScheduleTemplate,
    instance: PlotScheduleInstance,
    dayNumber: number
): StageTemplate | null => {
    if (!template || !template.stages.length) return null;

    // We can't use simple find because ranges might be overridden
    // Reusing logic from schedulerUtils but cleaner

    // Construct effective ranges
    const effectiveStages = template.stages.map(s => ({
        original: s,
        start: getStageStartDay(s, instance),
        end: getStageEndDay(s, instance)
    }));

    const match = effectiveStages.find(s => dayNumber >= s.start && dayNumber <= s.end);
    if (match) return match.original;

    // Cap at last stage if over
    const last = effectiveStages[effectiveStages.length - 1];
    if (dayNumber > last.end) return last.original;

    // Start at first if under
    if (dayNumber < effectiveStages[0].start) return effectiveStages[0].original;

    return null;
};

export const createInitialScheduleInstance = (plotId: string, cropName: string, referenceDate: string): PlotScheduleInstance => {
    const template = getTemplateForCrop(cropName);
    return {
        id: `sch_${idGenerator.generate()}`,
        plotId,
        templateId: template.id,
        referenceType: template.referenceType,
        referenceDate: referenceDate,
        stageOverrides: [],
        expectationOverrides: []
    };
};

export const getEffectiveStartDate = (plot: { startDate?: string; schedule?: { referenceDate?: string } }): Date | null => {
    if (plot.startDate) return new Date(plot.startDate);
    if (plot.schedule?.referenceDate) return new Date(plot.schedule.referenceDate);
    return null;
};

export const getDaysSinceStart = (referenceDateStr: string): number => {
    return calculateDayNumber(referenceDateStr, new Date());
};
