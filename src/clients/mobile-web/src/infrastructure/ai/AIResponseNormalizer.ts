import { v4 as uuidv4 } from 'uuid';
import { AgriLogResponse } from '../../domain/ai/contracts/AgriLogResponseSchema';
import { LogSegment, UnclearReason } from '../../domain/types/log.types';
import {
    detectIrrigationFailureFromText,
    inferIrrigationIssueReasonFromText,
    inferIrrigationIssueTypeFromText,
    isFailedIrrigationEvent
} from '../../domain/ai/IrrigationStatusHeuristics';

type AnyRecord = Record<string, any>;

const DAY_OUTCOMES = ['WORK_RECORDED', 'DISTURBANCE_RECORDED', 'NO_WORK_PLANNED', 'IRRELEVANT_INPUT'] as const;
const ACTIVITY_STATUS = ['completed', 'partial', 'pending', 'gap_recorded'] as const;
const LABOUR_TYPES = ['HIRED', 'CONTRACT', 'SELF'] as const;
const LABOUR_WHO_WORKED = ['OWNER', 'OPERATOR', 'HIRED_LABOUR', 'UNKNOWN'] as const;
const CONTRACT_UNITS = ['Tree', 'Acre', 'Row', 'Lump Sum'] as const;
const INPUT_METHODS = ['Spray', 'Drip', 'Drenching', 'Soil'] as const;
const CARRIER_TYPES = ['Blower', 'Tank', 'Hours', 'Pati', 'Bag', 'Liters'] as const;
const INPUT_REASONS = ['Preventive', 'Disease', 'Pest', 'Growth', 'Deficiency', 'Seller Advice', 'Other'] as const;
const INPUT_TYPES = ['fertilizer', 'pesticide', 'fungicide', 'bio', 'other', 'unknown'] as const;
const MACHINERY_TYPES = ['tractor', 'tiller', 'harvester', 'drone', 'sprayer', 'unknown'] as const;
const MACHINERY_OWNERSHIP = ['owned', 'rented', 'unknown'] as const;
const DISTURBANCE_SCOPE = ['FULL_DAY', 'PARTIAL', 'DELAYED'] as const;
const SEGMENTS = ['crop_activity', 'irrigation', 'labour', 'input', 'machinery'] as const;
const SEVERITY = ['LOW', 'MEDIUM', 'HIGH'] as const;
const ISSUE_TYPES = [
    'MACHINERY', 'ELECTRICITY', 'WEATHER', 'WATER_SOURCE',
    'PEST', 'DISEASE', 'LABOR_SHORTAGE', 'MATERIAL_SHORTAGE', 'OTHER'
] as const;
const NOTE_TYPES = ['observation', 'issue', 'tip', 'reminder', 'unknown'] as const;
const NOTE_SEVERITY = ['normal', 'important', 'urgent'] as const;
const NOTE_SOURCES = ['voice', 'manual'] as const;
const PLANNED_CATEGORIES = ['maintenance', 'procurement', 'coordination', 'general'] as const;
const UNCLEAR_REASONS = [
    'ambiguous_verb', 'unknown_vocabulary', 'incomplete_sentence',
    'conflicting_markers', 'no_actionable_content', 'audio_quality',
    'mixed_languages', 'unknown'
] as const;

const CONF_LEVELS = ['HIGH', 'MEDIUM', 'LOW'] as const;
const BUNCH_TYING_PATTERNS = [
    /घड\s*बांध/u,
    /झाड\s*बांध/u,
    /bunch\s*tying/i,
    /tree\s*tying/i
];
const WORKER_PATTERNS = [
    /(\d+)\s*(जण|जन|people|workers|माणसं|मजूर)/iu,
    /(एक|दोन|तीन|चार|पाच|सहा|सात|आठ|नऊ|दहा)\s*(जण|जन|people|workers|माणसं|मजूर)/iu
];
const MARATHI_NUMBER_MAP: Record<string, number> = {
    एक: 1,
    दोन: 2,
    तीन: 3,
    चार: 4,
    पाच: 5,
    सहा: 6,
    सात: 7,
    आठ: 8,
    नऊ: 9,
    दहा: 10
};

