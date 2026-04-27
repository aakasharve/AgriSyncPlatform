import type { AreaMeasurement, FarmCoordinate, GeoPoint } from '../../domain/farmGeography/types';

export type MapMode = 'canonical-farm' | 'plot-area';

export interface MapProvenance {
    drawnAt: string;
    mapProvider: 'google';
    accuracyMeters?: number;
}

export interface DrawCanonicalFarmResult {
    mode: 'draw-canonical-farm';
    boundary: GeoPoint[];
    centre: Omit<FarmCoordinate, 'farmId'>;
    area: AreaMeasurement;
    provenance: MapProvenance;
}

export interface DrawPlotAreaResult {
    mode: 'draw-plot-area';
    area: AreaMeasurement;
    provenance: MapProvenance;
    /**
     * Used only for the server-side distance warning. It must never be written
     * to a persisted plot entity, Dexie payload, outbox payload, or log.
     */
    transientCentroid?: GeoPoint;
}

export type MapResult = DrawCanonicalFarmResult | DrawPlotAreaResult;

export interface MapPort {
    openDrawingSession(
        mode: MapMode,
        initialCentre?: GeoPoint,
        existingBoundary?: GeoPoint[],
    ): Promise<MapResult | null>;
}

