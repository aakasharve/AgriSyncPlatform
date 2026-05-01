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
    type AttentionBoardDto,
    type CropCycleDto,
    type DailyLogDto,
    type DayLedgerDto,
    type PlotDto,
    type SyncPullResponse,
    type SyncOperatorDto,
    type PlannedTask as PlannedTaskDto
} from '../api/AgriSyncClient';
import { getDatabase, type AttachmentRecord } from '../storage/DexieDatabase';
import { DexieCropsRepository } from '../storage/DexieCropsRepository';
import { DexieProfileRepository } from '../storage/DexieProfileRepository';
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

function isPurveshDemoOwner(name: string): boolean {
    return name.trim().toLowerCase().includes('purvesh');
}

function buildPurveshDemoProfileDefaults(receivedAtUtc: string): Partial<FarmerProfile> {
    return {
        village: 'Khardi, Nashik',
        phone: '9800000001',
        language: 'mr',
        verificationStatus: VerificationStatus.PhoneVerified,
        landHoldings: {
            value: 6,
            unit: 'Acre',
        },
        people: [
            { id: 'demo_shankar', name: 'Shankar Jadhav', role: 'Mukadam', phone: '9800000002', isActive: true, skills: ['Spraying', 'Irrigation'] },
            { id: 'demo_raju', name: 'Raju Bhosale', role: 'Worker', phone: '9800000003', isActive: true, skills: ['Weeding', 'Equipment'] },
            { id: 'demo_santosh', name: 'Santosh Kamble', role: 'Worker', phone: '9800000004', isActive: true, skills: ['Fertigation', 'Field Support'] },
        ],
        trust: {
            requirePinForVerification: false,
            reviewPolicy: 'AUTO_APPROVE_OWNER',
            autoApproveDelayDays: 1,
        },
        location: {
            lat: 20.1194,
            lon: 73.7722,
            source: 'manual',
            updatedAt: receivedAtUtc,
        },
        waterResources: [
            { id: 'water_main_well', type: 'Well', name: 'Main Well', isAvailable: true, notes: 'G1/G2 drip main source' },
            { id: 'water_bore_east', type: 'Borewell', name: 'East Borewell', isAvailable: true, notes: 'Turmeric and S2 support line' },
            { id: 'water_farm_pond', type: 'Farm Pond', name: 'Farm Pond', isAvailable: true, notes: 'Pomegranate and backup irrigation' },
            { id: 'water_canal_feed', type: 'Canal', name: 'Canal Feed', isAvailable: true, notes: 'Sugarcane S1 flood irrigation' },
        ],
        motors: [
            { id: 'motor_kirloskar_75', name: 'Kirloskar 7.5 HP', hp: 7.5, phase: '3', powerSourceType: 'MSEB', linkedWaterSourceId: 'water_main_well' },
            { id: 'motor_cri_5', name: 'CRI 5 HP', hp: 5, phase: '3', powerSourceType: 'MSEB', linkedWaterSourceId: 'water_bore_east' },
            { id: 'motor_solar_10', name: 'Solar 10 HP Pump', hp: 10, phase: '3', powerSourceType: 'Solar', linkedWaterSourceId: 'water_farm_pond' },
            { id: 'motor_diesel_mobile', name: 'Mobile Diesel Pump', hp: 5, phase: '1', powerSourceType: 'Generator', linkedWaterSourceId: 'water_canal_feed' },
        ],
        electricityTiming: {
            singlePhase: {
                patternMode: 'FIXED_WEEKLY',
                alternateWeeklyPattern: false,
                weekAOffWindows: [
                    { id: 'sp_morning', startTime: '06:00', endTime: '09:00', repeatRule: 'DAILY', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
                ],
                weekBOffWindows: [],
            },
            threePhase: {
                patternMode: 'FIXED_WEEKLY',
                alternateWeeklyPattern: false,
                weekAOffWindows: [
                    { id: 'tp_evening', startTime: '18:30', endTime: '21:30', repeatRule: 'DAILY', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
                ],
                weekBOffWindows: [],
            },
            updatedAt: receivedAtUtc,
        },
        machineries: [
            { id: 'machine_tractor', name: 'John Deere 5050', type: 'Tractor', ownership: 'Owned', defaultOperatorId: 'demo_shankar' },
            { id: 'machine_sprayer', name: 'Power Sprayer 400L', type: 'Sprayer', ownership: 'Owned', defaultOperatorId: 'demo_shankar', capacity: 400 },
            { id: 'machine_rotavator', name: 'Mini Rotavator', type: 'Rotavator', ownership: 'Rented', defaultOperatorId: 'demo_raju' },
            { id: 'machine_blower', name: 'Blower Sprayer', type: 'Sprayer', ownership: 'Owned', defaultOperatorId: 'demo_santosh', capacity: 200 },
        ],
        infrastructure: {
            waterManagement: 'Decentralized',
            filtrationType: 'Disc',
        },
    };
}

function fillMissingProfileDetails(
    existingProfile: FarmerProfile | null,
    ownerOperator: FarmOperator,
    receivedAtUtc: string
): Partial<FarmerProfile> | null {
    if (!isPurveshDemoOwner(ownerOperator.name)) {
        return null;
    }

    if (existingProfile?.waterResources?.length || existingProfile?.motors?.length || existingProfile?.machineries?.length) {
        return null;
    }

    return buildPurveshDemoProfileDefaults(receivedAtUtc);
}

function enrichPurveshDemoCrops(crops: CropProfile[], profile: FarmerProfile | null): CropProfile[] {
    if (!profile || !isPurveshDemoOwner(profile.name)) {
        return crops;
    }

    crops.forEach(crop => {
        crop.plots.forEach(plot => {
            const plotName = normalizeMojibakeText(plot.name);
            const mergeInfrastructure = (defaults: NonNullable<Plot['infrastructure']>) => {
                plot.infrastructure = {
                    irrigationMethod: plot.infrastructure?.irrigationMethod || defaults.irrigationMethod,
                    linkedMotorId: plot.infrastructure?.linkedMotorId || defaults.linkedMotorId,
                    dripDetails: plot.infrastructure?.dripDetails || defaults.dripDetails,
                    linkedMachineryIds: plot.infrastructure?.linkedMachineryIds?.length
                        ? plot.infrastructure.linkedMachineryIds
                        : defaults.linkedMachineryIds,
                };
            };

            if (plotName.includes('G1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'motor_kirloskar_75',
                    dripDetails: { pipeSize: '16mm', hasFilter: true, flowRatePerHour: 1400 },
                    linkedMachineryIds: ['machine_sprayer', 'machine_blower'],
                });
                return;
            }

            if (plotName.includes('G2')) {
                mergeInfrastructure({
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'motor_cri_5',
                    dripDetails: { pipeSize: '16mm', hasFilter: true, flowRatePerHour: 1100 },
                    linkedMachineryIds: ['machine_sprayer'],
                });
                return;
            }

            if (plotName.includes('P1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Drip',
                    linkedMotorId: 'motor_solar_10',
                    dripDetails: { pipeSize: '20mm', hasFilter: true, flowRatePerHour: 1500 },
                    linkedMachineryIds: ['machine_blower', 'machine_sprayer'],
                });
                return;
            }

            if (plotName.includes('S1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Flood',
                    linkedMotorId: 'motor_diesel_mobile',
                    linkedMachineryIds: ['machine_tractor', 'machine_rotavator'],
                });
                return;
            }

            if (plotName.includes('S2')) {
                mergeInfrastructure({
                    irrigationMethod: 'Flood',
                    linkedMotorId: 'motor_cri_5',
                    linkedMachineryIds: ['machine_tractor'],
                });
                return;
            }

            if (plotName.includes('T1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Sprinkler',
                    linkedMotorId: 'motor_cri_5',
                    linkedMachineryIds: ['machine_rotavator'],
                });
                return;
            }

            if (plotName.includes('B1')) {
                mergeInfrastructure({
                    irrigationMethod: 'Flood',
                    linkedMotorId: 'motor_diesel_mobile',
                    linkedMachineryIds: ['machine_tractor'],
                });
            }
        });
    });

    return crops;
}

