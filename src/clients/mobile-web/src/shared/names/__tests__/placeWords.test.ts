/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF fix pass 2, N6) — the one place rule hides the crop only
 * when a plot name says it as a whole WORD; letters inside another word never hide it ("ऊस" is not in "पाऊसवाडी").
 */
import { describe, expect, it } from 'vitest';
import { placeWords, plotListText, plotsCountText } from '../placeWords';

describe('placeWords — a plot named after its crop is said alone, by whole words only (N6)', () => {
    it('Marathi: a plot that says the crop as a word stands alone', () => {
        expect(placeWords('Grapes', ['द्राक्ष G1'], 'mr')).toBe('द्राक्ष G1');
        expect(placeWords('Grapes', ['द्राक्ष-G1'], 'mr')).toBe('द्राक्ष-G1');
    });

    it('Marathi: letters of the crop inside another word never hide the crop (ऊस · पाऊसवाडी)', () => {
        expect(placeWords('ऊस', ['पाऊसवाडी'], 'mr')).toBe('ऊस · पाऊसवाडी');
    });

    it('English: "Grapes G1" stands alone; "Sugarcanefield" does not hide "Sugarcane"', () => {
        expect(placeWords('Grapes', ['Grapes G1'], 'en')).toBe('Grapes G1');
        expect(placeWords('Grapes', ['grapes g1'], 'en')).toBe('grapes g1');
        expect(placeWords('Sugarcane', ['Sugarcanefield'], 'en')).toBe('Sugarcane · Sugarcanefield');
    });

    it('plots that do not name the crop follow it', () => {
        expect(placeWords('Grapes', ['वरचा', 'खालचा'], 'mr')).toBe('द्राक्ष · वरचा, खालचा');
        expect(placeWords('Grapes', ['Upper'], 'en')).toBe('Grapes · Upper');
    });
});

describe('placeWords - one count rule (founder 2026-11-21, redesign decision 3)', () => {
    const g = (n: number) => Array.from({ length: n }, (_, i) => `द्राक्ष G${i + 1}`);

    it('1 to 3 plots are said by name, as before', () => {
        expect(placeWords('Grapes', g(1), 'mr', 15)).toBe('द्राक्ष G1');
        expect(placeWords('Grapes', g(3), 'mr', 15)).toBe('द्राक्ष G1, द्राक्ष G2, द्राक्ष G3');
        expect(placeWords('Grapes', ['वरचा', 'खालचा', 'मधला'], 'mr', 15)).toBe('द्राक्ष · वरचा, खालचा, मधला');
    });

    it('4 or more plots are the crop and a count in Marathi digits - never a line of names', () => {
        expect(placeWords('Grapes', g(4), 'mr')).toBe('द्राक्ष · ४ प्लॉट');
        expect(placeWords('Grapes', g(8), 'mr', 15)).toBe('द्राक्ष · ८ प्लॉट');
        expect(placeWords('Grapes', g(8), 'mr', 15)).not.toContain('G1');
        expect(placeWords('Grapes', g(14), 'mr', 15)).toBe('द्राक्ष · १४ प्लॉट');
    });

    it('every plot of the crop (the caller says the total) is "सर्व N प्लॉट"', () => {
        expect(placeWords('Grapes', g(15), 'mr', 15)).toBe('द्राक्ष · सर्व १५ प्लॉट');
        expect(placeWords('Grapes', g(4), 'mr', 4)).toBe('द्राक्ष · सर्व ४ प्लॉट');
    });

    it('without the total the word सर्व is never said; with 3 or fewer plots even "all" stays by name', () => {
        expect(placeWords('Grapes', g(15), 'mr')).toBe('द्राक्ष · १५ प्लॉट');
        expect(placeWords('Grapes', g(15), 'mr', null)).toBe('द्राक्ष · १५ प्लॉट');
        expect(placeWords('Grapes', ['वरचा', 'खालचा'], 'mr', 2)).toBe('द्राक्ष · वरचा, खालचा');
    });

    it('English twin: "Grapes · 8 plots" and "Grapes · all 15 plots", Latin digits', () => {
        expect(placeWords('Grapes', g(8), 'en', 15)).toBe('Grapes · 8 plots');
        expect(placeWords('Grapes', g(15), 'en', 15)).toBe('Grapes · all 15 plots');
        expect(placeWords('Grapes', g(2), 'en', 15)).toBe('Grapes · द्राक्ष G1, द्राक्ष G2');
    });

    it('blank plot names are not counted', () => {
        expect(placeWords('Grapes', ['', ' ', ...g(3)], 'mr', 15)).toBe('द्राक्ष G1, द्राक्ष G2, द्राक्ष G3');
    });
});

describe('plotListText and plotsCountText (the same rule for a line that has no crop in it)', () => {
    it('1 to 3 names joined, from 4 a count; "सर्व" only when the total is reached', () => {
        expect(plotListText(['G1', 'G4'], 'mr')).toBe('G1, G4');
        expect(plotListText(['G1', 'G2', 'G3', 'G4'], 'mr')).toBe('४ प्लॉट');
        expect(plotListText(Array.from({ length: 18 }, (_, i) => `G${i + 1}`), 'mr', 18)).toBe('सर्व १८ प्लॉट');
        expect(plotListText([], 'mr')).toBe('');
        expect(plotListText(['G1', 'G2', 'G3', 'G4'], 'en')).toBe('4 plots');
    });

    it('a count of one reads "1 plot" in English', () => {
        expect(plotsCountText(1, 'en')).toBe('1 plot');
        expect(plotsCountText(1, 'mr')).toBe('१ प्लॉट');
    });
});