const asObject = (value: unknown): AnyRecord =>
    (value && typeof value === 'object' && !Array.isArray(value)) ? value as AnyRecord : {};

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

const asString = (value: unknown, fallback = ''): string => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return fallback;
};

const asOptionalString = (value: unknown): string | undefined => {
    const text = asString(value, '');
    return text.length > 0 ? text : undefined;
};

const asNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
};

const asNullableNumber = (value: unknown): number | undefined => asNumber(value);

const asStringArray = (value: unknown): string[] =>
    asArray(value)
        .map(item => asString(item, ''))
        .filter(item => item.length > 0);

const toCanonical = (value: unknown): string =>
    asString(value, '')
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

function pickEnum<T extends readonly string[]>(
    value: unknown,
    allowed: T,
    aliases: Record<string, T[number]> = {},
    fallback?: T[number]
): T[number] | undefined {
    const raw = asString(value, '');
    if (!raw) return fallback;
    if ((allowed as readonly string[]).includes(raw)) return raw as T[number];

    const canonical = toCanonical(raw);
    const exactAllowed = (allowed as readonly string[]).find(item => toCanonical(item) === canonical);
    if (exactAllowed) return exactAllowed as T[number];

    const alias = aliases[canonical];
    if (alias) return alias;

    return fallback;
}

function normalizeSegmentList(value: unknown): LogSegment[] {
    const aliases: Record<string, LogSegment> = {
        crop: 'crop_activity',
        'crop activity': 'crop_activity',
        'crop activities': 'crop_activity',
        cropactivity: 'crop_activity',
        irrigation: 'irrigation',
        labour: 'labour',
        labor: 'labour',
        input: 'input',
        inputs: 'input',
        machinery: 'machinery',
        machine: 'machinery'
    };

    const segments = asArray(value)
        .map(item => pickEnum(item, SEGMENTS, aliases))
        .filter(Boolean) as LogSegment[];

    return Array.from(new Set(segments));
}

function normalizeIssue(issue: unknown) {
    const source = asObject(issue);
    if (Object.keys(source).length === 0) return undefined;

    const issueType = pickEnum(source.issueType || source.type, ISSUE_TYPES, {
        'labor shortage': 'LABOR_SHORTAGE',
        'labour shortage': 'LABOR_SHORTAGE',
        'material shortage': 'MATERIAL_SHORTAGE',
        water: 'WATER_SOURCE',
        'electricity issue': 'ELECTRICITY'
    }, 'OTHER');

    const reason = asString(source.reason || source.note, '');
    if (!reason) return undefined;

    return {
        issueType,
        reason,
        note: asOptionalString(source.note),
        severity: pickEnum(source.severity, SEVERITY, {}, 'LOW'),
        sourceText: asOptionalString(source.sourceText),
        systemInterpretation: asOptionalString(source.systemInterpretation)
    };
}

function normalizeDayOutcome(value: unknown): AgriLogResponse['dayOutcome'] {
    return pickEnum(value, DAY_OUTCOMES, {
        work: 'WORK_RECORDED',
        'work done': 'WORK_RECORDED',
        disturbance: 'DISTURBANCE_RECORDED',
        'no work': 'NO_WORK_PLANNED',
        irrelevant: 'IRRELEVANT_INPUT'
    }, 'WORK_RECORDED') as AgriLogResponse['dayOutcome'];
}

function normalizeInputMethod(value: unknown): AgriLogResponse['inputs'][number]['method'] {
    return pickEnum(value, INPUT_METHODS, {
        spray: 'Spray',
        spraying: 'Spray',
        drip: 'Drip',
        fertigation: 'Drip',
        drench: 'Drenching',
        drenching: 'Drenching',
        soil: 'Soil',
        basal: 'Soil',
        broadcast: 'Soil',
        granules: 'Soil',
        granule: 'Soil'
    }, 'Soil') as AgriLogResponse['inputs'][number]['method'];
}

