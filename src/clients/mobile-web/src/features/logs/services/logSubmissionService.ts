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

export interface WizardLogSubmissionPayload {
    context: WizardLogContext;
    activities: Record<string, any>;
    date?: string;
    submissionBatchId?: string;
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

function buildCropActivities(data: Record<string, any>, submissionBatchId: string): CropActivityEvent[] {
    const cropWork = data.crop_activity;
    if (!cropWork?.title?.trim()) {
        return [];
    }

    return [{
        id: `${submissionBatchId}-crop-activity`,
        title: cropWork.title.trim(),
        workTypes: cropWork.workTypes?.length ? cropWork.workTypes : [cropWork.title.trim()],
        notes: cropWork.notes?.trim() || undefined,
        status: 'completed',
    }];
}

function buildIrrigation(data: Record<string, any>, submissionBatchId: string): IrrigationEvent[] {
    const irrigation = data.irrigation;
    if (!irrigation || (!irrigation.durationHours && !irrigation.method && !irrigation.source)) {
        return [];
    }

    return [{
        id: `${submissionBatchId}-irrigation`,
        method: irrigation.method || 'Drip',
        source: irrigation.source || 'Shared Source',
        durationHours: irrigation.durationHours ? Number(irrigation.durationHours) : undefined,
        notes: irrigation.notes?.trim() || undefined,
    }];
}

function buildLabour(data: Record<string, any>, submissionBatchId: string): LabourEvent[] {
    const labour = data.labour;
    if (!labour || (!labour.count && !labour.totalCost && !labour.activity)) {
        return [];
    }

    return [{
        id: `${submissionBatchId}-labour`,
        type: labour.type || 'HIRED',
        count: labour.count ? Number(labour.count) : undefined,
        totalCost: labour.totalCost ? Number(labour.totalCost) : undefined,
        wagePerPerson: labour.wagePerPerson ? Number(labour.wagePerPerson) : undefined,
        activity: labour.activity?.trim() || 'Shared farm work',
        notes: labour.notes?.trim() || undefined,
    }];
}

function buildInputs(data: Record<string, any>, submissionBatchId: string): InputEvent[] {
    const input = data.inputs;
    if (!input || (!input.productName?.trim() && !input.cost)) {
        return [];
    }

    const quantity = input.quantity ? Number(input.quantity) : undefined;
    const mixItem: InputMixItem = {
        id: `${submissionBatchId}-input-mix`,
        productName: input.productName?.trim() || 'Unnamed Input',
        dose: quantity,
        unit: input.unit || 'unit',
    };

    return [{
        id: `${submissionBatchId}-input`,
        method: input.method || 'manual',
        mix: [mixItem],
        cost: input.cost ? Number(input.cost) : undefined,
        notes: input.notes?.trim() || undefined,
        productName: mixItem.productName,
        quantity,
        unit: mixItem.unit,
    }];
}

function buildMachinery(data: Record<string, any>, submissionBatchId: string): MachineryEvent[] {
    const machinery = data.machinery;
    if (!machinery || (!machinery.type && !machinery.hoursUsed && !machinery.rentalCost && !machinery.fuelCost)) {
        return [];
    }

    return [{
        id: `${submissionBatchId}-machinery`,
        type: machinery.type || 'tractor',
        ownership: machinery.ownership || 'owned',
        hoursUsed: machinery.hoursUsed ? Number(machinery.hoursUsed) : undefined,
        rentalCost: machinery.rentalCost ? Number(machinery.rentalCost) : undefined,
        fuelCost: machinery.fuelCost ? Number(machinery.fuelCost) : undefined,
        notes: machinery.notes?.trim() || undefined,
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
