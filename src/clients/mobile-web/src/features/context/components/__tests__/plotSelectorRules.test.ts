/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a)
 *
 * The one rule module for "how do I show a crop's plots": the thresholds, the short names, the search, the true quick buttons.
 */
import { describe, expect, it } from 'vitest';
import {
    ALL_CROPS_PHOTOS_MAX, PHOTO_ONCE_FROM, PLOT_GRID_FROM, PLOT_SEARCH_FROM, SMALL_CARDS_FROM,
    afterAllToggle, allChosen, allCropsColumns, allCropsLine, allCropsPhotoSlots, buildQuickButtons, hasPlotSearch, moreCropsText,
    naturalOrder, onlyShownText, photoOnceFor, pickedCountText, plotIdsWithWorkOn, plotMatchesQuery, plotPickMode, plotShortName, sameSet,
    smallPlotCardsFor, sortedNaturally, toLatinDigits, toggleId,
} from '../plotSelectorRules';

describe('the thresholds are named constants and the rules read them', () => {
    it('the numbers are the founder\'s: grid from 7, search from 25, photo once from 4', () => {
        expect(PLOT_GRID_FROM).toBe(7);
        expect(PLOT_SEARCH_FROM).toBe(25);
        expect(PHOTO_ONCE_FROM).toBe(4);
        expect(SMALL_CARDS_FROM).toBe(PHOTO_ONCE_FROM);
        expect(ALL_CROPS_PHOTOS_MAX).toBe(8);
    });

    it('1 to 6 plots are chips, 7 or more a number grid', () => {
        for (const n of [0, 1, 3, 6]) expect(plotPickMode(n)).toBe('chips');
        for (const n of [7, 15, 24, 60]) expect(plotPickMode(n)).toBe('grid');
    });

    it('search appears from 25 plots and not before', () => {
        expect(hasPlotSearch(24)).toBe(false);
        expect(hasPlotSearch(25)).toBe(true);
        expect(hasPlotSearch(40)).toBe(true);
    });

    it('a crop with 4 or more plots shows its photo once and has small cards; 1 to 3 keep a photo per card', () => {
        for (const n of [1, 2, 3]) { expect(photoOnceFor(n)).toBe(false); expect(smallPlotCardsFor(n)).toBe(false); }
        for (const n of [4, 5, 15]) { expect(photoOnceFor(n)).toBe(true); expect(smallPlotCardsFor(n)).toBe(true); }
    });

    it('the all-crops card shows every crop up to 8, and 7 photos plus "+N" above that', () => {
        expect(allCropsPhotoSlots(2)).toEqual({ shown: 2, more: 0 });
        expect(allCropsPhotoSlots(8)).toEqual({ shown: 8, more: 0 });
        expect(allCropsPhotoSlots(9)).toEqual({ shown: 7, more: 2 });
        expect(allCropsPhotoSlots(12)).toEqual({ shown: 7, more: 5 });
    });

    it('the photos sit in two columns for two crops, up to four across, so 5 to 8 make two rows', () => {
        expect(allCropsColumns(2, false)).toBe(2);
        expect(allCropsColumns(3, false)).toBe(3);
        expect(allCropsColumns(4, false)).toBe(4);
        expect(allCropsColumns(8, false)).toBe(4);
        expect(allCropsColumns(7, true)).toBe(4);
    });
});

describe('Marathi digits in the counts', () => {
    it('the count line reads "१५ पैकी ४ निवडले" in Marathi and "4 of 15 chosen" in English', () => {
        expect(pickedCountText(15, 4, 'mr')).toBe('१५ पैकी ४ निवडले');
        expect(pickedCountText(15, 0, 'mr')).toBe('१५ पैकी ० निवडले');
        expect(pickedCountText(15, 4, 'en')).toBe('4 of 15 chosen');
    });

    it('the all-crops card line and the "+N" tile carry Devanagari digits', () => {
        expect(allCropsLine(2, 18, 'mr')).toBe('२ पिकं · १८ प्लॉट');
        expect(moreCropsText(3, 'mr')).toBe('+३ पिकं');
        expect(allCropsLine(2, 18, 'en')).toBe('2 crops · 18 plots');
    });

    it('"only this plot" is one short sentence', () => {
        expect(onlyShownText('G7', 'mr')).toBe('फक्त G7 दिसतो');
        expect(onlyShownText('G7', 'en')).toBe('Only G7 is shown');
    });

    it('a Devanagari digit becomes a Latin one, nothing else changes', () => {
        expect(toLatinDigits('G७ प्लॉट १२')).toBe('G7 प्लॉट 12');
        expect(toLatinDigits('abc')).toBe('abc');
    });
});

