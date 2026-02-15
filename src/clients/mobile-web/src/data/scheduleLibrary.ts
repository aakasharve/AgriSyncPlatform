/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    CropScheduleTemplate,
    StageTemplate,
    OperationCategory,
    OperationType,
    ScheduleReferenceType,
    ScheduleOwnerType
} from '../features/scheduler/scheduler.types';

const op = (id: string, category: OperationCategory, name: string): OperationType => ({ id, category, name });

const OP_IRRIGATION_DRIP = op('op_irrig_drip', 'IRRIGATION', 'Drip Irrigation');
const OP_FERTIGATION = op('op_fert_gen', 'FERTIGATION', 'Fertigation');
const OP_FOLIAR_SPRAY = op('op_spray_gen', 'FOLIAR_SPRAY', 'Foliar Spray');
const OP_WEEDING = op('op_weed_man', 'WEED_CONTROL', 'Manual Weeding');
const OP_PRUNING = op('op_pruning', 'CULTURAL_OPERATION', 'Pruning');
const OP_THINNING = op('op_thinning', 'CULTURAL_OPERATION', 'Thinning');
const OP_HARVEST = op('op_harvest', 'CULTURAL_OPERATION', 'Harvest');
const OP_PEST_SCOUT = op('op_pest_scout', 'CULTURAL_OPERATION', 'Pest Scouting');
const OP_FIELD_PREP = op('op_field_prep', 'CULTURAL_OPERATION', 'Field Preparation');
const OP_DRAINAGE_AUDIT = op('op_drainage_audit', 'CULTURAL_OPERATION', 'Drainage Audit');
const OP_GAP_FILL = op('op_gap_fill', 'CULTURAL_OPERATION', 'Gap Filling');
const OP_EARTHING_UP = op('op_earthing_up', 'CULTURAL_OPERATION', 'Earthing Up');
const OP_GROWTH_CHECK = op('op_growth_check', 'CULTURAL_OPERATION', 'Growth Check');
const OP_QUALITY_CHECK = op('op_quality_check', 'CULTURAL_OPERATION', 'Quality Check');
const OP_HARVEST_PLAN = op('op_harvest_plan', 'CULTURAL_OPERATION', 'Harvest Planning');
const OP_POST_HARVEST_CLEANUP = op('op_post_harvest_cleanup', 'CULTURAL_OPERATION', 'Post Harvest Cleanup');
const OP_PHI_WATCH = op('op_phi_watch', 'CULTURAL_OPERATION', 'PHI Countdown Check');

const DEFAULT_STAGE_NOTES: Record<string, string> = {
    ESTABLISHMENT: 'Keep moisture stable and protect new growth from stress.',
    VEGETATIVE: 'Build canopy/root strength with balanced nutrition and scouting.',
    FLOWERING_FRUIT_SET: 'Avoid sudden stress and monitor set quality daily.',
    FRUIT_GROWTH: 'Maintain steady irrigation and nutrition for crop build-up.',
    FRUIT_MATURITY: 'Prioritize quality and harvest-readiness checks.',
    EARLY_GROWTH: 'Protect young plants and maintain uniform establishment.',
    CUSTOM: 'Follow stage checklist and record any delay with reason.'
};

export const getStageNote = (stage: StageTemplate): string =>
    stage.notes?.trim()
    || stage.description?.trim()
    || DEFAULT_STAGE_NOTES[stage.code]
    || DEFAULT_STAGE_NOTES.CUSTOM;

const stage = (
    id: string,
    templateId: string,
    name: string,
    code: StageTemplate['code'],
    dayStart: number,
    dayEnd: number,
    orderIndex: number,
    notes: string
): StageTemplate => ({
    id,
    templateId,
    name,
    code,
    dayStart,
    dayEnd,
    orderIndex,
    notes,
    description: notes
});

const normalizeCropCode = (value: string): string =>
    value.toLowerCase().trim().replace(/\s+/g, '_');

const CROP_ALIASES: Record<string, string> = {
    grape: 'grape',
    grapes: 'grape',
    tomato: 'tomato',
    tomatoes: 'tomato',
    pomegranate: 'pomegranate',
    pomegranates: 'pomegranate',
    pomogranate: 'pomegranate',
    pomogranates: 'pomegranate',
    pomo: 'pomegranate',
    sugarcane: 'sugarcane',
    sugarcanes: 'sugarcane',
    onion: 'onion',
    onions: 'onion'
};

const canonicalizeCropCode = (value: string): string => {
    const normalized = normalizeCropCode(value);
    if (CROP_ALIASES[normalized]) return CROP_ALIASES[normalized];
    if (normalized.endsWith('s') && CROP_ALIASES[normalized.slice(0, -1)]) {
        return CROP_ALIASES[normalized.slice(0, -1)];
    }
    return normalized;
};

type VariantPreset = {
    id: string;
    label: string;
    owner: string;
    ownerType: ScheduleOwnerType;
    adoptionScore: number;
    detailScore: number;
    followersCount: number;
    durationShift: number;
    dayShift: number;
    publishedAt: string;
};

const VARIANTS: VariantPreset[] = [
    {
        id: 'standard',
        label: 'University Standard',
        owner: 'ShramSafal System',
        ownerType: 'SYSTEM_DEFAULT',
        adoptionScore: 82,
        detailScore: 68,
        followersCount: 780,
        durationShift: 0,
        dayShift: 0,
        publishedAt: '2025-10-01'
    },
    {
        id: 'progressive',
        label: 'Progressive Farmer Practice',
        owner: 'Progressive Farmer Collective',
        ownerType: 'EXPERT',
        adoptionScore: 76,
        detailScore: 71,
        followersCount: 520,
        durationShift: -10,
        dayShift: -2,
        publishedAt: '2025-12-01'
    },
    {
        id: 'fpo',
        label: 'FPO Optimized',
        owner: 'District FPO Operations Desk',
        ownerType: 'INSTITUTION',
        adoptionScore: 87,
        detailScore: 74,
        followersCount: 1330,
        durationShift: -20,
        dayShift: -4,
        publishedAt: '2026-01-08'
    }
];

