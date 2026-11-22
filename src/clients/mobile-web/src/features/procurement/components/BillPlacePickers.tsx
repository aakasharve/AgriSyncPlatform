/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 5; founder-approved 2026-11-21) - खरेदी and the bill
 * photo sheet ask "which crop, which plot?" the way every other screen now does, with the SHARED pieces: the "सर्व पिकं" card (each crop's
 * photo, its name in Marathi through `cropNameIn`), then the plots of the crop as chips (1 to 6) or the number grid (7 or more), chosen =
 * dark green with a white tick, and one count line ("१५ पैकी १५ निवडले"). Three small adapters, all pure views over the page's own model:
 *
 *   - `BuyPlacePicker`   खरेदी: the page's `pick = { cropId, plotId }` (each may be `ALL`). "सर्व <पीक>" is the FIRST quick button; it is the
 *                        page's "all plots of this crop" (plotId = ALL). With ALL every plot of the crop wears the chosen look, so one tap on a
 *                        number shows only that plot (as आढावा does); a tap on that one chosen plot goes back to ALL. The page cannot hold a
 *                        subset of plots, so a tap on ANOTHER plot while one is chosen switches to it (the single choice the chips always had).
 *   - `BillPlotChoice`   the bill sheet's "कोणता प्लॉट?" (one plot of the farm): the card (all crops, or one) and one selector per crop.
 *   - `BillCropChoice`   the bill sheet's "कोणतं पीक?" (one crop, shared by all its plots): the crop cards of the shared picker.
 *
 * These two screens are written in Marathi only (every word on them is hard-coded Marathi), so the picker is told `mr` and never follows the
 * app language: no English word, no Latin digit beside Marathi words. The crop's stored name is never changed; only what is SHOWN.
 */
import React, { useState } from 'react';
import type { CropProfile } from '../../../types';
import type { Language } from '../../../i18n/language';
import { cropNameIn } from '../../../shared/names/namesIn';
import { AllCropsCard, CropPlotPicker, PlotCount } from '../../context/components/CropPlotPicker';
import { PickedCountLine, PlotGroupHeader, PlotSelector, cropWordsOf } from '../../context/components/PlotSelector';
import { photoOnceFor } from '../../context/components/plotSelectorRules';
import { ALL, type BillPick } from './billView';

const MR: Language = 'mr';
const noop = () => undefined;

// ── खरेदी ────────────────────────────────────────────────────────────────────────────────────────────

const BUY_IDS = {
    crop: (key: 'all' | string) => `buy-crop-${key}`,
    plot: (plotId: string) => `buy-plot-${plotId}`,
};

export const BuyPlacePicker: React.FC<{
    crops: readonly CropProfile[];
    pick: BillPick;
    onPickCrop: (cropId: string) => void;
    onPickPlot: (plotId: string) => void;
}> = ({ crops, pick, onPickCrop, onPickPlot }) => {
    const crop = crops.find(c => c.id === pick.cropId);
    const allIds = crop ? crop.plots.map(p => p.id) : [];
    // ALL = every plot of the crop is chosen; else the one plot.
    const chosen = pick.plotId === ALL ? allIds : allIds.filter(id => id === pick.plotId);
    const pickedPlotIds = pick.cropId === ALL ? crops.flatMap(c => c.plots.map(p => p.id)) : chosen;
    // One tap on a number: that plot alone; the one chosen plot again: every plot of the crop; another plot: switch to it.
    const tap = (plotId: string) => onPickPlot(pick.plotId === plotId ? ALL : plotId);

    return (
        <div className="space-y-2.5" data-testid="buy-pick">
            {crops.length === 1
                // One crop: CropPlotPicker would draw no "सर्व पिकं" card, but "सर्व" (every bill of the farm) must stay one tap away.
                ? <AllCropsCard crops={crops} chosen={pick.cropId} onPickCrop={key => onPickCrop(key)} testIds={BUY_IDS} language={MR} />
                : <CropPlotPicker crops={crops} chosen={pick.cropId} pickedPlotIds={pickedPlotIds} allCrops hidePlots testIds={BUY_IDS}
                    language={MR} onPickCrop={onPickCrop} onTogglePlot={noop} />}
            {crop && crop.plots.length > 0 && (
                <div className="space-y-2" data-testid="buy-plots" data-crop={crop.id}>
                    <PlotSelector plots={crop.plots} chosen={chosen} color={crop.color} cropNames={cropWordsOf(crop)} allToggle="none" language={MR}
                        quickButtons={[{ id: 'all', label: `सर्व ${cropNameIn(crop.name, MR, crop.masterId)}`, plotIds: allIds }]}
                        onChange={() => onPickPlot(ALL)} onTapPlot={tap}
                        testIds={{ plot: BUY_IDS.plot, quick: id => `buy-plot-${id}`, grid: 'buy-plot-grid' }} />
                    <PickedCountLine total={crop.plots.length} picked={chosen.length} testId="buy-picked-count" language={MR} />
                </div>
            )}
        </div>
    );
};

