/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 8 — extracted from AppContent.tsx.
 *
 * The two JSX-returning context-display helpers AppFeatureContexts
 * exposes via `useAppViewHelpers`: a thin top-bar color stripe and a
 * "Crop • Plot — Phase" caption.
 */

import React from 'react';
import { getPrimarySelection } from '../../application/selectors/ContextSelectors';
import { getPhaseAndDay } from '../../shared/utils/timelineUtils';
import type { CropProfile, FarmContext, LogScope } from '../../types';

interface ContextSnapshot {
    hasActiveLogContext: boolean;
    currentLogContext: FarmContext | null;
    logScope: LogScope;
}

export function buildContextColorIndicator(
    context: ContextSnapshot,
    crops: CropProfile[],
): React.ReactNode {
    if (!context.hasActiveLogContext) return null;
    const primary = getPrimarySelection(context.currentLogContext);
    if (primary?.cropId === 'FARM_GLOBAL') {
        return <div className="absolute top-0 left-0 w-full h-1 z-10 bg-stone-400 shadow-sm"></div>;
    }
    if (context.currentLogContext!.selection.length === 1) {
        const crop = crops.find(c => c.id === primary?.cropId);
        return <div className={`absolute top-0 left-0 w-full h-1 z-10 ${crop?.color || 'bg-stone-300'} shadow-sm`}></div>;
    }
    return (
        <div className="absolute top-0 left-0 w-full h-1 z-10 flex shadow-sm">
            {context.currentLogContext!.selection.map((s, idx) => {
                const crop = crops.find(c => c.id === s.cropId);
                return <div key={idx} className={`flex-1 h-full ${crop?.color || 'bg-stone-300'}`}></div>;
            })}
        </div>
    );
}

export function buildContextDisplay(
    context: ContextSnapshot,
    crops: CropProfile[],
): React.ReactNode {
    if (!context.hasActiveLogContext) return 'Select a crop to begin...';
    const primary = getPrimarySelection(context.currentLogContext);
    if (primary?.cropId === 'FARM_GLOBAL') return 'Logging for Entire Farm';

    const count = context.logScope.selectedPlotIds.length;
    if (count === 1) {
        const sel = primary;
        if (!sel) return 'Select a crop to begin...';

        const crop = crops.find(c => c.id === sel.cropId);
        const plotId = sel.selectedPlotIds[0];
        const plot = crop?.plots.find(p => p.id === plotId);
        const { label } = getPhaseAndDay(plot);

        return (
            <div className="flex flex-col items-center">
                <span>{sel.cropName} • {plot?.name}</span>
                <span className="text-xs font-bold bg-emerald-500/10 text-emerald-800 px-2 py-0.5 rounded-md mt-0.5 border border-emerald-500/20">
                    {label}
                </span>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center">
            <span>Broadcasting to {count} Plots</span>
            <span className="text-xs text-stone-400 font-medium mt-0.5">
                (Tap to see details)
            </span>
        </div>
    );
}
