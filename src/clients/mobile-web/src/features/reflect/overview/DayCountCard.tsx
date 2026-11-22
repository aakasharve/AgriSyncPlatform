/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a; founder pick D-172 = B, 2026-11-22: "one sentence for the day, plus the two
 * buttons that exist today")
 *
 * The card above शेताची स्थिती that says how the day stands in one look: "आज १०० पैकी ४३ सांगितले", a thin bar under it (decoration only; the
 * sentence says it), then the buttons in the order of need: the existing "सगळे निवडले", "आज बाकी", "आज सांगितलेले". A tap on a button does what
 * it always did: the whole page shows only those plots. The row LEFT the picker (`FarmStatus`), so there is no second copy of it.
 *
 * Honest by construction: every number comes from the work records the phone already holds (`toldTodayPlotIds`, the plots with any non-deleted
 * record today, a stoppage included, the same records the plot cards count). The numbers count the CROP he chose (all crops first), not the plots
 * he narrowed to, so the sentence does not change as he taps a button. A button with a count of ० is not drawn; the sentence says a zero.
 * There is NO problem button: that is the bigger fork (a new fact to work out) the founder did not pick.
 *
 * Drawn from 7 plots in view (all crops in view together; the founder's pilot farm has 14 plots over 4 crops and no crop of 7). On a day that
 * is not today there are no "today" facts: no sentence, no bar, no today buttons, only "सगळे निवडले", exactly what the picker drew before.
 * Every Marathi string is PROPOSED.
 */
import React from 'react';
import type { CropProfile } from '../../../types';
import { PlotQuickRow } from '../../context/components/PlotSelector';
import { buildQuickButtons, dayCountText, hasDayCard } from '../../context/components/plotSelectorRules';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { Language } from '../../../i18n/language';
import type { ReflectSelection } from './reflectSelection';

export const DayCountCard: React.FC<{
    crops: readonly CropProfile[];
    sel: ReflectSelection;
    onSel: (s: ReflectSelection) => void;
    /** The plots with work recorded today, while the page is on today; `null`/absent = no "today" facts. */
    toldTodayPlotIds?: ReadonlySet<string> | null;
    language?: Language;
}> = ({ crops, sel, onSel, toldTodayPlotIds, language: languageProp }) => {
    const ctxLanguage = useOptionalLanguage()?.language;
    const language: Language = languageProp ?? ctxLanguage ?? 'mr';
    // The crop he chose (all crops first), the page's own way: `FarmStatus` reads the same view.
    const view = crops.filter(c => (sel.crop === 'all' || c.id === sel.crop) && (c.plots ?? []).length > 0);
    const viewPlotIds = view.flatMap(c => c.plots.map(p => p.id));
    if (!hasDayCard(viewPlotIds.length)) return null;

    const picked = viewPlotIds.filter(id => sel.plotIds.includes(id));
    const quick = buildQuickButtons({
        plotIds: viewPlotIds,
        facts: toldTodayPlotIds ? { yesterday: null, today: toldTodayPlotIds } : null,
        kinds: ['todayLeft', 'toldToday'],
        language,
    });
    const told = toldTodayPlotIds ? viewPlotIds.filter(id => toldTodayPlotIds.has(id)).length : null;
    const percent = told === null ? 0 : Math.round((told / viewPlotIds.length) * 100);

    return (
        <div className="space-y-2.5 rounded-2xl bg-white p-3 ring-1 ring-stone-200" data-testid="day-count-card">
            {told !== null && (
                <>
                    <p className="m-0 text-[20px] font-extrabold leading-snug text-stone-900" data-testid="day-count-sentence">{dayCountText(viewPlotIds.length, told, language)}</p>
                    <div className="h-2 overflow-hidden rounded-full bg-stone-200" aria-hidden="true" data-testid="day-count-bar" data-percent={percent}>
                        <div className="h-full rounded-full bg-emerald-700" style={{ width: `${percent}%` }} />
                    </div>
                </>
            )}
            <PlotQuickRow plotIds={viewPlotIds} chosen={picked} allToggle="select" buttons={quick} language={language}
                onChange={next => onSel({ crop: sel.crop, plotIds: next })}
                testIds={{ all: 'farm-plots-all', quick: id => `farm-quick-${id}` }} />
        </div>
    );
};
