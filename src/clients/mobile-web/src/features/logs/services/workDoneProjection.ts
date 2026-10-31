import {
    ActivityExpenseEvent,
    CropActivityEvent,
    InputEvent,
    IrrigationEvent,
    LabourEvent,
    MachineryEvent,
} from '../../../types';
import { isCompletedIrrigationEvent } from './irrigationCompletion';

export type WorkDoneSourceBucketId =
    | 'cropActivities'
    | 'irrigation'
    | 'inputs'
    | 'labour'
    | 'machinery'
    | 'activityExpenses';

export interface WorkDoneProjectionInput {
    cropActivities?: CropActivityEvent[];
    irrigation?: IrrigationEvent[];
    inputs?: InputEvent[];
    labour?: LabourEvent[];
    machinery?: MachineryEvent[];
    activityExpenses?: ActivityExpenseEvent[];
}

export interface WorkDoneProjectionItem {
    id: string;
    sourceBucket: WorkDoneSourceBucketId;
    sourceId?: string;
    title: string;
    detail?: string;
}

const GENERIC_WORK_TITLES = new Set(['Crop Activity', 'Log Entry', 'Field Work', 'Work Done']);

/**
 * The words the "work done" rows are built with (PLR-D10 I13, LP-27). The default is the English the rows have
 * always had, so every existing caller (the closure receipt, the bucket derivation) is byte-identical. (The one
 * caller that passed Marathi, the old review form's activity card, was deleted with that form under founder D-63.)
 * `value` shows a stored fixed value (a method, a unit, a labour kind, an ownership) in that language.
 */
export interface WorkDoneLabels {
    irrigationDone: string;
    hours: (n: number) => string;
    litres: (n: number) => string;
    application: (product: string) => string;
    input: string;
    waterLitres: (n: number) => string;
    labourDone: string;
    workers: (n: number) => string;
    rupees: (n: number) => string;
    fuel: (n: number) => string;
    machineUsed: (type: string | undefined) => string;
    expenseRecorded: string;
    value: (v: string | number | undefined | null) => string;
}

export const ENGLISH_WORK_DONE_LABELS: WorkDoneLabels = {
    irrigationDone: 'Irrigation done',
    hours: n => `${n} hr`,
    litres: n => `${n} L`,
    application: product => `${product} application`,
    input: 'Input',
    waterLitres: n => `${n} L water`,
    labourDone: 'Labour work done',
    workers: n => `${n} worker${n === 1 ? '' : 's'}`,
    rupees: n => `Rs ${n}`,
    fuel: n => `fuel Rs ${n}`,
    machineUsed: type => `${type || 'Machine'} used`,
    expenseRecorded: 'Expense recorded',
    value: v => (v == null ? '' : String(v)),
};

function compact(parts: Array<string | number | undefined | null>): string {
    return parts
        .filter(part => part !== undefined && part !== null && `${part}`.trim().length > 0)
        .join(' ');
}

function joinDetail(parts: Array<string | number | undefined | null>): string | undefined {
    const value = parts
        .filter(part => part !== undefined && part !== null && `${part}`.trim().length > 0)
        .join(' | ');
    return value.length > 0 ? value : undefined;
}

function inputProductLabel(input: InputEvent, L: WorkDoneLabels): string {
    const mixLabels = (input.mix || [])
        .map(item => item.productName)
        .filter(Boolean);

    if (mixLabels.length > 0) {
        return mixLabels.slice(0, 2).join(', ') + (mixLabels.length > 2 ? ` +${mixLabels.length - 2}` : '');
    }

    return input.productName || L.input;
}

