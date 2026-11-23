/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FROZEN COPY - do not edit. spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7). The schedule-library parser of RELEASE 1.0.17 exactly as it shipped
 * (`git show b3d28967:src/clients/mobile-web/src/infrastructure/reference/TemplateCatalog.ts`, lines 13-414: parseReferenceTemplate, mapTemplate and their
 * helpers). Only the imported types are replaced by the local shapes below (1.0.17's scheduler.types, reduced to the fields this code writes) and the two
 * entry points are exported; every line of logic is the release's own. Release1017Parser_ReadsTheNewListing runs it against a listing the real server answered.
 */
/* eslint-disable */
type StageCode = 'ESTABLISHMENT' | 'VEGETATIVE' | 'FLOWERING_FRUIT_SET' | 'FRUIT_GROWTH' | 'FRUIT_MATURITY' | 'EARLY_GROWTH' | 'CUSTOM';
type FrequencyMode = 'EVERY_N_DAYS' | 'PER_WEEK';
type ScheduleReferenceType = 'PRUNING' | 'TRANSPLANTING' | 'PLANTING';
type StageTemplate = { id: string; templateId: string; name: string; code: StageCode; dayStart: number; dayEnd: number; orderIndex: number; notes?: string; description?: string };
type PeriodicExpectation = { id: string; stageId: string; operationTypeId: string; frequencyMode: FrequencyMode; frequencyValue: number; notes?: string };
type OneTimeExpectation = { id: string; stageId: string; operationTypeId: string; targetDayFromRef: number; notes?: string };
export type CropScheduleTemplate1017 = {
    id: string; cropCode: string; name: string; referenceType: ScheduleReferenceType; stages: StageTemplate[];
    periodicExpectations: PeriodicExpectation[]; oneTimeExpectations: OneTimeExpectation[]; createdBy: string; ownerType: string;
    totalDurationDays: number; description: string; adoptionScore: number; detailScore: number; followersCount: number;
};
type CropScheduleTemplate = CropScheduleTemplate1017;
type ReferenceStageDefinition = {
    name: string;
    startDay: number;
    endDay: number;
};

type ReferenceTemplateActivity = {
    name: string;
    category: string;
    stageName: string;
    startDay: number;
    endDay: number;
    frequencyMode: string;
    intervalDays?: number | null;
};

type ReferenceScheduleTemplate = {
    id: string;
    name: string;
    cropType: string;
    totalDays: number;
    stages: ReferenceStageDefinition[];
    activities: ReferenceTemplateActivity[];
};

const STAGE_NOTE_FALLBACKS: Record<StageCode | 'CUSTOM', string> = {
    ESTABLISHMENT: 'Protect establishment and maintain stable field conditions.',
    VEGETATIVE: 'Sustain uniform growth through irrigation and nutrition discipline.',
    FLOWERING_FRUIT_SET: 'Avoid stress spikes and monitor set quality daily.',
    FRUIT_GROWTH: 'Keep execution cadence stable to support crop build-up.',
    FRUIT_MATURITY: 'Prioritize quality checks and harvest readiness.',
    EARLY_GROWTH: 'Protect young plants and maintain uniformity.',
    CUSTOM: 'Follow stage checklist and log deviations immediately.',
};

let templates: CropScheduleTemplate[] = [];
let templatesById = new Map<string, CropScheduleTemplate>();
let templatesByCrop = new Map<string, CropScheduleTemplate[]>();
const fallbackTemplatesByCrop = new Map<string, CropScheduleTemplate>();

function normalizeToken(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeCropCode(value: string): string {
    return normalizeToken(value).replace(/[^a-z0-9_]+/g, '').replace(/^_+|_+$/g, '');
}

function canonicalCropCode(value: string): string {
    const normalized = normalizeCropCode(value);
    const aliases: Record<string, string> = {
        grapes: 'grape',
        grape: 'grape',
        tomatoes: 'tomato',
        tomato: 'tomato',
        onions: 'onion',
        onion: 'onion',
        pomegranate: 'pomegranate',
        pomegranates: 'pomegranate',
        sugarcanes: 'sugarcane',
        sugarcane: 'sugarcane',
    };

    if (aliases[normalized]) {
        return aliases[normalized];
    }

    if (normalized.endsWith('s') && aliases[normalized.slice(0, -1)]) {
        return aliases[normalized.slice(0, -1)];
    }

    return normalized || 'unknown_crop';
}

function toDisplayName(cropCode: string): string {
    return cropCode
        .split('_')
        .map(part => part.slice(0, 1).toUpperCase() + part.slice(1))
        .join(' ');
}

function toSafeId(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function toNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return fallback;
}

function toStringValue(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
        return null;
    }

    return toNumber(value, 0);
}

function isNotNull<T>(value: T | null): value is T {
    return value !== null;
}

function inferStageCode(stageName: string): StageCode {
    const value = normalizeToken(stageName);

    if (value.includes('flower') || value.includes('fruit_set') || value.includes('bloom')) {
        return 'FLOWERING_FRUIT_SET';
    }
    if (value.includes('fruit') || value.includes('berry') || value.includes('bulb') || value.includes('growth')) {
        return 'FRUIT_GROWTH';
    }
    if (value.includes('maturity') || value.includes('harvest') || value.includes('ripen')) {
        return 'FRUIT_MATURITY';
    }
    if (value.includes('vegetative') || value.includes('canopy') || value.includes('tiller')) {
        return 'VEGETATIVE';
    }
    if (value.includes('early')) {
        return 'EARLY_GROWTH';
    }
    if (value.includes('establish') || value.includes('germination') || value.includes('plant') || value.includes('pruning') || value.includes('post_pruning')) {
        return 'ESTABLISHMENT';
    }

    return 'CUSTOM';
}

function mapActivityToOperationId(category: string, name: string): string {
    const normalized = `${normalizeToken(category)} ${normalizeToken(name)}`;

    if (normalized.includes('irrigation') || normalized.includes('water')) {
        return 'op_irrig_drip';
    }
    if (
        normalized.includes('fertigation')
        || normalized.includes('nutrition')
        || normalized.includes('fertil')
        || normalized.includes('urea')
        || normalized.includes('dap')
        || normalized.includes('npk')
        || normalized.includes('basal')
        || normalized.includes('top_dress')
        || normalized.includes('top-dress')
        || normalized.includes('potash')
        || normalized.includes('manure')
        || normalized.includes('fym')
        || normalized.includes('micronutrient')
    ) {
        return 'op_fert_gen';
    }
    if (normalized.includes('spray')) {
        return 'op_spray_gen';
    }
    if (normalized.includes('weed')) {
        return 'op_weed_man';
    }
    if (normalized.includes('pruning')) {
        return 'op_pruning';
    }
    if (normalized.includes('harvest')) {
        return 'op_harvest';
    }
    if (normalized.includes('scout')) {
        return 'op_pest_scout';
    }
    if (normalized.includes('monitor')) {
        return 'op_growth_check';
    }
    if (normalized.includes('plant')) {
        return 'op_field_prep';
    }

    return 'op_field_prep';
}

function inferReferenceType(cropCode: string, stageList: StageTemplate[], activityList: ReferenceTemplateActivity[]): ScheduleReferenceType {
    const crop = cropCode.toLowerCase();
    const hasPruning = stageList.some(stage => normalizeToken(stage.name).includes('pruning'))
        || activityList.some(activity => normalizeToken(activity.name).includes('pruning'));
    const hasTransplant = stageList.some(stage => normalizeToken(stage.name).includes('transplant'))
        || activityList.some(activity => normalizeToken(activity.name).includes('transplant'));

    if (crop.includes('grape') || crop.includes('pomegranate') || hasPruning) {
        return 'PRUNING';
    }
    if (crop.includes('onion') || hasTransplant) {
        return 'TRANSPLANTING';
    }

    return 'PLANTING';
}

function resolveFrequencyMode(rawFrequencyMode: string): FrequencyMode | 'ONE_TIME' {
    const normalized = normalizeToken(rawFrequencyMode);

    if (normalized === 'one_time') {
        return 'ONE_TIME';
    }

    if (normalized === 'every_n_days') {
        return 'EVERY_N_DAYS';
    }

    return 'PER_WEEK';
}

function resolveActivityStageId(
    activity: ReferenceTemplateActivity,
    stageByName: Map<string, StageTemplate>,
    stageList: StageTemplate[]
): string | null {
    const direct = stageByName.get(normalizeToken(activity.stageName));
    if (direct) {
        return direct.id;
    }

    const byRange = stageList.find(stage => activity.startDay >= stage.dayStart && activity.startDay <= stage.dayEnd);
    if (byRange) {
        return byRange.id;
    }

    return stageList[0]?.id ?? null;
}

function buildExpectations(
    templateId: string,
    activityList: ReferenceTemplateActivity[],
    stageList: StageTemplate[]
): { periodic: PeriodicExpectation[]; oneTime: OneTimeExpectation[] } {
    const stageByName = new Map<string, StageTemplate>();
    stageList.forEach(stage => {
        stageByName.set(normalizeToken(stage.name), stage);
    });

    const periodic: PeriodicExpectation[] = [];
    const oneTime: OneTimeExpectation[] = [];

    activityList.forEach((activity, index) => {
        const stageId = resolveActivityStageId(activity, stageByName, stageList);
        if (!stageId) {
            return;
        }

        const operationTypeId = mapActivityToOperationId(activity.category, activity.name);
        const frequencyMode = resolveFrequencyMode(activity.frequencyMode);

        if (frequencyMode === 'ONE_TIME') {
            oneTime.push({
                id: `ot_${toSafeId(templateId)}_${index + 1}`,
                stageId,
                operationTypeId,
                targetDayFromRef: Math.max(0, activity.startDay),
                notes: activity.name,
            });
            return;
        }

        const frequencyValue = Math.max(1, toNumber(activity.intervalDays, 1));
        periodic.push({
            id: `pe_${toSafeId(templateId)}_${index + 1}`,
            stageId,
            operationTypeId,
            frequencyMode,
            frequencyValue,
            notes: activity.name,
        });
    });

    return { periodic, oneTime };
}

function mapTemplate(referenceTemplate: ReferenceScheduleTemplate): CropScheduleTemplate {
    const templateId = referenceTemplate.id.trim();
    const templateKey = toSafeId(templateId) || `tpl_${toSafeId(referenceTemplate.name)}`;
    const cropCode = canonicalCropCode(referenceTemplate.cropType);
    const stageList: StageTemplate[] = referenceTemplate.stages.map((stage, index) => {
        const stageId = `stg_${templateKey}_${index + 1}`;
        const stageCode = inferStageCode(stage.name);
        const startDay = Math.max(0, stage.startDay);
        const endDay = Math.max(startDay, stage.endDay);

        return {
            id: stageId,
            templateId,
            name: stage.name,
            code: stageCode,
            dayStart: startDay,
            dayEnd: endDay,
            orderIndex: index + 1,
            notes: STAGE_NOTE_FALLBACKS[stageCode] ?? STAGE_NOTE_FALLBACKS.CUSTOM,
            description: STAGE_NOTE_FALLBACKS[stageCode] ?? STAGE_NOTE_FALLBACKS.CUSTOM,
        };
    });

    const { periodic, oneTime } = buildExpectations(templateId, referenceTemplate.activities, stageList);
    const referenceType = inferReferenceType(cropCode, stageList, referenceTemplate.activities);

    return {
        id: templateId,
        cropCode,
        name: referenceTemplate.name,
        referenceType,
        stages: stageList,
        periodicExpectations: periodic,
        oneTimeExpectations: oneTime,
        createdBy: 'ShramSafal Reference Data',
        ownerType: 'SYSTEM_DEFAULT',
        totalDurationDays: Math.max(1, referenceTemplate.totalDays),
        description: `Server-managed template for ${toDisplayName(cropCode)}.`,
        adoptionScore: 0,
        detailScore: 0,
        followersCount: 0,
    };
}

function parseReferenceTemplate(input: unknown): ReferenceScheduleTemplate | null {
    if (!input || typeof input !== 'object') {
        return null;
    }

    const source = input as Record<string, unknown>;
    const stagesRaw = Array.isArray(source.stages) ? source.stages : [];
    const activitiesRaw = Array.isArray(source.activities) ? source.activities : [];

    const stages: ReferenceStageDefinition[] = stagesRaw
        .map(stage => {
            if (!stage || typeof stage !== 'object') {
                return null;
            }

            const value = stage as Record<string, unknown>;
            const name = toStringValue(value.name).trim();
            if (!name) {
                return null;
            }

            return {
                name,
                startDay: toNumber(value.startDay, 0),
                endDay: toNumber(value.endDay, 0),
            } satisfies ReferenceStageDefinition;
        })
        .filter(isNotNull);

    if (stages.length === 0) {
        return null;
    }

    const activities: ReferenceTemplateActivity[] = activitiesRaw
        .map(activity => {
            if (!activity || typeof activity !== 'object') {
                return null;
            }

            const value = activity as Record<string, unknown>;
            const name = toStringValue(value.name).trim();
            if (!name) {
                return null;
            }

            return {
                name,
                category: toStringValue(value.category, 'Activity'),
                stageName: toStringValue(value.stageName, stages[0].name),
                startDay: toNumber(value.startDay, 0),
                endDay: toNumber(value.endDay, toNumber(value.startDay, 0)),
                frequencyMode: toStringValue(value.frequencyMode, 'one_time'),
                intervalDays: toNullableNumber(value.intervalDays),
            } satisfies ReferenceTemplateActivity;
        })
        .filter(isNotNull);

    const id = toStringValue(source.id).trim();
    const name = toStringValue(source.name).trim();
    const cropType = toStringValue(source.cropType).trim();
    if (!id || !name || !cropType) {
        return null;
    }

    return {
        id,
        name,
        cropType,
        totalDays: Math.max(1, toNumber(source.totalDays, 120)),
        stages,
        activities,
    };
}

// The release's module-level index (its other functions read it); unused by the two entry points here.
void templates; void templatesById; void templatesByCrop; void fallbackTemplatesByCrop;

/** 1.0.17's setScheduleTemplatesFromReferenceData, minus the module index it rebuilt: what that release keeps of a listing. */
export function release1017Templates(rawTemplates: unknown[]): CropScheduleTemplate1017[] {
    if (!Array.isArray(rawTemplates)) {
        return [];
    }

    return rawTemplates
        .map(parseReferenceTemplate)
        .filter((template): template is ReferenceScheduleTemplate => template !== null)
        .map(mapTemplate);
}