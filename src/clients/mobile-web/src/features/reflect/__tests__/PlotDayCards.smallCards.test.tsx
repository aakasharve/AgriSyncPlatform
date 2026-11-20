// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, founder pick overview C: "two small cards across", and his rule "if same
 * crop is more than 3 times it should only show one image")
 *
 * The overview's plot cards for a crop with 4 or more plots: its photo ONCE in a header, then two small cards across, each with the crop's
 * colour edge, the plot's name and number, ONE status in words and a small mic; a tap elsewhere opens the plot's day. A crop with 1 to 3
 * cards keeps today's full card with its photo.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import { buildPlotDayCard, withNextHint } from '../overview/plotDayModel';
import { PlotDayCards } from '../overview/PlotDayCards';
import { plotRefsInScope, selectAll, toViewScope } from '../overview/reflectSelection';
import { TODAY, TODAY_KEY, crop, log, plot } from './reflectFixtures';
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';

const GRAPES = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', Array.from({ length: 15 }, (_, i) => plot(`g${i + 1}`, `द्राक्ष G${i + 1}`)));
const CANE = crop('cane', 'ऊस', 'Sugarcane', 'bg-pink-500', [plot('c1', 'ऊस S1'), plot('c2', 'ऊस S2'), plot('c3', 'ऊस S3')]);
const FARM = [GRAPES, CANE];
const meta = (hhmm: string) => ({ createdAtISO: `2026-10-25T${hhmm}:00.000Z`, createdByOperatorId: 'op' });

/** g1 told twice, g2..g9 once, g13 a stoppage; the other five plots nothing. */
const HISTORY = [
    log({ id: 'a1', plotIds: ['g1'], meta: meta('03:00'), cropActivities: [{ id: 'x', title: 'छाटणी' }] }),
    log({ id: 'a2', plotIds: ['g1'], meta: meta('09:00'), cropActivities: [{ id: 'y', title: 'फवारणी' }] }),
    ...Array.from({ length: 8 }, (_, i) => log({ id: `b${i}`, plotIds: [`g${i + 2}`], meta: meta(`0${i + 1}:30`), cropActivities: [{ id: `z${i}`, title: 'काम' }] })),
    log({ id: 'st', plotIds: ['g13'], disturbance: { scope: 'FULL_DAY', group: 'WEATHER', reason: 'पाऊस', blockedSegments: [] } }),
];

const cardsOf = (crops = FARM, sel = selectAll(crops), history = HISTORY, hints: Record<string, string> = {}) => {
    const scope = toViewScope(crops, sel);
    return plotRefsInScope(crops, scope).map(r => withNextHint(buildPlotDayCard(r, history, scope, TODAY_KEY, TODAY, undefined, lang.value), hints[r.plotId ?? '']));
};
const part = (el: HTMLElement, name: string) => el.querySelector(`[data-part="${name}"]`);

beforeEach(() => { lang.value = 'mr'; });
afterEach(cleanup);

