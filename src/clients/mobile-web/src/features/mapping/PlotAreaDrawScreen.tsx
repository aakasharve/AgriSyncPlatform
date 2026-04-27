import React, { useCallback } from 'react';
import { PlotMap } from '../context/components/PlotMap';
import type { PlotGeoData } from '../../domain/types/farm.types';
import type { DrawPlotAreaResult } from '../../application/ports/MapPort';
import { makeAreaMeasurement } from '../../domain/farmGeography/types';

interface PlotAreaDrawScreenProps {
    existingGeoData?: PlotGeoData;
    isReadOnly?: boolean;
    onComplete: (result: DrawPlotAreaResult) => void;
}

const acresToSquareMeters = (acres: number): number => acres * 4_046.8564224;

export const PlotAreaDrawScreen: React.FC<PlotAreaDrawScreenProps> = ({
    existingGeoData,
    isReadOnly = false,
    onComplete,
}) => {
    const handlePlotComplete = useCallback((geoData: PlotGeoData) => {
        onComplete({
            mode: 'draw-plot-area',
            area: makeAreaMeasurement({
                squareMeters: acresToSquareMeters(geoData.calculatedAreaAcres),
                computedBy: 'polygon',
                computedAt: geoData.drawnAt,
            }),
            transientCentroid: {
                lat: geoData.center.lat,
                lng: geoData.center.lng,
            },
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

