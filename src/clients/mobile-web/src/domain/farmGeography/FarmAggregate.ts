import type {
    BoundaryAlignment,
    Farm,
    FarmCoordinate,
    FarmId,
    GeoPoint,
    OwnerAccountId,
} from './types';
import { makeAreaMeasurement } from './types';

const EARTH_RADIUS_M = 6_371_000;
const DEFAULT_WEATHER_RADIUS_M = 3_000;
const ALIGNMENT_TOLERANCE_M = 50;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export const haversineMeters = (a: GeoPoint, b: GeoPoint): number => {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
};

export class FarmAggregate {
    private constructor(private readonly state: Farm) { }

    static seed(input: {
        id: FarmId;
        ownerAccountId: OwnerAccountId;
        farmerId: string;
        name: string;
        centreLat: number;
        centreLng: number;
        canonicalBoundary?: GeoPoint[];
    }): FarmAggregate {
        const now = new Date().toISOString();
        const centre: FarmCoordinate = {
            farmId: input.id,
            lat: input.centreLat,
            lng: input.centreLng,
            provenance: 'drawn',
            accuracyMeters: 10,
            capturedAt: now,
        };

        return new FarmAggregate({
            id: input.id,
            ownerAccountId: input.ownerAccountId,
            farmerId: input.farmerId,
            name: input.name.trim() || 'My Farm',
            canonicalBoundary: input.canonicalBoundary ?? [],
            centre,
            totalArea: makeAreaMeasurement({ squareMeters: 0, computedBy: 'manual', computedAt: now }),
            alignment: { status: 'UNCHECKED', reason: 'no-agristack-fetched' },
            plotIds: [],
            syncStatus: 'provisional',
            serverUpdatedAt: now,
            createdAt: now,
            updatedAt: now,
        });
    }

    snapshot(): Farm {
        return {
            ...this.state,
            canonicalBoundary: [...this.state.canonicalBoundary],
            plotIds: [...this.state.plotIds],
        };
    }

    isWithinWeatherBubble(point: GeoPoint, radiusMeters = DEFAULT_WEATHER_RADIUS_M): {
        within: boolean;
        distanceMeters: number;
    } {
        const distanceMeters = haversineMeters(this.state.centre, point);
        return {
            within: distanceMeters <= radiusMeters,
            distanceMeters,
        };
    }

    flagAlignment(input: { deviationMeters: number; note: string }): Farm {
        const now = new Date().toISOString();
        const alignment: BoundaryAlignment = input.deviationMeters <= ALIGNMENT_TOLERANCE_M
            ? { status: 'ALIGNED', checkedAt: now }
            : {
                status: 'MISALIGNED',
                checkedAt: now,
                deviationMeters: input.deviationMeters,
                note: input.note,
            };

        return {
            ...this.state,
            alignment,
            updatedAt: now,
        };
    }
}

