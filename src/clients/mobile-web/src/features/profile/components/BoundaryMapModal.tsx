/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted from ProfilePage.tsx.
 *
 * Shared full-bleed-on-mobile / centered-dialog-on-lg map overlay used
 * for both plot-boundary and farm-boundary drawing flows. The original
 * ProfilePage rendered two near-identical inline blocks; this is the
 * single source.
 */

import React from 'react';
import { AlertTriangle, MapPin, X } from 'lucide-react';
import type { PlotGeoData } from '../../../types';
import { PlotMap } from '../../context/components/PlotMap';

export interface BoundaryMapModalProps {
    headerCaption: string;          // small grey caption row, e.g. "Farm · My Farm" or "Crop · Plot"
    headerTitle: string;            // bold title, e.g. "Draw farm boundary"
    onClose: () => void;
    onPlotComplete: (geoData: PlotGeoData) => void | Promise<void>;
    onDone: () => void;
    existingGeoData?: PlotGeoData;
    closeDisabled?: boolean;
    error?: string | null;
}

export const BoundaryMapModal: React.FC<BoundaryMapModalProps> = ({
    headerCaption,
    headerTitle,
    onClose,
    onPlotComplete,
    onDone,
    existingGeoData,
    closeDisabled = false,
    error = null,
}) => (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm animate-in fade-in lg:flex lg:items-center lg:justify-center lg:p-6">
        <div className="bg-white h-full w-full flex flex-col overflow-hidden lg:h-auto lg:max-h-[92vh] lg:max-w-3xl lg:rounded-3xl lg:shadow-2xl">
            <div className="flex-shrink-0 bg-white/95 backdrop-blur-md border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                    <div className="bg-emerald-100 text-emerald-600 p-1.5 rounded-lg flex-shrink-0">
                        <MapPin size={16} />
                    </div>
                    <div className="leading-tight min-w-0">
                        <p className="text-[11px] text-slate-500 truncate">{headerCaption}</p>
                        <p className="text-sm font-bold text-slate-900">{headerTitle}</p>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 rounded-full text-slate-400 hover:bg-slate-100 flex-shrink-0"
                    aria-label="Close"
                    disabled={closeDisabled}
                >
                    <X size={18} />
                </button>
            </div>
            {error && (
                <div className="flex-shrink-0 bg-red-50 border-b border-red-100 px-4 py-2 text-xs text-red-700 flex items-center gap-2">
                    <AlertTriangle size={14} /> {error}
                </div>
            )}
            <div className="flex-1 min-h-0">
                <PlotMap
                    existingGeoData={existingGeoData}
                    onPlotComplete={(geoData) => { void onPlotComplete(geoData); }}
                    onDone={onDone}
                />
            </div>
        </div>
    </div>
);