function uniqueItems(items: WorkDoneProjectionItem[]): WorkDoneProjectionItem[] {
    const seen = new Set<string>();
    return items.filter(item => {
        const key = `${item.sourceBucket}:${item.title}:${item.detail || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function buildWorkDoneProjection(log: WorkDoneProjectionInput, L: WorkDoneLabels = ENGLISH_WORK_DONE_LABELS): WorkDoneProjectionItem[] {
    const items: WorkDoneProjectionItem[] = [];

    (log.cropActivities || []).forEach((activity, index) => {
        const workTypes = (activity.workTypes || []).filter(type => type && !GENERIC_WORK_TITLES.has(type));
        const title = workTypes[0] || (!GENERIC_WORK_TITLES.has(activity.title) ? activity.title : undefined);

        if (!title) return;

        items.push({
            id: `cropActivities:${activity.id || index}`,
            sourceBucket: 'cropActivities',
            sourceId: activity.id,
            // spec I18 — the work type in his language through the labels' `value` (identity for the English default).
            title: L.value(title) || title,
            detail: joinDetail([
                activity.status && activity.status !== 'completed' ? L.value(activity.status) : undefined,
                activity.quantity !== undefined ? compact([activity.quantity, activity.unit]) : undefined,
                activity.notes,
            ]),
        });
    });

    (log.irrigation || []).filter(isCompletedIrrigationEvent).forEach((irrigation, index) => {
        items.push({
            id: `irrigation:${irrigation.id || index}`,
            sourceBucket: 'irrigation',
            sourceId: irrigation.id,
            title: L.irrigationDone,
            detail: joinDetail([
                L.value(irrigation.method),
                irrigation.durationHours !== undefined ? L.hours(irrigation.durationHours) : undefined,
                irrigation.waterVolumeLitres !== undefined ? L.litres(irrigation.waterVolumeLitres) : undefined,
                L.value(irrigation.source),
            ]),
        });
    });

    (log.inputs || []).forEach((input, index) => {
        const product = inputProductLabel(input, L);
        items.push({
            id: `inputs:${input.id || index}`,
            sourceBucket: 'inputs',
            sourceId: input.id,
            title: L.application(product),
            detail: joinDetail([
                L.value(input.method),
                input.carrierCount !== undefined ? compact([input.carrierCount, L.value(input.carrierType)]) : undefined,
                input.computedWaterVolume !== undefined ? L.waterLitres(input.computedWaterVolume) : undefined,
            ]),
        });
    });

    (log.labour || []).forEach((labour, index) => {
        const totalWorkers = labour.count ?? ((labour.maleCount || 0) + (labour.femaleCount || 0));
        items.push({
            id: `labour:${labour.id || index}`,
            sourceBucket: 'labour',
            sourceId: labour.id,
            title: (labour.activity && (L.value(labour.activity) || labour.activity)) || L.labourDone,
            detail: joinDetail([
                totalWorkers ? L.workers(totalWorkers) : undefined,
                L.value(labour.type),
                labour.totalCost !== undefined ? L.rupees(labour.totalCost) : undefined,
            ]),
        });
    });

    (log.machinery || []).forEach((machine, index) => {
        items.push({
            id: `machinery:${machine.id || index}`,
            sourceBucket: 'machinery',
            sourceId: machine.id,
            title: L.machineUsed(machine.type),
            detail: joinDetail([
                machine.hoursUsed !== undefined ? L.hours(machine.hoursUsed) : undefined,
                L.value(machine.ownership),
                machine.rentalCost !== undefined ? L.rupees(machine.rentalCost) : undefined,
                machine.fuelCost !== undefined ? L.fuel(machine.fuelCost) : undefined,
            ]),
        });
    });

    (log.activityExpenses || []).forEach((expense, index) => {
        items.push({
            id: `activityExpenses:${expense.id || index}`,
            sourceBucket: 'activityExpenses',
            sourceId: expense.id,
            title: expense.reason || expense.category || L.expenseRecorded,
            detail: joinDetail([
                expense.totalAmount !== undefined ? L.rupees(expense.totalAmount) : undefined,
                expense.vendor,
            ]),
        });
    });

    return uniqueItems(items);
}

export function buildWorkDoneTitles(logs: WorkDoneProjectionInput[], L: WorkDoneLabels = ENGLISH_WORK_DONE_LABELS): string[] {
    const items = logs.flatMap(log => buildWorkDoneProjection(log, L));
    return uniqueItems(items).map(item => item.detail ? `${item.title} (${item.detail})` : item.title);
}
