import type { GeoPoint } from '../../domain/farmGeography/types';
import type { MapMode, MapPort, MapResult } from '../../application/ports/MapPort';

export type GoogleMapsDrawingSessionRunner = (
    mode: MapMode,
    initialCentre?: GeoPoint,
    existingBoundary?: GeoPoint[],
) => Promise<MapResult | null>;

/**
 * Adapter boundary for Google-backed drawing sessions.
 *
 * The React screen owns rendering; this adapter owns the provider contract so
 * downstream geography/weather code never imports Google Maps types directly.
 */
export class GoogleMapsAdapter implements MapPort {
    constructor(private readonly runDrawingSession: GoogleMapsDrawingSessionRunner) { }

    openDrawingSession(
        mode: MapMode,
        initialCentre?: GeoPoint,
        existingBoundary?: GeoPoint[],
    ): Promise<MapResult | null> {
        return this.runDrawingSession(mode, initialCentre, existingBoundary);
    }
}

