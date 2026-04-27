import type {
    AreaMeasurement,
    BoundaryAlignment,
    Farm,
    FarmCoordinate,
    FarmId,
    OwnerAccountId,
    PlotAreaRecord,
    PlotId,
} from '../../domain/farmGeography/types';
import type { DrawCanonicalFarmResult, DrawPlotAreaResult } from './MapPort';

export interface FarmGeographySession {
    ownerAccountId: OwnerAccountId;
    userId: string;
}

export interface FarmGeographyPort {
    getFarm(farmId: FarmId): Promise<Farm | null>;
    listAccessibleFarms(): Promise<Farm[]>;
    getFarmCentre(farmId: FarmId): Promise<FarmCoordinate | null>;
    getPlotArea(plotId: PlotId): Promise<AreaMeasurement | null>;
    getAlignment(farmId: FarmId): Promise<BoundaryAlignment>;
    resolveFarmIdForPlot(plotId: PlotId): Promise<FarmId | null>;
    isPlotWithinWeatherBubble(
        farmId: FarmId,
        point: FarmCoordinate | { lat: number; lng: number },
    ): Promise<{ within: boolean; distanceMeters: number; provisional: boolean }>;
    registerCanonicalFarm(
        session: FarmGeographySession,
        result: DrawCanonicalFarmResult,
        agristackRef?: string,
    ): Promise<Farm>;
    recordPlotArea(
        session: FarmGeographySession,
        farmId: FarmId,
        plotId: PlotId,
        result: DrawPlotAreaResult,
    ): Promise<PlotAreaRecord>;
    reconcileWithAgristack(farmId: FarmId): Promise<BoundaryAlignment>;
}

export interface FarmGeographyRepository {
    getFarm(farmId: FarmId): Promise<Farm | null>;
    listAccessibleFarms(): Promise<Farm[]>;
    saveFarm(farm: Farm): Promise<void>;
    getPlotArea(plotId: PlotId): Promise<PlotAreaRecord | null>;
    savePlotArea(record: PlotAreaRecord): Promise<void>;
    resolveFarmIdForPlot(plotId: PlotId): Promise<FarmId | null>;
}

