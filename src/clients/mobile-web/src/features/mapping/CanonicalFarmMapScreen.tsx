import React, { useCallback } from 'react';
import { PlotMap } from '../context/components/PlotMap';
import type { PlotGeoData } from '../../domain/types/farm.types';
import type { DrawCanonicalFarmResult } from '../../application/ports/MapPort';
import { makeAreaMeasurement } from '../../domain/farmGeography/types';

interface CanonicalFarmMapScreenProps {
    existingGeoData?: PlotGeoData;
    isReadOnly?: boolean;
    onComplete: (result: DrawCanonicalFarmResult) => void;
}

const acresToSquareMeters = (acres: number): number => acres * 4_046.8564224;

export const CanonicalFarmMapScreen: React.FC<CanonicalFarmMapScreenProps> = ({
    existingGeoData,
    isReadOnly = false,
    onComplete,
}) => {
    const handlePlotComplete = useCallback((geoData: PlotGeoData) => {
        onComplete({
            mode: 'draw-canonical-farm',
            boundary: geoData.boundary,
            centre: {
                lat: geoData.center.lat,
                lng: geoData.center.lng,
                provenance: 'drawn',
                capturedAt: geoData.drawnAt,
            },
            area: makeAreaMeasurement({
                squareMeters: acresToSquareMeters(geoData.calculatedAreaAcres),
                computedBy: 'polygon',
                computedAt: geoData.drawnAt,
            }),
            provenance: {
                drawnAt: geoData.drawnAt,
                mapProvider: 'google',
            },
        });
    }, [onComplete]);

    return (
        <PlotMap
            existingGeoData={existingGeoData}
            isReadOnly={isReadOnly}
            onPlotComplete={handlePlotComplete}
        />
    );
};

