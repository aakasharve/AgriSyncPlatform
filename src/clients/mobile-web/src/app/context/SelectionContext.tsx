import React, { createContext, useContext, useState, useMemo, useCallback } from 'react';
import { CropProfile } from '../../types';

/**
 * SelectionContext
 * 
 * The single source of truth for "What am I looking at?" in the app.
 * Handles:
 * - Selected Date (for viewing logs/timeline)
 * - Selected Crop/Plot (for filtering and context)
 * 
 * Replaces ad-hoc selection logic in AppContent and LogContext.
 */

export interface SelectionState {
    selectedDate: Date;
    selectedCropId?: string;
    selectedPlotIds: string[];
}

export interface SelectionContextType extends SelectionState {
    // Actions
    selectDate: (date: Date) => void;
    selectCrop: (cropId: string) => void;
    togglePlot: (plotId: string) => void;
    setSelectedPlots: (plotIds: string[]) => void;
    setSelection: (cropId: string | undefined, plotIds: string[]) => void;
    resetSelection: () => void;

    // Derived
    hasSelection: boolean;
    isMultiPlot: boolean;
}

const SelectionContext = createContext<SelectionContextType | undefined>(undefined);

interface SelectionProviderProps {
    crops: CropProfile[];
    children: React.ReactNode;
}

export const SelectionProvider: React.FC<SelectionProviderProps> = ({ crops, children }) => {
    // Phase 1: Local State (Later can be persisted via URL or Storage)
    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [selectedCropId, setSelectedCropId] = useState<string | undefined>(undefined);
    const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);

    const selectDate = useCallback((date: Date) => {
        setSelectedDate(date);
    }, []);

    const selectCrop = useCallback((cropId: string) => {
        // When selecting a crop, we reset plot selection (strict hierarchy)
        // Or we could auto-select all plots? Let's stick to simple "Select Crop" first.
        setSelectedCropId(cropId);
        setSelectedPlotIds([]);
    }, []);

    const togglePlot = useCallback((plotId: string) => {
        setSelectedPlotIds(prev => {
            const isSelected = prev.includes(plotId);
            if (isSelected) {
                return prev.filter(id => id !== plotId);
            } else {
                return [...prev, plotId];
            }
        });

        // Auto-detect crop if not selected or different?
        // If we select a plot, we should enforce its crop is selected.
        if (crops) {
            const parentCrop = crops.find(c => c.plots.some(p => p.id === plotId));
            if (parentCrop && parentCrop.id !== selectedCropId) {
                setSelectedCropId(parentCrop.id);
                // If we switch crop, we probably want ONLY this plot selected initially
                // logic handles this by side-effect in next render or we set it here?
                // setSelectedCropId is async. 
                // We should batch these updates if possible, but React 18 handles it.
            }
        }
    }, [crops, selectedCropId]);

    // Enhanced toggle logic to handle the crop switch atomically
    const togglePlotSafe = useCallback((plotId: string) => {
        const parentCrop = crops.find(c => c.plots.some(p => p.id === plotId));

        if (!parentCrop) return; // Should not happen

        if (parentCrop.id !== selectedCropId) {
            // Context switch: New crop, just this plot
            setSelectedCropId(parentCrop.id);
            setSelectedPlotIds([plotId]);
        } else {
            // Same context: Toggle behavior
            setSelectedPlotIds(prev => {
                const isSelected = prev.includes(plotId);
                return isSelected ? prev.filter(id => id !== plotId) : [...prev, plotId];
            });
        }
    }, [crops, selectedCropId]);

    const setSelectedPlots = useCallback((plotIds: string[]) => {
        setSelectedPlotIds(plotIds);
    }, []);

    const setSelection = useCallback((cropId: string | undefined, plotIds: string[]) => {
        setSelectedCropId(cropId);
        setSelectedPlotIds(plotIds);
    }, []);

    const resetSelection = useCallback(() => {
        setSelectedDate(new Date());
        setSelectedCropId(undefined);
        setSelectedPlotIds([]);
    }, []);

    const value = useMemo(() => ({
        selectedDate,
        selectedCropId,
        selectedPlotIds,
        selectDate,
        selectCrop,
        togglePlot: togglePlotSafe,
        setSelectedPlots,
        setSelection,
        resetSelection,
        hasSelection: !!selectedCropId,
        isMultiPlot: selectedPlotIds.length > 1
    }), [selectedDate, selectedCropId, selectedPlotIds, selectDate, selectCrop, togglePlotSafe, setSelectedPlots, setSelection, resetSelection]);

    return (
        <SelectionContext.Provider value={value}>
            {children}
        </SelectionContext.Provider>
    );
};

export const useSelection = () => {
    const context = useContext(SelectionContext);
    if (!context) {
        throw new Error('useSelection must be used within a SelectionProvider');
    }
    return context;
};
