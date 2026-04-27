import { getAuthSession } from '../api/AuthTokenStore';
import type {
    BoundaryAlignment,
    Farm,
    FarmId,
    PlotAreaRecord,
    PlotId,
} from '../../domain/farmGeography/types';
import {
    makeAreaMeasurement,
    makeFarmId,
    makeOwnerAccountId,
} from '../../domain/farmGeography/types';
import type {
    FarmGeographyPort,
    FarmGeographySession,
} from '../../application/ports/FarmGeographyPort';
import type { DrawCanonicalFarmResult, DrawPlotAreaResult } from '../../application/ports/MapPort';
import { haversineMeters } from '../../domain/farmGeography/FarmAggregate';

interface ViteImportMeta {
    env?: {
        VITE_AGRISYNC_API_URL?: unknown;
    };
}

const resolveBaseUrl = (): string => {
    const raw = (import.meta as ViteImportMeta).env?.VITE_AGRISYNC_API_URL;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().replace(/\/+$/, '');
    }
    return 'http://localhost:5048';
};

const authHeaders = (): Record<string, string> => {
    const session = getAuthSession();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.accessToken) {
        headers.Authorization = `Bearer ${session.accessToken}`;
    }
    return headers;
};

const parseJson = async <T>(response: Response): Promise<T> => {
    if (!response.ok) {
        throw new Error(`Farm geography request failed with HTTP ${response.status}.`);
    }
    return await response.json() as T;
};

interface FarmDto {
    id: string;
    name: string;
    ownerUserId: string;
    ownerAccountId: string;
    canonicalCentreLat: number | null;
    canonicalCentreLng: number | null;
    centreSource: string | null;
    weatherRadiusKm: number;
    totalMappedAreaAcres: number | null;
    totalGovtAreaAcres: number | null;
    geoValidationStatus: string;
    createdAtUtc: string;
    modifiedAtUtc: string;
}

interface MyFarmDto {
    farmId: string;
}

interface BootstrapFirstFarmResponse {
    farmId: string;
}

const mapAlignment = (dto: FarmDto): BoundaryAlignment => {
    const checkedAt = dto.modifiedAtUtc;
    switch (dto.geoValidationStatus) {
        case 'Verified':
            return { status: 'ALIGNED', checkedAt };
        case 'Misaligned':
        case 'PartiallyMatched':
            return {
                status: 'MISALIGNED',
                checkedAt,
                deviationMeters: 0,
                note: dto.geoValidationStatus,
            };
        case 'GovtRecordUnavailable':
            return { status: 'NO_AGRISTACK_RECORD', checkedAt };
        default:
            return { status: 'UNCHECKED', reason: dto.geoValidationStatus || 'unchecked' };
    }
};

const mapCentreSource = (source: string | null): Farm['centre']['provenance'] => {
    switch (source) {
        case 'UserConfirmedPin':
            return 'user_confirmed_pin';
        case 'DeviceSuggestedThenConfirmed':
            return 'device_suggested_then_confirmed';
        default:
            return 'drawn';
    }
};

const dtoToFarm = (dto: FarmDto): Farm | null => {
    if (dto.canonicalCentreLat === null || dto.canonicalCentreLng === null) {
        return null;
    }

    const farmId = makeFarmId(dto.id);
    const computedAt = dto.modifiedAtUtc || new Date().toISOString();

    return {
        id: farmId,
        ownerAccountId: makeOwnerAccountId(dto.ownerAccountId),
        farmerId: dto.ownerUserId,
        name: dto.name,
        canonicalBoundary: [],
        centre: {
            farmId,
            lat: dto.canonicalCentreLat,
            lng: dto.canonicalCentreLng,
            provenance: mapCentreSource(dto.centreSource),
            capturedAt: computedAt,
        },
        totalArea: makeAreaMeasurement({
            acres: dto.totalMappedAreaAcres ?? dto.totalGovtAreaAcres ?? 0,
            computedBy: 'backend',
            computedAt,
        }),
        alignment: mapAlignment(dto),
        plotIds: [],
        syncStatus: 'synced',
        serverUpdatedAt: computedAt,
        createdAt: dto.createdAtUtc,
        updatedAt: dto.modifiedAtUtc,
    };
};