function normalizeDisturbanceScope(value: unknown): AgriLogResponse['disturbance'] extends infer D
    ? D extends { scope: infer S }
        ? S
        : never
    : never {
    return pickEnum(value, DISTURBANCE_SCOPE, {
        'full day': 'FULL_DAY',
        fullday: 'FULL_DAY',
        full: 'FULL_DAY',
        'partial day': 'PARTIAL',
        partial: 'PARTIAL',
        delayed: 'DELAYED',
        delay: 'DELAYED'
    }, 'PARTIAL') as any;
}

function normalizeLabourType(value: unknown): AgriLogResponse['labour'][number]['type'] {
    return pickEnum(value, LABOUR_TYPES, {
        hired: 'HIRED',
        contract: 'CONTRACT',
        self: 'SELF',
        owner: 'SELF',
        family: 'SELF'
    }, 'HIRED') as AgriLogResponse['labour'][number]['type'];
}

function normalizeConfidenceLevel(score: number): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (score >= 0.85) return 'HIGH';
    if (score >= 0.6) return 'MEDIUM';
    return 'LOW';
}

function detectBunchTying(text: string): boolean {
    return BUNCH_TYING_PATTERNS.some(pattern => pattern.test(text));
}

function extractWorkerCount(text: string): number | undefined {
    for (const pattern of WORKER_PATTERNS) {
        const match = text.match(pattern);
        if (!match) continue;

        const rawCount = match[1];
        const numeric = Number(rawCount);
        if (Number.isFinite(numeric)) return numeric;

        const mapped = MARATHI_NUMBER_MAP[rawCount];
        if (mapped) return mapped;
    }

    return undefined;
}

