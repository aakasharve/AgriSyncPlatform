/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3)
 *
 * शेताची स्थिती — which crop and which plots the whole "पूर्ण शेतीचा आढावा" page shows. Pure.
 *
 * The farmer picks "सर्व पिकं" or one crop, then any of its plots. Every section below reads the page's
 * long-standing scope pair — `viewCrops` (crop ids) and `viewPlots` (crop id → plot ids) — derived here,
 * so the existing scope rules (`isWholeFarmSelection`, `getScopedLogCost`, the log lookups in
 * `../helpers`) keep working exactly as they did.
 *
 * Three rules, the first two from the approved preview:
 *   - never an empty page: un-picking the last picked plot picks every plot of the view again;
 *   - a crop whose plots are ALL un-picked leaves the scope. (In the old pair an empty plot list meant
 *     "every plot of that crop", so leaving it in would have shown the very plots he just hid.)
 *   - lane UI-9a (founder pick 2026-11-20, overview C "number grid in place"): with MANY plots in view (a crop drawn as a number grid, 7 or
 *     more) and every plot picked, one tap on a number shows ONLY that plot (before: the tap took it off, so seeing one plot of 15 meant 14
 *     taps). From there taps add and remove as usual. A small farm (chips) keeps the tap it always had.
 */
import type { CropProfile, DailyLog, Plot } from '../../../types';
import { plotPickMode } from '../../context/components/plotSelectorRules';

export interface ReflectSelection {
    /** 'all' = "सर्व पिकं"; otherwise one crop id. */
    crop: 'all' | string;
    /** The picked plots (flat; a crop with no plot at all needs none). */
    plotIds: string[];
}

export interface ViewScope {
    viewCrops: string[];
    viewPlots: Record<string, string[]>;
}

/** One plot card's identity: a plot of a crop, or a crop that has no plot yet. */
export interface PlotRef {
    /** `cropId:plotId`, or `cropId` alone for a crop without plots. */
    key: string;
    crop: CropProfile;
    cropId: string;
    cropName: string;
    /** The crop's own colour class (`bg-…`), the colour code every section uses for it. */
    cropColor: string;
    plot?: Plot;
    plotId?: string;
    plotName?: string;
    /** Position of the plot inside its crop (the numbered plot marker). */
    plotIndex: number;
}

const cropsOfView = (crops: readonly CropProfile[], key: 'all' | string): CropProfile[] =>
    crops.filter(c => key === 'all' || c.id === key);

const plotIdsOf = (crops: readonly CropProfile[]): string[] => crops.flatMap(c => (c.plots ?? []).map(p => p.id));

export const selectAll = (crops: readonly CropProfile[]): ReflectSelection => ({ crop: 'all', plotIds: plotIdsOf(crops) });

export const pickCrop = (crops: readonly CropProfile[], key: 'all' | string): ReflectSelection =>
    ({ crop: key, plotIds: plotIdsOf(cropsOfView(crops, key)) });

/** The view holds a crop with so many plots that its plots are drawn as a number grid (`plotSelectorRules`). */
export const viewHasManyPlots = (crops: readonly CropProfile[], key: 'all' | string): boolean =>
    cropsOfView(crops, key).some(c => plotPickMode((c.plots ?? []).length) === 'grid');

/** Every plot of the view is picked (and there is more than one to pick from). */
const allPicked = (crops: readonly CropProfile[], sel: ReflectSelection): boolean => {
    const visible = plotIdsOf(cropsOfView(crops, sel.crop));
    return visible.length > 1 && visible.every(id => sel.plotIds.includes(id));
};

/** The one plot the page is narrowed to, when the view has many plots and exactly one of them is picked; else undefined. */
export const soloPlotId = (crops: readonly CropProfile[], sel: ReflectSelection): string | undefined => {
    if (!viewHasManyPlots(crops, sel.crop)) return undefined;
    const picked = plotIdsOf(cropsOfView(crops, sel.crop)).filter(id => sel.plotIds.includes(id));
    return picked.length === 1 ? picked[0] : undefined;
};

export const togglePlot = (crops: readonly CropProfile[], sel: ReflectSelection, plotId: string): ReflectSelection => {
    const stillVisible = plotIdsOf(cropsOfView(crops, sel.crop));
    if (stillVisible.includes(plotId) && viewHasManyPlots(crops, sel.crop) && allPicked(crops, sel)) return { ...sel, plotIds: [plotId] };
    const next = sel.plotIds.includes(plotId) ? sel.plotIds.filter(id => id !== plotId) : [...sel.plotIds, plotId];
    return next.some(id => stillVisible.includes(id)) ? { ...sel, plotIds: next } : pickCrop(crops, sel.crop);
};

export const toViewScope = (crops: readonly CropProfile[], sel: ReflectSelection): ViewScope => {
    const viewCrops: string[] = [];
    const viewPlots: Record<string, string[]> = {};
    for (const c of cropsOfView(crops, sel.crop)) {
        const plots = c.plots ?? [];
        if (plots.length === 0) { viewCrops.push(c.id); continue; }
        const picked = plots.map(p => p.id).filter(id => sel.plotIds.includes(id));
        if (picked.length === 0) continue;
        viewCrops.push(c.id);
        viewPlots[c.id] = picked;
    }
    return { viewCrops, viewPlots };
};

/** The page's long-standing visibility rule for a log (notes, the day's tasks): its crop is picked and, when that crop has picked plots, one of them. */
export const isLogInScope = (log: DailyLog, scope: ViewScope): boolean => {
    const context = log.context?.selection?.[0];
    if (!context || !scope.viewCrops.includes(context.cropId)) return false;
    const picked = scope.viewPlots[context.cropId] ?? [];
    if (picked.length === 0) return true;
    return context.selectedPlotIds?.some(id => picked.includes(id)) ?? false;
};

/** One card per picked plot (and one per plot-less crop in view), in the farm's own order. */
export const plotRefsInScope = (crops: readonly CropProfile[], scope: ViewScope): PlotRef[] =>
    crops.filter(c => scope.viewCrops.includes(c.id)).flatMap((c): PlotRef[] => {
        const base = { crop: c, cropId: c.id, cropName: c.name, cropColor: c.color };
        const plots = c.plots ?? [];
        if (plots.length === 0) return [{ ...base, key: c.id, plotIndex: 0 }];
        const picked = scope.viewPlots[c.id] ?? [];
        return plots
            .map((p, plotIndex) => ({ p, plotIndex }))
            .filter(({ p }) => picked.includes(p.id))
            .map(({ p, plotIndex }) => ({ ...base, key: `${c.id}:${p.id}`, plot: p, plotId: p.id, plotName: p.name, plotIndex }));
    });
