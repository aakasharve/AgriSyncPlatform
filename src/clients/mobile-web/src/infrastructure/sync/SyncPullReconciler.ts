import { VersionRegistry } from '../../core/contracts/VersionRegistry';
import { systemClock } from '../../core/domain/services/Clock';
import {
    type CropProfile,
    type DailyLog,
    LogVerificationStatus,
    type Plot,
} from '../../types';
import {
    type AttachmentDto,
    type CropCycleDto,
    type DailyLogDto,
    type DayLedgerDto,
    type PlotDto,
    type SyncPullResponse,
    type SyncOperatorDto,
    type PlannedTask as PlannedTaskDto
} from '../api/AgriSyncClient';
import { getDatabase, type AttachmentRecord } from '../storage/DexieDatabase';
import { storageNamespace } from '../storage/StorageNamespace';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { setScheduleTemplatesFromReferenceData } from '../reference/TemplateCatalog';
import { normalizeMojibakeDeep, normalizeMojibakeText } from '../../shared/utils/textEncoding';
import {
    type FarmerProfile,
    type FarmOperator,
    OperatorCapability,
    VerificationStatus,
} from '../../types';

export function dayLedgerMetaKey(id: string): string {
    return `shramsafal_day_ledger_${id}`;
}

type SyncPullReferenceDataPayload = SyncPullResponse & {
    scheduleTemplates?: unknown[];
    cropTypes?: unknown[];
    activityCategories?: string[];
    costCategories?: string[];
    referenceDataVersionHash?: string;
    operators?: SyncOperatorDto[];
};

type CropTypeReference = {
    name: string;
    defaultTemplateId?: string | null;
};

const REFERENCE_DATA_VERSION_META_KEY = 'shramsafal_reference_data_version_hash_v1';

const CROP_COLORS = [
    'bg-emerald-500',
    'bg-rose-500',
    'bg-indigo-500',
    'bg-amber-500',
    'bg-cyan-500',
    'bg-lime-500',
    'bg-orange-500',
];

const ICON_HINTS: Array<{ includes: string[]; iconName: string }> = [
    { includes: ['grape'], iconName: 'Grape' },
    { includes: ['onion'], iconName: 'Onion' },
    { includes: ['sugarcane'], iconName: 'Sugarcane' },
    { includes: ['wheat'], iconName: 'Wheat' },
    { includes: ['pomegranate'], iconName: 'Flower2' },
    { includes: ['tomato'], iconName: 'Sprout' },
    { includes: ['guava', 'mango', 'banana', 'orange'], iconName: 'Trees' },
];

function toCropId(name: string): string {
    const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return normalized.length > 0 ? `crop_${normalized}` : 'crop_unknown';
}

function pickIconName(cropName: string): string {
    const value = cropName.toLowerCase();
    const match = ICON_HINTS.find(item => item.includes.some(key => value.includes(key)));
    return match?.iconName ?? 'Sprout';
}

function normalizeCropTypeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readCropTypeReferences(rawCropTypes: unknown[]): Map<string, string> {
    const defaults = new Map<string, string>();

    rawCropTypes.forEach(item => {
        if (!item || typeof item !== 'object') {
            return;
        }

        const value = item as CropTypeReference;
        if (typeof value.name !== 'string') {
            return;
        }

        if (typeof value.defaultTemplateId !== 'string') {
            return;
        }

        const templateId = value.defaultTemplateId.trim();
        if (!templateId) {
            return;
        }

        defaults.set(normalizeCropTypeKey(value.name), templateId);
    });

    return defaults;
}

function defaultPlotSchedule(plotId: string, referenceDate: string, templateId: string | null) {
    return {
        id: `sch_${plotId}`,
        plotId,
        templateId: templateId ?? 'fallback_template',
        referenceType: 'PLANTING' as const,
        referenceDate,
        stageOverrides: [],
        expectationOverrides: [],
    };
}

