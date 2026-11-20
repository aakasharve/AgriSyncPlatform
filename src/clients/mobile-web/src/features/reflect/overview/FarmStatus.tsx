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
 * (the page is never empty, `reflectSelection.ts`). The quick buttons are true facts only: "आज सांगितलेले" and "आज बाकी" come from the
 * work recorded today (the same records the plot cards count) and are drawn only while the page is on today, never with a count of ०.
 * Every Marathi string is PROPOSED.
 */
import React from 'react';
import type { CropProfile } from '../../../types';
import { pickCrop, soloPlotId, togglePlot, viewHasManyPlots, type ReflectSelection } from './reflectSelection';
import { CropPlotPicker } from '../../context/components/CropPlotPicker';
import { PickedCountLine, PlotGroupHeader, PlotQuickRow, PlotSelector, cropWordsOf } from '../../context/components/PlotSelector';
import { SELECTOR_WORDS, buildQuickButtons, onlyShownText, photoOnceFor, pickedCountText, plotShortName } from '../../context/components/plotSelectorRules';
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
    /** The plots with work recorded today, while the page is on today; `null`/absent = no "today" buttons. */
    toldTodayPlotIds?: ReadonlySet<string> | null;
}> = ({ crops, sel, onSel, toldTodayPlotIds }) => {
    const language: Language = useOptionalLanguage()?.language ?? 'mr';
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
    const quick = buildQuickButtons({ plotIds: viewPlotIds, facts: toldTodayPlotIds ? { yesterday: null, today: toldTodayPlotIds } : null, kinds: ['toldToday', 'todayLeft'], language });
    const sw = SELECTOR_WORDS[language === 'en' ? 'en' : 'mr'];

    return (
        <div data-testid="farm-status">
            <CropPlotPicker crops={crops} chosen={sel.crop} pickedPlotIds={sel.plotIds} allCrops hidePlots testIds={TEST_IDS}
                onPickCrop={key => onSel(pickCrop(crops, key))}
                onTogglePlot={(_cropId, plotId) => onSel(togglePlot(crops, sel, plotId))} />
            {view.length > 0 && (
                <div className="mt-2.5 space-y-3" data-testid="farm-plots" data-many={many ? 'yes' : 'no'}>
                    {many && (
                        <PlotQuickRow plotIds={viewPlotIds} chosen={picked} allToggle="select" buttons={quick} language={language}
                            onChange={next => onSel({ crop: sel.crop, plotIds: next })}
                            testIds={{ all: 'farm-plots-all', quick: id => `farm-quick-${id}` }} />
                    )}
                    {view.map(c => {
                        const header = view.length > 1 && photoOnceFor(c.plots.length);
                        const mine = c.plots.filter(p => sel.plotIds.includes(p.id)).length;
                        return (
                            <section key={c.id} className="space-y-2" data-testid={`farm-crop-section-${c.id}`} data-header={header ? 'yes' : 'no'}>
                                {header && <PlotGroupHeader crop={c} testId={`farm-crop-header-${c.id}`} language={language} sub={pickedCountText(c.plots.length, mine, language)} />}
                                <PlotSelector plots={c.plots} chosen={sel.plotIds.filter(id => c.plots.some(p => p.id === id))} color={c.color} cropNames={cropWordsOf(c)}
                                    underHeader={header || (view.length === 1 && photoOnceFor(c.plots.length))} allToggle="none" language={language}
                                    onTapPlot={plotId => onSel(togglePlot(crops, sel, plotId))}
                                    testIds={{ plot: TEST_IDS.plot, grid: `farm-grid-${c.id}` }} />
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
                        <p className="m-0 text-[12.5px] font-bold text-stone-500" data-testid="farm-tap-hint">{HINT[language === 'en' ? 'en' : 'mr']}</p>
                    )}
                </div>
            )}
            <p className="m-0 mt-2 text-[12.5px] font-semibold text-stone-500">खालचं सगळं (कामं, प्लॉटचं काम, नोंदी, कॅलेंडर, खर्च) याच प्लॉटचं दिसतं.</p>
        </div>
    );
};