describe('the plot inside its crop\'s group', () => {
    it('"द्राक्ष G7" is shown as "G7" once the header says the crop (display only)', () => {
        expect(plotShortName('द्राक्ष G7', ['द्राक्ष'])).toBe('G7');
        expect(plotShortName('Grapes - G7', ['Grapes'])).toBe('G7');
        expect(plotShortName('grapes G12', ['Grapes'])).toBe('G12');
    });

    it('the crop may be named in any of the languages the stored name could use', () => {
        expect(plotShortName('Grapes G7', ['द्राक्ष', 'Grapes'])).toBe('G7');
        expect(plotShortName('द्राक्ष G7', ['Grapes', 'द्राक्ष'])).toBe('G7');
    });

    it('a name that does not start with the crop word, or is only the crop word, is left alone', () => {
        expect(plotShortName('सोनाका', ['द्राक्ष'])).toBe('सोनाका');
        expect(plotShortName('द्राक्ष', ['द्राक्ष'])).toBe('द्राक्ष');
        expect(plotShortName('द्राक्षबाग', ['द्राक्ष'])).toBe('द्राक्षबाग'); // no separator: a different word
        expect(plotShortName('G7', [undefined, ''])).toBe('G7');
    });
});

describe('natural number order: G2 before G10 (CTO ruling 2026-11-20)', () => {
    const order = (names: string[]) => sortedNaturally(names, n => n);

    it('G1, G2, G10, G11 come in number order, not text order', () => {
        expect(order(['G11', 'G2', 'G10', 'G1'])).toEqual(['G1', 'G2', 'G10', 'G11']);
        expect(order(['द्राक्ष G10', 'द्राक्ष G9', 'द्राक्ष G100', 'द्राक्ष G1'])).toEqual(['द्राक्ष G1', 'द्राक्ष G9', 'द्राक्ष G10', 'द्राक्ष G100']);
    });

    it('a Devanagari digit is the same as a Latin one', () => {
        expect(order(['ऊस १०', 'ऊस २'])).toEqual(['ऊस २', 'ऊस १०']);
        expect(order(['G10', 'G२', 'G1'])).toEqual(['G1', 'G२', 'G10']);
    });

    it('a name with no digit sorts after the names that have one, and those keep their own order (stable)', () => {
        expect(order(['सोनाका', 'G10', 'थॉम्पसन', 'G2', 'पूर्व'])).toEqual(['G2', 'G10', 'सोनाका', 'थॉम्पसन', 'पूर्व']);
        expect(order(['b', 'a', 'c'])).toEqual(['b', 'a', 'c']);
        expect(order(['', 'G1'])).toEqual(['G1', '']);
    });

    it('equal names, or names equal in number, keep their original order; case does not matter; leading zeros are the same number', () => {
        expect(naturalOrder(['G7', 'g7', 'G07', 'G7'])).toEqual([0, 1, 2, 3]);
        expect(naturalOrder(['G3', 'G1', 'G3', 'G1'])).toEqual([1, 3, 0, 2]);
    });

    it('a name with two numbers compares them in turn; a shorter name comes first; a number comes before a word', () => {
        expect(order(['A2-10', 'A2-9', 'A10-1', 'A2'])).toEqual(['A2', 'A2-9', 'A2-10', 'A10-1']);
        expect(order(['7B', 'G7'])).toEqual(['7B', 'G7']);
    });

    it('naturalOrder gives positions and does not touch its input; sortedNaturally returns a new array', () => {
        const names = ['G2', 'G10', 'G1'];
        expect(naturalOrder(names)).toEqual([2, 0, 1]);
        const items = [{ n: 'G10' }, { n: 'G2' }];
        const sorted = sortedNaturally(items, i => i.n);
        expect(sorted.map(i => i.n)).toEqual(['G2', 'G10']);
        expect(items.map(i => i.n)).toEqual(['G10', 'G2']);
        expect(names).toEqual(['G2', 'G10', 'G1']);
    });
});

describe('search: a number or a name, either script', () => {
    const plots = [{ name: 'द्राक्ष G7', position: 7 }, { name: 'द्राक्ष G17', position: 17 }, { name: 'सोनाका', position: 3 }, { name: 'द्राक्ष G27', position: 27 }];
    const hits = (q: string) => plots.filter(p => plotMatchesQuery(p, q)).map(p => p.position);

    it('an empty search shows everything', () => {
        expect(hits('')).toEqual([7, 17, 3, 27]);
        expect(hits('  ')).toEqual([7, 17, 3, 27]);
    });

    it('a Latin digit and a Devanagari digit find the same plot (by its number or the number in its name), not "G17" for "7"', () => {
        expect(hits('7')).toEqual([7]);
        expect(hits('७')).toEqual([7]);
        expect(hits('17')).toEqual([17]);
        expect(hits('१७')).toEqual([17]);
        expect(hits('3')).toEqual([3]); // the plot's place number, though its name has no digit
    });

    it('a name is found by any part of it, in any case', () => {
        expect(hits('सोना')).toEqual([3]);
        expect(hits('g2')).toEqual([27]);
        expect(hits('G७')).toEqual([7]); // mixed script
    });
});