export class AIResponseNormalizer {
    normalize(raw: unknown): AgriLogResponse {
        const source = asObject(raw);
        const transcriptContext = [
            asString(source.fullTranscript, ''),
            asString(source.summary, ''),
            asString(source.aiSourceSummary, '')
        ].join(' ').trim();

        let cropActivities = asArray(source.cropActivities).map(activity => this.normalizeCropActivity(activity));
        let irrigation = asArray(source.irrigation).map(entry => this.normalizeIrrigation(entry, transcriptContext));
        let labour = asArray(source.labour).map(entry => this.normalizeLabour(entry));
        const inputs = asArray(source.inputs).map(entry => this.normalizeInput(entry));
        const machinery = asArray(source.machinery).map(entry => this.normalizeMachinery(entry));
        const activityExpenses = asArray(source.activityExpenses).map(entry => this.normalizeActivityExpense(entry));
        let disturbance = this.normalizeDisturbance(source.disturbance);

        // Transcript fallback: ensure tying work and labour count are not lost for mixed Marathi logs
        if (transcriptContext && detectBunchTying(transcriptContext)) {
            const hasTyingActivity = cropActivities.some(activity =>
                detectBunchTying([
                    activity.title,
                    ...(activity.workTypes || []),
                    activity.sourceText || '',
                    activity.systemInterpretation || ''
                ].join(' '))
            );

            if (!hasTyingActivity) {
                cropActivities.push({
                    id: uuidv4(),
                    title: 'Bunch Tying',
                    workTypes: ['Tying'],
                    notes: undefined,
                    sourceText: asOptionalString(source.fullTranscript),
                    systemInterpretation: 'Detected tying activity from transcript.'
                });
            } else {
                cropActivities = cropActivities.map(activity => {
                    if (activity.title !== 'General Work') return activity;
                    const raw = [
                        activity.sourceText || '',
                        activity.systemInterpretation || '',
                        transcriptContext
                    ].join(' ');
                    if (!detectBunchTying(raw)) return activity;
                    return {
                        ...activity,
                        title: 'Bunch Tying',
                        workTypes: activity.workTypes && activity.workTypes.length > 0 ? activity.workTypes : ['Tying']
                    };
                });
            }
        }

        const detectedWorkerCount = extractWorkerCount(transcriptContext);
        if (detectedWorkerCount && detectedWorkerCount > 0) {
            if (labour.length === 0) {
                labour.push({
                    id: uuidv4(),
                    type: 'HIRED',
                    count: detectedWorkerCount,
                    notes: 'Detected from transcript worker-count pattern',
                    sourceText: asOptionalString(source.fullTranscript),
                    systemInterpretation: `Detected ${detectedWorkerCount} workers from transcript.`
                });
            } else {
                labour = labour.map(entry => {
                    if ((entry.count || 0) > 0 || (entry.maleCount || 0) > 0 || (entry.femaleCount || 0) > 0) {
                        return entry;
                    }
                    return {
                        ...entry,
                        count: detectedWorkerCount
                    };
                });
            }
        }

        const failedIrrigation = irrigation.filter(event => isFailedIrrigationEvent(event, transcriptContext));
        const hasSuccessfulIrrigation = irrigation.some(event => !isFailedIrrigationEvent(event, transcriptContext));

        if (failedIrrigation.length > 0) {
            if (disturbance) {
                disturbance = {
                    ...disturbance,
                    blockedSegments: Array.from(new Set([...(disturbance.blockedSegments || []), 'irrigation']))
                };
            } else if (!hasSuccessfulIrrigation && cropActivities.length === 0 && labour.length === 0 && inputs.length === 0 && machinery.length === 0) {
                const firstFailure = failedIrrigation[0];
                disturbance = {
                    scope: 'FULL_DAY',
                    group: firstFailure.issue?.issueType || 'IRRIGATION_BLOCK',
                    reason: firstFailure.issue?.reason || 'Irrigation could not be completed',
                    severity: 'HIGH',
                    blockedSegments: ['irrigation'],
                    note: firstFailure.notes,
                    sourceText: firstFailure.sourceText,
                    systemInterpretation: firstFailure.systemInterpretation
                };
            }
        }

        let dayOutcome = normalizeDayOutcome(source.dayOutcome);
        const hasWork = cropActivities.length > 0
            || hasSuccessfulIrrigation
            || labour.length > 0
            || inputs.length > 0
            || machinery.length > 0;

        if (!hasWork && (disturbance || failedIrrigation.length > 0)) {
            dayOutcome = 'DISTURBANCE_RECORDED';
        } else if (dayOutcome === 'IRRELEVANT_INPUT' && hasWork) {
            dayOutcome = 'WORK_RECORDED';
        }

        return {
            summary: asString(source.summary, 'Log processed.'),
            dayOutcome,
            cropActivities,
            irrigation,
            labour,
            inputs,
            machinery,
            activityExpenses,
            observations: this.normalizeObservations(source.observations),
            plannedTasks: this.normalizePlannedTasks(source.plannedTasks),
            disturbance,
            missingSegments: normalizeSegmentList(source.missingSegments),
            confidence: this.normalizeConfidence(source.confidence),
            fieldConfidences: this.normalizeFieldConfidences(source.fieldConfidences),
            unclearSegments: this.normalizeUnclearSegments(source.unclearSegments),
            questionsForUser: this.normalizeQuestions(source.questionsForUser),
            fullTranscript: asOptionalString(source.fullTranscript),
            aiSourceSummary: asOptionalString(source.aiSourceSummary),
            originalLogId: asOptionalString(source.originalLogId)
        };
    }

