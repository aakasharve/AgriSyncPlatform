/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF fix pass 1, item 10) — THE one way a place is said: the crop
 * in his language, then its plots. A plot named after its crop ("द्राक्ष G1") already says the crop, so it is said alone —
 * never "द्राक्ष · द्राक्ष G1". (The rule the हजेरी card had on its own, `TodayAttendanceCard.placeText`, now shared by the
 * बदला screen, its title, "तपासा आणि जतन करा", आवाज नोंदी, the mic's place line, the result screen and income.)
 */
import { cropNameIn } from './namesIn';

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

/** "द्राक्ष · वरचा, खालचा" — or "द्राक्ष G1" when every plot already names its crop; '' when there is nothing to say. */
export function placeWords(cropName: string | null | undefined, plotNames: readonly string[], language: string | null | undefined): string {
    const crop = cropNameIn(cropName ?? '', language);
    const plots = plotNames.map(p => p.trim()).filter(Boolean);
    const plotsSayCrop = plots.length > 0
        && plots.every(p => (!!crop && saysCrop(p, crop)) || (!!cropName && saysCrop(p, cropName)));
    if (plotsSayCrop) return plots.join(', ');
    return [crop, plots.join(', ')].filter(Boolean).join(' · ');
}
