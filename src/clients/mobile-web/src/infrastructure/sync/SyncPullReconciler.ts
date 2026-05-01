import { VersionRegistry } from '../../core/contracts/VersionRegistry';
import { systemClock } from '../../core/domain/services/Clock';
import {
    type CropProfile,
    type DailyLog,
    LogVerificationStatus,
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
import { storageNamespace } from '../storage/StorageNamespace';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { setScheduleTemplatesFromReferenceData } from '../reference/TemplateCatalog';
import { normalizeMojibakeDeep, normalizeMojibakeText } from '../../shared/utils/textEncoding';
import {
    type FarmerProfile,
    type FarmOperator,
    VerificationStatus,
} from '../../types';

// Sub-plan 04 Task 7 — helpers extracted to ./helpers/* per the plan's
// "decompose SyncPullReconciler into orchestrator + helpers" goal.
import { mapVerificationStatus } from './helpers/mapVerificationStatus';
import { mapAttachmentStatus } from './helpers/mapAttachmentStatus';
import {
    normalizeTaskActivityType,
    isIrrigationActivity,
    isSprayActivity,
    isNutritionActivity,
    isObservationActivity,
} from './helpers/normalizeActivityType';
import { mapOperatorRole, capabilitiesForRole } from './helpers/operatorRole';
import { readCropTypeReferences, normalizeCropTypeKey } from './helpers/cropIdentity';
import { ensureCrop, upsertPlot } from './helpers/plotSchedule';
import {
    isPurveshDemoOwner,
    fillMissingProfileDetails,
    enrichPurveshDemoCrops,
} from './helpers/purveshDemoEnrichment';

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

const REFERENCE_DATA_VERSION_META_KEY = 'shramsafal_reference_data_version_hash_v1';


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

    const receivedAtUtc = systemClock.nowISO();
    const existingProfile = readExistingProfile();
    const reconciledProfile = buildProfileFromSync(
        operators,
        payload.farms[0]?.ownerUserId,
        existingProfile,
        receivedAtUtc);
    const mergedCrops = enrichPurveshDemoCrops([...cropsById.values()], reconciledProfile);
    writeCrops(mergedCrops);
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