// readExistingProfile / writeProfile removed in T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE
// (2026-05-01). Profile reads/writes go through DexieProfileRepository inside
// reconcileSyncPull so the substrate sync writes to is the same substrate the
// UI reads from.

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
    const demoDefaults = fillMissingProfileDetails(existingProfile, ownerOperator, receivedAtUtc);
    const existingActiveOperatorId = existingProfile?.activeOperatorId;
    const activeOperatorId = existingActiveOperatorId && finalOperators.some(operator => operator.id === existingActiveOperatorId)
        ? existingActiveOperatorId
        : ownerOperator.id;

    return {
        name: ownerOperator.name,
        village: existingProfile?.village || demoDefaults?.village || '',
        phone: existingProfile?.phone || demoDefaults?.phone || '',
        language: existingProfile?.language || demoDefaults?.language || 'mr',
        verificationStatus: existingProfile?.verificationStatus || demoDefaults?.verificationStatus || VerificationStatus.Unverified,
        landHoldings: existingProfile?.landHoldings || demoDefaults?.landHoldings,
        operators: finalOperators,
        activeOperatorId,
        people: existingProfile?.people || demoDefaults?.people,
        trust: existingProfile?.trust || demoDefaults?.trust,
        location: existingProfile?.location || demoDefaults?.location || {
            lat: 0,
            lon: 0,
            source: 'unknown',
            updatedAt: receivedAtUtc,
        },
        waterResources: existingProfile?.waterResources?.length ? existingProfile.waterResources : demoDefaults?.waterResources || [],
        motors: existingProfile?.motors?.length ? existingProfile.motors : demoDefaults?.motors || [],
        electricityTiming: existingProfile?.electricityTiming || demoDefaults?.electricityTiming,
        machineries: existingProfile?.machineries?.length ? existingProfile.machineries : demoDefaults?.machineries,
        infrastructure: existingProfile?.infrastructure || demoDefaults?.infrastructure || {
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

// readExistingCrops / writeCrops removed in T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE
// (2026-05-01). Crop reads/writes go through DexieCropsRepository inside
// reconcileSyncPull. Normalization (normalizeMojibakeDeep) still runs — it's
// applied internally by the repositories, so the on-the-wire mojibake-repair
// behavior is preserved.

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

    // Substrate is Dexie post T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE (2026-05-01).
    // The repositories instantiate cleanly (no constructor params) because they
    // are stateless wrappers around getDatabase().
    const cropsRepo = new DexieCropsRepository();
    const profileRepo = new DexieProfileRepository();

    const existingCrops = await cropsRepo.getAll();
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

    const receivedAtUtc = systemClock.nowISO();
    // DexieProfileRepository.get() returns `{} as FarmerProfile` for a missing
    // singleton row; convert that back to null at the boundary so
    // buildProfileFromSync's existing null-vs-real semantics keep working
    // (line 520's `!existingProfile` early-return + line 556's
    // `if (finalOperators.length === 0) return existingProfile`).
    const profileFromRepo = await profileRepo.get();
    const existingProfile: FarmerProfile | null =
        profileFromRepo && Object.keys(profileFromRepo).length > 0
            ? profileFromRepo
            : null;
    const reconciledProfile = buildProfileFromSync(
        operators,
        payload.farms[0]?.ownerUserId,
        existingProfile,
        receivedAtUtc);
    const mergedCrops = enrichPurveshDemoCrops([...cropsById.values()], reconciledProfile);
    await cropsRepo.save(mergedCrops);
    if (reconciledProfile) {
        await profileRepo.save(reconciledProfile);
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

    // Build server-version lookup so we can detect stale-pull overwrites.
    const serverModifiedByLogId = new Map<string, string>();
    for (const dto of payload.dailyLogs) {
        if (dto.modifiedAtUtc) {
            serverModifiedByLogId.set(dto.id, dto.modifiedAtUtc);
        }
    }

    const db = getDatabase();

    // ARCH-S004: collect logIds that still have unsynced local mutations so we do
    // NOT overwrite them with server state that is older than the pending edits.
    const pendingLogIds = new Set<string>();
    try {
        const pending = await db.mutationQueue
            .where('status')
            .anyOf(['PENDING', 'SENDING', 'FAILED'])
            .toArray();
        for (const mutation of pending) {
            const payloadObj = mutation.payload as
                | { dailyLogId?: string; logId?: string; id?: string }
                | null
                | undefined;
            if (!payloadObj || typeof payloadObj !== 'object') continue;
            if (payloadObj.dailyLogId) pendingLogIds.add(payloadObj.dailyLogId);
            if (payloadObj.logId) pendingLogIds.add(payloadObj.logId);
        }
    } catch (error) {
        console.warn('SyncPullReconciler: failed to read mutationQueue for conflict detection', error);
    }

    await db.transaction('rw', [
        db.logs, db.attachments, db.uploadQueue, db.appMeta, db.referenceData,
        db.farms, db.plots, db.cropCycles, db.costEntries, db.financeCorrections,
        db.dayLedgers, db.plannedTasks, db.attentionCards
    ], async () => {
        for (const log of logs) {
            // Source-version conflict isolation.
            if (pendingLogIds.has(log.id)) {
                console.info(
                    JSON.stringify({
                        component: 'SyncPullReconciler',
                        action: 'skip_overwrite_pending_mutation',
                        logId: log.id,
                    }));
                continue;
            }

            const existing = await db.logs.get(log.id);
            const serverModified = serverModifiedByLogId.get(log.id);
            if (
                existing?.serverModifiedAtUtc &&
                serverModified &&
                Date.parse(serverModified) <= Date.parse(existing.serverModifiedAtUtc)
            ) {
                // Server has not advanced past the version we already reconciled.
                continue;
            }

            await db.logs.put({
                id: log.id,
                schemaVersion: VersionRegistry.DB_SCHEMA_VERSION,
                log,
                date: log.date,
                verificationStatus: log.verification?.status,
                createdByOperatorId: log.meta?.createdByOperatorId,
                isDeleted: log.deletion ? 1 : 0,
                serverModifiedAtUtc: serverModified,
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

        // CEI Phase 1 — clear and repopulate attention cards on every successful pull.
        if (payload.attentionBoard) {
            await db.attentionCards.clear();
            const attentionBoard = payload.attentionBoard as AttentionBoardDto;
            if (attentionBoard.cards.length > 0) {
                await db.attentionCards.bulkPut(
                    attentionBoard.cards.map(card => ({
                        cardId: card.cardId,
                        farmId: card.farmId,
                        farmName: card.farmName,
                        plotId: card.plotId,
                        plotName: card.plotName,
                        rank: card.rank,
                        computedAtUtc: card.computedAtUtc,
                        cropCycleId: card.cropCycleId,
                        stageName: card.stageName,
                        titleEn: card.titleEn,
                        titleMr: card.titleMr,
                        descriptionEn: card.descriptionEn,
                        descriptionMr: card.descriptionMr,
                        suggestedAction: card.suggestedAction,
                        suggestedActionLabelEn: card.suggestedActionLabelEn,
                        suggestedActionLabelMr: card.suggestedActionLabelMr,
                        overdueTaskCount: card.overdueTaskCount,
                        latestHealthScore: card.latestHealthScore,
                        unresolvedDisputeCount: card.unresolvedDisputeCount,
                    }))
                );
            }
        }

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
