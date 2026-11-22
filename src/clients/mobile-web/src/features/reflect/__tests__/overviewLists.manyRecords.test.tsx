// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a; founder pick D-175 = A, 2026-11-22: "the lists at the bottom, as drawn")
 *
 * Two lists that grew with the farm, capped and made honest:
 *  - कामाचं कॅलेंडर: a week row draws its first 4 chips and then "+८ नोंदी"; a record that names several plots says "१५ प्लॉट" instead of
 *    naming only its first plot (`calendarModel` reads the count).
 *  - उत्पन्न आणि खर्च, "प्लॉटनुसार": the first 5 bars, then "आणखी ९ दाखवा"; the "सर्वात जास्त खर्च" line still looks at ALL the bars.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => {
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => k });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import { ActivityCalendar } from '../overview/ActivityCalendar';
import { buildCalendarDay, type CalendarChip, type CalendarDay } from '../overview/calendarModel';
import { CostSection } from '../overview/CostSection';
import { buildSeasonTotals, buildSpend, spendRange, type Ledger } from '../overview/moneyModel';
import { selectAll, toViewScope } from '../overview/reflectSelection';
import { TODAY, TODAY_KEY, crop, log, plot } from './reflectFixtures';

beforeEach(() => { lang.value = 'mr'; });
afterEach(cleanup);

// ── the calendar ──────────────────────────────────────────────────────────────────────────────────────

const chip = (i: number, over: Partial<CalendarChip> = {}): CalendarChip => ({ logId: `c${i}`, color: 'bg-green-500', plotLabel: `G${i}`, plotIndex: i - 1, activity: 'फवारणी', plotCount: 1, ...over });
const dayWith = (chips: CalendarChip[], over: Partial<CalendarDay> = {}): CalendarDay => ({
    key: TODAY_KEY, date: TODAY, offset: 0, isToday: true, farmWide: false, chips, cropColors: ['bg-green-500'], rainy: false, due: [], empty: chips.length === 0, ...over,
});
const draw = (day: CalendarDay, onDate = vi.fn()) => {
    render(<ActivityCalendar date={TODAY} onDate={onDate} mode="week" onMode={vi.fn()} view={TODAY} onView={vi.fn()} dayOf={() => day} legendCrops={[]} />);
    return onDate;
};
const chipsDrawn = () => document.querySelectorAll('[data-testid^="cal-chip-"]').length;

describe('a calendar day row draws its first 4 chips, then "+N नोंदी"', () => {
    it('12 records: 4 chips and "+८ नोंदी" on every day row (the same stub for all seven days)', () => {
        draw(dayWith(Array.from({ length: 12 }, (_, i) => chip(i + 1))));
        // seven day rows, each the same stub: 4 chips and one "+८ नोंदी" apiece
        expect(chipsDrawn()).toBe(7 * 4);
        expect(screen.getAllByTestId(`cal-more-${TODAY_KEY}`)).toHaveLength(7);
        expect(screen.getAllByTestId(`cal-more-${TODAY_KEY}`)[0]).toHaveTextContent('+८ नोंदी');
    });

    it('the first four records are the ones drawn, in order', () => {
        draw(dayWith(Array.from({ length: 6 }, (_, i) => chip(i + 1))));
        const row = screen.getAllByTestId(`cal-day-${TODAY_KEY}`)[0];
        const drawn = [...row.querySelectorAll('[data-testid^="cal-chip-"]')].map(el => el.getAttribute('data-testid'));
        expect(drawn).toEqual(['cal-chip-c1', 'cal-chip-c2', 'cal-chip-c3', 'cal-chip-c4']);
        expect(within(row).getByTestId(`cal-more-${TODAY_KEY}`)).toHaveTextContent('+२ नोंदी');
    });

    it('exactly 4 records: all drawn and no "+N"; 5 records: "+१ नोंदी"', () => {
        const { unmount } = render(<ActivityCalendar date={TODAY} onDate={vi.fn()} mode="week" onMode={vi.fn()} view={TODAY} onView={vi.fn()}
            dayOf={() => dayWith(Array.from({ length: 4 }, (_, i) => chip(i + 1)))} legendCrops={[]} />);
        expect(screen.queryByTestId(`cal-more-${TODAY_KEY}`)).toBeNull();
        unmount();
        render(<ActivityCalendar date={TODAY} onDate={vi.fn()} mode="week" onMode={vi.fn()} view={TODAY} onView={vi.fn()}
            dayOf={() => dayWith(Array.from({ length: 5 }, (_, i) => chip(i + 1)))} legendCrops={[]} />);
        expect(screen.getAllByTestId(`cal-more-${TODAY_KEY}`)[0]).toHaveTextContent('+१ नोंदी');
    });

    it('the row stays the one tap that shows that day above: a tap on "+८ नोंदी" selects the day', () => {
        const onDate = draw(dayWith(Array.from({ length: 12 }, (_, i) => chip(i + 1))));
        fireEvent.click(screen.getAllByTestId(`cal-more-${TODAY_KEY}`)[0]);
        expect(onDate).toHaveBeenCalledTimes(1);
    });

    it('the English twin: "+8 records"', () => {
        lang.value = 'en';
        draw(dayWith(Array.from({ length: 12 }, (_, i) => chip(i + 1))));
        expect(screen.getAllByTestId(`cal-more-${TODAY_KEY}`)[0]).toHaveTextContent('+8 records');
    });

    it('a stopped day draws no chips and no "+N" (it is one amber line, as before)', () => {
        draw(dayWith(Array.from({ length: 12 }, (_, i) => chip(i + 1)), { blocked: { groupLabel: 'हवामान', reason: 'पाऊस' } }));
        expect(chipsDrawn()).toBe(0);
        expect(screen.queryByTestId(`cal-more-${TODAY_KEY}`)).toBeNull();
    });
});