function ensureCrop(cropsById: Map<string, CropProfile>, cropName: string): CropProfile {
    const normalizedCropName = normalizeMojibakeText(cropName);
    const cropId = toCropId(normalizedCropName);
    const existing = cropsById.get(cropId);
    if (existing) {
        existing.name = normalizeMojibakeText(existing.name);
        return existing;
    }

    const color = CROP_COLORS[cropsById.size % CROP_COLORS.length];
    const created: CropProfile = {
        id: cropId,
        name: normalizedCropName,
        iconName: pickIconName(normalizedCropName),
        color,
        plots: [],
        activeScheduleId: null,
        supportedTasks: [],
        workflow: [],
        createdAt: systemClock.nowISO(),
    };

    cropsById.set(cropId, created);
    return created;
}

function upsertPlot(crop: CropProfile, plotDto: PlotDto, cycle: CropCycleDto, templateId: string | null): void {
    const normalizedPlotName = normalizeMojibakeText(plotDto.name);
    const normalizedCropName = normalizeMojibakeText(cycle.cropName);

    const existingPlot = crop.plots.find(p => p.id === plotDto.id);
    if (existingPlot) {
        existingPlot.name = normalizedPlotName;
        existingPlot.startDate = cycle.startDate;
        existingPlot.variety = normalizedCropName;
        if (existingPlot.schedule) {
            existingPlot.schedule.templateId = templateId ?? existingPlot.schedule.templateId;
        }
        existingPlot.baseline = {
            ...existingPlot.baseline,
            totalArea: plotDto.areaInAcres,
            unit: 'Acre',
        };
        return;
    }

    const plot: Plot = {
        id: plotDto.id,
        name: normalizedPlotName,
        variety: normalizedCropName,
        startDate: cycle.startDate,
        createdAt: plotDto.createdAtUtc,
        baseline: {
            totalArea: plotDto.areaInAcres,
            unit: 'Acre',
        },
        schedule: defaultPlotSchedule(plotDto.id, cycle.startDate, templateId),
    };

    crop.plots.push(plot);
}

function mapVerificationStatus(status?: string): LogVerificationStatus {
    if (!status) {
        return LogVerificationStatus.DRAFT;
    }

    const normalized = status
        .trim()
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();

    switch (normalized) {
        case 'draft':
        case 'pending':
            return LogVerificationStatus.DRAFT;
        case 'confirmed':
        case 'auto_approved':
            return LogVerificationStatus.CONFIRMED;
        case 'approved':
        case 'verified':
            return LogVerificationStatus.VERIFIED;
        case 'rejected':
        case 'disputed':
            return LogVerificationStatus.DISPUTED;
        case 'correction_pending':
            return LogVerificationStatus.CORRECTION_PENDING;
        default:
            return LogVerificationStatus.DRAFT;
    }
}

function mapAttachmentStatus(status?: string): AttachmentRecord['status'] {
    if (!status) {
        return 'pending';
    }

    switch (status.trim().toLowerCase()) {
        case 'finalized':
        case 'uploaded':
            return 'uploaded';
        case 'uploading':
            return 'uploading';
        case 'failed':
            return 'failed';
        default:
            return 'pending';
    }
}

function normalizeTaskActivityType(value: string): string {
    return value.trim().toLowerCase();
}

function isIrrigationActivity(value: string): boolean {
    return value.includes('irrigation')
        || value.includes('drip')
        || value.includes('flood')
        || value.includes('sprinkler')
        || value.includes('pani');
}

function isSprayActivity(value: string): boolean {
    return value.includes('spray')
        || value.includes('spraying')
        || value.includes('phavar')
        || value.includes('herbicide')
        || value.includes('fungicide')
        || value.includes('pesticide');
}

function isNutritionActivity(value: string): boolean {
    return value.includes('fertigation')
        || value.includes('fertilizer')
        || value.includes('fertiliser')
        || value.includes('urea')
        || value.includes('dap')
        || value.includes('basal')
        || value.includes('khat');
}

function isObservationActivity(value: string): boolean {
    return value.includes('observation')
        || value.includes('inspection')
        || value.includes('check');
}

