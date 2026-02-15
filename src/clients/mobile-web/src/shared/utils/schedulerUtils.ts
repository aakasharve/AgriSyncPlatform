
import {
    CropProfile,
    Plot
} from '../../types';
import { idGenerator } from '../../core/domain/services/IdGenerator';
import {
    PlotScheduleInstance,
    CropScheduleTemplate,
    StageTemplate,
    PeriodicExpectation,
    OneTimeExpectation,
    OperationType,
    OperationCategory,
    ScheduleReferenceType,
    ScheduleOwnerType
} from '../../features/scheduler/scheduler.types';

// --- FACTORY: Operation Types ---

const createOp = (id: string, category: OperationCategory, name: string): OperationType => ({
    id, category, name
});

const OP_IRRIGATION_DRIP = createOp('op_irrig_drip', 'IRRIGATION', 'Drip Irrigation');
const OP_FERTIGATION_DEFAULT = createOp('op_fert_gen', 'FERTIGATION', 'Fertigation');
const OP_FOLIAR_SPRAY = createOp('op_spray_gen', 'FOLIAR_SPRAY', 'Foliar Spray');
const OP_WEEDING = createOp('op_weed_man', 'WEED_CONTROL', 'Manual Weeding');

// --- FACTORY: Templates ---

export const getTomatoScheduleTemplate = (): CropScheduleTemplate => {
    const templateId = 'tpl_tomato_v1';

    const stages: StageTemplate[] = [
        { id: 'stg_tom_1', templateId, name: 'Establishment', code: 'ESTABLISHMENT', dayStart: 0, dayEnd: 25, orderIndex: 1 },
        { id: 'stg_tom_2', templateId, name: 'Vegetative Growth', code: 'VEGETATIVE', dayStart: 26, dayEnd: 60, orderIndex: 2 },
        { id: 'stg_tom_3', templateId, name: 'Flowering & Fruit Setting', code: 'FLOWERING_FRUIT_SET', dayStart: 61, dayEnd: 90, orderIndex: 3 },
        { id: 'stg_tom_4', templateId, name: 'Fruit Development', code: 'FRUIT_GROWTH', dayStart: 91, dayEnd: 125, orderIndex: 4 },
        { id: 'stg_tom_5', templateId, name: 'Harvest', code: 'FRUIT_MATURITY', dayStart: 126, dayEnd: 160, orderIndex: 5 },
    ];

    const periodicExpectations: PeriodicExpectation[] = [
        // Establishment: Frequent water, low fert
        { id: 'pe_tom_1_irrig', stageId: 'stg_tom_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 2, notes: 'Keep soil moist' },
        { id: 'pe_tom_1_fert', stageId: 'stg_tom_1', operationTypeId: OP_FERTIGATION_DEFAULT.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Root starter' },

        // Vegetative: Balanced
        { id: 'pe_tom_2_irrig', stageId: 'stg_tom_2', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 3 },
        { id: 'pe_tom_2_fert', stageId: 'stg_tom_2', operationTypeId: OP_FERTIGATION_DEFAULT.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 4, notes: '19:19:19 alternate days' },
        { id: 'pe_tom_2_spray', stageId: 'stg_tom_2', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Preventive' },

        // Flowering: High K
        { id: 'pe_tom_3_fert', stageId: 'stg_tom_3', operationTypeId: OP_FERTIGATION_DEFAULT.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 3, notes: 'Calcium Nitrate + Boron' },
    ];

    return {
        id: templateId,
        cropCode: 'tomato',
        name: 'Standard Tomato Schedule',
        referenceType: 'PLANTING',
        createdBy: 'System',
        ownerType: 'SYSTEM_DEFAULT',
        stages,
        periodicExpectations,
        oneTimeExpectations: []
    };
};

export const getGenericScheduleTemplate = (cropName: string): CropScheduleTemplate => {
    // If we had more templates, we'd switch here. For now, all fallback to a generic structure.
    const cropCode = cropName.toLowerCase().replace(/\s+/g, '_');
    const templateId = `tpl_gen_${cropCode}`;

    const stages: StageTemplate[] = [
        { id: `stg_${cropCode}_1`, templateId, name: 'Stage 1 (Early)', code: 'ESTABLISHMENT', dayStart: 0, dayEnd: 30, orderIndex: 1 },
        { id: `stg_${cropCode}_2`, templateId, name: 'Stage 2 (Mid)', code: 'VEGETATIVE', dayStart: 31, dayEnd: 90, orderIndex: 2 },
        { id: `stg_${cropCode}_3`, templateId, name: 'Stage 3 (Late)', code: 'FRUIT_MATURITY', dayStart: 91, dayEnd: 120, orderIndex: 3 },
    ];

    const periodicExpectations: PeriodicExpectation[] = [
        { id: `pe_${cropCode}_1`, stageId: `stg_${cropCode}_1`, operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'PER_WEEK', frequencyValue: 2 },
        { id: `pe_${cropCode}_2`, stageId: `stg_${cropCode}_2`, operationTypeId: OP_FERTIGATION_DEFAULT.id, frequencyMode: 'PER_WEEK', frequencyValue: 1 },
    ];

    return {
        id: templateId,
        cropCode,
        name: `Generic ${cropName} Schedule`,
        referenceType: 'PLANTING',
        createdBy: 'System',
        ownerType: 'SYSTEM_DEFAULT',
        stages,
        periodicExpectations,
        oneTimeExpectations: []
    };
};

// --- FACTORY: Grape Template (Complex) ---
export const getGrapeScheduleTemplate = (): CropScheduleTemplate => {
    const templateId = 'tpl_grape_oct_v1';

    // Grape Stages (Oct Pruning Cycle)
    const stages: StageTemplate[] = [
        { id: 'stg_grp_1', templateId, name: 'Sprouting & Leaf (Day 1-15)', code: 'ESTABLISHMENT', dayStart: 0, dayEnd: 15, orderIndex: 1 },
        { id: 'stg_grp_2', templateId, name: 'Bunch Emergence (Day 16-30)', code: 'VEGETATIVE', dayStart: 16, dayEnd: 30, orderIndex: 2 },
        { id: 'stg_grp_3', templateId, name: 'Flowering & Setting (Day 31-50)', code: 'FLOWERING_FRUIT_SET', dayStart: 31, dayEnd: 50, orderIndex: 3 },
        { id: 'stg_grp_4', templateId, name: 'Berry Growth (Day 51-100)', code: 'FRUIT_GROWTH', dayStart: 51, dayEnd: 100, orderIndex: 4 },
        { id: 'stg_grp_5', templateId, name: 'Veraison & Harvest (Day 101+)', code: 'FRUIT_MATURITY', dayStart: 101, dayEnd: 150, orderIndex: 5 },
    ];

    // Periodic (Baseline Discipline)
    const periodicExpectations: PeriodicExpectation[] = [
        // Sprouting: Daily water, frequent spray
        { id: 'pe_grp_1_irrig', stageId: 'stg_grp_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 1 },
        { id: 'pe_grp_1_spray', stageId: 'stg_grp_1', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 2, notes: 'Fungicide preventive' },

        // Flowering: No water stress, specific micro-nutrients
        { id: 'pe_grp_3_irrig', stageId: 'stg_grp_3', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 3 },
        { id: 'pe_grp_3_fert', stageId: 'stg_grp_3', operationTypeId: OP_FERTIGATION_DEFAULT.id, frequencyMode: 'PER_WEEK', frequencyValue: 2, notes: 'Calcium/Boron focus' },
    ];

    // One-Time (Precision Milestones from Excel)
    const oneTimeExpectations: OneTimeExpectation[] = [
        { id: 'ot_grp_1', stageId: 'stg_grp_1', operationTypeId: OP_WEEDING.id, targetDayFromRef: 2, notes: 'Apply Paste on Cuts' }, // Activity
        { id: 'ot_grp_2', stageId: 'stg_grp_1', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 12, notes: 'Hydrogen Cyanamide Spray' },

        { id: 'ot_grp_3', stageId: 'stg_grp_2', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 22, notes: 'GA3 Dose 1 (Elongation)' },

        { id: 'ot_grp_4', stageId: 'stg_grp_3', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 35, notes: 'GA3 Dose 2 (Thinning)' },
        { id: 'ot_grp_5', stageId: 'stg_grp_3', operationTypeId: OP_FERTIGATION_DEFAULT.id, targetDayFromRef: 40, notes: '0:52:34 Boost' },
    ];

    return {
        id: templateId,
        cropCode: 'grape',
        name: 'Grape Oct Pruning (Nashik)',
        referenceType: 'PRUNING',
        createdBy: 'System',
        ownerType: 'SYSTEM_DEFAULT',
        stages,
        periodicExpectations,
        oneTimeExpectations
    };
};

// --- FACTORY: Pomegranate Template (Mrig Bahar) ---
export const getPomegranateScheduleTemplate = (): CropScheduleTemplate => {
    const templateId = 'tpl_pomegranate_mrig_v1';

    const stages: StageTemplate[] = [
        { id: 'stg_pom_1', templateId, name: 'Bahar Treatment (Day 1-30)', code: 'ESTABLISHMENT', dayStart: 0, dayEnd: 30, orderIndex: 1 },
        { id: 'stg_pom_2', templateId, name: 'Vegetative & Flowering (Day 31-75)', code: 'FLOWERING_FRUIT_SET', dayStart: 31, dayEnd: 75, orderIndex: 2 },
        { id: 'stg_pom_3', templateId, name: 'Fruit Development (Day 76-135)', code: 'FRUIT_GROWTH', dayStart: 76, dayEnd: 135, orderIndex: 3 },
        { id: 'stg_pom_4', templateId, name: 'Maturity & Harvest (Day 136-180)', code: 'FRUIT_MATURITY', dayStart: 136, dayEnd: 180, orderIndex: 4 },
    ];

    const periodicExpectations: PeriodicExpectation[] = [
        // Bahar: Stress then water
        { id: 'pe_pom_1_irrig', stageId: 'stg_pom_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 2 },
        { id: 'pe_pom_1_spray', stageId: 'stg_pom_1', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Fungicide after defoliation' },

        // Flowering: Critical spray window
        { id: 'pe_pom_2_irrig', stageId: 'stg_pom_2', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 1 },
        { id: 'pe_pom_2_fert', stageId: 'stg_pom_2', operationTypeId: OP_FERTIGATION_DEFAULT.id, frequencyMode: 'PER_WEEK', frequencyValue: 2, notes: '19:19:19 + Micronutrients' },
        { id: 'pe_pom_2_spray', stageId: 'stg_pom_2', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 10, notes: 'Bacterial blight prevention' },

        // Fruit: K heavy
        { id: 'pe_pom_3_fert', stageId: 'stg_pom_3', operationTypeId: OP_FERTIGATION_DEFAULT.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Potash + Calcium' },
    ];

    const oneTimeExpectations: OneTimeExpectation[] = [
        { id: 'ot_pom_1', stageId: 'stg_pom_1', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 5, notes: 'Ethrel spray for defoliation' },
        { id: 'ot_pom_2', stageId: 'stg_pom_2', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 45, notes: 'Fruit set spray' },
    ];

    return {
        id: templateId,
        cropCode: 'pomegranate',
        name: 'Pomegranate Mrig Bahar',
        referenceType: 'PRUNING',
        createdBy: 'System',
        ownerType: 'SYSTEM_DEFAULT',
        stages,
        periodicExpectations,
        oneTimeExpectations
    };
};

// --- FACTORY: Sugarcane Template ---
export const getSugarcaneScheduleTemplate = (): CropScheduleTemplate => {
    const templateId = 'tpl_sugarcane_v1';

    const stages: StageTemplate[] = [
        { id: 'stg_sug_1', templateId, name: 'Germination (Day 1-45)', code: 'ESTABLISHMENT', dayStart: 0, dayEnd: 45, orderIndex: 1 },
        { id: 'stg_sug_2', templateId, name: 'Tillering (Day 46-120)', code: 'VEGETATIVE', dayStart: 46, dayEnd: 120, orderIndex: 2 },
        { id: 'stg_sug_3', templateId, name: 'Grand Growth (Day 121-270)', code: 'FRUIT_GROWTH', dayStart: 121, dayEnd: 270, orderIndex: 3 },
        { id: 'stg_sug_4', templateId, name: 'Maturity (Day 271-365)', code: 'FRUIT_MATURITY', dayStart: 271, dayEnd: 365, orderIndex: 4 },
    ];

    const periodicExpectations: PeriodicExpectation[] = [
        // Germination: Heavy water
        { id: 'pe_sug_1_irrig', stageId: 'stg_sug_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 7 },
        { id: 'pe_sug_1_weed', stageId: 'stg_sug_1', operationTypeId: OP_WEEDING.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Critical weed control' },

        // Tillering: Nitrogen push
        { id: 'pe_sug_2_fert', stageId: 'stg_sug_2', operationTypeId: OP_FERTIGATION_DEFAULT.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 15, notes: 'Urea dose' },

        // Grand Growth: Water + earthing
        { id: 'pe_sug_3_irrig', stageId: 'stg_sug_3', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 7 },
    ];

    const oneTimeExpectations: OneTimeExpectation[] = [
        { id: 'ot_sug_1', stageId: 'stg_sug_2', operationTypeId: OP_WEEDING.id, targetDayFromRef: 60, notes: 'First Earthing Up' },
        { id: 'ot_sug_2', stageId: 'stg_sug_2', operationTypeId: OP_WEEDING.id, targetDayFromRef: 90, notes: 'Second Earthing Up' },
    ];

    return {
        id: templateId,
        cropCode: 'sugarcane',
        name: 'Sugarcane Adsali',
        referenceType: 'PLANTING',
        createdBy: 'System',
        ownerType: 'SYSTEM_DEFAULT',
        stages,
        periodicExpectations,
        oneTimeExpectations
    };
};

// --- FACTORY: Onion Template (Short Duration) ---
export const getOnionScheduleTemplate = (): CropScheduleTemplate => {
    const templateId = 'tpl_onion_v1';

    const stages: StageTemplate[] = [
        { id: 'stg_oni_1', templateId, name: 'Transplant & Establishment (Day 1-20)', code: 'ESTABLISHMENT', dayStart: 0, dayEnd: 20, orderIndex: 1 },
        { id: 'stg_oni_2', templateId, name: 'Bulb Initiation (Day 21-50)', code: 'VEGETATIVE', dayStart: 21, dayEnd: 50, orderIndex: 2 },
        { id: 'stg_oni_3', templateId, name: 'Bulb Development (Day 51-90)', code: 'FRUIT_GROWTH', dayStart: 51, dayEnd: 90, orderIndex: 3 },
        { id: 'stg_oni_4', templateId, name: 'Maturity & Harvest (Day 91-110)', code: 'FRUIT_MATURITY', dayStart: 91, dayEnd: 110, orderIndex: 4 },
    ];

    const periodicExpectations: PeriodicExpectation[] = [
        // Establishment: Frequent light water
        { id: 'pe_oni_1_irrig', stageId: 'stg_oni_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 3 },
        { id: 'pe_oni_1_spray', stageId: 'stg_oni_1', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Thrips prevention' },

        // Bulb Initiation: Critical water + fert
        { id: 'pe_oni_2_irrig', stageId: 'stg_oni_2', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 3 },
        { id: 'pe_oni_2_fert', stageId: 'stg_oni_2', operationTypeId: OP_FERTIGATION_DEFAULT.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Sulphur + Potash' },

        // Bulb Development: Reduce water
        { id: 'pe_oni_3_spray', stageId: 'stg_oni_3', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 10, notes: 'Purple blotch spray' },
    ];

    const oneTimeExpectations: OneTimeExpectation[] = [
        { id: 'ot_oni_1', stageId: 'stg_oni_2', operationTypeId: OP_WEEDING.id, targetDayFromRef: 30, notes: 'First Weeding' },
        { id: 'ot_oni_2', stageId: 'stg_oni_3', operationTypeId: OP_IRRIGATION_DRIP.id, targetDayFromRef: 85, notes: 'Stop irrigation before harvest' },
    ];

    return {
        id: templateId,
        cropCode: 'onion',
        name: 'Onion Rabi',
        referenceType: 'TRANSPLANTING',
        createdBy: 'System',
        ownerType: 'SYSTEM_DEFAULT',
        stages,
        periodicExpectations,
        oneTimeExpectations
    };
};

/**
 * Registry to find template by crop
 */
export const getTemplateForCrop = (cropName: string): CropScheduleTemplate => {
    const name = cropName.toLowerCase();
    if (name.includes('tomato')) return getTomatoScheduleTemplate();
    if (name.includes('grape')) return getGrapeScheduleTemplate();
    if (name.includes('pomegranate')) return getPomegranateScheduleTemplate();
    if (name.includes('sugarcane')) return getSugarcaneScheduleTemplate();
    if (name.includes('onion')) return getOnionScheduleTemplate();
    return getGenericScheduleTemplate(cropName);
};

// --- HELPER: Stage Calculation ---

export const getDaysSinceStart = (referenceDateStr: string): number => {
    if (!referenceDateStr) return 0;
    // Normalize to Midnight to avoid time-of-day diffs
    const start = new Date(referenceDateStr);
    start.setHours(0, 0, 0, 0);

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const diff = now.getTime() - start.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
};

export const getEffectiveStartDate = (plot: Plot): Date | null => {
    if (plot.startDate) return new Date(plot.startDate);
    if (plot.schedule?.referenceDate) return new Date(plot.schedule.referenceDate);
    return null;
};

export const getCurrentStageFromTemplate = (
    template: CropScheduleTemplate,
    instance: PlotScheduleInstance,
    daysElapsed: number
): StageTemplate | null => {
    if (!template || !template.stages.length) return null;

    // Apply instance.stageOverrides
    const stages = template.stages.map(s => {
        const override = instance.stageOverrides.find(o => o.stageId === s.id);
        if (override) {
            return { ...s, dayStart: override.customDayStart ?? s.dayStart, dayEnd: override.customDayEnd ?? s.dayEnd };
        }
        return s;
    });

    const match = stages.find(s => daysElapsed >= s.dayStart && daysElapsed <= s.dayEnd);
    if (match) return match;

    if (daysElapsed > stages[stages.length - 1].dayEnd) return stages[stages.length - 1];
    return stages[0];
};

/**
 * Returns specific rules for a given day (periodic + one-time).
 */
export const getExpectationsForDay = (
    template: CropScheduleTemplate,
    instance: PlotScheduleInstance,
    dayNumber: number
) => {
    const stage = getCurrentStageFromTemplate(template, instance, dayNumber);
    if (!stage) return { periodic: [], oneTime: [] };

    // 1. One Time Matches (Legacy tolerance allowed? Strict integer match preferred for 'Day X')
    const oneTime = template.oneTimeExpectations.filter(ot => {
        const diff = ot.targetDayFromRef - dayNumber;
        return Math.abs(diff) < 0.5; // Strict integer match for visual clarity, floating safe
    });

    // 2. Periodic Matches
    const periodic = template.periodicExpectations.filter(pe => {
        // Must belong to this stage
        if (pe.stageId !== stage.id) return false;

        // TODO: Apply Overrides from instance
        const override = instance.expectationOverrides.find(o => o.expectationId === pe.id);
        const mode = override?.customFrequencyMode ?? pe.frequencyMode;
        const value = override?.customFrequencyValue ?? pe.frequencyValue;

        if (mode === 'EVERY_N_DAYS') {
            const stageStartDerived = instance.stageOverrides.find(o => o.stageId === stage.id)?.customDayStart ?? stage.dayStart;
            // Safe modulo
            const relDay = dayNumber - stageStartDerived;
            return relDay >= 0 && relDay % value === 0;
        }
        if (mode === 'PER_WEEK') {
            return true;
        }
        return false;
    });

    return { periodic, oneTime };
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