const boundaryToGeoJson = (result: DrawCanonicalFarmResult): string => {
    const coordinates = result.boundary.map(point => [point.lng, point.lat]);
    if (coordinates.length > 0) {
        const first = coordinates[0];
        const last = coordinates[coordinates.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
            coordinates.push(first);
        }
    }

    return JSON.stringify({
        type: 'Feature',
        properties: {},
        geometry: {
            type: 'Polygon',
            coordinates: [coordinates],
        },
    });
};

export class BackendFarmGeographyClient implements FarmGeographyPort {
    async getFarm(farmId: FarmId): Promise<Farm | null> {
        const response = await fetch(`${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(farmId)}`, {
            headers: authHeaders(),
        });
        if (response.status === 404) return null;
        return dtoToFarm(await parseJson<FarmDto>(response));
    }

    async listAccessibleFarms(): Promise<Farm[]> {
        const response = await fetch(`${resolveBaseUrl()}/shramsafal/farms/mine`, {
            headers: authHeaders(),
        });
        const memberships = await parseJson<MyFarmDto[]>(response);
        const farms = await Promise.all(
            memberships.map(membership => this.getFarm(makeFarmId(membership.farmId))),
        );
        return farms.filter((farm): farm is Farm => farm !== null);
    }

    async getFarmCentre(farmId: FarmId) {
        const farm = await this.getFarm(farmId);
        return farm?.centre ?? null;
    }

    async getPlotArea(plotId: PlotId) {
        void plotId;
        return null;
    }

    async getAlignment(farmId: FarmId) {
        const farm = await this.getFarm(farmId);
        return farm?.alignment ?? { status: 'UNCHECKED', reason: 'farm-not-loaded' };
    }

    async resolveFarmIdForPlot(plotId: PlotId): Promise<FarmId | null> {
        void plotId;
        return null;
    }

    async isPlotWithinWeatherBubble(farmId: FarmId, point: { lat: number; lng: number }) {
        const farm = await this.getFarm(farmId);
        if (!farm) {
            return { within: false, distanceMeters: Number.POSITIVE_INFINITY, provisional: true };
        }
        const distanceMeters = haversineMeters(farm.centre, point);
        return { within: distanceMeters <= 3_000, distanceMeters, provisional: false };
    }

    async registerCanonicalFarm(
        _session: FarmGeographySession,
        result: DrawCanonicalFarmResult,
        agristackRef?: string,
    ): Promise<Farm> {
        void agristackRef;
        const bootstrapResponse = await fetch(`${resolveBaseUrl()}/bootstrap/first-farm`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ farmName: 'My Farm', village: null }),
        });
        const bootstrap = await parseJson<BootstrapFirstFarmResponse>(bootstrapResponse);

        const boundaryResponse = await fetch(`${resolveBaseUrl()}/shramsafal/farms/${encodeURIComponent(bootstrap.farmId)}/boundary`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({
                polygonGeoJson: boundaryToGeoJson(result),
                centreLat: result.centre.lat,
                centreLng: result.centre.lng,
                calculatedAreaAcres: result.area.acres,
            }),
        });

        const farm = dtoToFarm(await parseJson<FarmDto>(boundaryResponse));
        if (!farm) {
            throw new Error('Farm geography request failed: backend did not return a canonical centre.');
        }
        return farm;
    }

    async recordPlotArea(
        _session: FarmGeographySession,
        farmId: FarmId,
        plotId: PlotId,
        result: DrawPlotAreaResult,
    ): Promise<PlotAreaRecord> {
        void _session;
        void farmId;
        void plotId;
        void result;
        throw new Error('Backend plot area persistence is not available yet; use local FarmGeographyService for plot area drafts.');
    }

    async reconcileWithAgristack(farmId: FarmId) {
        return await this.getAlignment(farmId);
    }
}