type BaseLibraryTemplate = Omit<CropScheduleTemplate, 'createdBy' | 'ownerType' | 'adoptionScore' | 'detailScore' | 'followersCount' | 'publishedAt'> & {
    cropDisplayName: string;
};

const shiftDay = (value: number, delta: number): number => Math.max(0, value + delta);

const getStageDuration = (stage: StageTemplate): number =>
    Math.max(1, stage.dayEnd - stage.dayStart);

const applyDayShiftToStages = (stages: StageTemplate[], templateId: string, suffix: string, dayShift: number): StageTemplate[] => {
    let cursor = 0;

    return stages.map((s, idx) => {
        const duration = getStageDuration(s);
        const start = idx === 0 ? shiftDay(s.dayStart, dayShift) : cursor;
        const end = start + duration;
        cursor = end + 1;

        return {
            ...s,
            id: `${s.id}_${suffix}`,
            templateId,
            dayStart: start,
            dayEnd: end,
            orderIndex: idx + 1,
            notes: getStageNote(s),
            description: getStageNote(s)
        };
    });
};

const makeVariantTemplates = (
    base: BaseLibraryTemplate,
    idMap: { standard: string; progressive: string; fpo: string }
): CropScheduleTemplate[] => {
    const stageIdMapBase = new Map(base.stages.map(s => [s.id, s.id]));

    return VARIANTS.map(variant => {
        const variantId = idMap[variant.id as keyof typeof idMap];
        const stages = variant.id === 'standard'
            ? base.stages.map(s => ({ ...s, notes: getStageNote(s), description: getStageNote(s), templateId: variantId }))
            : applyDayShiftToStages(base.stages, variantId, variant.id, variant.dayShift);

        const stageIdMap = new Map<string, string>();
        stages.forEach((s, idx) => {
            const baseStageId = base.stages[idx]?.id;
            if (baseStageId) stageIdMap.set(baseStageId, s.id);
        });

        const periodicExpectations = base.periodicExpectations.map(pe => {
            const mappedStageId = stageIdMap.get(pe.stageId) || stageIdMapBase.get(pe.stageId) || pe.stageId;
            const shiftedFreq = variant.id === 'fpo'
                ? Math.max(1, pe.frequencyValue - (pe.frequencyMode === 'EVERY_N_DAYS' ? 1 : 0))
                : pe.frequencyValue;
            return {
                ...pe,
                id: variant.id === 'standard' ? pe.id : `${pe.id}_${variant.id}`,
                stageId: mappedStageId,
                frequencyValue: shiftedFreq
            };
        });

        const oneTimeExpectations = base.oneTimeExpectations.map(ot => {
            const mappedStageId = stageIdMap.get(ot.stageId) || stageIdMapBase.get(ot.stageId) || ot.stageId;
            return {
                ...ot,
                id: variant.id === 'standard' ? ot.id : `${ot.id}_${variant.id}`,
                stageId: mappedStageId,
                targetDayFromRef: shiftDay(ot.targetDayFromRef, variant.dayShift),
                notes: variant.id === 'standard' ? ot.notes : `${ot.notes || 'Scheduled intervention'} (${variant.label})`
            };
        });

        const defaultDuration = base.totalDurationDays || (base.stages[base.stages.length - 1]?.dayEnd ?? 120);
        const maxStageDay = stages[stages.length - 1]?.dayEnd ?? defaultDuration;

        return {
            ...base,
            id: variantId,
            name: `${variant.label} - ${base.cropDisplayName}`,
            createdBy: variant.owner,
            ownerType: variant.ownerType,
            description: variant.id === 'standard'
                ? base.description
                : `${base.description} (${variant.label.toLowerCase()} variation).`,
            adoptionScore: variant.adoptionScore,
            detailScore: variant.detailScore,
            followersCount: variant.followersCount,
            publishedAt: variant.publishedAt,
            totalDurationDays: Math.max(45, Math.min(maxStageDay, defaultDuration + variant.durationShift)),
            stages,
            periodicExpectations,
            oneTimeExpectations
        };
    });
};

