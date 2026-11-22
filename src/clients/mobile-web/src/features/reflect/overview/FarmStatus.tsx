/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6, WP-3; lane UI-7, founder D-150; lane UI-9a, founder pick overview C 2026-11-20)
 *
 * शेताची स्थिती — which crop and which plots the whole page shows, on the farm's real crops and plots, in plain words: "सर्व पिकं"
 * or one crop (its photo, "२ पैकी २ प्लॉट"), then that crop's plots, each with its crop's colour. Picking here narrows EVERY section
 * below. The page starts on every crop and every plot (`ReflectPage` holds `null` = all).
 *
 * Lane UI-7: the crop cards are THE shared crop -> plot look (`context/components/CropPlotPicker.tsx`). This file adapts the page's own
 * selection model (`reflectSelection.ts`) to it.
 *
 * Lane UI-9a: a crop with 7 or more plots draws its plots as a number grid IN PLACE under the crop cards (the shared `PlotSelector`, rules
 * in `plotSelectorRules`), a crop of 4 or more with several crops in view under its own header (photo once); a small farm keeps its chips.
 * With every plot picked, one tap on a number shows ONLY that plot ("फक्त G7 दिसतो" and "सगळे दाखवा" say so); there is no "none" button
 * (the page is never empty, `reflectSelection.ts`). The quick buttons ("सगळे निवडले", "आज बाकी", "आज सांगितलेले") are true facts only and moved
 * out of the picker on 2026-11-22 (founder D-172 = B): they live on the day card above this section (`DayCountCard`), so there is no second copy.
 * Every Marathi string is PROPOSED.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CropProfile } from '../../../types';
import { pickCrop, soloPlotId, togglePlot, viewHasManyPlots, type ReflectSelection } from './reflectSelection';
import { CropPlotPicker } from '../../context/components/CropPlotPicker';
import { PickedCountLine, PlotGroupHeader, PlotSelector, cropWordsOf } from '../../context/components/PlotSelector';
import {
    NUMBERS_WORDS, SELECTOR_WORDS, foldsManyPlots, onlyShownText, photoOnceFor, pickedCountText, plotMatchesQuery, plotNumbers, plotPickMode, plotShortName,
} from '../../context/components/plotSelectorRules';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { Language } from '../../../i18n/language';

const TEST_IDS = {
    crop: (key: 'all' | string) => `farm-crop-${key}`,
    plot: (plotId: string) => `farm-plot-${plotId}`,
};

const HINT = { mr: 'एक नंबर दाबा: फक्त तो प्लॉट दिसेल', en: 'Tap a number: only that plot is shown' } as const;

