import {
    LabourEvent, InputEvent, MachineryEvent, ActivityExpenseEvent,
    CropProfile, DailyLog, AgriLogResponse, PlannedTask, ObservationSeverity
} from '../../../types';

/**
 * Pure helper functions extracted from LogFactory to keep that file under the
 * Plan 04 §DoD 800-line cap. Behavior-neutral move: these were `private static`
 * methods on `LogFactory`, all of them pure functions of their arguments. The
 * extraction keeps the call sites identical apart from swapping `this.<fn>(...)`
 * for `<fn>(...)`.
 */

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

export function scopeChildId(baseId: string, plotId: string): string {
    return `${baseId}::${plotId}`;
}

export function filterEventsForPlot<T extends { id: string; targetPlotName?: string }>(
    events: T[] | undefined,
    plotName: string,
    plotId: string
): T[] {
    return (events || [])
        .filter(event => !event.targetPlotName || event.targetPlotName === plotName)
        .map(event => ({
            ...event,
            id: scopeChildId(event.id, plotId)
        }));
}

export function allocateLabourForPlot(
    labourEvents: LabourEvent[] | undefined,
    plotName: string,
    plotId: string,
    plotIndex: number,
    plotCount: number
): LabourEvent[] {
    return (labourEvents || [])
        .filter(event => !event.targetPlotName || event.targetPlotName === plotName)
        .map(event => {
            const isShared = !event.targetPlotName;
            return {
                ...event,
                id: scopeChildId(event.id, plotId),
                totalCost: allocateOptionalAmount(event.totalCost, isShared, plotIndex, plotCount)
            };
        });
}

export function allocateInputsForPlot(
    inputEvents: InputEvent[] | undefined,
    plotName: string,
    plotId: string,
    plotIndex: number,
    plotCount: number
): InputEvent[] {
    return (inputEvents || [])
        .filter(event => !event.targetPlotName || event.targetPlotName === plotName)
        .map(event => {
            const isShared = !event.targetPlotName;
            return {
                ...event,
                id: scopeChildId(event.id, plotId),
                cost: allocateOptionalAmount(event.cost, isShared, plotIndex, plotCount),
                mix: (event.mix || []).map(item => ({
                    ...item,
                    id: scopeChildId(item.id, plotId)
                }))
            };
        });
}

export function allocateMachineryForPlot(
    machineryEvents: MachineryEvent[] | undefined,
    plotName: string,
    plotId: string,
    plotIndex: number,
    plotCount: number
): MachineryEvent[] {
    return (machineryEvents || [])
        .filter(event => !event.targetPlotName || event.targetPlotName === plotName)
        .map(event => {
            const isShared = !event.targetPlotName;
            return {
                ...event,
                id: scopeChildId(event.id, plotId),
                rentalCost: allocateOptionalAmount(event.rentalCost, isShared, plotIndex, plotCount),
                fuelCost: allocateOptionalAmount(event.fuelCost, isShared, plotIndex, plotCount)
            };
        });
}

export function allocateActivityExpensesForPlot(
    expenseEvents: ActivityExpenseEvent[] | undefined,
    plotName: string,
    plotId: string,
    plotIndex: number,
    plotCount: number
): ActivityExpenseEvent[] {
    return (expenseEvents || [])
        .filter(event => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const targetPlotName = (event as any).targetPlotName as string | undefined;
            return !targetPlotName || targetPlotName === plotName;
        })
        .map(event => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const targetPlotName = (event as any).targetPlotName as string | undefined;
            const isShared = !targetPlotName;

            return {
                ...event,
                id: scopeChildId(event.id, plotId),
                totalAmount: allocateOptionalAmount(event.totalAmount, isShared, plotIndex, plotCount),
                items: (event.items || []).map(item => ({
                    ...item,
                    id: scopeChildId(item.id, plotId),
                    total: allocateOptionalAmount(item.total, isShared, plotIndex, plotCount)
                }))
            };
        });
}

export function allocateOptionalAmount(
    value: number | null | undefined,
    isShared: boolean,
    plotIndex: number,
    plotCount: number
): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (!isShared || plotCount <= 1) return value;
    return allocateAmountAcrossPlots(value, plotIndex, plotCount);
}

export function allocateAmountAcrossPlots(total: number, plotIndex: number, plotCount: number): number {
    if (plotCount <= 1) return total;

    const totalCents = Math.round(total * 100);
    const baseShare = Math.trunc(totalCents / plotCount);
    const remainder = totalCents - (baseShare * plotCount);
    const shareCents = baseShare + (plotIndex < remainder ? 1 : 0);

    return shareCents / 100;
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
