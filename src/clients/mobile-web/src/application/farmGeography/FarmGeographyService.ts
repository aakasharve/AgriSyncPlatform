import { FarmAggregate, haversineMeters } from '../../domain/farmGeography/FarmAggregate';
import {
    makeAreaMeasurement,
    makeFarmId,
    type AreaMeasurement,
    type BoundaryAlignment,
    type Farm,
    type FarmCoordinate,
    type FarmId,
    type GeoPoint,
    type PlotAreaRecord,
    type PlotId,
} from '../../domain/farmGeography/types';
import type {
    FarmGeographyPort,
    FarmGeographyRepository,
    FarmGeographySession,
} from '../ports/FarmGeographyPort';
import type { DrawCanonicalFarmResult, DrawPlotAreaResult } from '../ports/MapPort';

const makeClientId = (prefix: string): string => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export class FarmGeographyService implements FarmGeographyPort {
    constructor(private readonly repository: FarmGeographyRepository) { }

    getFarm(farmId: FarmId): Promise<Farm | null> {
        return this.repository.getFarm(farmId);
    }

    listAccessibleFarms(): Promise<Farm[]> {
        return this.repository.listAccessibleFarms();
    }

    async getFarmCentre(farmId: FarmId): Promise<FarmCoordinate | null> {
        const farm = await this.repository.getFarm(farmId);
        return farm?.centre ?? null;
    }

    async getPlotArea(plotId: PlotId): Promise<AreaMeasurement | null> {
        const record = await this.repository.getPlotArea(plotId);
        return record?.area ?? null;
    }

    async getAlignment(farmId: FarmId): Promise<BoundaryAlignment> {
        const farm = await this.repository.getFarm(farmId);
        return farm?.alignment ?? { status: 'UNCHECKED', reason: 'farm-not-loaded' };
    }

    resolveFarmIdForPlot(plotId: PlotId): Promise<FarmId | null> {
        return this.repository.resolveFarmIdForPlot(plotId);
    }

    async isPlotWithinWeatherBubble(
        farmId: FarmId,
        point: GeoPoint,
    ): Promise<{ within: boolean; distanceMeters: number; provisional: boolean }> {
        const farm = await this.repository.getFarm(farmId);
        if (!farm) {
            return { within: false, distanceMeters: Number.POSITIVE_INFINITY, provisional: true };
        }

        const distanceMeters = haversineMeters(farm.centre, point);
        return {
            within: distanceMeters <= 3_000,
            distanceMeters,
            provisional: farm.syncStatus !== 'synced',
        };
    }

    async registerCanonicalFarm(
        session: FarmGeographySession,
        result: DrawCanonicalFarmResult,
        agristackRef?: string,
    ): Promise<Farm> {
        const now = new Date().toISOString();
        const farmId = makeFarmId(makeClientId('farm'));
        const aggregate = FarmAggregate.seed({
            id: farmId,
            ownerAccountId: session.ownerAccountId,
            farmerId: session.userId,
            name: 'My Farm',
            centreLat: result.centre.lat,
            centreLng: result.centre.lng,
            canonicalBoundary: result.boundary,
        });

        const farm: Farm = {
            ...aggregate.snapshot(),
            totalArea: result.area,
            agristackRef: agristackRef
                ? {
                    farmerIdAgristack: agristackRef,
                    surveyNumbers: [],
                    recordFetchedAt: now,
                }
                : undefined,
            syncStatus: 'pendingPush',
            serverUpdatedAt: now,
            updatedAt: now,
        };

        await this.repository.saveFarm(farm);
        return farm;
    }

    async recordPlotArea(
        session: FarmGeographySession,
        farmId: FarmId,
        plotId: PlotId,
        result: DrawPlotAreaResult,
    ): Promise<PlotAreaRecord> {
        const now = new Date().toISOString();
        const farm = await this.repository.getFarm(farmId);
        const distanceFromFarmCentreKm = farm && result.transientCentroid
            ? haversineMeters(farm.centre, result.transientCentroid) / 1_000
            : undefined;

        const record: PlotAreaRecord = {
            plotId,
            farmId,
            ownerAccountId: session.ownerAccountId,
            area: makeAreaMeasurement({
                squareMeters: result.area.squareMeters,
                computedBy: result.area.computedBy,
                computedAt: result.area.computedAt,
            }),
            distanceFromFarmCentreKm,
            syncStatus: 'pendingPush',
            serverUpdatedAt: now,
            updatedAt: now,
        };

        await this.repository.savePlotArea(record);
        return record;
    }

    async reconcileWithAgristack(farmId: FarmId): Promise<BoundaryAlignment> {
        const farm = await this.repository.getFarm(farmId);
        if (!farm) {
            return { status: 'UNCHECKED', reason: 'farm-not-loaded' };
        }
        return farm.alignment;
    }
}

