/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF fix pass 2, N6) — the one place rule hides the crop only
 * when a plot name says it as a whole WORD; letters inside another word never hide it ("ऊस" is not in "पाऊसवाडी").
 */
import { describe, expect, it } from 'vitest';
import { placeWords } from '../placeWords';

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
