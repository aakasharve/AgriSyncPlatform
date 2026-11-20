/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF fix pass 1, item 10) — THE one way a place is said: the crop
 * in his language, then its plots. A plot named after its crop ("द्राक्ष G1") already says the crop, so it is said alone —
 * never "द्राक्ष · द्राक्ष G1". (The rule the हजेरी card had on its own, `TodayAttendanceCard.placeText`, now shared by the
 * बदला screen, its title, "तपासा आणि जतन करा", आवाज नोंदी, the mic's place line, the result screen and income.)
 *
 * Lane UI-9a, founder 2026-11-21 (redesign decision 3, "one count rule for plots written as text"): 1 to 3 plots are said by name,
 * 4 or more by count ("द्राक्ष · ८ प्लॉट"), and when the caller tells us the crop's total and every plot is meant, "द्राक्ष · सर्व १५ प्लॉट"
 * - so a place never grows into fifteen joined names that the mic screen cuts off after four. The words "N प्लॉट" are the app's own;
 * "सर्व N प्लॉट" is PROPOSED (draft Marathi - needs review).
 */
import { digitsFor } from '../utils/marathiDigits';
import { cropNameIn } from './namesIn';

/** From this many plots a place is a count, not a list of names (founder 2026-11-21). */
export const PLOT_COUNT_FROM = 4;

const COUNT_WORDS = {
    mr: { plots: 'प्लॉट', all: 'सर्व' },
    en: { plots: 'plots', all: 'all' },
} as const;

/** "८ प्लॉट", or "सर्व १५ प्लॉट" when all of the crop's plots are meant ("8 plots" / "all 15 plots" in English). */
export function plotsCountText(count: number, language: string | null | undefined, totalPlots?: number | null): string {
    const w = COUNT_WORDS[language === 'en' ? 'en' : 'mr'];
    const all = totalPlots != null && totalPlots > 0 && count >= totalPlots;
    const noun = language === 'en' && count === 1 ? 'plot' : w.plots;
    return `${all ? `${w.all} ` : ''}${digitsFor(count, language)} ${noun}`;
}

/** Plot names as a line: "G1, G4" for 1 to 3 plots, "८ प्लॉट" (or "सर्व १५ प्लॉट") from 4. '' when there is none. */
export function plotListText(plotNames: readonly string[], language: string | null | undefined, totalPlots?: number | null): string {
    const plots = plotNames.map(p => p.trim()).filter(Boolean);
    if (plots.length === 0) return '';
    return plots.length >= PLOT_COUNT_FROM ? plotsCountText(plots.length, language, totalPlots) : plots.join(', ');
}

/** The words of a name: split on spaces, punctuation and symbols (never a word-boundary regex, which does not know Devanagari). */
const wordsOf = (text: string): string[] => text.toLocaleLowerCase().split(/[\s\p{P}\p{S}]+/u).filter(Boolean);

/**
 * Lane OF fix 2 (N6) — does this plot name say the crop as whole WORDS ("द्राक्ष G1", "Grapes G1")? Letters inside another
 * word never count: crop ऊस is not said by the plot "पाऊसवाडी".
 */
function saysCrop(plot: string, crop: string): boolean {
    const want = wordsOf(crop);
    if (want.length === 0) return false;
    const have = wordsOf(plot);
    return have.some((_, i) => want.every((w, j) => have[i + j] === w));
}

/**
 * "द्राक्ष · वरचा, खालचा" — or "द्राक्ष G1" when every plot already names its crop; from 4 plots "द्राक्ष · ८ प्लॉट", and
 * "द्राक्ष · सर्व १५ प्लॉट" when `totalPlots` (the crop's whole count, passed by a caller that knows it) is reached.
 * '' when there is nothing to say.
 */
export function placeWords(cropName: string | null | undefined, plotNames: readonly string[], language: string | null | undefined, totalPlots?: number | null): string {
    const crop = cropNameIn(cropName ?? '', language);
    const plots = plotNames.map(p => p.trim()).filter(Boolean);
    if (plots.length >= PLOT_COUNT_FROM) return [crop, plotsCountText(plots.length, language, totalPlots)].filter(Boolean).join(' · ');
    const plotsSayCrop = plots.length > 0
        && plots.every(p => (!!crop && saysCrop(p, crop)) || (!!cropName && saysCrop(p, cropName)));
    if (plotsSayCrop) return plots.join(', ');
    return [crop, plots.join(', ')].filter(Boolean).join(' · ');
}
