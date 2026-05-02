/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 7 — extracted from SyncPullReconciler.ts.
 *
 * Pre-transaction phase of the sync pull. Builds:
 *   - the merged crops set (with mojibake-normalized names + plot data),
 *   - the reconciled farmer profile (operators + demo defaults),
 *   - the plot lookup table consumed by the logs reconciler.
 *
 * Persists profile + crops via their Dexie repositories (the storage
 * substrate after T-SP04-DEXIE-CUTOVER-SYNC-BRIDGE 2026-05-01). The big
 * cross-table transaction in SyncPullReconciler.ts handles the rest.
 */

import { systemClock } from '../../../../core/domain/services/Clock';
import { DexieCropsRepository } from '../../../../infrastructure/storage/DexieCropsRepository';
import { DexieProfileRepository } from '../../../../infrastructure/storage/DexieProfileRepository';
import { normalizeMojibakeText } from '../../../../shared/utils/textEncoding';
import {
    type FarmerProfile,
    type FarmOperator,
    VerificationStatus,
} from '../../../../types';
import type {
    SyncPullResponse,
    SyncOperatorDto,
} from '../../../../infrastructure/api/AgriSyncClient';
import { capabilitiesForRole, mapOperatorRole } from '../helpers/operatorRole';
import {
    normalizeCropTypeKey,
    readCropTypeReferences,
} from '../helpers/cropIdentity';
import { ensureCrop, upsertPlot } from '../helpers/plotSchedule';
import {
    enrichPurveshDemoCrops,
    fillMissingProfileDetails,
} from '../helpers/purveshDemoEnrichment';

export interface PlotLookupEntry {
    cropId: string;
    cropName: string;
    plotName: string;
}

export interface ProfileAndCropsResult {
    plotLookup: Map<string, PlotLookupEntry>;
    receivedAtUtc: string;
}

type ReferencePayload = SyncPullResponse & {
    cropTypes?: unknown[];
    operators?: SyncOperatorDto[];
};

export async function reconcileProfileAndCrops(
    payload: SyncPullResponse,
): Promise<ProfileAndCropsResult> {
    const referencePayload = payload as ReferencePayload;
    const cropTypes = referencePayload.cropTypes ?? [];
    const operators = referencePayload.operators ?? [];
    const cropTypeDefaults = readCropTypeReferences(cropTypes);

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

    const plotLookup = new Map<string, PlotLookupEntry>();
    for (const crop of mergedCrops) {
        for (const plot of crop.plots) {
            plotLookup.set(plot.id, {
                cropId: crop.id,
                cropName: crop.name,
                plotName: plot.name,
            });
        }
    }

    return { plotLookup, receivedAtUtc };
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