describe('a crop with 15 plots: the photo once, two small cards across', () => {
    it('one header with the crop photo; 15 small cards, none with a photo banner of its own; the 3-plot crop keeps full cards with their photo', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        const group = screen.getByTestId('plot-group-grape');
        expect(group).toHaveAttribute('data-small', 'yes');
        expect(screen.getByTestId('plot-group-header-grape').querySelector('img, svg')).toBeTruthy();
        expect(screen.getByTestId('plot-group-header-grape')).toHaveTextContent('द्राक्ष');
        expect(screen.getByTestId('plot-group-header-grape')).toHaveTextContent('१५ प्लॉट');
        const grid = screen.getByTestId('plot-small-cards-grape');
        expect(grid.className).toContain('grid-cols-2');
        expect(grid.children.length).toBe(15);
        expect(group.querySelectorAll('[data-part="banner"]').length).toBe(0);
        expect(group.querySelectorAll('img').length + group.querySelectorAll('svg[data-part="banner"]').length).toBeLessThanOrEqual(1); // only the header's photo
        // cane has 3 plots: today's full cards, each with its banner photo, no group header
        expect(screen.queryByTestId('plot-group-cane')).toBeNull();
        for (const id of ['cane:c1', 'cane:c2', 'cane:c3']) expect(part(screen.getByTestId(`plot-card-${id}`), 'banner')).toBeTruthy();
    });

    it('a small card carries the crop\'s colour edge, the plot\'s name without the crop word, its number in Devanagari digits, and nothing else but one status', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        const card = screen.getByTestId('plot-card-grape:g7');
        expect(part(card, 'edge')?.className).toContain('bg-green-500');
        expect(part(card, 'name')).toHaveTextContent('G7');
        expect(card.textContent).not.toContain('द्राक्ष');
        expect(part(card, 'number')?.textContent).toBe('७');
        expect(card.querySelectorAll('[data-testid^="plot-status-"]').length).toBe(1);
        // no chips, no money, no water: the day view holds them
        expect(card.querySelector('[data-kind]')).toBeNull();
    });

    it('ONE status in words from what the card holds: how many times told, a stoppage told, or nothing yet', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-status-grape:g1')).toHaveTextContent('आज २ वेळा सांगितलं');
        expect(screen.getByTestId('plot-status-grape:g1')).toHaveAttribute('data-status', 'told');
        expect(screen.getByTestId('plot-status-grape:g2')).toHaveAttribute('data-status', 'told');
        expect(screen.getByTestId('plot-status-grape:g13')).toHaveTextContent('अडचण सांगितली');
        expect(screen.getByTestId('plot-status-grape:g13')).toHaveAttribute('data-status', 'problem');
        expect(screen.getByTestId('plot-status-grape:g10')).toHaveTextContent('आज अजून काही सांगितलं नाही');
        expect(screen.getByTestId('plot-status-grape:g10')).toHaveAttribute('data-status', 'left');
        // never a "late" word: the overview has no such fact
        expect(document.body.textContent).not.toMatch(/उशीर/);
    });

    it('the header counts the plots by status, with true counts only, in Devanagari digits', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-group-told-grape')).toHaveTextContent('९ सांगितले');
        expect(screen.getByTestId('plot-group-problem-grape')).toHaveTextContent('१ अडचण');
        expect(screen.getByTestId('plot-group-left-grape')).toHaveTextContent('५ बाकी');
    });

    it('a status with no plot is not drawn in the header (everything told: only "सांगितले")', () => {
        const told = Array.from({ length: 15 }, (_, i) => log({ id: `t${i}`, plotIds: [`g${i + 1}`], cropActivities: [{ id: `q${i}`, title: 'काम' }] }));
        render(<PlotDayCards cards={cardsOf(FARM, selectAll(FARM), told)} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-group-told-grape')).toHaveTextContent('१५ सांगितले');
        expect(screen.queryByTestId('plot-group-problem-grape')).toBeNull();
        expect(screen.queryByTestId('plot-group-left-grape')).toBeNull();
    });

    it('the cards stay in the plot-number order, so a plot is always in the same place', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        const names = [...screen.getByTestId('plot-small-cards-grape').children].map(c => part(c as HTMLElement, 'number')?.textContent);
        expect(names).toEqual(['१', '२', '३', '४', '५', '६', '७', '८', '९', '१०', '११', '१२', '१३', '१४', '१५']);
    });
});