describe('a record that names several plots says how many', () => {
    it('"१५ प्लॉट" instead of the first plot\'s name, and no plot-number badge (there is no one plot to number)', () => {
        draw(dayWith([chip(1, { plotLabel: 'G1', plotIndex: 0, plotCount: 15 })]));
        const c = screen.getAllByTestId('cal-chip-c1')[0];
        expect(c).toHaveTextContent('१५ प्लॉट');
        expect(c).not.toHaveTextContent('G1');
        expect(c).toHaveTextContent('फवारणी');
    });

    it('one plot: nothing changes - the plot\'s name and its number badge', () => {
        draw(dayWith([chip(1, { plotLabel: 'G1', plotIndex: 0, plotCount: 1 })]));
        const c = screen.getAllByTestId('cal-chip-c1')[0];
        expect(c).toHaveTextContent('G1');
        expect(c).not.toHaveTextContent('प्लॉट');
    });

    it('a record with no plot named (a whole crop) keeps what it showed (the crop\'s name)', () => {
        draw(dayWith([chip(1, { plotLabel: 'द्राक्ष', plotIndex: undefined, plotCount: 0 })]));
        expect(screen.getAllByTestId('cal-chip-c1')[0]).toHaveTextContent('द्राक्ष');
    });

    it('the English twin: "15 plots"', () => {
        lang.value = 'en';
        draw(dayWith([chip(1, { plotCount: 15 })]));
        expect(screen.getAllByTestId('cal-chip-c1')[0]).toHaveTextContent('15 plots');
    });
});

describe('calendarModel counts the plots a record names', () => {
    const GRAPES = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', Array.from({ length: 20 }, (_, i) => plot(`g${i + 1}`, `द्राक्ष G${i + 1}`)));
    const CANE = crop('cane', 'ऊस', 'Sugarcane', 'bg-pink-500', [plot('c1', 'ऊस S1'), plot('c2', 'ऊस S2')]);
    const crops = [GRAPES, CANE];
    const scope = toViewScope(crops, selectAll(crops));
    const dayOf = (history: ReturnType<typeof log>[]) => buildCalendarDay({ date: TODAY, history, crops, scope, dueTasks: [], today: TODAY });

    it('a spraying told for 15 plots is one chip with a count of 15 (its label is still the first plot, the count is what the chip says)', () => {
        const ids = Array.from({ length: 15 }, (_, i) => `g${i + 1}`);
        const day = dayOf([log({ id: 'spray', plotIds: ids, inputs: [{ id: 'i', type: 'pesticide' }] as never })]);
        expect(day.chips).toHaveLength(1);
        expect(day.chips[0].plotCount).toBe(15);
        expect(day.chips[0].plotLabel).toBe('द्राक्ष G1');
    });

    it('one plot is a count of 1; a record of a crop that has no plots at all is a count of 0 (it keeps showing the name of the crop)', () => {
        const bare = crop('onion', 'कांदा', 'Onion', 'bg-amber-500', []);
        const withBare = [GRAPES, CANE, bare];
        const bareScope = toViewScope(withBare, selectAll(withBare));
        const day = buildCalendarDay({ date: TODAY, history: [log({ id: 'one', plotIds: ['g3'] }), log({ id: 'none', cropId: 'onion', plotIds: [] })], crops: withBare, scope: bareScope, dueTasks: [], today: TODAY });
        expect(day.chips.find(c => c.logId === 'one')?.plotCount).toBe(1);
        expect(day.chips.find(c => c.logId === 'none')?.plotCount).toBe(0);
        expect(day.chips.find(c => c.logId === 'none')?.plotLabel).toBe('कांदा');
    });

    it('a record that names plots of two crops counts them all', () => {
        const day = dayOf([{ ...log({ id: 'two', plotIds: ['g1', 'g2', 'g3'] }), context: { selection: [
            { cropId: 'grape', cropName: 'grape', selectedPlotIds: ['g1', 'g2', 'g3'], selectedPlotNames: ['g1', 'g2', 'g3'] },
            { cropId: 'cane', cropName: 'cane', selectedPlotIds: ['c1', 'c2'], selectedPlotNames: ['c1', 'c2'] },
        ] } } as never]);
        expect(day.chips[0].plotCount).toBe(5);
    });

    it('the same plot named twice is counted once', () => {
        const day = dayOf([log({ id: 'dup', plotIds: ['g1', 'g1', 'g2'] })]);
        expect(day.chips[0].plotCount).toBe(2);
    });
});

