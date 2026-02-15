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
    type PlotDto,
    type SyncPullResponse,
} from '../api/AgriSyncClient';
import { getDatabase } from '../storage/DexieDatabase';
import { storageNamespace } from '../storage/StorageNamespace';

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

    switch (status.trim().toLowerCase()) {
        case 'approved':
        case 'verified':
            return LogVerificationStatus.VERIFIED;
        case 'rejected':
        case 'disputed':
            return LogVerificationStatus.DISPUTED;
        case 'confirmed':
            return LogVerificationStatus.CONFIRMED;
        case 'correction_pending':
            return LogVerificationStatus.CORRECTION_PENDING;
        case 'pending':
            return LogVerificationStatus.DRAFT;
        default:
            return LogVerificationStatus.DRAFT;
    }
}

function toDailyLog(
    source: DailyLogDto,
    plotLookup: Map<string, { cropId: string; cropName: string; plotName: string }>
): DailyLog {
    const plotContext = plotLookup.get(source.plotId);
    const latestVerification = [...source.verificationEvents]
        .sort((left, right) => Date.parse(right.occurredAtUtc) - Date.parse(left.occurredAtUtc))[0];

    const verificationStatus = mapVerificationStatus(source.lastVerificationStatus ?? latestVerification?.status);

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

    const db = getDatabase();
    await db.transaction('rw', [db.logs, db.appMeta], async () => {
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

        await db.appMeta.put({
            key: 'shramsafal_last_reconciled_pull_v1',
            value: {
                serverTimeUtc: payload.serverTimeUtc,
                nextCursorUtc: payload.nextCursorUtc,
                receivedAtUtc: systemClock.nowISO(),
                importedLogs: logs.length,
            },
            updatedAt: systemClock.nowISO(),
        });
    });
}