function mapOperatorRole(rawRole?: string): FarmOperator['role'] {
    const normalized = (rawRole ?? '').trim().toUpperCase();
    switch (normalized) {
        case 'PRIMARYOWNER':
        case 'PRIMARY_OWNER':
            return 'PRIMARY_OWNER';
        case 'SECONDARYOWNER':
        case 'SECONDARY_OWNER':
            return 'SECONDARY_OWNER';
        case 'MUKADAM':
            return 'MUKADAM';
        default:
            return 'WORKER';
    }
}

function capabilitiesForRole(role: FarmOperator['role']): OperatorCapability[] {
    switch (role) {
        case 'PRIMARY_OWNER':
            return Object.values(OperatorCapability) as OperatorCapability[];
        case 'SECONDARY_OWNER':
            return [
                OperatorCapability.VIEW_ALL,
                OperatorCapability.LOG_DATA,
                OperatorCapability.APPROVE_LOGS,
                OperatorCapability.MANAGE_PEOPLE,
            ];
        case 'MUKADAM':
            return [
                OperatorCapability.VIEW_ALL,
                OperatorCapability.LOG_DATA,
            ];
        case 'WORKER':
        default:
            return [
                OperatorCapability.VIEW_ALL,
                OperatorCapability.LOG_DATA,
            ];
    }
}

function readExistingProfile(): FarmerProfile | null {
    const key = storageNamespace.getKey('farmer_profile');
    const raw = localStorage.getItem(key);
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw) as FarmerProfile;
    } catch {
        return null;
    }
}

function writeProfile(profile: FarmerProfile): void {
    const key = storageNamespace.getKey('farmer_profile');
    localStorage.setItem(key, JSON.stringify(profile));
}

function buildProfileFromSync(
    operators: SyncOperatorDto[],
    ownerUserId: string | undefined,
    existingProfile: FarmerProfile | null,
    receivedAtUtc: string
): FarmerProfile | null {
    if (operators.length === 0 && !existingProfile) {
        return null;
    }

    const mappedOperators: FarmOperator[] = operators.map(operator => {
        const normalizedRole = mapOperatorRole(operator.role);
        const role = ownerUserId && operator.userId === ownerUserId
            ? 'PRIMARY_OWNER'
            : normalizedRole;
        const displayName = normalizeMojibakeText(operator.displayName?.trim() || operator.userId);

        return {
            id: operator.userId,
            name: displayName,
            role,
            capabilities: capabilitiesForRole(role),
            isVerifier: role === 'PRIMARY_OWNER' || role === 'SECONDARY_OWNER',
            isActive: true,
        };
    });

    const operatorsById = new Map<string, FarmOperator>();
    mappedOperators.forEach(operator => {
        operatorsById.set(operator.id, operator);
    });

    const finalOperators = [...operatorsById.values()].sort((left, right) => {
        const leftRank = left.role === 'PRIMARY_OWNER' ? 0 : left.role === 'SECONDARY_OWNER' ? 1 : left.role === 'MUKADAM' ? 2 : 3;
        const rightRank = right.role === 'PRIMARY_OWNER' ? 0 : right.role === 'SECONDARY_OWNER' ? 1 : right.role === 'MUKADAM' ? 2 : 3;
        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }

        return left.name.localeCompare(right.name);
    });

    if (finalOperators.length === 0) {
        return existingProfile;
    }

    const ownerOperator = finalOperators.find(operator => operator.role === 'PRIMARY_OWNER') ?? finalOperators[0];
    const existingActiveOperatorId = existingProfile?.activeOperatorId;
    const activeOperatorId = existingActiveOperatorId && finalOperators.some(operator => operator.id === existingActiveOperatorId)
        ? existingActiveOperatorId
        : ownerOperator.id;

    return {
        name: ownerOperator.name,
        village: existingProfile?.village || '',
        phone: existingProfile?.phone || '',
        language: existingProfile?.language || 'mr',
        verificationStatus: existingProfile?.verificationStatus || VerificationStatus.Unverified,
        landHoldings: existingProfile?.landHoldings,
        operators: finalOperators,
        activeOperatorId,
        people: existingProfile?.people,
        trust: existingProfile?.trust,
        location: existingProfile?.location || {
            lat: 0,
            lon: 0,
            source: 'unknown',
            updatedAt: receivedAtUtc,
        },
        waterResources: existingProfile?.waterResources || [],
        motors: existingProfile?.motors || [],
        electricityTiming: existingProfile?.electricityTiming,
        machineries: existingProfile?.machineries,
        infrastructure: existingProfile?.infrastructure || {
            waterManagement: 'Decentralized',
            filtrationType: 'Screen',
        },
    };
}

