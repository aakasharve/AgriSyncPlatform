import React from 'react';
import type { PlotGeoData } from '../../../types';
import { GooglePlotMap } from '../../../infrastructure/mapping/GooglePlotMap';

interface PlotMapProps {
    existingGeoData?: PlotGeoData;
    onPlotComplete: (geoData: PlotGeoData) => void;
    isReadOnly?: boolean;
    onDone?: () => void;
}

export const PlotMap: React.FC<PlotMapProps> = (props) => (
    <GooglePlotMap {...props} />
);