// ── the money by plot ─────────────────────────────────────────────────────────────────────────────────

describe('उत्पन्न आणि खर्च "प्लॉटनुसार": the first 5 bars, then "आणखी N दाखवा"', () => {
    const PLOTS = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', Array.from({ length: 14 }, (_, i) => plot(`g${i + 1}`, `द्राक्ष G${i + 1}`)));
    const crops = [PLOTS];
    const scope = toViewScope(crops, selectAll(crops));
    const range = spendRange('week', TODAY, TODAY);
    // 100 rupees for G1 .. G13, and G14 (the last bar, never among the first five) the biggest spender
    const ledger: Ledger = {
        entries: PLOTS.plots.map((p, i) => ({ id: `e${i}`, plotId: p.id, dateKey: TODAY_KEY, direction: 'Expense' as const, category: 'Labour' as const, amount: p.id === 'g14' ? 9000 : 100 + i })),
        gaps: [],
        complete: true,
    };
    const open = () => {
        render(<CostSection totals={buildSeasonTotals(ledger, crops, scope, () => [], true)} spend={buildSpend(ledger, crops, scope, range, true)} range={range} />);
        fireEvent.click(screen.getByTestId('cost-view-plot'));
    };

    it('14 plots: 5 bars and "आणखी ९ दाखवा"; a tap draws all 14 and the button goes', () => {
        open();
        expect(screen.getByTestId('cost-bars-plot').children.length).toBe(5);
        const more = screen.getByTestId('cost-bars-more');
        expect(more).toHaveTextContent('आणखी ९ दाखवा');
        expect(more.className).toContain('min-h-[44px]');
        fireEvent.click(more);
        expect(screen.getByTestId('cost-bars-plot').children.length).toBe(14);
        expect(screen.queryByTestId('cost-bars-more')).toBeNull();
    });

    it('the bars are drawn in the order the app already draws them (the farm\'s plot order), not re-sorted', () => {
        open();
        const labels = [...screen.getByTestId('cost-bars-plot').children].map(el => el.querySelector('span')?.textContent);
        expect(labels).toEqual(['द्राक्ष G1', 'द्राक्ष G2', 'द्राक्ष G3', 'द्राक्ष G4', 'द्राक्ष G5']);
    });

    it('"सर्वात जास्त खर्च" still looks at ALL the bars: it names G14 although G14 is not among the five drawn', () => {
        open();
        expect(screen.queryByText('द्राक्ष G14', { selector: 'span.truncate' })).toBeNull();
        expect(screen.getByTestId('cost-top')).toHaveTextContent('द्राक्ष G14');
    });

    it('5 plots or fewer: every bar and no button', () => {
        const few = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', Array.from({ length: 5 }, (_, i) => plot(`g${i + 1}`, `द्राक्ष G${i + 1}`)));
        const fewScope = toViewScope([few], selectAll([few]));
        render(<CostSection totals={buildSeasonTotals(ledger, [few], fewScope, () => [], true)} spend={buildSpend(ledger, [few], fewScope, range, true)} range={range} />);
        fireEvent.click(screen.getByTestId('cost-view-plot'));
        expect(screen.getByTestId('cost-bars-plot').children.length).toBe(5);
        expect(screen.queryByTestId('cost-bars-more')).toBeNull();
    });

    it('the crop view is not capped (a farm has a few crops)', () => {
        open();
        fireEvent.click(screen.getByTestId('cost-view-crop'));
        expect(screen.queryByTestId('cost-bars-more')).toBeNull();
    });

    it('the English twin: "Show 9 more"', () => {
        lang.value = 'en';
        open();
        expect(screen.getByTestId('cost-bars-more')).toHaveTextContent('Show 9 more');
    });
});
