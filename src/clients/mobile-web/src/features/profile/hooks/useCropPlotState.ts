/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 6 — extracted from ProfilePage.tsx.
 *
 * Owns the structure-tab UI state + crop/plot mutation helpers.
 * ProfilePage stays a thin orchestrator; the underlying data still
 * flows in via the `crops` prop and out via `onUpdateCrops`.
 */

import React from 'react';
import type { CropProfile, Plot, PlotGeoData } from '../../../types';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { systemClock } from '../../../core/domain/services/Clock';
import { getTemplateById as getScheduleById, getTemplatesForCrop as getSchedulesForCrop } from '../../../infrastructure/reference/TemplateCatalog';
import { getNextUnusedColor } from '../helpers/cropPalette';

export interface UseCropPlotStateInput {
    crops: CropProfile[];
    onUpdateCrops: (next: CropProfile[]) => void;
}

export interface UseCropPlotStateResult {
    isAddingCrop: boolean;
    setIsAddingCrop: React.Dispatch<React.SetStateAction<boolean>>;
    newCropData: Partial<CropProfile>;
    setNewCropData: React.Dispatch<React.SetStateAction<Partial<CropProfile>>>;
    cropNameError: string;
    setCropNameError: React.Dispatch<React.SetStateAction<string>>;
    wizardCropId: string | null;
    setWizardCropId: React.Dispatch<React.SetStateAction<string | null>>;
    mappingPlotId: { cropId: string; plotId: string } | null;
    setMappingPlotId: React.Dispatch<React.SetStateAction<{ cropId: string; plotId: string } | null>>;
    normalizeCropName: (name: string) => string;
    normalizedNewCropName: string;
    isDuplicateCropName: boolean;
    handleAddCrop: () => void;
    handleAddPlot: (plot: Plot) => void;
    handleSaveMap: (cropId: string, plotId: string, geoData: PlotGeoData) => void;
    deleteCrop: (id: string) => void;
    deletePlot: (cId: string, pId: string) => void;
}

const normalizeCropName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export function useCropPlotState({ crops, onUpdateCrops }: UseCropPlotStateInput): UseCropPlotStateResult {
    const [isAddingCrop, setIsAddingCrop] = React.useState(false);
    const [newCropData, setNewCropData] = React.useState<Partial<CropProfile>>({ iconName: 'Sprout' });
    const [cropNameError, setCropNameError] = React.useState<string>('');
    const [wizardCropId, setWizardCropId] = React.useState<string | null>(null);
    const [mappingPlotId, setMappingPlotId] = React.useState<{ cropId: string; plotId: string } | null>(null);

    const normalizedNewCropName = normalizeCropName(newCropData.name || '');
    const isDuplicateCropName = normalizedNewCropName.length > 0
        && crops.some(c => normalizeCropName(c.name) === normalizedNewCropName);

    const handleAddCrop = () => {
        const trimmedName = newCropData.name?.trim() || '';
        if (trimmedName.length < 2) {
            setCropNameError('Crop name is required (at least 2 characters)');
            return;
        }
        if (crops.some(c => normalizeCropName(c.name) === normalizeCropName(trimmedName))) {
            setCropNameError('This crop already exists. One crop can be added only once.');
            return;
        }
        setCropNameError('');

        const autoColor = getNextUnusedColor(crops);
        const defaultScheduleId = getSchedulesForCrop(trimmedName)[0]?.id || null;
        const newCrop: CropProfile = {
            id: `c_${idGenerator.generate()}`,
            name: trimmedName,
            iconName: newCropData.iconName!,
            color: autoColor,
            plots: [],
            activeScheduleId: defaultScheduleId,
            supportedTasks: ['General'],
            workflow: [],
            createdAt: systemClock.nowISO(),
        };
        onUpdateCrops([...crops, newCrop]);
        setIsAddingCrop(false);
        setNewCropData({ iconName: 'Sprout' });
    };

    const handleAddPlot = (plot: Plot) => {
        onUpdateCrops(crops.map(crop => {
            if (crop.id !== wizardCropId) return crop;

            const adoptedScheduleId = plot.schedule?.templateId || crop.activeScheduleId || null;
            const adoptedTemplate = getScheduleById(adoptedScheduleId || '');

            return {
                ...crop,
                activeScheduleId: adoptedScheduleId,
                plots: [...crop.plots, plot].map(existingPlot => {
                    if (!adoptedScheduleId || !adoptedTemplate) return existingPlot;
                    return {
                        ...existingPlot,
                        schedule: {
                            ...existingPlot.schedule,
                            templateId: adoptedScheduleId,
                            referenceType: adoptedTemplate.referenceType,
                            stageOverrides: [],
                            expectationOverrides: [],
                        },
                    };
                }),
            };
        }));
        setWizardCropId(null);
    };

    const handleSaveMap = (cropId: string, plotId: string, geoData: PlotGeoData) => {
        onUpdateCrops(crops.map(c => {
            if (c.id !== cropId) return c;
            return {
                ...c,
                plots: c.plots.map(p => {
                    if (p.id !== plotId) return p;
                    return {
                        ...p,
                        geoData,
                        baseline: {
                            ...p.baseline,
                            totalArea: parseFloat(geoData.calculatedAreaAcres.toFixed(2)),
                            unit: 'Acre',
                        },
                    };
                }),
            };
        }));
    };

    const deleteCrop = (id: string) => onUpdateCrops(crops.filter(c => c.id !== id));
    const deletePlot = (cId: string, pId: string) => onUpdateCrops(
        crops.map(c => c.id === cId ? { ...c, plots: c.plots.filter(p => p.id !== pId) } : c),
    );

    return {
        isAddingCrop, setIsAddingCrop,
        newCropData, setNewCropData,
        cropNameError, setCropNameError,
        wizardCropId, setWizardCropId,
        mappingPlotId, setMappingPlotId,
        normalizeCropName, normalizedNewCropName, isDuplicateCropName,
        handleAddCrop, handleAddPlot, handleSaveMap,
        deleteCrop, deletePlot,
    };
}