function toDailyLog(
    source: DailyLogDto,
    plotLookup: Map<string, { cropId: string; cropName: string; plotName: string }>
): DailyLog {
    const plotContext = plotLookup.get(source.plotId);
    const selectedCropName = normalizeMojibakeText(plotContext?.cropName ?? 'Farm');
    const selectedPlotName = normalizeMojibakeText(plotContext?.plotName ?? 'Unknown Plot');
    const latestVerification = [...source.verificationEvents]
        .sort((left, right) => Date.parse(right.occurredAtUtc) - Date.parse(left.occurredAtUtc))[0];

    const verificationStatus = mapVerificationStatus(
        source.lastVerificationStatus ?? latestVerification?.status);
    const cropActivities: DailyLog['cropActivities'] = [];
    const irrigation: DailyLog['irrigation'] = [];
    const inputs: DailyLog['inputs'] = [];
    const observations: DailyLog['observations'] = [];

    source.tasks.forEach(task => {
        const activityType = normalizeMojibakeText(task.activityType);
        const taskNotes = task.notes ? normalizeMojibakeText(task.notes) : undefined;
        const normalizedActivity = normalizeTaskActivityType(activityType);
        if (isIrrigationActivity(normalizedActivity)) {
            irrigation.push({
                id: task.id,
                method: 'Drip',
                source: 'Field',
                notes: taskNotes,
            });
            return;
        }

        if (isSprayActivity(normalizedActivity)) {
            inputs.push({
                id: task.id,
                method: 'Spray',
                mix: [{
                    id: `mix_${task.id}`,
                    productName: activityType,
                    unit: 'unit',
                }],
                reason: 'Preventive',
                type: 'pesticide',
                productName: activityType,
                notes: taskNotes,
            });
            return;
        }

        if (isNutritionActivity(normalizedActivity)) {
            inputs.push({
                id: task.id,
                method: normalizedActivity.includes('fertigation') ? 'Drip' : 'Soil',
                mix: [{
                    id: `mix_${task.id}`,
                    productName: activityType,
                    unit: 'unit',
                }],
                reason: 'Growth',
                type: 'fertilizer',
                productName: activityType,
                notes: taskNotes,
            });
            return;
        }

        if (isObservationActivity(normalizedActivity)) {
            observations.push({
                id: task.id,
                plotId: source.plotId,
                cropId: plotContext?.cropId,
                dateKey: source.logDate,
                timestamp: task.occurredAtUtc,
                textRaw: taskNotes || activityType,
                textCleaned: taskNotes,
                noteType: 'observation',
                severity: 'normal',
                source: 'manual',
            });
            return;
        }

        cropActivities.push({
            id: task.id,
            title: activityType,
            workTypes: [activityType],
            notes: taskNotes,
            status: 'completed',
        });
    });

    return {
        id: source.id,
        date: source.logDate,
        context: {
            selection: [{
                cropId: plotContext?.cropId ?? 'FARM_GLOBAL',
                cropName: selectedCropName,
                selectedPlotIds: [source.plotId],
                selectedPlotNames: [selectedPlotName],
            }],
        },
        dayOutcome: 'WORK_RECORDED',
        cropActivities,
        irrigation,
        labour: [],
        inputs,
        machinery: [],
        activityExpenses: [],
        observations,
        plannedTasks: [],
        meta: {
            createdAtISO: source.createdAtUtc,
            createdByOperatorId: source.operatorUserId,
            schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
        },
        verification: {
            required: true,
            status: verificationStatus,
            verifiedByOperatorId: latestVerification?.verifiedByUserId,
            verifiedAtISO: latestVerification?.occurredAtUtc,
            notes: latestVerification?.reason,
        },
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            totalActivityExpenses: 0,
            grandTotal: 0,
        },
    };
}