export const FarmStatus: React.FC<{
    crops: readonly CropProfile[];
    sel: ReflectSelection;
    onSel: (s: ReflectSelection) => void;
}> = ({ crops, sel, onSel }) => {
    const language: Language = useOptionalLanguage()?.language ?? 'mr';
    // Lane UI-9a (founder D-174 = A): with more than 15 plots in view each crop's number grid is folded and one search hears every crop.
    const [query, setQuery] = useState('');
    const [openGrids, setOpenGrids] = useState<ReadonlySet<string>>(() => new Set());
    if (crops.length === 0) {
        return <p className="m-0 rounded-2xl bg-stone-50 p-3 text-center text-[14.5px] font-bold text-stone-600" data-testid="farm-status-empty">अजून पीक जोडलेलं नाही — शेत सेटअपमध्ये पीक आणि प्लॉट जोडा.</p>;
    }
    const view = crops.filter(c => (sel.crop === 'all' || c.id === sel.crop) && (c.plots ?? []).length > 0);
    const viewPlotIds = view.flatMap(c => c.plots.map(p => p.id));
    const picked = viewPlotIds.filter(id => sel.plotIds.includes(id));
    const many = viewHasManyPlots(crops, sel.crop);
    const solo = soloPlotId(crops, sel);
    const soloName = solo ? (() => {
        const owner = view.find(c => c.plots.some(p => p.id === solo));
        const plot = owner?.plots.find(p => p.id === solo);
        return plot ? (owner && photoOnceFor(owner.plots.length) ? plotShortName(plot.name, cropWordsOf(owner)) : plot.name) : '';
    })() : '';
    const sw = SELECTOR_WORDS[language === 'en' ? 'en' : 'mr'];
    const nw = NUMBERS_WORDS[language === 'en' ? 'en' : 'mr'];
    const folded = foldsManyPlots(viewPlotIds.length);
    const searching = folded && query.trim() !== '';
    const toggleGrid = (cropId: string) => setOpenGrids(prev => { const next = new Set(prev); if (!next.delete(cropId)) next.add(cropId); return next; });
    // How many plots of each crop answer the search (a plot's number is its place among ALL the crop's plots, as in the grid).
    const answers = (c: CropProfile): number => {
        const numbers = plotNumbers(c.plots);
        return c.plots.filter(p => plotMatchesQuery({ name: p.name, position: numbers.get(p.id) ?? 0 }, query)).length;
    };
    const found = searching ? view.reduce((n, c) => n + answers(c), 0) : 0;

    return (
        <div data-testid="farm-status">
            <CropPlotPicker crops={crops} chosen={sel.crop} pickedPlotIds={sel.plotIds} allCrops hidePlots testIds={TEST_IDS}
                onPickCrop={key => onSel(pickCrop(crops, key))}
                onTogglePlot={(_cropId, plotId) => onSel(togglePlot(crops, sel, plotId))} />
            {view.length > 0 && (
                <div className="mt-2.5 space-y-3" data-testid="farm-plots" data-many={many ? 'yes' : 'no'}>
                    {folded && (
                        <input type="search" value={query} onChange={e => setQuery(e.target.value)} data-testid="farm-search" aria-label={sw.search} placeholder={sw.search}
                            className="min-h-[46px] w-full rounded-xl border-2 border-stone-300 bg-white px-3 text-[15px] font-bold text-stone-900 placeholder:text-stone-500" />
                    )}
                    {searching && found === 0 && <p className="m-0 text-[14px] font-bold text-stone-600" data-testid="farm-search-empty">{sw.noMatch}</p>}
                    {view.map(c => {
                        if (searching && answers(c) === 0) return null;
                        // A crop drawn as a number grid folds behind one row on a page of more than 15 plots; a small crop (chips) never does.
                        const folds = folded && plotPickMode(c.plots.length) === 'grid';
                        const open = !folds || searching || openGrids.has(c.id);
                        const header = folds || (view.length > 1 && photoOnceFor(c.plots.length));
                        const mine = c.plots.filter(p => sel.plotIds.includes(p.id)).length;
                        return (
                            <section key={c.id} className="space-y-2" data-testid={`farm-crop-section-${c.id}`} data-header={header ? 'yes' : 'no'} data-folded={folds && !open ? 'yes' : 'no'}>
                                {header && (
                                    <PlotGroupHeader crop={c} testId={`farm-crop-header-${c.id}`} language={language} sub={pickedCountText(c.plots.length, mine, language)}
                                        right={folds && !searching ? (
                                            <button type="button" onClick={() => toggleGrid(c.id)} aria-expanded={open} data-testid={`farm-fold-${c.id}`}
                                                className="inline-flex min-h-[44px] shrink-0 items-center gap-1 self-center rounded-xl border-2 border-stone-400 bg-white px-3 text-[14px] font-extrabold text-stone-800 active:scale-95">
                                                <span>{open ? nw.hide : nw.show}</span>
                                                {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
                                            </button>
                                        ) : undefined} />
                                )}
                                {open && (
                                    <PlotSelector plots={c.plots} chosen={sel.plotIds.filter(id => c.plots.some(p => p.id === id))} color={c.color} cropNames={cropWordsOf(c)}
                                        underHeader={header || (view.length === 1 && photoOnceFor(c.plots.length))} allToggle="none" language={language}
                                        query={folded ? query : undefined}
                                        onTapPlot={plotId => onSel(togglePlot(crops, sel, plotId))}
                                        testIds={{ plot: TEST_IDS.plot, grid: `farm-grid-${c.id}` }} />
                                )}
                            </section>
                        );
                    })}
                    {many && solo && (
                        <div className="flex items-center gap-2 rounded-2xl border-2 border-stone-300 bg-white px-3 py-2" data-testid="farm-solo-line">
                            <span className="min-w-0 flex-1 text-[15px] font-extrabold text-stone-900">{onlyShownText(soloName, language)}</span>
                            <button type="button" data-testid="farm-solo-all" onClick={() => onSel(pickCrop(crops, sel.crop))}
                                className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl border-2 border-emerald-800 bg-white px-3 text-[14px] font-extrabold text-emerald-800 active:scale-95">{sw.showAll}</button>
                        </div>
                    )}
                    {many && !solo && picked.length < viewPlotIds.length && (
                        <PickedCountLine total={viewPlotIds.length} picked={picked.length} testId="farm-picked-count" language={language} />
                    )}
                    {many && picked.length === viewPlotIds.length && (
                        <p className="m-0 text-[14px] font-bold text-stone-700" data-testid="farm-tap-hint">{HINT[language === 'en' ? 'en' : 'mr']}</p>
                    )}
                </div>
            )}
            <p className="m-0 mt-2 text-[14px] font-semibold text-stone-700" data-testid="farm-below-note">खालचं सगळं (कामं, प्लॉटचं काम, नोंदी, कॅलेंडर, खर्च) याच प्लॉटचं दिसतं.</p>
        </div>
    );
};