describe('natural number order (G2 before G10)', () => {
    it('small cards and full cards are listed in number order whatever order the plots were stored in; a small card\'s number is its place in that order', () => {
        const names = ['G10', 'G2', 'G1', 'G11', 'G3', 'G4'];
        const scrambled = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', names.map((g, i) => plot(`s${i}`, `द्राक्ष ${g}`)));
        const small = render(<PlotDayCards cards={cardsOf([scrambled], selectAll([scrambled]), [])} isToday onOpen={vi.fn()} />);
        const listed = [...screen.getByTestId('plot-small-cards-grape').children].map(c => part(c as HTMLElement, 'name')?.textContent);
        expect(listed).toEqual(['G1', 'G2', 'G3', 'G4', 'G10', 'G11']);
        const numbers = [...screen.getByTestId('plot-small-cards-grape').children].map(c => part(c as HTMLElement, 'number')?.textContent);
        expect(numbers).toEqual(['१', '२', '३', '४', '५', '६']); // listed order, numbered in that order (G1 is stored third but reads १)
        expect(part(screen.getByTestId('plot-card-grape:s2'), 'number')?.textContent).toBe('१');
        small.unmount();
        // three cards: full cards, the same order
        const few = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', ['G10', 'G2', 'G1'].map((g, i) => plot(`f${i}`, `द्राक्ष ${g}`)));
        render(<PlotDayCards cards={cardsOf([few], selectAll([few]), [])} isToday onOpen={vi.fn()} />);
        const full = screen.getAllByTestId(/^plot-card-grape:/).map(c => c.getAttribute('data-testid'));
        expect(full).toEqual(['plot-card-grape:f2', 'plot-card-grape:f1', 'plot-card-grape:f0']);
    });

    it('15 plots stored in a scrambled order: every small card reads G<n> with the number n, two-digit ones included (the CTO\'s "G3 १४" case)', () => {
        const order = [3, 4, 7, 14, 1, 9, 12, 2, 15, 5, 11, 6, 13, 10, 8];
        const scrambled = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', order.map(n => plot(`h${n}`, `द्राक्ष G${n}`)));
        render(<PlotDayCards cards={cardsOf([scrambled], selectAll([scrambled]), [])} isToday onOpen={vi.fn()} />);
        for (let n = 1; n <= 15; n += 1) {
            const card = screen.getByTestId(`plot-card-grape:h${n}`);
            expect(part(card, 'name')).toHaveTextContent(`G${n}`);
            expect(part(card, 'number')?.textContent).toBe(toDevanagariDigits(String(n)));
        }
    });

    it('the number is the plot\'s place among ALL the crop\'s plots, not among the cards in view: narrowed to G3 and G14, they still read ३ and १४', () => {
        const order = [3, 4, 7, 14, 1, 9, 12, 2, 15, 5, 11, 6, 13, 10, 8];
        const scrambled = crop('grape', 'द्राक्ष', 'Grapes', 'bg-green-500', order.map(n => plot(`h${n}`, `द्राक्ष G${n}`)));
        // four cards in view (the small look starts at 4): G3, G14, G2, G10
        const sel = { crop: 'grape', plotIds: ['h3', 'h14', 'h2', 'h10'] };
        render(<PlotDayCards cards={cardsOf([scrambled], sel, [])} isToday onOpen={vi.fn()} />);
        const numbers = [...screen.getByTestId('plot-small-cards-grape').children].map(c => part(c as HTMLElement, 'number')?.textContent);
        expect(numbers).toEqual(['२', '३', '१०', '१४']);
    });
});

describe('taps', () => {
    it('a tap on the card opens that plot\'s day; the small mic opens the mic for that plot and does not open the day', () => {
        const onOpen = vi.fn();
        const onTell = vi.fn();
        render(<PlotDayCards cards={cardsOf(FARM, selectAll(FARM), HISTORY, { g7: 'अजून खतं सांगा' })} isToday onOpen={onOpen} onTell={onTell} />);
        fireEvent.click(screen.getByTestId('plot-card-grape:g3'));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onOpen.mock.calls[0][0].plotId).toBe('g3');
        const mic = screen.getByTestId('plot-hint-speak-grape:g7');
        expect(mic.className).toMatch(/h-11 w-11/); // a 44 px target
        fireEvent.click(mic);
        expect(onTell).toHaveBeenCalledTimes(1);
        expect(onTell.mock.calls[0][0].plotId).toBe('g7');
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('the mic is drawn only where the full card would show "अजून सांगा" AND a way to speak exists: never a mic that leads nowhere', () => {
        const hints = { g7: 'अजून खतं सांगा' };
        const { unmount } = render(<PlotDayCards cards={cardsOf(FARM, selectAll(FARM), HISTORY, hints)} isToday onOpen={vi.fn()} onTell={vi.fn()} />);
        expect(screen.getAllByTestId(/^plot-hint-speak-/)).toHaveLength(1);
        expect(screen.queryByTestId('plot-hint-speak-grape:g8')).toBeNull();
        unmount();
        render(<PlotDayCards cards={cardsOf(FARM, selectAll(FARM), HISTORY, hints)} isToday onOpen={vi.fn()} />);
        expect(screen.queryAllByTestId(/^plot-hint-speak-/)).toHaveLength(0);
    });

    it('a plot with nothing told takes no hint (the empty plot is not made to look half done)', () => {
        render(<PlotDayCards cards={cardsOf(FARM, selectAll(FARM), HISTORY, { g10: 'सांगा' })} isToday onOpen={vi.fn()} onTell={vi.fn()} />);
        expect(screen.queryByTestId('plot-hint-speak-grape:g10')).toBeNull();
    });

    it('Enter on a focused small card opens the day, as the full card does', () => {
        const onOpen = vi.fn();
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={onOpen} />);
        fireEvent.keyDown(screen.getByTestId('plot-card-grape:g5'), { key: 'Enter' });
        expect(onOpen).toHaveBeenCalledTimes(1);
    });
});

