import { VersionRegistry } from '../../core/contracts/VersionRegistry';
import { systemClock } from '../../core/domain/services/Clock';
import {
    type CropProfile,
    type DailyLog,
    LogVerificationStatus,
    type Plot,
} from '../../types';
import {
    type CropCycleDto,
    type DailyLogDto,
    type DayLedgerDto,
    type PlannedTask as PlannedTaskDto,
    type PlotDto,
    type SyncPullResponse,
} from '../api/AgriSyncClient';
import { getDatabase } from '../storage/DexieDatabase';
import { storageNamespace } from '../storage/StorageNamespace';

type SyncPullReferenceDataPayload = SyncPullResponse & {
    scheduleTemplates?: unknown[];
    cropTypes?: unknown[];
    activityCategories?: string[];
    costCategories?: string[];
    referenceDataVersionHash?: string;
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

function defaultPlotSchedule(plotId: string, referenceDate: string) {
    return {
        id: `sch_${plotId}`,
        plotId,
        templateId: 'sync_template',
        referenceType: 'PLANTING' as const,
        referenceDate,
        stageOverrides: [],
        expectationOverrides: [],
    };
}

function ensureCrop(cropsById: Map<string, CropProfile>, cropName: string): CropProfile {
    const cropId = toCropId(cropName);
    const existing = cropsById.get(cropId);
    if (existing) {
        return existing;
    }

    const color = CROP_COLORS[cropsById.size % CROP_COLORS.length];
    const created: CropProfile = {
        id: cropId,
        name: cropName,
        iconName: pickIconName(cropName),
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

function upsertPlot(crop: CropProfile, plotDto: PlotDto, cycle: CropCycleDto): void {
    const existingPlot = crop.plots.find(p => p.id === plotDto.id);
    if (existingPlot) {
        existingPlot.name = plotDto.name;
        existingPlot.startDate = cycle.startDate;
        existingPlot.baseline = {
            ...existingPlot.baseline,
            totalArea: plotDto.areaInAcres,
            unit: 'Acre',
        };
        return;
    }

    const plot: Plot = {
        id: plotDto.id,
        name: plotDto.name,
        variety: cycle.cropName,
        startDate: cycle.startDate,
        createdAt: plotDto.createdAtUtc,
        baseline: {
            totalArea: plotDto.areaInAcres,
            unit: 'Acre',
        },
        schedule: defaultPlotSchedule(plotDto.id, cycle.startDate),
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

function dayLedgerMetaKey(dayLedgerId: string): string {
    return `shramsafal_day_ledger_${dayLedgerId}`;
}

function normalizeDateValue(value: string): string {
    return value.includes('T') ? value.split('T')[0] : value;
}

function toDailyLog(
    source: DailyLogDto,
    plotLookup: Map<string, { cropId: string; cropName: string; plotName: string }>
): DailyLog {
    const plotContext = plotLookup.get(source.plotId);
    const latestVerification = [...source.verificationEvents]
        .sort((left, right) => Date.parse(right.occurredAtUtc) - Date.parse(left.occurredAtUtc))[0];

    const verificationStatus = mapVerificationStatus(
        source.verificationStatus ?? source.lastVerificationStatus ?? latestVerification?.status);

    return {
        id: source.id,
        date: source.logDate,
        context: {
            selection: [{
                cropId: plotContext?.cropId ?? 'FARM_GLOBAL',
                cropName: plotContext?.cropName ?? 'Farm',
                selectedPlotIds: [source.plotId],
                selectedPlotNames: [plotContext?.plotName ?? 'Unknown Plot'],
            }],
        },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: source.tasks.map(task => ({
            id: task.id,
            title: task.activityType,
            workTypes: [task.activityType],
            notes: task.notes,
            status: 'completed',
        })),
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        observations: [],
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
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeCrops(crops: CropProfile[]): void {
    const key = storageNamespace.getKey('crops');
    localStorage.setItem(key, JSON.stringify(crops));
}

export async function reconcileSyncPull(payload: SyncPullResponse): Promise<void> {
    const existingCrops = readExistingCrops();
    const cropsById = new Map(existingCrops.map(crop => [crop.id, crop]));

    const plotsById = new Map(payload.plots.map(plot => [plot.id, plot]));
    for (const cycle of payload.cropCycles) {
        const crop = ensureCrop(cropsById, cycle.cropName);
        const plotDto = plotsById.get(cycle.plotId);
        if (!plotDto) {
            continue;
        }

        upsertPlot(crop, plotDto, cycle);
    }

    const mergedCrops = [...cropsById.values()];
    writeCrops(mergedCrops);

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
    const dayLedgers: DayLedgerDto[] = payload.dayLedgers ?? [];
    const plannedTasks: PlannedTaskDto[] = payload.plannedActivities ?? [];
    const referencePayload = payload as SyncPullReferenceDataPayload;
    const scheduleTemplates = referencePayload.scheduleTemplates ?? [];
    const cropTypes = referencePayload.cropTypes ?? [];
    const activityCategories = referencePayload.activityCategories ?? [];
    const costCategories = referencePayload.costCategories ?? [];
    const referenceDataVersionHash = referencePayload.referenceDataVersionHash?.trim() ?? '';
    const receivedAtUtc = systemClock.nowISO();

    const db = getDatabase();
    await db.transaction('rw', [db.logs, db.appMeta, db.referenceData, db.dayLedgers, db.plannedTasks], async () => {
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
                dateKey: normalizeDateValue(dayLedger.dateKey),
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
                plannedDate: normalizeDateValue(plannedTask.plannedDate),
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

        await db.appMeta.put({
            key: 'shramsafal_finance_cost_entries_v1',
            value: payload.costEntries ?? [],
            updatedAt: receivedAtUtc,
        });

        await db.appMeta.put({
            key: 'shramsafal_finance_corrections_v1',
            value: payload.financeCorrections ?? [],
            updatedAt: receivedAtUtc,
        });

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
                importedScheduleTemplates: scheduleTemplates.length,
                importedDayLedgers: dayLedgers.length,
                importedPlannedTasks: plannedTasks.length,
                referenceDataVersionHash: referenceDataVersionHash || null,
                referenceDataUpdated,
            },
            updatedAt: receivedAtUtc,
        });
    });
}
