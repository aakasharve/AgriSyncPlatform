import {
    CropActivityEvent,
    CropProfile,
    DailyLog,
    FarmerProfile,
    InputEvent,
    InputMixItem,
    IrrigationEvent,
    LabourEvent,
    LogScope,
    MachineryEvent,
} from '../../../types';
import { LogFactory } from '../../../core/domain/LogFactory';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

export interface WizardLogSelection {
    cropId: string;
    cropName: string;
    plotId: string;
    plotName: string;
    cropCycleId: string;
}

export interface WizardLogContext {
    operatorId: string;
    selections: WizardLogSelection[];
}

/**
 * Open-shape map of bucket-keyed wizard form data. Each bucket builder narrows
 * the corresponding entry at use site (defensive — wizard forms are loosely
 * typed today and may change shape per template / locale).
 */
export type WizardActivityBag = Record<string, unknown>;

export interface WizardLogSubmissionPayload {
    context: WizardLogContext;
    activities: WizardActivityBag;
    date?: string;
    submissionBatchId?: string;
}

/**
 * Field-by-field narrowing helpers for the wizard activity bag.
 * Each builder reads a specific bucket key and tolerates undefined / partial
 * shapes by returning [].
 */
function getRecord(bag: WizardActivityBag, key: string): Record<string, unknown> | undefined {
    const v = bag[key];
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
function asString(v: unknown): string | undefined {
    return typeof v === 'string' ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
    return undefined;
}
function asStringArray(v: unknown): string[] | undefined {
    return Array.isArray(v) && v.every(item => typeof item === 'string') ? (v as string[]) : undefined;
}

export function buildLogScopeFromWizardContext(context: WizardLogContext): LogScope {
    const cropIds = Array.from(new Set(context.selections.map(selection => selection.cropId)));
    const plotIds = context.selections.map(selection => selection.plotId);

    return {
        selectedCropIds: cropIds,
        selectedPlotIds: plotIds,
        mode: plotIds.length > 1 ? 'multi' : 'single',
        applyPolicy: 'broadcast',
    };
}

function buildCropActivities(data: WizardActivityBag, submissionBatchId: string): CropActivityEvent[] {
    const cropWork = getRecord(data, 'cropActivities') ?? getRecord(data, 'crop_activity');
    const title = asString(cropWork?.title)?.trim();
    if (!cropWork || !title) {
        return [];
    }
    const workTypes = asStringArray(cropWork.workTypes);

    return [{
        id: `${submissionBatchId}-crop-activity`,
        title,
        workTypes: workTypes && workTypes.length > 0 ? workTypes : [title],
        notes: asString(cropWork.notes)?.trim() || undefined,
        status: 'completed',
    }];
}

function buildIrrigation(data: WizardActivityBag, submissionBatchId: string): IrrigationEvent[] {
    const irrigation = getRecord(data, 'irrigation');
    const method = asString(irrigation?.method);
    const source = asString(irrigation?.source);
    const durationHours = asNumber(irrigation?.durationHours);
    if (!irrigation || (!durationHours && !method && !source)) {
        return [];
    }

    return [{
        id: `${submissionBatchId}-irrigation`,
        method: (method as IrrigationEvent['method']) || 'Drip',
        source: source || 'Shared Source',
        durationHours,
        notes: asString(irrigation.notes)?.trim() || undefined,
    }];
}

function buildLabour(data: WizardActivityBag, submissionBatchId: string): LabourEvent[] {
    const labour = getRecord(data, 'labour');
    const count = asNumber(labour?.count);
    const totalCost = asNumber(labour?.totalCost);
    const activity = asString(labour?.activity)?.trim();
    if (!labour || (!count && !totalCost && !activity)) {
        return [];
    }

    return [{
        id: `${submissionBatchId}-labour`,
        type: (asString(labour.type) as LabourEvent['type']) || 'HIRED',
        count,
        totalCost,
        wagePerPerson: asNumber(labour.wagePerPerson),
        activity: activity || 'Shared farm work',
        notes: asString(labour.notes)?.trim() || undefined,
    }];
}

function buildInputs(data: WizardActivityBag, submissionBatchId: string): InputEvent[] {
    const input = getRecord(data, 'inputs');
    const productName = asString(input?.productName)?.trim();
    const cost = asNumber(input?.cost);
    if (!input || (!productName && !cost)) {
        return [];
    }

    const quantity = asNumber(input.quantity);
    const unit = asString(input.unit) || 'unit';
    const mixItem: InputMixItem = {
        id: `${submissionBatchId}-input-mix`,
        productName: productName || 'Unnamed Input',
        dose: quantity,
        unit,
    };

    return [{
        id: `${submissionBatchId}-input`,
        method: (asString(input.method) as InputEvent['method']) || 'manual',
        mix: [mixItem],
        cost,
        notes: asString(input.notes)?.trim() || undefined,
        productName: mixItem.productName,
        quantity,
        unit: mixItem.unit,
    }];
}

function buildMachinery(data: WizardActivityBag, submissionBatchId: string): MachineryEvent[] {
    const machinery = getRecord(data, 'machinery');
    const type = asString(machinery?.type);
    const hoursUsed = asNumber(machinery?.hoursUsed);
    const rentalCost = asNumber(machinery?.rentalCost);
    const fuelCost = asNumber(machinery?.fuelCost);
    if (!machinery || (!type && !hoursUsed && !rentalCost && !fuelCost)) {
        return [];
    }

    return [{
        id: `${submissionBatchId}-machinery`,
        type: (type as MachineryEvent['type']) || 'tractor',
        ownership: (asString(machinery.ownership) as MachineryEvent['ownership']) || 'owned',
        hoursUsed,
        rentalCost,
        fuelCost,
        notes: asString(machinery.notes)?.trim() || undefined,
    }];
}

export function splitLogSubmission(
    payload: WizardLogSubmissionPayload,
    crops: CropProfile[],
    profile: FarmerProfile
): DailyLog[] {
    const submissionBatchId = payload.submissionBatchId || idGenerator.generate();
    const date = payload.date || getDateKey();
    const manualEntryPayload = {
        date,
        cropActivities: buildCropActivities(payload.activities, submissionBatchId),
        irrigation: buildIrrigation(payload.activities, submissionBatchId),
        labour: buildLabour(payload.activities, submissionBatchId),
        inputs: buildInputs(payload.activities, submissionBatchId),
        machinery: buildMachinery(payload.activities, submissionBatchId),
        activityExpenses: [],
        observations: [],
        plannedTasks: [],
        fullTranscript: `Wizard batch ${submissionBatchId}`,
    };

    const effectiveProfile: FarmerProfile = {
        ...profile,
        activeOperatorId: payload.context.operatorId,
    };

    return LogFactory.createFromManualEntry(
        manualEntryPayload,
        buildLogScopeFromWizardContext(payload.context),
        crops,
        effectiveProfile
    );
}
