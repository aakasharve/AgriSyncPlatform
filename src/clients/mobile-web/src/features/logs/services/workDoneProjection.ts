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

function inputProductLabel(input: InputEvent): string {
    const mixLabels = (input.mix || [])
        .map(item => item.productName)
        .filter(Boolean);

    if (mixLabels.length > 0) {
        return mixLabels.slice(0, 2).join(', ') + (mixLabels.length > 2 ? ` +${mixLabels.length - 2}` : '');
    }

    return input.productName || 'Input';
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

export function buildWorkDoneProjection(log: WorkDoneProjectionInput): WorkDoneProjectionItem[] {
    const items: WorkDoneProjectionItem[] = [];

    (log.cropActivities || []).forEach((activity, index) => {
        const workTypes = (activity.workTypes || []).filter(type => type && !GENERIC_WORK_TITLES.has(type));
        const title = workTypes[0] || (!GENERIC_WORK_TITLES.has(activity.title) ? activity.title : undefined);

        if (!title) return;

        items.push({
            id: `cropActivities:${activity.id || index}`,
            sourceBucket: 'cropActivities',
            sourceId: activity.id,
            title,
            detail: joinDetail([
                activity.status && activity.status !== 'completed' ? activity.status : undefined,
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
            title: 'Irrigation done',
            detail: joinDetail([
                irrigation.method,
                irrigation.durationHours !== undefined ? `${irrigation.durationHours} hr` : undefined,
                irrigation.waterVolumeLitres !== undefined ? `${irrigation.waterVolumeLitres} L` : undefined,
                irrigation.source,
            ]),
        });
    });

    (log.inputs || []).forEach((input, index) => {
        const product = inputProductLabel(input);
        items.push({
            id: `inputs:${input.id || index}`,
            sourceBucket: 'inputs',
            sourceId: input.id,
            title: `${product} application`,
            detail: joinDetail([
                input.method,
                input.carrierCount !== undefined ? compact([input.carrierCount, input.carrierType]) : undefined,
                input.computedWaterVolume !== undefined ? `${input.computedWaterVolume} L water` : undefined,
            ]),
        });
    });

    (log.labour || []).forEach((labour, index) => {
        const totalWorkers = labour.count ?? ((labour.maleCount || 0) + (labour.femaleCount || 0));
        items.push({
            id: `labour:${labour.id || index}`,
            sourceBucket: 'labour',
            sourceId: labour.id,
            title: labour.activity || 'Labour work done',
            detail: joinDetail([
                totalWorkers ? `${totalWorkers} worker${totalWorkers === 1 ? '' : 's'}` : undefined,
                labour.type,
                labour.totalCost !== undefined ? `Rs ${labour.totalCost}` : undefined,
            ]),
        });
    });

    (log.machinery || []).forEach((machine, index) => {
        items.push({
            id: `machinery:${machine.id || index}`,
            sourceBucket: 'machinery',
            sourceId: machine.id,
            title: `${machine.type || 'Machine'} used`,
            detail: joinDetail([
                machine.hoursUsed !== undefined ? `${machine.hoursUsed} hr` : undefined,
                machine.ownership,
                machine.rentalCost !== undefined ? `Rs ${machine.rentalCost}` : undefined,
                machine.fuelCost !== undefined ? `fuel Rs ${machine.fuelCost}` : undefined,
            ]),
        });
    });

    (log.activityExpenses || []).forEach((expense, index) => {
        items.push({
            id: `activityExpenses:${expense.id || index}`,
            sourceBucket: 'activityExpenses',
            sourceId: expense.id,
            title: expense.reason || expense.category || 'Expense recorded',
            detail: joinDetail([
                expense.totalAmount !== undefined ? `Rs ${expense.totalAmount}` : undefined,
                expense.vendor,
            ]),
        });
    });

    return uniqueItems(items);
}

export function buildWorkDoneTitles(logs: WorkDoneProjectionInput[]): string[] {
    const items = logs.flatMap(log => buildWorkDoneProjection(log));
    return uniqueItems(items).map(item => item.detail ? `${item.title} (${item.detail})` : item.title);
}