    private normalizeCropActivity(value: unknown): AgriLogResponse['cropActivities'][number] {
        const item = asObject(value);
        return {
            id: asOptionalString(item.id) || uuidv4(),
            title: asString(item.title || item.activity || item.taskName, 'General Work'),
            workTypes: asStringArray(item.workTypes),
            status: pickEnum(item.status, ACTIVITY_STATUS),
            quantity: asNumber(item.quantity),
            unit: asOptionalString(item.unit),
            notes: asOptionalString(item.notes),
            areaCovered: asNumber(item.areaCovered),
            startTime: asOptionalString(item.startTime),
            endTime: asOptionalString(item.endTime),
            detectedCrop: asOptionalString(item.detectedCrop),
            isCommonActivity: typeof item.isCommonActivity === 'boolean' ? item.isCommonActivity : undefined,
            tags: asStringArray(item.tags),
            targetPlotName: asOptionalString(item.targetPlotName),
            sourceText: asOptionalString(item.sourceText),
            systemInterpretation: asOptionalString(item.systemInterpretation),
            issue: normalizeIssue(item.issue)
        };
    }

    private normalizeIrrigation(value: unknown, transcriptContext: string): AgriLogResponse['irrigation'][number] {
        const item = asObject(value);
        const normalized = {
            id: asOptionalString(item.id) || uuidv4(),
            linkedActivityId: asOptionalString(item.linkedActivityId),
            method: asString(item.method || item.irrigationMethod, 'Irrigation'),
            source: asString(item.source || item.waterSource || item.sourceName, 'Unknown Source'),
            durationHours: asNumber(item.durationHours),
            waterVolumeLitres: asNumber(item.waterVolumeLitres || item.volume),
            notes: asOptionalString(item.notes),
            detectedCrop: asOptionalString(item.detectedCrop),
            motorId: asOptionalString(item.motorId || item.linkedMotorId || item.motor),
            targetPlotName: asOptionalString(item.targetPlotName),
            sourceText: asOptionalString(item.sourceText),
            systemInterpretation: asOptionalString(item.systemInterpretation),
            issue: normalizeIssue(item.issue)
        };

        const eventContext = [
            asString(item.sourceText, ''),
            asString(item.systemInterpretation, ''),
            asString(item.notes, ''),
            asString(item.reason, ''),
            asString(item.comment, '')
        ].join(' ').trim();

        const textForFailureDetection = eventContext.length > 0 ? eventContext : transcriptContext;
        if (!detectIrrigationFailureFromText(textForFailureDetection)) {
            return normalized;
        }

        const inferredType = inferIrrigationIssueTypeFromText(textForFailureDetection);
        const inferredReason = inferIrrigationIssueReasonFromText(textForFailureDetection);

        return {
            ...normalized,
            durationHours: 0,
            waterVolumeLitres: undefined,
            notes: normalized.notes || 'Irrigation could not be completed.',
            issue: normalized.issue || {
                issueType: inferredType,
                reason: inferredReason,
                severity: 'HIGH',
                note: normalized.notes,
                sourceText: normalized.sourceText || asOptionalString(textForFailureDetection),
                systemInterpretation: normalized.systemInterpretation
            }
        };
    }

    private normalizeLabour(value: unknown): AgriLogResponse['labour'][number] {
        const item = asObject(value);
        return {
            id: asOptionalString(item.id) || uuidv4(),
            linkedActivityId: asOptionalString(item.linkedActivityId),
            type: normalizeLabourType(item.type || item.labourType),
            shiftId: asOptionalString(item.shiftId),
            maleCount: asNullableNumber(item.maleCount),
            femaleCount: asNullableNumber(item.femaleCount),
            count: asNullableNumber(item.count || item.workerCount),
            wagePerPerson: asNullableNumber(item.wagePerPerson),
            contractUnit: pickEnum(item.contractUnit, CONTRACT_UNITS, { 'lump sum': 'Lump Sum', lumpsum: 'Lump Sum' }),
            contractQuantity: asNullableNumber(item.contractQuantity),
            operatorId: asOptionalString(item.operatorId),
            totalCost: asNullableNumber(item.totalCost),
            notes: asOptionalString(item.notes),
            detectedCrop: asOptionalString(item.detectedCrop),
            whoWorked: pickEnum(item.whoWorked, LABOUR_WHO_WORKED, {
                'hired labour': 'HIRED_LABOUR',
                labour: 'HIRED_LABOUR'
            }),
            activity: asOptionalString(item.activity),
            targetPlotName: asOptionalString(item.targetPlotName),
            sourceText: asOptionalString(item.sourceText),
            systemInterpretation: asOptionalString(item.systemInterpretation),
            issue: normalizeIssue(item.issue)
        };
    }

