import React, { createContext, useContext, useMemo, useState } from 'react';
import { LogScope, FarmContext, CropProfile } from '../../types';

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

interface SelectedCropContext {
    cropId: string;
    cropName: string;
    selectedPlotIds: string[];
    selectedPlotNames: string[];
}

const EMPTY_SCOPE: LogScope = {
    selectedCropIds: [],
    selectedPlotIds: [],
    mode: 'single',
    applyPolicy: 'broadcast',
};

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function normalizeScope(scope: LogScope): LogScope {
    const selectedCropIds = unique(scope.selectedCropIds || []);
    const selectedPlotIds = unique(scope.selectedPlotIds || []);
    const applyPolicy = scope.applyPolicy || 'broadcast';

    if (selectedCropIds.includes('FARM_GLOBAL')) {
        return {
            selectedCropIds: ['FARM_GLOBAL'],
            selectedPlotIds: [],
            mode: 'single',
            applyPolicy,
        };
    }

    return {
        selectedCropIds,
        selectedPlotIds,
        mode: selectedPlotIds.length > 1 ? 'multi' : 'single',
        applyPolicy,
    };
}

export const LogProvider: React.FC<LogProviderProps> = ({ crops, children }) => {
    const [scopeState, setScopeState] = useState<LogScope>(EMPTY_SCOPE);
    const logScope = useMemo(() => normalizeScope(scopeState), [scopeState]);

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

        const plotCropIds = logScope.selectedPlotIds
            .map(plotId => crops.find(crop => crop.plots.some(plot => plot.id === plotId))?.id)
            .filter((cropId): cropId is string => Boolean(cropId));
        const orderedCropIds = unique([...logScope.selectedCropIds, ...plotCropIds]);

        const selection = orderedCropIds.map(cId => {
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

            if (plots.length === 0) return null;

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

    const activeCropId = currentLogContext?.selection[0]?.cropId ?? logScope.selectedCropIds[0] ?? undefined;
    const activePlotId = currentLogContext?.selection.flatMap(selection => selection.selectedPlotIds)[0]
        ?? logScope.selectedPlotIds[0]
        ?? undefined;

    const handleSetLogScope = (newScope: LogScope) => {
        setScopeState(normalizeScope(newScope));
    };

    const togglePlot = (plotId: string, cropId: string, isGlobal: boolean) => {
        if (isGlobal) {
            setScopeState({
                selectedCropIds: ['FARM_GLOBAL'],
                selectedPlotIds: [],
                mode: 'single',
                applyPolicy: logScope.applyPolicy,
            });
            return;
        }

        setScopeState(prevScope => {
            const normalizedScope = normalizeScope(prevScope);
            const nextCropIds = normalizedScope.selectedCropIds.filter(id => id !== 'FARM_GLOBAL');
            const nextPlotIds = [...normalizedScope.selectedPlotIds];
            const existingIndex = nextPlotIds.indexOf(plotId);

            if (existingIndex >= 0) {
                nextPlotIds.splice(existingIndex, 1);
            } else {
                nextPlotIds.push(plotId);
            }

            const cropIdsWithPlots = nextCropIds.filter(selectedCropId => {
                if (selectedCropId === cropId) {
                    return nextPlotIds.some(selectedPlotId =>
                        crops.find(crop => crop.id === selectedCropId)?.plots.some(plot => plot.id === selectedPlotId)
                    );
                }

                return true;
            });

            if (existingIndex < 0 && !cropIdsWithPlots.includes(cropId)) {
                cropIdsWithPlots.push(cropId);
            }

            return normalizeScope({
                ...normalizedScope,
                selectedCropIds: cropIdsWithPlots,
                selectedPlotIds: nextPlotIds,
            });
        });
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
        resetScope: () => setScopeState(EMPTY_SCOPE)
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
