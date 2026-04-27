export type FarmId = string & { readonly __brand: 'FarmId' };
export type PlotId = string & { readonly __brand: 'PlotId' };
export type OwnerAccountId = string & { readonly __brand: 'OwnerAccountId' };

export const makeFarmId = (raw: string): FarmId => raw as FarmId;
export const makePlotId = (raw: string): PlotId => raw as PlotId;
export const makeOwnerAccountId = (raw: string): OwnerAccountId => raw as OwnerAccountId;

export interface GeoPoint {
    lat: number;
    lng: number;
}

export type AreaComputedBy = 'polygon' | 'manual' | 'backend';

export interface AreaMeasurement {
    guntha: number;
    acres: number;
    squareMeters: number;
    computedBy: AreaComputedBy;
    computedAt: string;
}

export interface FarmCoordinate extends GeoPoint {
    farmId: FarmId;
    provenance: 'drawn' | 'agristack' | 'reconciled' | 'user_confirmed_pin' | 'device_suggested_then_confirmed';
    accuracyMeters?: number;
    capturedAt: string;
}

export type BoundaryAlignment =
    | { status: 'ALIGNED'; checkedAt: string }
    | { status: 'MISALIGNED'; checkedAt: string; deviationMeters: number; note: string }
    | { status: 'UNCHECKED'; reason: string }
    | { status: 'NO_AGRISTACK_RECORD'; checkedAt: string };

export type FarmSyncStatus = 'synced' | 'pendingPush' | 'conflict' | 'provisional';

export interface Farm {
    id: FarmId;
    ownerAccountId: OwnerAccountId;
    farmerId: string;
    name: string;
    canonicalBoundary: GeoPoint[];
    centre: FarmCoordinate;
    totalArea: AreaMeasurement;
    agristackRef?: {
        farmerIdAgristack: string;
        surveyNumbers: string[];
        recordFetchedAt: string;
    };
    alignment: BoundaryAlignment;
    plotIds: PlotId[];
    syncStatus: FarmSyncStatus;
    serverUpdatedAt: string;
    createdAt: string;
    updatedAt: string;
}

export interface PlotAreaRecord {
    plotId: PlotId;
    farmId: FarmId;
    ownerAccountId: OwnerAccountId;
    area: AreaMeasurement;
    distanceFromFarmCentreKm?: number;
    syncStatus: FarmSyncStatus;
    serverUpdatedAt: string;
    updatedAt: string;
}

const SQ_M_PER_GUNTHA = 101.17141056;
const GUNTHA_PER_ACRE = 40;
const SQ_M_PER_ACRE = SQ_M_PER_GUNTHA * GUNTHA_PER_ACRE;

const round = (value: number, digits: number): number => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
};

export const makeAreaMeasurement = (input: {
    guntha?: number;
    acres?: number;
    squareMeters?: number;
    computedBy: AreaComputedBy;
    computedAt?: string;
}): AreaMeasurement => {
    const provided = [input.guntha, input.acres, input.squareMeters]
        .filter(value => typeof value === 'number');

    if (provided.length !== 1) {
        throw new Error('AreaMeasurement requires exactly one area input.');
    }

    const squareMeters =
        input.squareMeters ??
        (input.guntha !== undefined ? input.guntha * SQ_M_PER_GUNTHA : undefined) ??
        (input.acres !== undefined ? input.acres * SQ_M_PER_ACRE : undefined);

    if (squareMeters === undefined || !Number.isFinite(squareMeters)) {
        throw new Error('AreaMeasurement rejected: invalid area.');
    }

    if (squareMeters < 0) {
        throw new Error('AreaMeasurement rejected: negative area.');
    }

    return {
        guntha: round(squareMeters / SQ_M_PER_GUNTHA, 2),
        acres: round(squareMeters / SQ_M_PER_ACRE, 3),
        squareMeters: round(squareMeters, 2),
        computedBy: input.computedBy,
        computedAt: input.computedAt ?? new Date().toISOString(),
    };
};