    private normalizeInput(value: unknown): AgriLogResponse['inputs'][number] {
        const item = asObject(value);
        let mix = asArray(item.mix).map(mixItem => this.normalizeMixItem(mixItem));
        if (mix.length === 0 && asOptionalString(item.productName)) {
            mix = [this.normalizeMixItem(item)];
        }

        return {
            id: asOptionalString(item.id) || uuidv4(),
            linkedActivityId: asOptionalString(item.linkedActivityId),
            linkedExpenseId: asOptionalString(item.linkedExpenseId),
            linkedExpenseItemId: asOptionalString(item.linkedExpenseItemId),
            costSource: pickEnum(item.costSource, ['MANUAL', 'PROCUREMENT'] as const),
            method: normalizeInputMethod(item.method || item.applicationMethod),
            carrierType: pickEnum(item.carrierType, CARRIER_TYPES, { litre: 'Liters', liters: 'Liters', litres: 'Liters' }),
            carrierCount: asNullableNumber(item.carrierCount),
            carrierCapacity: asNullableNumber(item.carrierCapacity),
            computedWaterVolume: asNullableNumber(item.computedWaterVolume),
            mix,
            reason: pickEnum(item.reason, INPUT_REASONS, {
                'seller advice': 'Seller Advice',
                seller: 'Seller Advice'
            }),
            recommendedBy: asOptionalString(item.recommendedBy),
            cost: asNullableNumber(item.cost),
            notes: asOptionalString(item.notes),
            detectedCrop: asOptionalString(item.detectedCrop),
            type: pickEnum(item.type, INPUT_TYPES, {}, 'unknown'),
            productName: asOptionalString(item.productName),
            quantity: asNullableNumber(item.quantity),
            unit: asOptionalString(item.unit),
            targetPlotName: asOptionalString(item.targetPlotName),
            sourceText: asOptionalString(item.sourceText),
            systemInterpretation: asOptionalString(item.systemInterpretation),
            issue: normalizeIssue(item.issue)
        };
    }

    private normalizeMixItem(value: unknown): AgriLogResponse['inputs'][number]['mix'][number] {
        const mixItem = asObject(value);
        return {
            id: asOptionalString(mixItem.id) || uuidv4(),
            productName: asString(mixItem.productName || mixItem.name, 'Unknown Input'),
            dose: asNullableNumber(mixItem.dose),
            unit: asString(mixItem.unit || mixItem.doseUnit, 'unit'),
            linkedExpenseId: asOptionalString(mixItem.linkedExpenseId),
            linkedExpenseItemId: asOptionalString(mixItem.linkedExpenseItemId),
            costSource: pickEnum(mixItem.costSource, ['MANUAL', 'PROCUREMENT'] as const)
        };
    }

