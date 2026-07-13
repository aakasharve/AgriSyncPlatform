/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesScheduleWindow — pure "was today's planned {category} work done?" gap
 * signal (Phase 5, Task 3A).
 *
 * The plan data is REAL (every plot has a live schedule; ClientPlanEngine
 * already derives today's plan) but the named-task match is fuzzy — only the
 * CATEGORY level (spray / fertigation / irrigation / activity) is trustworthy.
 * This module NEVER surfaces a precise task-name claim, only a category.
 *
 * DRY: reuses the SAME primitives dayState.ts's computeDayState /
 * getOverdueStageSignal already use for plan-vs-done —
 * ClientPlanEngine.derivePlannedItemsForDay for today's plan and
 * dayState.getExecutionCountByCategory for executed counts. Neither
 * plan-derivation nor execution-counting logic is re-implemented here.
 *
 * PURE: no Date.now(), no network, no React/DOM. todayLocalDate is passed in.
 *
 * spec: dfes-companion-2026-07-11
 */
import type { CropProfile, DailyLog } from '../../../types';
import {
    calculateDayNumber,
    derivePlannedItemsForDay,
    getScheduleById,
    getTemplateForCrop,
} from '../../scheduler/planning/ClientPlanEngine';
import { getExecutionCountByCategory, type OperationCategory } from '../../../shared/utils/dayState';

export type { OperationCategory };

export interface ScheduleGapContext {
    /** One of the 4 category buckets dayState.ts already reports on (real, not fabricated). */
    category: OperationCategory;
    /** Real Marathi label for the category — reused from existing app copy, never invented. */
    categoryLabelMr: string;
    /** Best-effort planned-item name for TELEMETRY ONLY — never shown as a precise task claim. */
    plannedItemName?: string;
}

/**
 * Real Marathi words already live in the app for these 4 categories — reused
 * verbatim here, never fabricated:
 *   - FOLIAR_SPRAY 'फवारणी' — canonical spray term (shared/utils/marathiPrompts.ts SPRAY vocabulary)
 *   - FERTIGATION  'खत'    — i18n/translations.ts context.inputs 'खत आणि औषधे' / noInputs 'आज खत/औषध वापरले नाही'
 *   - IRRIGATION   'सिंचन'  — i18n/translations.ts context.irrigation
 *   - ACTIVITY     'कामे'   — i18n/translations.ts activitiesLogged 'कामे नोंदवली'
 */
const CATEGORY_LABEL_MR: Readonly<Record<OperationCategory, string>> = {
    FOLIAR_SPRAY: 'फवारणी',
    FERTIGATION: 'खत',
    IRRIGATION: 'सिंचन',
    ACTIVITY: 'कामे',
};

/**
 * Deterministic top-gap pick when more than one category qualifies on the
 * same day: spray > fertigation > irrigation > activity. Spray is highest
 * because a missed spray window is the most time-sensitive of the four
 * (pest/disease pressure and re-entry/PHI timing), fertigation/irrigation
 * next (input timing), activity (general work) lowest.
 */
const CATEGORY_PRIORITY: readonly OperationCategory[] = ['FOLIAR_SPRAY', 'FERTIGATION', 'IRRIGATION', 'ACTIVITY'];

/**
 * Buckets the wider scheduler OperationCategory (7 values, scheduler.types.ts)
 * down to the 4-value reporting bucket dayState.ts already uses. Mirrors the
 * identical split already used by features/compare/plotComparisonService.ts
 * (`i.category !== 'FOLIAR_SPRAY' && i.category !== 'FERTIGATION' && i.category !== 'IRRIGATION'` => activity).
 */
const toBucketCategory = (category: string): OperationCategory => {
    if (category === 'FOLIAR_SPRAY' || category === 'FERTIGATION' || category === 'IRRIGATION') return category;
    return 'ACTIVITY';
};

const normalizeDateKey = (value: string): string => (value.includes('T') ? value.split('T')[0] : value);

/**
 * Returns the single top schedule gap for `plotId` on `todayLocalDate`, or
 * null when there is nothing honest to ask about (no plot/schedule/template,
 * nothing planned today, or every planned category already has executed
 * work today).
 */
export function computeScheduleGap(
    crops: CropProfile[],
    history: DailyLog[],
    plotId: string | null,
    todayLocalDate: string,
): ScheduleGapContext | null {
    if (!plotId) return null;

    const match = crops
        .flatMap(crop => crop.plots.map(plot => ({ crop, plot })))
        .find(item => item.plot.id === plotId);
    if (!match) return null;

    const { crop, plot } = match;
    if (!plot.schedule) return null;

    // Same template-resolution chain computeDayState/getOverdueStageSignal use (shared/utils/dayState.ts).
    const template =
        getScheduleById(crop.activeScheduleId || '')
        || getScheduleById(plot.schedule.templateId || '')
        || getTemplateForCrop(crop.name);
    if (!template) return null;

    const referenceDate = plot.schedule.referenceDate || plot.startDate || todayLocalDate;
    const dayNumber = calculateDayNumber(referenceDate, todayLocalDate);
    const dailyPlan = derivePlannedItemsForDay(template, plot.schedule, dayNumber);
    if (dailyPlan.plannedItems.length === 0) return null;

    const plannedByCategory = new Map<OperationCategory, string>();
    dailyPlan.plannedItems.forEach(item => {
        const bucket = toBucketCategory(item.category);
        if (!plannedByCategory.has(bucket)) plannedByCategory.set(bucket, item.name);
    });

    const todaysPlotLogs = history.filter(log =>
        normalizeDateKey(log.date) === todayLocalDate
        && log.context.selection.some(selection => (selection.selectedPlotIds || []).includes(plot.id))
    );

    for (const category of CATEGORY_PRIORITY) {
        if (!plannedByCategory.has(category)) continue;
        const executed = getExecutionCountByCategory(todaysPlotLogs, category);
        if (executed === 0) {
            return {
                category,
                categoryLabelMr: CATEGORY_LABEL_MR[category],
                plannedItemName: plannedByCategory.get(category),
            };
        }
    }

    return null;
}