const GRAPE_LIBRARY: CropScheduleTemplate[] = [
    {
        id: 'tpl_grape_oct_v1',
        cropCode: 'grape',
        name: 'University Standard - Grape',
        referenceType: 'PRUNING',
        createdBy: 'MPKV Rahuri',
        ownerType: 'INSTITUTION',
        description: 'Manure at flooring stage with standard sequencing.',
        totalDurationDays: 150,
        adoptionScore: 84,
        detailScore: 72,
        followersCount: 1260,
        publishedAt: '2025-08-15',
        stages: [
            stage('stg_grp_uni_1', 'tpl_grape_oct_v1', 'Bud Break & Shoot Setup', 'ESTABLISHMENT', 0, 15, 1, 'Keep pruning cuts protected and moisture steady.'),
            stage('stg_grp_uni_2', 'tpl_grape_oct_v1', 'Canopy & Flooring', 'VEGETATIVE', 16, 35, 2, 'Train shoots and keep the floor clean before bunch set.'),
            stage('stg_grp_uni_3', 'tpl_grape_oct_v1', 'Flowering & Fruit Set', 'FLOWERING_FRUIT_SET', 36, 60, 3, 'Avoid irrigation shocks and check set quality daily.'),
            stage('stg_grp_uni_4', 'tpl_grape_oct_v1', 'Berry Development', 'FRUIT_GROWTH', 61, 110, 4, 'Sustain uniform irrigation and nutrient supply for sizing.'),
            stage('stg_grp_uni_5', 'tpl_grape_oct_v1', 'Maturity & Harvest', 'FRUIT_MATURITY', 111, 150, 5, 'Protect quality and prepare stage-wise harvest windows.')
        ],
        periodicExpectations: [
            { id: 'pe_grp_uni_irrig', stageId: 'stg_grp_uni_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 1 },
            { id: 'pe_grp_uni_spray', stageId: 'stg_grp_uni_2', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 4 },
            { id: 'pe_grp_uni_fert', stageId: 'stg_grp_uni_3', operationTypeId: OP_FERTIGATION.id, frequencyMode: 'PER_WEEK', frequencyValue: 2 },
            { id: 'pe_grp_uni_irrig2', stageId: 'stg_grp_uni_4', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 2 }
        ],
        oneTimeExpectations: [
            { id: 'ot_grp_uni_1', stageId: 'stg_grp_uni_1', operationTypeId: OP_PRUNING.id, targetDayFromRef: 0, notes: 'Finish pruning and paste application.' },
            { id: 'ot_grp_uni_2', stageId: 'stg_grp_uni_3', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 42, notes: 'Apply manure at flooring stage.' },
            { id: 'ot_grp_uni_3', stageId: 'stg_grp_uni_4', operationTypeId: OP_THINNING.id, targetDayFromRef: 76, notes: 'Bunch correction and thinning.' }
        ]
    },
    {
        id: 'tpl_grape_patil_v1',
        cropCode: 'grape',
        name: 'Progressive Farmer Practice - Grape',
        referenceType: 'PRUNING',
        createdBy: 'Progressive Farmer Collective',
        ownerType: 'EXPERT',
        description: 'Manure immediately after pruning to boost early recovery.',
        totalDurationDays: 135,
        adoptionScore: 79,
        detailScore: 70,
        followersCount: 930,
        publishedAt: '2025-11-20',
        stages: [
            stage('stg_grp_prog_1', 'tpl_grape_patil_v1', 'Post-Pruning Reset', 'ESTABLISHMENT', 0, 12, 1, 'Avoid over-irrigation in the first week after pruning.'),
            stage('stg_grp_prog_2', 'tpl_grape_patil_v1', 'Canopy Build', 'VEGETATIVE', 13, 28, 2, 'Balance canopy early for uniform bunch growth later.'),
            stage('stg_grp_prog_3', 'tpl_grape_patil_v1', 'Bloom & Set', 'FLOWERING_FRUIT_SET', 29, 48, 3, 'Maintain stable field humidity and spray discipline.'),
            stage('stg_grp_prog_4', 'tpl_grape_patil_v1', 'Berry Sizing', 'FRUIT_GROWTH', 49, 96, 4, 'Keep water intervals steady through berry expansion.'),
            stage('stg_grp_prog_5', 'tpl_grape_patil_v1', 'Color & Harvest Window', 'FRUIT_MATURITY', 97, 135, 5, 'Stage harvest by quality and maturity checks.')
        ],
        periodicExpectations: [
            { id: 'pe_grp_prog_irrig', stageId: 'stg_grp_prog_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 1 },
            { id: 'pe_grp_prog_fert', stageId: 'stg_grp_prog_2', operationTypeId: OP_FERTIGATION.id, frequencyMode: 'PER_WEEK', frequencyValue: 2 },
            { id: 'pe_grp_prog_spray', stageId: 'stg_grp_prog_3', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 5 }
        ],
        oneTimeExpectations: [
            { id: 'ot_grp_prog_1', stageId: 'stg_grp_prog_1', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 7, notes: 'Apply manure after pruning.' },
            { id: 'ot_grp_prog_2', stageId: 'stg_grp_prog_3', operationTypeId: OP_THINNING.id, targetDayFromRef: 36, notes: 'Bunch thinning pass.' }
        ]
    },
    {
        id: 'tpl_grape_fpo_v1',
        cropCode: 'grape',
        name: 'FPO Optimized - Grape',
        referenceType: 'PRUNING',
        createdBy: 'Nashik FPO Operations Desk',
        ownerType: 'INSTITUTION',
        description: 'Split manure model for tighter nutrient control and compliance.',
        totalDurationDays: 120,
        adoptionScore: 88,
        detailScore: 76,
        followersCount: 1540,
        publishedAt: '2026-01-08',
        stages: [
            stage('stg_grp_fpo_1', 'tpl_grape_fpo_v1', 'Bud Burst', 'ESTABLISHMENT', 0, 10, 1, 'Check uniform bud burst and avoid heavy irrigation.'),
            stage('stg_grp_fpo_2', 'tpl_grape_fpo_v1', 'Canopy & Floor Management', 'VEGETATIVE', 11, 26, 2, 'Keep floor clean and airflow open in canopy.'),
            stage('stg_grp_fpo_3', 'tpl_grape_fpo_v1', 'Flowering & Set', 'FLOWERING_FRUIT_SET', 27, 44, 3, 'Support set with stable irrigation and timely foliar support.'),
            stage('stg_grp_fpo_4', 'tpl_grape_fpo_v1', 'Rapid Berry Growth', 'FRUIT_GROWTH', 45, 85, 4, 'Weekly berry-size checks with corrective actions.'),
            stage('stg_grp_fpo_5', 'tpl_grape_fpo_v1', 'Ripening & Dispatch Prep', 'FRUIT_MATURITY', 86, 120, 5, 'Protect quality and prepare planned harvest windows.')
        ],
        periodicExpectations: [
            { id: 'pe_grp_fpo_irrig', stageId: 'stg_grp_fpo_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 1 },
            { id: 'pe_grp_fpo_spray', stageId: 'stg_grp_fpo_2', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 5 },
            { id: 'pe_grp_fpo_fert', stageId: 'stg_grp_fpo_3', operationTypeId: OP_FERTIGATION.id, frequencyMode: 'PER_WEEK', frequencyValue: 3 }
        ],
        oneTimeExpectations: [
            { id: 'ot_grp_fpo_1', stageId: 'stg_grp_fpo_1', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 8, notes: 'Split manure phase 1.' },
            { id: 'ot_grp_fpo_2', stageId: 'stg_grp_fpo_4', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 44, notes: 'Split manure phase 2.' },
            { id: 'ot_grp_fpo_3', stageId: 'stg_grp_fpo_3', operationTypeId: OP_THINNING.id, targetDayFromRef: 34, notes: 'Cluster correction before berry growth.' }
        ]
    }
];

const TOMATO_BASE: BaseLibraryTemplate = {
    id: 'tpl_tomato_v1',
    cropCode: 'tomato',
    cropDisplayName: 'Tomato',
    name: 'Tomato Base',
    referenceType: 'PLANTING',
    description: 'Baseline tomato schedule with stage-wise execution checkpoints.',
    totalDurationDays: 125,
    stages: [
        stage('stg_tom_1', 'tpl_tomato_v1', 'Establishment', 'ESTABLISHMENT', 0, 20, 1, 'Support transplant recovery and root establishment.'),
        stage('stg_tom_2', 'tpl_tomato_v1', 'Vegetative Growth', 'VEGETATIVE', 21, 50, 2, 'Balance canopy growth with measured nutrient doses.'),
        stage('stg_tom_3', 'tpl_tomato_v1', 'Flowering & Set', 'FLOWERING_FRUIT_SET', 51, 82, 3, 'Avoid stress during flowering and fruit set.'),
        stage('stg_tom_4', 'tpl_tomato_v1', 'Fruit Fill & Harvest', 'FRUIT_MATURITY', 83, 125, 4, 'Run staged picking and quality checks.')
    ],
    periodicExpectations: [
        { id: 'pe_tom_irrig', stageId: 'stg_tom_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 2 },
        { id: 'pe_tom_fert', stageId: 'stg_tom_2', operationTypeId: OP_FERTIGATION.id, frequencyMode: 'PER_WEEK', frequencyValue: 2 },
        { id: 'pe_tom_spray', stageId: 'stg_tom_3', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'PER_WEEK', frequencyValue: 1 }
    ],
    oneTimeExpectations: [
        { id: 'ot_tom_weed', stageId: 'stg_tom_2', operationTypeId: OP_WEEDING.id, targetDayFromRef: 27, notes: 'First weeding pass.' },
        { id: 'ot_tom_harv', stageId: 'stg_tom_4', operationTypeId: OP_HARVEST.id, targetDayFromRef: 94, notes: 'First planned harvest window.' }
    ]
};

const POMEGRANATE_BASE: BaseLibraryTemplate = {
    id: 'tpl_pomegranate_mrig_v1',
    cropCode: 'pomegranate',
    cropDisplayName: 'Pomegranate',
    name: 'Pomegranate Base',
    referenceType: 'PRUNING',
    description: 'DFES 18-month demo template with stage-wise notes, sprays, nutrition splits, irrigation stability and closure.',
    totalDurationDays: 540,
    stages: [
        stage(
            'stg_pom_0',
            'tpl_pomegranate_mrig_v1',
            'S0: Land Preparation & Field Readiness',
            'ESTABLISHMENT',
            0,
            30,
            1,
            'Do not plant until Plant-Ready = YES. Fix drainage first, test drip lines, and arrange labour + inputs before planting.'
        ),
        stage(
            'stg_pom_1',
            'tpl_pomegranate_mrig_v1',
            'S1: Planting + Germination',
            'ESTABLISHMENT',
            31,
            60,
            2,
            'Uniform planting depth + spacing is critical. First 30 DAP needs strict weed control and moisture stability. Gap-fill early only.'
        ),
        stage(
            'stg_pom_2',
            'tpl_pomegranate_mrig_v1',
            'S2: Establishment + Primary Tillering',
            'VEGETATIVE',
            61,
            150,
            3,
            'Tillering/stand strength is decided here. Do not delay weed control and never push heavy input without moisture support.'
        ),
        stage(
            'stg_pom_3',
            'tpl_pomegranate_mrig_v1',
            'S3: Secondary Tillering + Canopy Build',
            'FLOWERING_FRUIT_SET',
            151,
            240,
            4,
            'Target canopy closure + clean inter-row. Control pests early and avoid both drought and waterlogging.'
        ),
        stage(
            'stg_pom_4',
            'tpl_pomegranate_mrig_v1',
            'S4: Grand Growth',
            'FRUIT_GROWTH',
            241,
            360,
            5,
            'This is the engine room. Missing irrigation causes heavy yield loss. Keep access paths clean and avoid crop damage during work.'
        ),
        stage(
            'stg_pom_5',
            'tpl_pomegranate_mrig_v1',
            'S5: Internode Elongation + Biomass Peak',
            'FRUIT_GROWTH',
            361,
            420,
            6,
            'Avoid excess nitrogen now. Watch lodging after wind/rain and hold disease pressure low.'
        ),
        stage(
            'stg_pom_6',
            'tpl_pomegranate_mrig_v1',
            'S6: Maturity + Sugar Accumulation',
            'FRUIT_MATURITY',
            421,
            510,
            7,
            'Stop heavy nitrogen. Keep moisture stable (not aggressive) and plan harvest logistics before the final window.'
        ),
        stage(
            'stg_pom_7',
            'tpl_pomegranate_mrig_v1',
            'S7: Ripening + Harvest + Closure',
            'FRUIT_MATURITY',
            511,
            540,
            8,
            'Do not harvest too early. Respect PHI for any late spray and close season with full cost + income records.'
        )
    ],
    periodicExpectations: [
        { id: 'pe_pom_s0_field_prep', stageId: 'stg_pom_0', operationTypeId: OP_FIELD_PREP.id, frequencyMode: 'PER_WEEK', frequencyValue: 2, notes: 'Stubble removal, tillage, leveling, bund repair and pre-plant readiness checks.' },
        { id: 'pe_pom_s0_drainage', stageId: 'stg_pom_0', operationTypeId: OP_DRAINAGE_AUDIT.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 7, notes: 'No waterlogging allowed before planting.' },
        { id: 'pe_pom_s1_irrig', stageId: 'stg_pom_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 2, notes: 'Frequent light irrigation only; avoid flooding.' },
        { id: 'pe_pom_s1_gap_fill', stageId: 'stg_pom_1', operationTypeId: OP_GAP_FILL.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 7, notes: 'Inspect DAP 10-15 and fill gaps immediately.' },
        { id: 'pe_pom_s1_scout', stageId: 'stg_pom_1', operationTypeId: OP_PEST_SCOUT.id, frequencyMode: 'PER_WEEK', frequencyValue: 2, notes: 'Early scouting 2x/week.' },
        { id: 'pe_pom_s2_weed', stageId: 'stg_pom_2', operationTypeId: OP_WEEDING.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 12, notes: 'Weeding/interculture every 10-14 days.' },
        { id: 'pe_pom_s2_irrig', stageId: 'stg_pom_2', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 3, notes: 'Avoid stress dips; tiller loss is permanent.' },
        { id: 'pe_pom_s2_scout', stageId: 'stg_pom_2', operationTypeId: OP_PEST_SCOUT.id, frequencyMode: 'PER_WEEK', frequencyValue: 2, notes: 'Weekly pest + disease + moisture status log.' },
        { id: 'pe_pom_s3_irrig', stageId: 'stg_pom_3', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 3, notes: 'Keep stable interval. Avoid wet-dry cycles.' },
        { id: 'pe_pom_s3_earthing', stageId: 'stg_pom_3', operationTypeId: OP_EARTHING_UP.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Earthing/mulching and inter-row cleanup.' },
        { id: 'pe_pom_s4_irrig', stageId: 'stg_pom_4', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 4, notes: 'No missed cycles in grand growth phase.' },
        { id: 'pe_pom_s4_growth', stageId: 'stg_pom_4', operationTypeId: OP_GROWTH_CHECK.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Monthly growth check: height/thickness estimate.' },
        { id: 'pe_pom_s5_irrig', stageId: 'stg_pom_5', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 5, notes: 'Stable irrigation; avoid sudden wet spikes.' },
        { id: 'pe_pom_s5_quality', stageId: 'stg_pom_5', operationTypeId: OP_QUALITY_CHECK.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Track lodging, pest presence and leaf health.' },
        { id: 'pe_pom_s6_irrig', stageId: 'stg_pom_6', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 6, notes: 'Steady moisture, no aggressive irrigation.' },
        { id: 'pe_pom_s6_quality', stageId: 'stg_pom_6', operationTypeId: OP_QUALITY_CHECK.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Observe maturity indicators and harvest readiness.' },
        { id: 'pe_pom_s7_harvest_plan', stageId: 'stg_pom_7', operationTypeId: OP_HARVEST_PLAN.id, frequencyMode: 'PER_WEEK', frequencyValue: 1, notes: 'Weekly harvest-readiness checks in final window.' },
        { id: 'pe_pom_s7_phi', stageId: 'stg_pom_7', operationTypeId: OP_PHI_WATCH.id, frequencyMode: 'PER_WEEK', frequencyValue: 2, notes: 'If late spray logged, verify PHI countdown before harvest closure.' }
    ],
    oneTimeExpectations: [
        { id: 'ot_pom_s0_spray_weed', stageId: 'stg_pom_0', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 18, notes: 'Pre-plant Weed Knockdown (Demo): Herbicide-Z 310 ml/acre, 120 L water/acre, 15L tank = 39 ml/tank.' },
        { id: 'ot_pom_s0_spray_fungal', stageId: 'stg_pom_0', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 24, notes: 'Soil Fungal Risk Reduction (Demo): Fungicide-F 420 g/acre, 100 L water/acre, 15L tank = 63 g/tank.' },
        { id: 'ot_pom_s0_nutri_compost', stageId: 'stg_pom_0', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 26, notes: 'Basal Organic (Demo): Compost-A 820 kg/acre, single incorporation pass.' },
        { id: 'ot_pom_s0_nutri_base', stageId: 'stg_pom_0', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 29, notes: 'Base NPK (Demo): NPK-Base 55 kg/acre, single basal application.' },

        { id: 'ot_pom_s1_spray_pest', stageId: 'stg_pom_1', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 44, notes: 'Early Sucking Pest Control (Demo): Insecticide-A 165 ml/acre, 90 L water/acre, repeat after 7 days, PHI 14.' },
        { id: 'ot_pom_s1_spray_damping', stageId: 'stg_pom_1', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 42, notes: 'Damping-Off Prevention (Demo): Fungicide-B 260 g/acre, 100 L water/acre, repeat after 10 days.' },
        { id: 'ot_pom_s1_nutri_starter', stageId: 'stg_pom_1', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 31, notes: 'Starter-N (Demo): 18 kg/acre split at day 0 and day 15 from planting.' },
        { id: 'ot_pom_s1_root_tonic', stageId: 'stg_pom_1', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 46, notes: 'Root Booster Foliar (Demo): 1.6 g/L in 80 L/acre, total 128 g/acre.' },

        { id: 'ot_pom_s2_spray_leaf', stageId: 'stg_pom_2', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 105, notes: 'Leaf Spot Prevention (Demo): Fungicide-C 240 ml/acre, 120 L water/acre.' },
        { id: 'ot_pom_s2_spray_chewing', stageId: 'stg_pom_2', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 120, notes: 'Chewing Pest Control (Demo): Insecticide-D 210 ml/acre, 110 L water/acre.' },
        { id: 'ot_pom_s2_nutri_tillering_1', stageId: 'stg_pom_2', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 101, notes: 'Tillering Support (Demo): N-Boost 26 kg/acre split 1.' },
        { id: 'ot_pom_s2_nutri_tillering_2', stageId: 'stg_pom_2', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 131, notes: 'Tillering Support (Demo): N-Boost 26 kg/acre split 2.' },
        { id: 'ot_pom_s2_micromix', stageId: 'stg_pom_2', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 126, notes: 'Micronutrient Mix (Demo): 2.2 g/L in 90 L/acre, total 198 g/acre.' },

        { id: 'ot_pom_s3_spray_borer', stageId: 'stg_pom_3', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 188, notes: 'Borer Risk Control (Demo): Insecticide-Bor 190 ml/acre, repeat after 12 days.' },
        { id: 'ot_pom_s3_spray_rust', stageId: 'stg_pom_3', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 202, notes: 'Rust/Blight Prevention (Demo): Fungicide-Rust 260 ml/acre, repeat after 10 days.' },
        { id: 'ot_pom_s3_nutri_growth_1', stageId: 'stg_pom_3', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 180, notes: 'Canopy Build Split (Demo): Growth-NPK 40 kg/acre split 1.' },
        { id: 'ot_pom_s3_nutri_growth_2', stageId: 'stg_pom_3', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 210, notes: 'Canopy Build Split (Demo): Growth-NPK 40 kg/acre split 2.' },
        { id: 'ot_pom_s3_magnesium', stageId: 'stg_pom_3', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 205, notes: 'Magnesium Foliar (Demo): 1.5 g/L in 100 L/acre, total 150 g/acre.' },

        { id: 'ot_pom_s4_spray_mite', stageId: 'stg_pom_4', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 275, notes: 'Mite/Thrips Control if needed (Demo): Insecticide-M 145 ml/acre.' },
        { id: 'ot_pom_s4_spray_shield_1', stageId: 'stg_pom_4', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 300, notes: 'Disease Shield (Demo): Fungicide-Shield 300 ml/acre, cycle 1.' },
        { id: 'ot_pom_s4_spray_shield_2', stageId: 'stg_pom_4', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 340, notes: 'Disease Shield (Demo): Fungicide-Shield 300 ml/acre, cycle 2.' },
        { id: 'ot_pom_s4_nutri_power_1', stageId: 'stg_pom_4', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 270, notes: 'Grand Growth Feeding (Demo): NPK-Power 60 kg/acre split 1.' },
        { id: 'ot_pom_s4_nutri_power_2', stageId: 'stg_pom_4', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 310, notes: 'Grand Growth Feeding (Demo): NPK-Power 60 kg/acre split 2.' },
        { id: 'ot_pom_s4_nutri_power_3', stageId: 'stg_pom_4', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 350, notes: 'Grand Growth Feeding (Demo): NPK-Power 60 kg/acre split 3.' },
        { id: 'ot_pom_s4_silicon', stageId: 'stg_pom_4', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 325, notes: 'Silicon Strength (Demo): 1.2 g/L in 120 L/acre, total 144 g/acre.' },

        { id: 'ot_pom_s5_spray_late_borer', stageId: 'stg_pom_5', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 380, notes: 'Late Borer Control (Demo): Insecticide-LateBor 175 ml/acre.' },
        { id: 'ot_pom_s5_spray_leaf', stageId: 'stg_pom_5', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 405, notes: 'Leaf Disease Control (Demo): Fungicide-Leaf 280 ml/acre.' },
        { id: 'ot_pom_s5_balanced_1', stageId: 'stg_pom_5', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 385, notes: 'Balanced Feed (Demo): 45 kg/acre split 1.' },
        { id: 'ot_pom_s5_balanced_2', stageId: 'stg_pom_5', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 415, notes: 'Balanced Feed (Demo): 45 kg/acre split 2.' },
        { id: 'ot_pom_s5_k_support_1', stageId: 'stg_pom_5', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 392, notes: 'K-Support (Demo): 22 kg/acre split 1.' },
        { id: 'ot_pom_s5_k_support_2', stageId: 'stg_pom_5', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 418, notes: 'K-Support (Demo): 22 kg/acre split 2.' },

        { id: 'ot_pom_s6_spray_guard_1', stageId: 'stg_pom_6', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 450, notes: 'Disease Guard (Demo): Fungicide-Guard 260 ml/acre, cycle 1.' },
        { id: 'ot_pom_s6_spray_guard_2', stageId: 'stg_pom_6', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 500, notes: 'Disease Guard (Demo): Fungicide-Guard 260 ml/acre, cycle 2.' },
        { id: 'ot_pom_s6_kboost_1', stageId: 'stg_pom_6', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 460, notes: 'Maturity K Push (Demo): K-Boost 30 kg/acre split 1.' },
        { id: 'ot_pom_s6_kboost_2', stageId: 'stg_pom_6', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 485, notes: 'Maturity K Push (Demo): K-Boost 30 kg/acre split 2.' },
        { id: 'ot_pom_s6_kboost_3', stageId: 'stg_pom_6', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 505, notes: 'Maturity K Push (Demo): K-Boost 30 kg/acre split 3.' },
        { id: 'ot_pom_s6_micro_maintain', stageId: 'stg_pom_6', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 490, notes: 'Micronutrient Maintenance (Demo): 1.8 g/L in 120 L/acre, total 216 g/acre.' },

        { id: 'ot_pom_s7_spray_emergency', stageId: 'stg_pom_7', operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 520, notes: 'Emergency Pest Control only if needed (Demo): Insecticide-H 120 ml/acre, PHI 7.' },
        { id: 'ot_pom_s7_nutri_stop', stageId: 'stg_pom_7', operationTypeId: OP_FERTIGATION.id, targetDayFromRef: 512, notes: 'Nutrition Stop Marker: no heavy nitrogen feeding after M16 (rule marker).' },
        { id: 'ot_pom_s7_restore', stageId: 'stg_pom_7', operationTypeId: OP_POST_HARVEST_CLEANUP.id, targetDayFromRef: 536, notes: 'Post-harvest soil restore (Demo): GreenManure 35 kg/acre + line flush and repair log.' }
    ]
};

const SUGARCANE_BASE: BaseLibraryTemplate = {
    id: 'tpl_sugarcane_v1',
    cropCode: 'sugarcane',
    cropDisplayName: 'Sugarcane',
    name: 'Sugarcane Base',
    referenceType: 'PLANTING',
    description: 'Adsali style sugarcane baseline for long-cycle execution.',
    totalDurationDays: 365,
    stages: [
        stage('stg_sug_1', 'tpl_sugarcane_v1', 'Germination', 'ESTABLISHMENT', 0, 45, 1, 'Ensure uniform sprouting and early weed control.'),
        stage('stg_sug_2', 'tpl_sugarcane_v1', 'Tillering', 'VEGETATIVE', 46, 125, 2, 'Keep irrigation and nutrition schedule consistent.'),
        stage('stg_sug_3', 'tpl_sugarcane_v1', 'Grand Growth', 'FRUIT_GROWTH', 126, 280, 3, 'Track stand health and maintain moisture rhythm.'),
        stage('stg_sug_4', 'tpl_sugarcane_v1', 'Maturity', 'FRUIT_MATURITY', 281, 365, 4, 'Prepare harvest logistics and avoid late shocks.')
    ],
    periodicExpectations: [
        { id: 'pe_sug_irrig', stageId: 'stg_sug_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 7 },
        { id: 'pe_sug_fert', stageId: 'stg_sug_2', operationTypeId: OP_FERTIGATION.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 15 }
    ],
    oneTimeExpectations: [
        { id: 'ot_sug_earthing1', stageId: 'stg_sug_2', operationTypeId: OP_WEEDING.id, targetDayFromRef: 62, notes: 'First earthing up.' },
        { id: 'ot_sug_earthing2', stageId: 'stg_sug_2', operationTypeId: OP_WEEDING.id, targetDayFromRef: 95, notes: 'Second earthing up.' }
    ]
};

const ONION_BASE: BaseLibraryTemplate = {
    id: 'tpl_onion_v1',
    cropCode: 'onion',
    cropDisplayName: 'Onion',
    name: 'Onion Base',
    referenceType: 'TRANSPLANTING',
    description: 'Rabi onion baseline with clear stage transitions and notes.',
    totalDurationDays: 110,
    stages: [
        stage('stg_oni_1', 'tpl_onion_v1', 'Transplant Establishment', 'ESTABLISHMENT', 0, 20, 1, 'Protect seedlings and maintain light moisture.'),
        stage('stg_oni_2', 'tpl_onion_v1', 'Bulb Initiation', 'VEGETATIVE', 21, 50, 2, 'Maintain nutrient balance and thrips surveillance.'),
        stage('stg_oni_3', 'tpl_onion_v1', 'Bulb Development', 'FRUIT_GROWTH', 51, 90, 3, 'Keep intervals disciplined during bulb expansion.'),
        stage('stg_oni_4', 'tpl_onion_v1', 'Maturity & Harvest', 'FRUIT_MATURITY', 91, 110, 4, 'Reduce irrigation and plan harvest/curing sequence.')
    ],
    periodicExpectations: [
        { id: 'pe_oni_irrig', stageId: 'stg_oni_1', operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'EVERY_N_DAYS', frequencyValue: 3 },
        { id: 'pe_oni_spray', stageId: 'stg_oni_2', operationTypeId: OP_FOLIAR_SPRAY.id, frequencyMode: 'PER_WEEK', frequencyValue: 1 },
        { id: 'pe_oni_fert', stageId: 'stg_oni_3', operationTypeId: OP_FERTIGATION.id, frequencyMode: 'PER_WEEK', frequencyValue: 1 }
    ],
    oneTimeExpectations: [
        { id: 'ot_oni_pest_check', stageId: 'stg_oni_1', operationTypeId: OP_PEST_SCOUT.id, targetDayFromRef: 9, notes: 'Mandatory pest scouting before bulb initiation.' },
        { id: 'ot_oni_weed', stageId: 'stg_oni_2', operationTypeId: OP_WEEDING.id, targetDayFromRef: 30, notes: 'First weeding and row cleanup.' },
        { id: 'ot_oni_harv', stageId: 'stg_oni_4', operationTypeId: OP_HARVEST.id, targetDayFromRef: 102, notes: 'Planned harvest kickoff.' }
    ]
};

const OTHER_LIBRARY: CropScheduleTemplate[] = [
    ...makeVariantTemplates(TOMATO_BASE, { standard: 'tpl_tomato_v1', progressive: 'tpl_tomato_progressive_v1', fpo: 'tpl_tomato_fpo_v1' }),
    ...makeVariantTemplates(POMEGRANATE_BASE, { standard: 'tpl_pomegranate_mrig_v1', progressive: 'tpl_pomegranate_farmer_v1', fpo: 'tpl_pomegranate_nrcp_v1' }),
    ...makeVariantTemplates(SUGARCANE_BASE, { standard: 'tpl_sugarcane_v1', progressive: 'tpl_sugarcane_efficiency_v1', fpo: 'tpl_sugarcane_fpo_v1' }),
    ...makeVariantTemplates(ONION_BASE, { standard: 'tpl_onion_v1', progressive: 'tpl_onion_precision_v1', fpo: 'tpl_onion_fpo_v1' })
];

export type ScheduleLibrarySort = 'HIGHEST_ADOPTION' | 'MOST_FOLLOWED' | 'SHORTEST_DURATION' | 'NEWEST';

export const sortSchedules = (
    schedules: CropScheduleTemplate[],
    sortBy: ScheduleLibrarySort = 'HIGHEST_ADOPTION'
): CropScheduleTemplate[] => {
    const copy = [...schedules];
    copy.sort((a, b) => {
        if (sortBy === 'MOST_FOLLOWED') return (b.followersCount || 0) - (a.followersCount || 0);
        if (sortBy === 'SHORTEST_DURATION') return (a.totalDurationDays || 9999) - (b.totalDurationDays || 9999);
        if (sortBy === 'NEWEST') return Date.parse(b.publishedAt || '1970-01-01') - Date.parse(a.publishedAt || '1970-01-01');
        return (b.adoptionScore || 0) - (a.adoptionScore || 0);
    });
    return copy;
};

const BASE_LIBRARY = [...GRAPE_LIBRARY, ...OTHER_LIBRARY];

const genericCache = new Map<string, CropScheduleTemplate[]>();

const createGenericTemplatesForCrop = (cropCodeRaw: string): CropScheduleTemplate[] => {
    const cropCode = canonicalizeCropCode(cropCodeRaw);
    if (genericCache.has(cropCode)) return genericCache.get(cropCode)!;

    const display = cropCode.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const genericBase: BaseLibraryTemplate = {
        id: `tpl_gen_${cropCode}_v1`,
        cropCode,
        cropDisplayName: display,
        name: `${display} Base`,
        referenceType: 'PLANTING',
        description: `Auto-generated schedule set for ${display}.`,
        totalDurationDays: 120,
        stages: [
            stage(`stg_gen_${cropCode}_1`, `tpl_gen_${cropCode}_v1`, 'Early Stage', 'ESTABLISHMENT', 0, 25, 1, `Establish ${display} crop uniformly.`),
            stage(`stg_gen_${cropCode}_2`, `tpl_gen_${cropCode}_v1`, 'Middle Stage', 'VEGETATIVE', 26, 75, 2, `Maintain stable growth and regular scouting.`),
            stage(`stg_gen_${cropCode}_3`, `tpl_gen_${cropCode}_v1`, 'Late Stage', 'FRUIT_MATURITY', 76, 120, 3, `Prepare quality-focused finish and harvest readiness.`)
        ],
        periodicExpectations: [
            { id: `pe_gen_${cropCode}_irrig`, stageId: `stg_gen_${cropCode}_1`, operationTypeId: OP_IRRIGATION_DRIP.id, frequencyMode: 'PER_WEEK', frequencyValue: 2 },
            { id: `pe_gen_${cropCode}_fert`, stageId: `stg_gen_${cropCode}_2`, operationTypeId: OP_FERTIGATION.id, frequencyMode: 'PER_WEEK', frequencyValue: 1 }
        ],
        oneTimeExpectations: [
            { id: `ot_gen_${cropCode}_spray`, stageId: `stg_gen_${cropCode}_2`, operationTypeId: OP_FOLIAR_SPRAY.id, targetDayFromRef: 48, notes: 'Mid-stage correction spray.' }
        ]
    };

    const generic = makeVariantTemplates(genericBase, {
        standard: `tpl_gen_${cropCode}_v1`,
        progressive: `tpl_gen_${cropCode}_progressive_v1`,
        fpo: `tpl_gen_${cropCode}_fpo_v1`
    });

    genericCache.set(cropCode, generic);
    return generic;
};

export const SCHEDULE_LIBRARY: CropScheduleTemplate[] = sortSchedules(BASE_LIBRARY, 'HIGHEST_ADOPTION');

export const getAllSchedules = (): CropScheduleTemplate[] => [
    ...SCHEDULE_LIBRARY,
    ...Array.from(genericCache.values()).flat()
];

export const getSchedulesForCrop = (
    cropCodeRaw: string,
    sortBy: ScheduleLibrarySort = 'HIGHEST_ADOPTION'
): CropScheduleTemplate[] => {
    const cropCode = canonicalizeCropCode(cropCodeRaw);
    const matched = SCHEDULE_LIBRARY.filter(t => canonicalizeCropCode(t.cropCode) === cropCode);
    if (matched.length >= 3) return sortSchedules(matched, sortBy);
    if (matched.length > 0) {
        const generated = createGenericTemplatesForCrop(cropCode).slice(0, 3 - matched.length);
        return sortSchedules([...matched, ...generated], sortBy);
    }
    return sortSchedules(createGenericTemplatesForCrop(cropCode), sortBy);
};

export const getScheduleById = (id: string): CropScheduleTemplate | undefined => {
    const staticMatch = SCHEDULE_LIBRARY.find(t => t.id === id);
    if (staticMatch) return staticMatch;
    return Array.from(genericCache.values()).flat().find(t => t.id === id);
};

export const getTemplateForCrop = (cropName: string): CropScheduleTemplate => {
    const list = getSchedulesForCrop(cropName, 'HIGHEST_ADOPTION');
    return list[0];
};