    private normalizeMachinery(value: unknown): AgriLogResponse['machinery'][number] {
        const item = asObject(value);
        return {
            id: asOptionalString(item.id) || uuidv4(),
            linkedActivityId: asOptionalString(item.linkedActivityId),
            type: pickEnum(item.type, MACHINERY_TYPES, {
                tractor: 'tractor',
                spray: 'sprayer'
            }, 'unknown') as AgriLogResponse['machinery'][number]['type'],
            ownership: pickEnum(item.ownership, MACHINERY_OWNERSHIP, { own: 'owned', rented: 'rented' }, 'unknown') as AgriLogResponse['machinery'][number]['ownership'],
            hoursUsed: asNullableNumber(item.hoursUsed),
            rentalCost: asNullableNumber(item.rentalCost),
            fuelCost: asNullableNumber(item.fuelCost),
            targetPlotName: asOptionalString(item.targetPlotName),
            notes: asOptionalString(item.notes),
            sourceText: asOptionalString(item.sourceText),
            systemInterpretation: asOptionalString(item.systemInterpretation),
            issue: normalizeIssue(item.issue)
        };
    }

    private normalizeActivityExpense(value: unknown): AgriLogResponse['activityExpenses'][number] {
        const item = asObject(value);
        const normalizedItems = asArray(item.items).map(expenseItem => {
            const parsed = asObject(expenseItem);
            return {
                id: asOptionalString(parsed.id) || uuidv4(),
                name: asString(parsed.name || parsed.productName || parsed.itemName, 'Item'),
                qty: asNullableNumber(parsed.qty),
                unit: asOptionalString(parsed.unit),
                unitPrice: asNullableNumber(parsed.unitPrice),
                total: asNullableNumber(parsed.total)
            };
        });

        const items = normalizedItems.length > 0 ? normalizedItems : [{
            id: uuidv4(),
            name: asString(item.reason || item.title, 'Item'),
            qty: undefined,
            unit: undefined,
            unitPrice: undefined,
            total: undefined
        }];

        const computedTotal = items.reduce((sum, entry) => sum + (entry.total || 0), 0);
        return {
            id: asOptionalString(item.id) || uuidv4(),
            reason: asString(item.reason || item.title, 'Activity expense'),
            category: asOptionalString(item.category),
            vendor: asOptionalString(item.vendor),
            vendorPhone: asOptionalString(item.vendorPhone),
            items,
            totalAmount: asNullableNumber(item.totalAmount) ?? computedTotal,
            linkedActivityId: asOptionalString(item.linkedActivityId),
            observation: asOptionalString(item.observation),
            notes: asOptionalString(item.notes),
            timestamp: asOptionalString(item.timestamp),
            sourceText: asOptionalString(item.sourceText),
            systemInterpretation: asOptionalString(item.systemInterpretation)
        };
    }

    private normalizeObservations(value: unknown): AgriLogResponse['observations'] {
        const observations = asArray(value).map(entry => {
            const item = asObject(entry);
            const textRaw = asString(item.textRaw || item.text || item.note, '');
            if (!textRaw) return null;

            return {
                id: asOptionalString(item.id) || uuidv4(),
                plotId: asOptionalString(item.plotId),
                cropId: asOptionalString(item.cropId),
                dateKey: asOptionalString(item.dateKey),
                timestamp: asOptionalString(item.timestamp),
                textRaw,
                textCleaned: asOptionalString(item.textCleaned),
                noteType: pickEnum(item.noteType, NOTE_TYPES, {}, 'observation'),
                severity: pickEnum(item.severity, NOTE_SEVERITY, {}, 'normal'),
                tags: asStringArray(item.tags),
                source: pickEnum(item.source, NOTE_SOURCES, {}, 'voice'),
                aiConfidence: asNumber(item.aiConfidence),
                status: pickEnum(item.status, ['open', 'resolved'] as const),
                resolvedAt: asOptionalString(item.resolvedAt),
                sourceText: asOptionalString(item.sourceText),
                systemInterpretation: asOptionalString(item.systemInterpretation)
            };
        }).filter(Boolean) as NonNullable<AgriLogResponse['observations']>;

        return observations.length > 0 ? observations : undefined;
    }