// ── the bill photo sheet ─────────────────────────────────────────────────────────────────────────────

const BILL_IDS = {
    crop: (key: 'all' | string) => `bill-crop-${key}`,
    plot: (plotId: string) => `bill-plot-${plotId}`,
};

/**
 * "कोणता प्लॉट?" - one plot of the farm. With several crops the "सर्व पिकं" card narrows what is listed (a view only; it chooses no crop for
 * the bill); every crop in view is one section: its photo once (from 4 plots, the shared rule), then its plots. The one chosen plot is
 * dark green with a tick; a bill goes on exactly one plot, so there is no "select all".
 */
export const BillPlotChoice: React.FC<{
    crops: readonly CropProfile[];
    plotId: string;
    onPickPlot: (plotId: string) => void;
}> = ({ crops, plotId, onPickPlot }) => {
    const [view, setView] = useState<'all' | string>('all');
    const withPlots = crops.filter(c => c.plots.length > 0);
    // A crop that has since gone falls back to every crop.
    const viewKey = withPlots.some(c => c.id === view) ? view : 'all';
    const shown = withPlots.filter(c => viewKey === 'all' || c.id === viewKey);
    // The count line counts the whole farm, whatever the card narrows to: the chosen plot stays chosen (the save uses it) even when it is not in view.
    const total = withPlots.reduce((n, c) => n + c.plots.length, 0);
    const picked = withPlots.some(c => c.plots.some(p => p.id === plotId)) ? 1 : 0;
    const hasCard = withPlots.length > 1;

    return (
        <div className="space-y-2.5" data-testid="bill-plot-pick">
            {hasCard && (
                <CropPlotPicker crops={withPlots} chosen={viewKey} pickedPlotIds={plotId ? [plotId] : []} allCrops hidePlots testIds={BILL_IDS}
                    language={MR} onPickCrop={setView} onTogglePlot={noop} />
            )}
            {shown.map(c => {
                // The crop's photo once above its plots (from 4 plots, the shared rule) - unless the card above already says the one crop in view.
                const header = photoOnceFor(c.plots.length) && (shown.length > 1 || !hasCard);
                return (
                    <section key={c.id} className="space-y-2" data-testid={`bill-crop-section-${c.id}`} data-header={header ? 'yes' : 'no'}>
                        {header && <PlotGroupHeader crop={c} testId={`bill-crop-header-${c.id}`} language={MR} sub={<PlotCount total={c.plots.length} language={MR} />} />}
                        <PlotSelector plots={c.plots} chosen={c.plots.some(p => p.id === plotId) ? [plotId] : []} color={c.color} cropNames={cropWordsOf(c)}
                            allToggle="none" language={MR} onTapPlot={onPickPlot} testIds={{ plot: BILL_IDS.plot, grid: `bill-grid-${c.id}` }} />
                    </section>
                );
            })}
            <PickedCountLine total={total} picked={picked} testId="bill-picked-count" language={MR} />
        </div>
    );
};

/**
 * "कोणतं पीक?" - one crop, shared by all its plots: the shared crop cards (photo, Marathi name, "N प्लॉट"; the chosen one has the green border
 * and a tick, and says all its plots are in). No "सर्व पिकं" card here: a bill for every crop is the whole-farm choice above.
 */
export const BillCropChoice: React.FC<{
    crops: readonly CropProfile[];
    cropId: string;
    onPickCrop: (cropId: string) => void;
}> = ({ crops, cropId, onPickCrop }) => {
    const chosen = crops.find(c => c.id === cropId);
    return (
        <div data-testid="bill-crop-pick">
            <CropPlotPicker crops={crops} chosen={cropId} pickedPlotIds={chosen ? chosen.plots.map(p => p.id) : []} hidePlots testIds={BILL_IDS}
                language={MR} onPickCrop={onPickCrop} onTogglePlot={noop} />
        </div>
    );
};