describe('true quick buttons', () => {
    const log = (date: string, plotIds: string[], extra: object = {}) =>
        ({ date, context: { selection: [{ cropId: 'c', selectedPlotIds: plotIds }] }, ...extra }) as unknown as Parameters<typeof plotIdsWithWorkOn>[0][number];

    it('plots with work on a day are the plots named by that day\'s records that are not deleted', () => {
        const logs = [log('2026-11-19', ['a', 'b']), log('2026-11-19', ['b', 'c']), log('2026-11-19', ['d'], { deletion: { at: 'x' } }), log('2026-11-20', ['e'])];
        expect([...plotIdsWithWorkOn(logs, '2026-11-19')].sort()).toEqual(['a', 'b', 'c']);
        expect([...plotIdsWithWorkOn(logs, '2026-11-20')]).toEqual(['e']);
        expect(plotIdsWithWorkOn(logs, '2026-11-18').size).toBe(0);
    });

    it('a record with no plot (the whole farm) names no plot', () => {
        expect(plotIdsWithWorkOn([{ date: 'd', context: { selection: [{ cropId: 'FARM_GLOBAL' }] } } as never], 'd').size).toBe(0);
        expect(plotIdsWithWorkOn([{ date: 'd' } as never], 'd').size).toBe(0);
    });

    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

    it('"कालचेच" is the plots that had work yesterday and "आज बाकी" those with nothing today, each with its real count in Marathi digits', () => {
        const q = buildQuickButtons({ plotIds: ids, kinds: ['yesterday', 'todayLeft'], language: 'mr',
            facts: { yesterday: new Set(['p3', 'p4', 'p7', 'zzz']), today: new Set(['p1', 'p2']) } });
        expect(q.map(b => b.id)).toEqual(['yesterday', 'todayLeft']);
        expect(q[0]).toMatchObject({ label: 'कालचेच ३', plotIds: ['p3', 'p4', 'p7'] }); // 'zzz' is another crop's plot: not counted
        expect(q[1]).toMatchObject({ label: 'आज बाकी ६', plotIds: ['p3', 'p4', 'p5', 'p6', 'p7', 'p8'] });
    });

    it('"आज सांगितलेले" is the plots told today', () => {
        const q = buildQuickButtons({ plotIds: ids, kinds: ['toldToday', 'todayLeft'], language: 'mr', facts: { yesterday: null, today: new Set(['p1', 'p2', 'p3']) } });
        expect(q.map(b => b.label)).toEqual(['आज सांगितलेले ३', 'आज बाकी ५']);
    });

    it('a button whose count is ० is not drawn (nothing told yesterday, everything told today)', () => {
        const q = buildQuickButtons({ plotIds: ids, kinds: ['yesterday', 'todayLeft', 'toldToday'], language: 'mr', facts: { yesterday: new Set<string>(), today: new Set(ids) } });
        expect(q.map(b => b.id)).toEqual(['toldToday']);
    });

    it('a fact the phone could not read draws no button that needs it', () => {
        expect(buildQuickButtons({ plotIds: ids, kinds: ['yesterday', 'todayLeft', 'toldToday'], language: 'mr', facts: null })).toEqual([]);
        expect(buildQuickButtons({ plotIds: ids, kinds: ['yesterday', 'todayLeft'], language: 'mr', facts: { yesterday: new Set(['p1']), today: null } }).map(b => b.id)).toEqual(['yesterday']);
    });

    it('the English twin says the same things with Latin digits', () => {
        const q = buildQuickButtons({ plotIds: ids, kinds: ['yesterday'], language: 'en', facts: { yesterday: new Set(['p1']), today: null } });
        expect(q[0].label).toBe('Same as yesterday 1');
    });
});

describe('choosing', () => {
    it('toggleId adds a plot last and takes a chosen one off', () => {
        expect(toggleId(['a'], 'b')).toEqual(['a', 'b']);
        expect(toggleId(['a', 'b'], 'a')).toEqual(['b']);
    });

    it('the "सगळे" toggle chooses all, and clears all when all are chosen and clearing is allowed', () => {
        expect(afterAllToggle(['a', 'b', 'c'], ['a'], true)).toEqual(['a', 'b', 'c']);
        expect(afterAllToggle(['a', 'b', 'c'], ['a', 'b', 'c'], true)).toEqual([]);
        // a page that is never empty keeps all chosen
        expect(afterAllToggle(['a', 'b', 'c'], ['a', 'b', 'c'], false)).toEqual(['a', 'b', 'c']);
    });

    it('allChosen is false for no plots at all; sameSet ignores order', () => {
        expect(allChosen([], [])).toBe(false);
        expect(allChosen(['a', 'b'], ['b', 'a', 'z'])).toBe(true);
        expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
        expect(sameSet(['a'], ['a', 'b'])).toBe(false);
    });
});
