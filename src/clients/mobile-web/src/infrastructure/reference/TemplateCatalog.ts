import {
    type CropScheduleTemplate,
    type FrequencyMode,
    type OneTimeExpectation,
    type PeriodicExpectation,
    type ScheduleReferenceType,
    type StageCode,
    type StageTemplate,
} from '../../features/scheduler/scheduler.types';

export type TemplateCatalogSort = 'HIGHEST_ADOPTION' | 'MOST_FOLLOWED' | 'SHORTEST_DURATION' | 'NEWEST';

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

function buildFallbackTemplate(cropName: string): CropScheduleTemplate {
    const cropCode = canonicalCropCode(cropName);
    const existing = fallbackTemplatesByCrop.get(cropCode);
    if (existing) {
        return existing;
    }

    const templateId = `tpl_fallback_${cropCode}`;
    const displayName = toDisplayName(cropCode);
    const stages: StageTemplate[] = [
        { id: `stg_${templateId}_1`, templateId, name: 'Early Stage', code: 'ESTABLISHMENT', dayStart: 0, dayEnd: 30, orderIndex: 1, notes: STAGE_NOTE_FALLBACKS.ESTABLISHMENT },
        { id: `stg_${templateId}_2`, templateId, name: 'Mid Stage', code: 'VEGETATIVE', dayStart: 31, dayEnd: 80, orderIndex: 2, notes: STAGE_NOTE_FALLBACKS.VEGETATIVE },
        { id: `stg_${templateId}_3`, templateId, name: 'Late Stage', code: 'FRUIT_MATURITY', dayStart: 81, dayEnd: 120, orderIndex: 3, notes: STAGE_NOTE_FALLBACKS.FRUIT_MATURITY },
    ];

    const template: CropScheduleTemplate = {
        id: templateId,
        cropCode,
        name: `${displayName} (Fallback Template)`,
        referenceType: 'PLANTING',
        stages,
        periodicExpectations: [
            {
                id: `pe_${templateId}_1`,
                stageId: stages[0].id,
                operationTypeId: 'op_irrig_drip',
                frequencyMode: 'EVERY_N_DAYS',
                frequencyValue: 3,
                notes: 'Fallback irrigation cadence.',
            },
        ],
        oneTimeExpectations: [
            {
                id: `ot_${templateId}_1`,
                stageId: stages[2].id,
                operationTypeId: 'op_harvest',
                targetDayFromRef: 100,
                notes: 'Fallback harvest checkpoint.',
            },
        ],
        createdBy: 'System Fallback',
        ownerType: 'SYSTEM_DEFAULT',
        totalDurationDays: 120,
        description: 'Used only when reference templates are not yet cached.',
        adoptionScore: 0,
        detailScore: 0,
        followersCount: 0,
    };

    fallbackTemplatesByCrop.set(cropCode, template);
    return template;
}

function rebuildIndexes(nextTemplates: CropScheduleTemplate[]): void {
    templates = nextTemplates;
    templatesById = new Map(nextTemplates.map(template => [template.id, template]));
    templatesByCrop = new Map<string, CropScheduleTemplate[]>();

    nextTemplates.forEach(template => {
        const cropCode = canonicalCropCode(template.cropCode);
        const bucket = templatesByCrop.get(cropCode) ?? [];
        bucket.push(template);
        templatesByCrop.set(cropCode, bucket);
    });
}

export function setScheduleTemplatesFromReferenceData(rawTemplates: unknown[]): void {
    if (!Array.isArray(rawTemplates)) {
        rebuildIndexes([]);
        return;
    }

    const mapped = rawTemplates
        .map(parseReferenceTemplate)
        .filter((template): template is ReferenceScheduleTemplate => template !== null)
        .map(mapTemplate);

    rebuildIndexes(mapped);
}

export function sortTemplates(
    sourceTemplates: CropScheduleTemplate[],
    sortBy: TemplateCatalogSort = 'HIGHEST_ADOPTION'
): CropScheduleTemplate[] {
    const copy = [...sourceTemplates];
    copy.sort((left, right) => {
        if (sortBy === 'MOST_FOLLOWED') {
            return (right.followersCount ?? 0) - (left.followersCount ?? 0);
        }
        if (sortBy === 'SHORTEST_DURATION') {
            return (left.totalDurationDays ?? Number.MAX_SAFE_INTEGER) - (right.totalDurationDays ?? Number.MAX_SAFE_INTEGER);
        }
        if (sortBy === 'NEWEST') {
            return Date.parse(right.publishedAt ?? '1970-01-01') - Date.parse(left.publishedAt ?? '1970-01-01');
        }
        return (right.adoptionScore ?? 0) - (left.adoptionScore ?? 0);
    });
    return copy;
}

export function getAllTemplates(): CropScheduleTemplate[] {
    return [...templates];
}

export function getTemplatesForCrop(
    cropName: string,
    sortBy: TemplateCatalogSort = 'HIGHEST_ADOPTION'
): CropScheduleTemplate[] {
    const cropCode = canonicalCropCode(cropName);
    const fromCatalog = templatesByCrop.get(cropCode);
    if (fromCatalog && fromCatalog.length > 0) {
        return sortTemplates(fromCatalog, sortBy);
    }

    return [buildFallbackTemplate(cropCode)];
}

export function getTemplateById(id: string): CropScheduleTemplate | undefined {
    const templateId = id.trim();
    if (!templateId) {
        return undefined;
    }

    const direct = templatesById.get(templateId);
    if (direct) {
        return direct;
    }

    for (const fallback of fallbackTemplatesByCrop.values()) {
        if (fallback.id === templateId) {
            return fallback;
        }
    }

    return undefined;
}

export function getPrimaryTemplateForCrop(cropName: string): CropScheduleTemplate {
    const options = getTemplatesForCrop(cropName);
    return options[0];
}

export function getStageNote(stage: StageTemplate): string {
    return stage.notes?.trim()
        || stage.description?.trim()
        || STAGE_NOTE_FALLBACKS[stage.code]
        || STAGE_NOTE_FALLBACKS.CUSTOM;
}