describe('the number of cards drawn decides, not the crop\'s size', () => {
    it('narrowed to 3 of the 15 plots the crop shows 3 full cards with their photo (the photo would repeat only 3 times)', () => {
        const three = cardsOf(FARM, { crop: 'grape', plotIds: ['g2', 'g5', 'g9'] });
        render(<PlotDayCards cards={three} isToday onOpen={vi.fn()} />);
        expect(screen.queryByTestId('plot-group-grape')).toBeNull();
        for (const id of ['g2', 'g5', 'g9']) expect(part(screen.getByTestId(`plot-card-grape:${id}`), 'banner')).toBeTruthy();
    });

    it('narrowed to 4 of the 15 plots the crop is a header and 4 small cards', () => {
        const four = cardsOf(FARM, { crop: 'grape', plotIds: ['g2', 'g5', 'g9', 'g11'] });
        render(<PlotDayCards cards={four} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-small-cards-grape').children.length).toBe(4);
        expect(within(screen.getByTestId('plot-group-grape')).queryAllByTestId(/^plot-card-/)).toHaveLength(4);
        // the header counts the plots on screen (4), not the crop's 15
        expect(screen.getByTestId('plot-group-header-grape')).toHaveTextContent('४ प्लॉट');
    });

    it('two big crops get two headers, each with its own photo', () => {
        const caneBig = crop('cane', 'ऊस', 'Sugarcane', 'bg-pink-500', Array.from({ length: 6 }, (_, i) => plot(`c${i + 1}`, `ऊस S${i + 1}`)));
        render(<PlotDayCards cards={cardsOf([GRAPES, caneBig])} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-group-header-grape')).toBeTruthy();
        expect(screen.getByTestId('plot-group-header-cane')).toBeTruthy();
        expect(part(screen.getByTestId('plot-card-cane:c3'), 'edge')?.className).toContain('bg-pink-500');
        expect(screen.getByTestId('plot-small-cards-cane').children.length).toBe(6);
    });

    it('a crop with no plot yet keeps its one card', () => {
        const bare = crop('onion', 'कांदा', 'Onion', 'bg-amber-500', []);
        render(<PlotDayCards cards={cardsOf([GRAPES, bare])} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-card-onion')).toBeTruthy();
        expect(screen.getByTestId('plot-small-cards-grape').children.length).toBe(15);
    });
});

describe('English', () => {
    it('the same cards say their status in English with Latin digits', () => {
        lang.value = 'en';
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-group-told-grape')).toHaveTextContent('9 told');
        expect(screen.getByTestId('plot-group-problem-grape')).toHaveTextContent('1 problem');
        expect(screen.getByTestId('plot-group-left-grape')).toHaveTextContent('5 left');
        expect(screen.getByTestId('plot-status-grape:g13')).toHaveTextContent('A problem was reported');
        expect(part(screen.getByTestId('plot-card-grape:g7'), 'number')?.textContent).toBe('7');
    });
});
