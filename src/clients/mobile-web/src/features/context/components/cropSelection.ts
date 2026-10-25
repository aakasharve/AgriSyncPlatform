/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cropSelection — the selection rules of the crop -> plot flow, as pure functions (PLR-D5).
 *
 * Same contract as `CropSelector`: `crops` (ids) + `plots` (cropId -> plotIds), with
 * `FARM_GLOBAL` as the exclusive "entire farm" choice. A farmer may pick several crops
 * and, inside them, only the plots he worked on (e.g. sugarcane plot 2 and one grape
 * plot that sit side by side). `LogContext` already turns exactly this into a multi-crop
 * scope and drops any crop that has no chosen plot, so no data-model change is needed.
 *
 * One deliberate difference from `CropSelector.handleCropToggle`: a crop that has a
 * SINGLE plot gets that plot chosen for him (there is nothing to choose). `CropSelector`
 * leaves it empty ("user must manually select the plot"); that rule predates the
 * one-question-at-a-time flow and is flagged for the founder's ruling.
 */

export const FARM_GLOBAL = 'FARM_GLOBAL';

export type PlotMap = Record<string, string[]>;
export interface Selection { crops: string[]; plots: PlotMap }
export interface SelectableCrop { id: string; plots: readonly { id: string }[] }

export const EMPTY_SELECTION: Selection = { crops: [], plots: {} };

export const isGlobal = (s: Selection): boolean => s.crops.includes(FARM_GLOBAL);
export const plotsOf = (s: Selection, cropId: string): string[] => s.plots[cropId] ?? [];
export const totalPlots = (s: Selection): number => s.crops.reduce((n, c) => n + plotsOf(s, c).length, 0);
/** Ready to speak: the whole farm, or at least one plot. */
export const isReady = (s: Selection): boolean => isGlobal(s) || totalPlots(s) > 0;

export const toggleGlobal = (s: Selection): Selection => (isGlobal(s) ? EMPTY_SELECTION : { crops: [FARM_GLOBAL], plots: {} });

export const toggleCrop = (s: Selection, crop: SelectableCrop): Selection => {
    const base = isGlobal(s) ? EMPTY_SELECTION : s;
    if (base.crops.includes(crop.id)) {
        const plots = { ...base.plots };
        delete plots[crop.id];
        return { crops: base.crops.filter(id => id !== crop.id), plots };
    }
    return { crops: [...base.crops, crop.id], plots: { ...base.plots, [crop.id]: crop.plots.length === 1 ? [crop.plots[0].id] : [] } };
};

export const togglePlot = (s: Selection, cropId: string, plotId: string): Selection => {
    const crops = (s.crops.includes(cropId) ? s.crops : [...s.crops, cropId]).filter(id => id !== FARM_GLOBAL);
    const current = plotsOf(s, cropId);
    const next = current.includes(plotId) ? current.filter(id => id !== plotId) : [...current, plotId];
    return { crops, plots: { ...s.plots, [cropId]: next } };
};

/** Every crop, every plot ("सर्व"). */
export const selectEverything = (crops: readonly SelectableCrop[]): Selection => ({
    crops: crops.map(c => c.id),
    plots: Object.fromEntries(crops.map(c => [c.id, c.plots.map(p => p.id)])),
});

/** Every plot of the crops already chosen. */
export const selectAllPlots = (s: Selection, crops: readonly SelectableCrop[]): Selection => ({
    crops: s.crops,
    plots: { ...s.plots, ...Object.fromEntries(crops.filter(c => s.crops.includes(c.id)).map(c => [c.id, c.plots.map(p => p.id)])) },
});

export const allCropsSelected = (s: Selection, crops: readonly SelectableCrop[]): boolean =>
    crops.length > 0 && crops.every(c => s.crops.includes(c.id));

export const allPlotsSelected = (s: Selection, crops: readonly SelectableCrop[]): boolean =>
    crops.filter(c => s.crops.includes(c.id)).every(c => c.plots.every(p => plotsOf(s, c.id).includes(p.id)));

/** Crops chosen but with no plot chosen yet. */
export const pendingCrops = (s: Selection): string[] => s.crops.filter(id => id !== FARM_GLOBAL && plotsOf(s, id).length === 0);