    private normalizePlannedTasks(value: unknown): AgriLogResponse['plannedTasks'] {
        const tasks = asArray(value).map(entry => {
            const task = asObject(entry);
            const title = asString(task.title, '');
            if (!title) return null;
            return {
                title,
                dueHint: asOptionalString(task.dueHint) ?? null,
                category: pickEnum(task.category, PLANNED_CATEGORIES, {}, 'general'),
                sourceText: asString(task.sourceText || task.title, title),
                systemInterpretation: asString(task.systemInterpretation || task.title, title)
            };
        }).filter(Boolean) as NonNullable<AgriLogResponse['plannedTasks']>;

        return tasks.length > 0 ? tasks : undefined;
    }

    private normalizeDisturbance(value: unknown): AgriLogResponse['disturbance'] {
        const disturbance = asObject(value);
        if (Object.keys(disturbance).length === 0) return undefined;

        const reason = asString(disturbance.reason || disturbance.note, '');
        if (!reason) return undefined;

        return {
            scope: normalizeDisturbanceScope(disturbance.scope),
            group: asString(disturbance.group, 'General'),
            reason,
            severity: pickEnum(disturbance.severity, SEVERITY, {}, 'LOW'),
            blockedSegments: normalizeSegmentList(disturbance.blockedSegments),
            note: asOptionalString(disturbance.note),
            weatherEventId: asOptionalString(disturbance.weatherEventId),
            sourceText: asOptionalString(disturbance.sourceText),
            systemInterpretation: asOptionalString(disturbance.systemInterpretation)
        };
    }

    private normalizeConfidence(value: unknown): AgriLogResponse['confidence'] {
        const source = asObject(value);
        const normalized: Record<string, number> = {};

        Object.entries(source).forEach(([key, rawScore]) => {
            const score = asNumber(rawScore);
            if (score !== undefined) normalized[key] = score;
        });

        return Object.keys(normalized).length > 0 ? normalized : undefined;
    }

    private normalizeFieldConfidences(value: unknown): AgriLogResponse['fieldConfidences'] {
        const source = asObject(value);
        const normalized: NonNullable<AgriLogResponse['fieldConfidences']> = {};

        Object.entries(source).forEach(([field, rawConf]) => {
            if (typeof rawConf === 'number') {
                const score = Number.isFinite(rawConf) ? rawConf : 0.5;
                normalized[field] = {
                    level: normalizeConfidenceLevel(score),
                    score
                };
                return;
            }

            const conf = asObject(rawConf);
            const score = asNumber(conf.score) ?? 0.5;
            const level = pickEnum(conf.level, CONF_LEVELS, {}, normalizeConfidenceLevel(score));
            normalized[field] = {
                level,
                score,
                reason: asOptionalString(conf.reason)
            };
        });

        return Object.keys(normalized).length > 0 ? normalized : undefined;
    }

    private normalizeUnclearSegments(value: unknown): AgriLogResponse['unclearSegments'] {
        const segments = asArray(value).map(entry => {
            const item = asObject(entry);
            return {
                id: asOptionalString(item.id) || uuidv4(),
                rawText: asString(item.rawText, ''),
                confidence: asNumber(item.confidence) ?? 0,
                reason: pickEnum(item.reason, UNCLEAR_REASONS, {}, 'unknown') as UnclearReason,
                userMessage: asString(item.userMessage, 'Could not confidently parse this part.'),
                userMessageEn: asOptionalString(item.userMessageEn),
                suggestedRephrase: asOptionalString(item.suggestedRephrase)
            };
        });

        return segments.length > 0 ? segments : undefined;
    }

    private normalizeQuestions(value: unknown): AgriLogResponse['questionsForUser'] {
        const questions = asArray(value).map(entry => {
            const item = asObject(entry);
            const text = asString(item.text, '');
            if (!text) return null;
            return {
                id: asOptionalString(item.id) || uuidv4(),
                type: 'LABOUR_SOURCE_CHECK' as const,
                target: 'LABOUR' as const,
                text
            };
        }).filter(Boolean) as NonNullable<AgriLogResponse['questionsForUser']>;

        return questions.length > 0 ? questions : undefined;
    }
}