function readExistingCrops(): CropProfile[] {
    const key = storageNamespace.getKey('crops');
    const raw = localStorage.getItem(key);
    if (!raw) {
        return [];
    }

    try {
        const parsed = JSON.parse(raw) as CropProfile[];
        const normalized = normalizeMojibakeDeep(Array.isArray(parsed) ? parsed : []);
        return normalized.value as CropProfile[];
    } catch {
        return [];
    }
}

function writeCrops(crops: CropProfile[]): void {
    const key = storageNamespace.getKey('crops');
    const normalized = normalizeMojibakeDeep(crops).value;
    localStorage.setItem(key, JSON.stringify(normalized));
}

export async function reconcileSyncPull(payload: SyncPullResponse): Promise<void> {
    const referencePayload = payload as SyncPullReferenceDataPayload;
    const scheduleTemplates = referencePayload.scheduleTemplates ?? [];
    const cropTypes = referencePayload.cropTypes ?? [];
    const activityCategories = referencePayload.activityCategories ?? [];
    const costCategories = referencePayload.costCategories ?? [];
    const referenceDataVersionHash = referencePayload.referenceDataVersionHash?.trim() ?? '';
    const operators = referencePayload.operators ?? [];
    const cropTypeDefaults = readCropTypeReferences(cropTypes);
    const dayLedgers = payload.dayLedgers ?? [];
    const plannedTasks = payload.plannedActivities as PlannedTaskDto[] ?? [];

    const existingCrops = readExistingCrops();
    const cropsById = new Map(existingCrops.map(crop => [crop.id, crop]));

    const plotsById = new Map(payload.plots.map(plot => [plot.id, plot]));
    for (const cycle of payload.cropCycles) {
        const crop = ensureCrop(cropsById, cycle.cropName);
        const resolvedTemplateId = cropTypeDefaults.get(normalizeCropTypeKey(cycle.cropName))
            ?? crop.activeScheduleId
            ?? null;
        if (resolvedTemplateId) {
            crop.activeScheduleId = resolvedTemplateId;
        }

        const plotDto = plotsById.get(cycle.plotId);
        if (!plotDto) {
            continue;
        }

        upsertPlot(crop, plotDto, cycle, resolvedTemplateId);
    }

    const mergedCrops = [...cropsById.values()];
    writeCrops(mergedCrops);
    const receivedAtUtc = systemClock.nowISO();
    const existingProfile = readExistingProfile();
    const reconciledProfile = buildProfileFromSync(
        operators,
        payload.farms[0]?.ownerUserId,
        existingProfile,
        receivedAtUtc);
    if (reconciledProfile) {
        writeProfile(reconciledProfile);
    }

    const plotLookup = new Map<string, { cropId: string; cropName: string; plotName: string }>();
    for (const crop of mergedCrops) {
        for (const plot of crop.plots) {
            plotLookup.set(plot.id, {
                cropId: crop.id,
                cropName: crop.name,
                plotName: plot.name,
            });
        }
    }

    const logs = payload.dailyLogs.map(log => toDailyLog(log, plotLookup));
    const attachments: AttachmentDto[] = payload.attachments ?? [];

    const db = getDatabase();
    await db.transaction('rw', [
        db.logs, db.attachments, db.uploadQueue, db.appMeta, db.referenceData,
        db.farms, db.plots, db.cropCycles, db.costEntries, db.financeCorrections,
        db.dayLedgers, db.plannedTasks
    ], async () => {
        for (const log of logs) {
            await db.logs.put({
                id: log.id,
                schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
                log,
                date: log.date,
                verificationStatus: log.verification?.status,
                createdByOperatorId: log.meta?.createdByOperatorId,
                isDeleted: log.deletion ? 1 : 0,
            });
        }

        for (const attachment of attachments) {
            const existing = await db.attachments.get(attachment.id);
            const mappedStatus = mapAttachmentStatus(attachment.status);

            await db.attachments.put({
                id: attachment.id,
                farmId: attachment.farmId,
                linkedEntityId: attachment.linkedEntityId,
                linkedEntityType: attachment.linkedEntityType,
                localPath: existing?.localPath ?? attachment.localPath ?? '',
                originalFileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes ?? existing?.sizeBytes ?? 0,
                status: mappedStatus,
                remoteAttachmentId: attachment.id,
                uploadedAtUtc: attachment.uploadedAtUtc ?? existing?.uploadedAtUtc,
                finalizedAtUtc: attachment.finalizedAtUtc ?? existing?.finalizedAtUtc,
                createdAt: attachment.createdAtUtc,
                updatedAt: attachment.modifiedAtUtc,
                retryCount: existing?.retryCount ?? 0,
                lastError: mappedStatus === 'failed'
                    ? existing?.lastError ?? 'Attachment upload failed on server.'
                    : undefined,
            });

            if (mappedStatus === 'uploaded') {
                const queuedItems = await db.uploadQueue
                    .where('attachmentId')
                    .equals(attachment.id)
                    .toArray();

                for (const queuedItem of queuedItems) {
                    if (queuedItem.autoId === undefined) {
                        continue;
                    }

                    await db.uploadQueue.update(queuedItem.autoId, {
                        status: 'completed',
                        updatedAt: receivedAtUtc,
                        nextAttemptAt: undefined,
                        lastError: undefined,
                    });
                }
            }
        }

        let referenceDataUpdated = false;
        if (referenceDataVersionHash.length > 0) {
            const previousVersionMeta = await db.appMeta.get(REFERENCE_DATA_VERSION_META_KEY);
            const previousVersionHash = typeof previousVersionMeta?.value === 'string'
                ? previousVersionMeta.value
                : '';

            if (previousVersionHash !== referenceDataVersionHash) {
                await db.referenceData.put({
                    key: 'scheduleTemplates',
                    data: scheduleTemplates,
                    versionHash: referenceDataVersionHash,
                    updatedAt: receivedAtUtc,
                });
                await db.referenceData.put({
                    key: 'cropTypes',
                    data: cropTypes,
                    versionHash: referenceDataVersionHash,
                    updatedAt: receivedAtUtc,
                });
                await db.referenceData.put({
                    key: 'activityCategories',
                    data: activityCategories,
                    versionHash: referenceDataVersionHash,
                    updatedAt: receivedAtUtc,
                });
                await db.referenceData.put({
                    key: 'costCategories',
                    data: costCategories,
                    versionHash: referenceDataVersionHash,
                    updatedAt: receivedAtUtc,
                });

                referenceDataUpdated = true;
            }

            await db.appMeta.put({
                key: REFERENCE_DATA_VERSION_META_KEY,
                value: referenceDataVersionHash,
                updatedAt: receivedAtUtc,
            });
        }

        for (const dayLedger of dayLedgers) {
            await db.dayLedgers.put({
                id: dayLedger.id,
                farmId: dayLedger.farmId,
                dateKey: getDateKey(dayLedger.ledgerDate),
                payload: dayLedger,
                updatedAt: receivedAtUtc,
            });

            await db.appMeta.put({
                key: dayLedgerMetaKey(dayLedger.id),
                value: dayLedger,
                updatedAt: receivedAtUtc,
            });
        }

        for (const plannedTask of plannedTasks) {
            await db.plannedTasks.put({
                id: plannedTask.id,
                cropCycleId: plannedTask.cropCycleId,
                plannedDate: getDateKey(plannedTask.plannedDate),
                payload: plannedTask,
                updatedAt: receivedAtUtc,
            });
        }

        await db.appMeta.put({
            key: 'shramsafal_day_ledgers_index_v1',
            value: {
                ids: dayLedgers.map(dayLedger => dayLedger.id),
                importedAtUtc: receivedAtUtc,
                importedCount: dayLedgers.length,
            },
            updatedAt: receivedAtUtc,
        });

        await db.appMeta.put({
            key: 'shramsafal_planned_tasks_index_v1',
            value: {
                ids: plannedTasks.map(task => task.id),
                importedAtUtc: receivedAtUtc,
                importedCount: plannedTasks.length,
            },
            updatedAt: receivedAtUtc,
        });

        const parsedCostEntries = payload.costEntries ?? [];
        const normalizedCostEntries = parsedCostEntries.map(entry => normalizeMojibakeDeep(entry).value);
        for (const ce of normalizedCostEntries) {
            await db.costEntries.put({
                id: ce.id,
                farmId: ce.farmId,
                payload: ce,
                updatedAt: receivedAtUtc
            });
        }

        const parsedCorrections = payload.financeCorrections ?? [];
        const normalizedCorrections = parsedCorrections.map(correction => normalizeMojibakeDeep(correction).value);
        for (const fc of normalizedCorrections) {
            await db.financeCorrections.put({
                id: fc.id,
                costEntryId: fc.costEntryId,
                payload: fc,
                updatedAt: receivedAtUtc
            });
        }

        await db.appMeta.put({
            key: 'shramsafal_finance_cost_entries_v1',
            value: normalizedCostEntries,
            updatedAt: receivedAtUtc,
        });

        await db.appMeta.put({
            key: 'shramsafal_finance_corrections_v1',
            value: normalizedCorrections,
            updatedAt: receivedAtUtc,
        });

        const parsedFarms = payload.farms ?? [];
        const normalizedFarms = parsedFarms.map(farm => normalizeMojibakeDeep(farm).value);
        for (const f of normalizedFarms) {
            await db.farms.put({
                id: f.id,
                payload: f,
                updatedAt: receivedAtUtc
            });
        }

        const parsedLocalPlots = payload.plots ?? [];
        const normalizedLocalPlots = parsedLocalPlots.map(plot => normalizeMojibakeDeep(plot).value);
        for (const p of normalizedLocalPlots) {
            await db.plots.put({
                id: p.id,
                farmId: p.farmId,
                payload: p,
                updatedAt: receivedAtUtc
            });
        }

        const parsedCycles = payload.cropCycles ?? [];
        const normalizedCycles = parsedCycles.map(cycle => normalizeMojibakeDeep(cycle).value);
        for (const cy of normalizedCycles) {
            await db.cropCycles.put({
                id: cy.id,
                farmId: cy.farmId,
                plotId: cy.plotId,
                payload: cy,
                updatedAt: receivedAtUtc
            });
        }

        await db.appMeta.put({
            key: 'shramsafal_finance_price_configs_v1',
            value: payload.priceConfigs ?? [],
            updatedAt: receivedAtUtc,
        });

        await db.appMeta.put({
            key: 'shramsafal_last_reconciled_pull_v1',
            value: {
                serverTimeUtc: payload.serverTimeUtc,
                nextCursorUtc: payload.nextCursorUtc,
                receivedAtUtc,
                importedLogs: logs.length,
                importedAttachments: attachments.length,
                importedScheduleTemplates: scheduleTemplates.length,
                importedDayLedgers: dayLedgers.length,
                importedPlannedTasks: plannedTasks.length,
                referenceDataVersionHash: referenceDataVersionHash || null,
                referenceDataUpdated,
            },
            updatedAt: receivedAtUtc,
        });
    });

    // Keep runtime catalog aligned with the latest server reference data.
    setScheduleTemplatesFromReferenceData(scheduleTemplates);

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('agrisync:finance-sync-payload', {
            detail: {
                costEntries: payload.costEntries ?? [],
                corrections: payload.financeCorrections ?? [],
                priceConfigs: payload.priceConfigs ?? [],
            },
        }));
        window.dispatchEvent(new CustomEvent('agrisync:sync-reconciled'));
    }
}
