import {
    LabourEvent, InputEvent, MachineryEvent, ActivityExpenseEvent
} from '../../../types';

/**
 * Pure helper functions extracted from LogFactory to keep that file under the
 * Plan 04 §DoD 800-line cap. Behavior-neutral move: these were `private static`
 * methods on `LogFactory`, all of them pure functions of their arguments. The
 * extraction keeps the call sites identical apart from swapping `this.<fn>(...)`
 * for `<fn>(...)`.
 */

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
    // ActivityExpenseEvent does not declare `targetPlotName` (unlike sibling
    // event types) but voice/manual payloads may still attach it for plot
    // bucketing. Read it through a narrowed structural type instead of `any`.
    type WithTargetPlot = ActivityExpenseEvent & { targetPlotName?: string };
    return (expenseEvents || [])
        .filter(event => {
            const targetPlotName = (event as WithTargetPlot).targetPlotName;
            return !targetPlotName || targetPlotName === plotName;
        })
        .map(event => {
            const targetPlotName = (event as WithTargetPlot).targetPlotName;
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
    return events.reduce((sum, event) => sum + (event.rentalCost || event.fuelCost || 0), 0);
}

export function sumExpenseCost(events: ActivityExpenseEvent[]): number {
    return events.reduce((sum, event) => sum + (event.totalAmount || 0), 0);
}
