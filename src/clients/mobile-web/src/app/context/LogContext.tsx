import React, { createContext, useContext, useState, useMemo } from 'react';
import { LogScope, FarmContext, CropProfile } from '../../types';
import { getPrimaryCropId, getPrimaryPlotId } from '../../domain/context/selectors';

// Define the shape of the Context
interface LogContextType {
    logScope: LogScope;
    currentLogContext: FarmContext | null;
    hasActiveLogContext: boolean; // True if a valid logging context is selected (plot or FARM_GLOBAL)
    isContextReady: boolean; // True if valid selection exists
    // Helpers
    activeCropId?: string; // If single context
    activePlotId?: string; // If single plot

    // Actions
    setLogScope: (scope: LogScope) => void;
    togglePlot: (plotId: string, cropId: string, isGlobal: boolean) => void;
    resetScope: () => void;
}

const LogContext = createContext<LogContextType | undefined>(undefined);

interface LogProviderProps {
    crops: CropProfile[];
    children: React.ReactNode;
}

// Helper interface for currentLogContext derivation
interface SelectedCropContext {
    cropId: string;
    cropName: string;
    selectedPlotIds: string[];
    selectedPlotNames: string[];
}

import { useSelection } from './SelectionContext';

export const LogProvider: React.FC<LogProviderProps> = ({ crops, children }) => {
    // 1. Core State delegated to SelectionContext
    const {
        selectedCropId,
        selectedPlotIds,
        setSelection,
        togglePlot: toggleSelectionPlot,
        resetSelection
    } = useSelection();

    // 2. Transaction-specific state (not in global selection)
    const [applyPolicy, setApplyPolicy] = useState<LogScope['applyPolicy']>('broadcast');

    // 3. Construct LogScope from Selection
    const logScope: LogScope = useMemo(() => ({
        selectedCropIds: selectedCropId ? [selectedCropId] : [],
        selectedPlotIds,
        mode: selectedPlotIds.length > 1 ? 'multi' : 'single',
        applyPolicy
    }), [selectedCropId, selectedPlotIds, applyPolicy]);

    // 4. Derive Context from Scope (Legacy/Current Logic)
    const currentLogContext = useMemo(() => {
        const isFarmGlobalSelected =
            logScope.selectedCropIds.includes('FARM_GLOBAL') && logScope.selectedPlotIds.length === 0;

        if (isFarmGlobalSelected) {
            return {
                selection: [{
                    cropId: 'FARM_GLOBAL',
                    cropName: 'Entire Farm',
                    selectedPlotIds: [],
                    selectedPlotNames: []
                }]
            };
        }

        if (logScope.selectedPlotIds.length === 0) return null;

        const selectedCrops = Array.from(new Set(logScope.selectedCropIds));
        const selection = selectedCrops.map(cId => {
            if (cId === 'FARM_GLOBAL') {
                return {
                    cropId: 'FARM_GLOBAL',
                    cropName: 'Entire Farm',
                    selectedPlotIds: [],
                    selectedPlotNames: []
                };
            }

            const crop = crops.find(c => c.id === cId);
            if (!crop) return null;

            const plots = crop.plots.filter(p => logScope.selectedPlotIds.includes(p.id));

            if (crop.plots.length > 0 && plots.length === 0) return null;

            return {
                cropId: cId,
                cropName: crop.name,
                selectedPlotIds: plots.map(p => p.id),
                selectedPlotNames: plots.map(p => p.name)
            };
        }).filter(Boolean) as SelectedCropContext[];

        if (selection.length === 0) return null;

        return { selection };
    }, [logScope, crops]);

    const hasActiveLogContext = !!currentLogContext && currentLogContext.selection.length > 0;
    const isContextReady = hasActiveLogContext;

    const activeCropId = getPrimaryCropId(currentLogContext) ?? undefined;
    const activePlotId = getPrimaryPlotId(currentLogContext) ?? undefined;

    // Actions adapted to SelectionContext
    const handleSetLogScope = (newScope: LogScope) => {
        if (newScope.applyPolicy) setApplyPolicy(newScope.applyPolicy);

        const newCropId = newScope.selectedCropIds[0];
        const newPlotIds = newScope.selectedPlotIds;

        // Use atomic setSelection to avoid race conditions/batching issues
        if (newCropId) {
            setSelection(newCropId, newPlotIds);
        } else {
            resetSelection();
        }
    };

    const togglePlot = (plotId: string, cropId: string, isGlobal: boolean) => {
        // Use SelectionContext toggler
        toggleSelectionPlot(plotId);
    };

    const value = {
        logScope,
        currentLogContext,
        hasActiveLogContext,
        isContextReady,
        activeCropId,
        activePlotId,
        setLogScope: handleSetLogScope,
        togglePlot,
        resetScope: resetSelection
    };

    return (
        <LogContext.Provider value={value}>
            {children}
        </LogContext.Provider>
    );
};

// Hook for consumption
export const useLogContext = () => {
    const context = useContext(LogContext);
    if (context === undefined) {
        throw new Error('useLogContext must be used within a LogProvider');
    }
    return context;
};
