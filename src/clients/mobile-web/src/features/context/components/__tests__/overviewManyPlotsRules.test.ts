/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, founder picks 2026-11-22: D-172 B, D-173 A, D-174 A, D-175 A)
 *
 * The thresholds and words of the आढावा page with many plots, in one place (`plotSelectorRules`), so the five screens that read them
 * (the day card, the folded picker, the crop groups, the calendar, the money bars) can never disagree about "more than 15".
 */
import { describe, expect, it } from 'vitest';
import {
    CALENDAR_CHIPS_SHOWN, DAY_CARD_FROM, MANY_PLOTS_CARDS_SHOWN, MANY_PLOTS_FROM, MONEY_BARS_SHOWN,
    dayCountText, foldsManyPlots, hasDayCard, moreRecordsText, moreShownText, plotCountText,
} from '../plotSelectorRules';

describe('when the overview says the day in one sentence (D-172)', () => {
    it('from 7 plots in view, not before (the same cut as the number grid)', () => {
        expect(DAY_CARD_FROM).toBe(7);
        expect(hasDayCard(6)).toBe(false);
        expect(hasDayCard(7)).toBe(true);
        expect(hasDayCard(14)).toBe(true);
    });

    it('says "आज १०० पैकी ४३ सांगितले" in Devanagari digits, and its English twin in Latin digits', () => {
        expect(dayCountText(100, 43, 'mr')).toBe('आज १०० पैकी ४३ सांगितले');
        expect(dayCountText(14, 0, 'mr')).toBe('आज १४ पैकी ० सांगितले');
        expect(dayCountText(100, 43, 'en')).toBe('Today: 43 of 100 told');
    });
});

describe('"more than 15 plots" (D-173, D-174)', () => {
    it('folds from 16 plots: 15 plots are drawn exactly as before', () => {
        expect(MANY_PLOTS_FROM).toBe(16);
        expect(foldsManyPlots(15)).toBe(false);
        expect(foldsManyPlots(16)).toBe(true);
        expect(foldsManyPlots(100)).toBe(true);
    });

    it('the caps are the ones the founder picked: 6 cards, 4 calendar chips, 5 money bars', () => {
        expect(MANY_PLOTS_CARDS_SHOWN).toBe(6);
        expect(CALENDAR_CHIPS_SHOWN).toBe(4);
        expect(MONEY_BARS_SHOWN).toBe(5);
    });
});

describe('the words (PROPOSED, Marathi first)', () => {
    it('"आणखी ३४ दाखवा" / "Show 34 more"', () => {
        expect(moreShownText(34, 'mr')).toBe('आणखी ३४ दाखवा');
        expect(moreShownText(34, 'en')).toBe('Show 34 more');
    });

    it('"+८ नोंदी" / "+8 records"', () => {
        expect(moreRecordsText(8, 'mr')).toBe('+८ नोंदी');
        expect(moreRecordsText(8, 'en')).toBe('+8 records');
    });

    it('"१५ प्लॉट" for a record that names several plots (the app\'s own form), "15 plots" in English, "1 plot" for one', () => {
        expect(plotCountText(15, 'mr')).toBe('१५ प्लॉट');
        expect(plotCountText(15, 'en')).toBe('15 plots');
        expect(plotCountText(1, 'en')).toBe('1 plot');
    });
});
