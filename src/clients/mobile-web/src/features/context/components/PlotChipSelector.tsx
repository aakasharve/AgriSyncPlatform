/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { CropProfile, Plot } from '../../../types';
import { Check } from 'lucide-react';
import { CropSymbol } from './CropSelector';

interface PlotChipSelectorProps {
    crops: CropProfile[];
    selectedCrops: string[];
    selectedPlots: Record<string, string[]>;
    onSelectionChange: (cropIds: string[], plotIds: Record<string, string[]>) => void;
    singleSelect?: boolean;
}

/**
 * PlotChipSelector - Visual crop cards with plot selection buttons
 * Shows crops as large cards with plots as buttons below
 */
const PlotChipSelector: React.FC<PlotChipSelectorProps> = ({
    crops,
    selectedCrops,
    selectedPlots,
    onSelectionChange,
    singleSelect = false
}) => {
    const togglePlot = (cropId: string, plotId: string) => {
        if (singleSelect) {
            // Single Select Mode: Clicking a plot selects ONLY that plot
            // If already selected, we allow deselecting (toggle) or enforce strict? 
            // Usually toggle is good.
            const currentPlots = selectedPlots[cropId] || [];
            if (currentPlots.includes(plotId)) {
                // Deselecting the only active item
                onSelectionChange([], {});
            } else {
                // Selecting new item -> Clear everything else
                onSelectionChange([cropId], { [cropId]: [plotId] });
            }
            return;
        }

        const currentPlots = selectedPlots[cropId] || [];
        const newPlots = currentPlots.includes(plotId)
            ? currentPlots.filter(id => id !== plotId)
            : [...currentPlots, plotId];

        const newSelectedPlots = { ...selectedPlots, [cropId]: newPlots };

        // Update selectedCrops based on which crops have plots selected
        const newSelectedCrops = Object.keys(newSelectedPlots).filter(
            id => newSelectedPlots[id].length > 0
        );

        onSelectionChange(newSelectedCrops, newSelectedPlots);
    };

    const selectAllPlotsForCrop = (cropId: string, allPlotIds: string[]) => {
        const newSelectedPlots = { ...selectedPlots, [cropId]: allPlotIds };
        const newSelectedCrops = Object.keys(newSelectedPlots).filter(
            id => newSelectedPlots[id].length > 0
        );
        onSelectionChange(newSelectedCrops, newSelectedPlots);
    };

    const deselectAllPlotsForCrop = (cropId: string) => {
        const newSelectedPlots = { ...selectedPlots };
        delete newSelectedPlots[cropId];
        const newSelectedCrops = Object.keys(newSelectedPlots).filter(
            id => newSelectedPlots[id].length > 0
        );
        onSelectionChange(newSelectedCrops, newSelectedPlots);
    };

    return (
        <div className="grid grid-cols-2 gap-4">
            {crops.map(crop => {
                if (!crop.plots || crop.plots.length === 0) return null;

                const cropPlots = selectedPlots[crop.id] || [];
                const allSelected = cropPlots.length === crop.plots.length;
                const someSelected = cropPlots.length > 0 && !allSelected;

                return (
                    <div
                        key={crop.id}
                        className={`rounded-2xl p-4 border-2 transition-all ${cropPlots.length > 0
                            ? `${crop.color} border-transparent shadow-lg`
                            : 'bg-white border-slate-200 hover:border-slate-300'
                            }`}
                    >
                        {/* Crop Header */}
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <CropSymbol name={crop.iconName} size="md" />
                                <div>
                                    <h3 className={`font-bold text-base ${cropPlots.length > 0 ? 'text-white' : 'text-slate-800'}`}>
                                        {crop.name}
                                    </h3>
                                    <p className={`text-xs ${cropPlots.length > 0 ? 'text-white/80' : 'text-slate-500'}`}>
                                        {cropPlots.length}/{crop.plots.length} selected
                                    </p>
                                </div>
                            </div>
                            {cropPlots.length > 0 && (
                                <button
                                    onClick={() => deselectAllPlotsForCrop(crop.id)}
                                    className="text-xs font-bold text-white/90 hover:text-white bg-black/20 px-2 py-1 rounded-lg"
                                >
                                    Clear
                                </button>
                            )}
                        </div>

                        {/* Plot Buttons */}
                        <div className="space-y-2">
                            {crop.plots.map((plot, idx) => {
                                const isSelected = cropPlots.includes(plot.id);
                                return (
                                    <button
                                        key={plot.id}
                                        onClick={() => togglePlot(crop.id, plot.id)}
                                        className={`w-full text-left px-3 py-2.5 rounded-xl font-medium transition-all text-sm ${isSelected
                                            ? 'bg-white/20 backdrop-blur-sm border-2 border-white/40 text-white shadow-sm'
                                            : 'bg-slate-100 border-2 border-transparent text-slate-700 hover:bg-slate-200'
                                            }`}
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                {isSelected && <Check size={14} strokeWidth={3} className="text-white" />}
                                                <span className="font-bold">{plot.name}</span>
                                            </div>
                                            <span className={`text-xs font-bold ${isSelected ? 'text-white/70' : 'text-slate-400'}`}>
                                                ({String.fromCharCode(65 + idx)})
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Select All Button */}
                        {!allSelected && (
                            <button
                                onClick={() => selectAllPlotsForCrop(crop.id, crop.plots.map(p => p.id))}
                                className={`w-full mt-2 px-3 py-2 rounded-lg text-xs font-bold transition-colors ${cropPlots.length > 0
                                    ? 'bg-white/10 text-white/90 hover:bg-white/20 border border-white/30'
                                    : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                    }`}
                            >
                                Select All Plots
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default PlotChipSelector;
