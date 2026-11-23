// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a; founder pick D-173 = A, 2026-11-22: "fold crops, problems first, six at a time")
 *
 * The overview's plot cards when the page holds MORE THAN 15 plots: each crop group folds behind a 44 px arrow (its header and counts stay), a crop
 * that holds a problem opens by itself, and so does a crop that is alone on the page; inside an open crop the cards come in the order of need
 * (अडचण, then बाकी, then सांगितले), the first 6 are drawn (every problem card always, never hidden) and "आणखी N दाखवा" draws the rest. The tags follow
 * the day card's rule: "सांगितले" is every plot with a record (the problem plots included), "अडचण" is drawn first as a flag. 15 plots or fewer
 * draw exactly what they drew before.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import { buildPlotDayCard } from '../overview/plotDayModel';
import { PlotDayCards } from '../overview/PlotDayCards';
import { plotRefsInScope, selectAll, toViewScope, type ReflectSelection } from '../overview/reflectSelection';
import type { CropProfile } from '../../../types';
import { TODAY, TODAY_KEY, crop, log, plot } from './reflectFixtures';

const mk = (id: string, name: string, icon: string, color: string, letter: string, n: number) =>
    crop(id, name, icon, color, Array.from({ length: n }, (_, i) => plot(`${id}${i + 1}`, `${name} ${letter}${i + 1}`)));
/** 42 plots: grapes 20, cane 12, pomegranate 6, onion 4 (the design page's sample, scaled down). */
const GRAPES = mk('g', 'द्राक्ष', 'Grapes', 'bg-green-500', 'G', 20);
const CANE = mk('u', 'ऊस', 'Sugarcane', 'bg-pink-500', 'U', 12);
const POM = mk('p', 'डाळिंब', 'Pomegranate', 'bg-red-500', 'P', 6);
const ONION = mk('o', 'कांदा', 'Onion', 'bg-amber-500', 'O', 4);
const FARM = [GRAPES, CANE, POM, ONION];

const work = (id: string, plotId: string, cropId: string) =>
    log({ id, plotIds: [plotId], cropId, cropActivities: [{ id: `a-${id}`, title: 'काम' }] });
const stop = (id: string, plotId: string, cropId: string) =>
    log({ id, plotIds: [plotId], cropId, disturbance: { scope: 'FULL_DAY', group: 'WEATHER', reason: 'पाऊस', blockedSegments: [] } });

/**
 * grapes: g7 and g18 stopped (problems), g1..g6 told, the other 12 untold.
 * cane: nothing wrong (4 told). pomegranate and onion: nothing told.
 */
const HISTORY = [
    stop('s1', 'g7', 'g'), stop('s2', 'g18', 'g'),
    ...['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id, i) => work(`w${i}`, id, 'g')),
    ...['u1', 'u2', 'u3', 'u4'].map((id, i) => work(`c${i}`, id, 'u')),
];

const cardsOf = (crops: readonly CropProfile[] = FARM, sel: ReflectSelection = selectAll(crops), history = HISTORY) => {
    const scope = toViewScope(crops, sel);
    return plotRefsInScope(crops, scope).map(r => buildPlotDayCard(r, history, scope, TODAY_KEY, TODAY, undefined, lang.value));
};
const names = (cropId: string) => [...screen.getByTestId(`plot-small-cards-${cropId}`).children].map(c => c.querySelector('[data-part="name"]')?.textContent);
const visibleTags = (cropId: string) => [...document.querySelectorAll(`[data-testid^="plot-group-"][data-testid$="-${cropId}"]`)]
    .filter(el => /^plot-group-(told|problem|left)-/.test(el.getAttribute('data-testid') ?? ''))
    .map(el => el.getAttribute('data-testid')?.split('-')[2]);

beforeEach(() => { lang.value = 'mr'; });
afterEach(cleanup);

describe('more than 15 plots: crops fold, a crop with a problem opens itself', () => {
    it('every crop group of 4 or more plots has a 44 px arrow; the crop with a problem is open, the others are folded', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        for (const id of ['g', 'u', 'p', 'o']) {
            const arrow = screen.getByTestId(`plot-group-fold-${id}`);
            expect(arrow.className).toContain('h-11');
            expect(arrow.className).toContain('w-11');
        }
        expect(screen.getByTestId('plot-group-fold-g').getAttribute('aria-expanded')).toBe('true'); // g7 and g18 stopped
        expect(screen.getByTestId('plot-small-cards-g')).toBeTruthy();
        for (const id of ['u', 'p', 'o']) {
            expect(screen.getByTestId(`plot-group-fold-${id}`).getAttribute('aria-expanded')).toBe('false');
            expect(screen.queryByTestId(`plot-small-cards-${id}`)).toBeNull();
        }
    });

    it('a folded crop still shows its photo header and its counts, so the whole farm reads in a few lines', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        const header = screen.getByTestId('plot-group-header-u');
        expect(header.querySelector('img, svg')).toBeTruthy();
        expect(header).toHaveTextContent('ऊस');
        expect(header).toHaveTextContent('१२ प्लॉट');
        expect(screen.getByTestId('plot-group-told-u')).toHaveTextContent('४ सांगितले');
        expect(screen.getByTestId('plot-group-left-u')).toHaveTextContent('८ बाकी');
        expect(screen.queryByTestId('plot-group-problem-u')).toBeNull(); // a count of 0 is not drawn
    });

    it('the arrow opens a folded crop and folds an open one; the state is the farmer\'s own', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        fireEvent.click(screen.getByTestId('plot-group-fold-u'));
        expect(screen.getByTestId('plot-small-cards-u')).toBeTruthy();
        expect(screen.getByTestId('plot-group-fold-u').getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(screen.getByTestId('plot-group-fold-g')); // he folds the crop that opened itself
        expect(screen.queryByTestId('plot-small-cards-g')).toBeNull();
        expect(screen.getByTestId('plot-group-problem-g')).toBeTruthy(); // its counts stay
    });

    it('a crop that is alone on the page opens by itself', () => {
        const alone = [mk('g', 'द्राक्ष', 'Grapes', 'bg-green-500', 'G', 20)];
        render(<PlotDayCards cards={cardsOf(alone, selectAll(alone), [])} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-small-cards-g')).toBeTruthy();
        expect(screen.getByTestId('plot-group-fold-g').getAttribute('aria-expanded')).toBe('true');
    });

    // spec: plr-d10-founder-answers-2026-11-23 (C1 = B) — on a big farm every crop is grouped, a crop of 1 to 3 plots too.
    it('a crop with 1 to 3 plots is grouped too (founder C1 = B): its header, its arrow, its plots behind one tap', () => {
        const farm = [GRAPES, CANE, mk('o', 'कांदा', 'Onion', 'bg-amber-500', 'O', 2)];
        render(<PlotDayCards cards={cardsOf(farm, selectAll(farm), HISTORY)} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-group-header-o')).toBeTruthy();
        expect(screen.getByTestId('plot-group-fold-o').getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(screen.getByTestId('plot-group-fold-o'));
        expect(names('o')).toEqual(['O1', 'O2']);
    });
});

describe('15 plots or fewer: grouped by crop from 10 (founder C1 = B), nothing else changes', () => {
    it('15 plots: the crop\'s arrow (open: it holds a problem), every card in number order, no "आणखी" button, the old tags (a stopped plot is not counted as told)', () => {
        const fifteen = [mk('g', 'द्राक्ष', 'Grapes', 'bg-green-500', 'G', 10), mk('u', 'ऊस', 'Sugarcane', 'bg-pink-500', 'U', 5)];
        const hist = [stop('s1', 'g3', 'g'), work('w1', 'g1', 'g'), work('w2', 'g2', 'g')];
        render(<PlotDayCards cards={cardsOf(fifteen, selectAll(fifteen), hist)} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-group-fold-g').getAttribute('aria-expanded')).toBe('true');
        expect(names('g')).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10']);
        expect(screen.queryByTestId('plot-more-g')).toBeNull();
        expect(screen.getByTestId('plot-group-told-g')).toHaveTextContent('२ सांगितले');
        expect(visibleTags('g')).toEqual(['told', 'problem', 'left']);
    });

    it('a page narrowed to 9 plots out of 42 is not grouped (counted on what the page shows); 10 are, with no cap', () => {
        const nine: ReflectSelection = { crop: 'all', plotIds: ['g1', 'g2', 'g3', 'g4', 'g5', 'u1', 'u2', 'u3', 'u4'] };
        render(<PlotDayCards cards={cardsOf(FARM, nine)} isToday onOpen={vi.fn()} />);
        expect(screen.queryByTestId('plot-group-fold-g')).toBeNull();
        expect(names('g')).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
        cleanup();
        const ten: ReflectSelection = { crop: 'all', plotIds: ['g1', 'g2', 'g3', 'g4', 'g5', 'u1', 'u2', 'u3', 'u4', 'u5'] };
        render(<PlotDayCards cards={cardsOf(FARM, ten)} isToday onOpen={vi.fn()} />);
        fireEvent.click(screen.getByTestId('plot-group-fold-g'));
        expect(names('g')).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
        expect(screen.queryByTestId('plot-more-g')).toBeNull();
    });
});

describe('inside an open crop: the order of need, six at a time', () => {
    it('problems first, then the plots not yet told, then the told ones; each group in number order', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        fireEvent.click(screen.getByTestId('plot-more-g')); // all 20, to read the whole order
        expect(names('g')).toEqual([
            'G7', 'G18', // problems
            'G8', 'G9', 'G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16', 'G17', 'G19', 'G20', // left
            'G1', 'G2', 'G3', 'G4', 'G5', 'G6', // told
        ]);
    });

    it('draws the first 6 and a button "आणखी १४ दाखवा" for the rest; a tap draws all and the button goes', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        expect(names('g')).toEqual(['G7', 'G18', 'G8', 'G9', 'G10', 'G11']);
        const more = screen.getByTestId('plot-more-g');
        expect(more).toHaveTextContent('आणखी १४ दाखवा');
        expect(more.className).toContain('min-h-[44px]');
        fireEvent.click(more);
        expect(names('g').length).toBe(20);
        expect(screen.queryByTestId('plot-more-g')).toBeNull();
    });

    it('every problem card is always drawn, never hidden by the cap: 8 stopped plots give 8 cards and "आणखी १२ दाखवा"', () => {
        const eight = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'].map((id, i) => stop(`x${i}`, id, 'g'));
        render(<PlotDayCards cards={cardsOf(FARM, selectAll(FARM), eight)} isToday onOpen={vi.fn()} />);
        expect(names('g')).toEqual(['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']);
        expect(screen.getByTestId('plot-more-g')).toHaveTextContent('आणखी १२ दाखवा');
    });

    it('a crop whose cards all fit in 6 has no button', () => {
        const few = [mk('g', 'द्राक्ष', 'Grapes', 'bg-green-500', 'G', 6), mk('u', 'ऊस', 'Sugarcane', 'bg-pink-500', 'U', 12)];
        render(<PlotDayCards cards={cardsOf(few, selectAll(few), [stop('s', 'g1', 'g')])} isToday onOpen={vi.fn()} />);
        expect(names('g').length).toBe(6);
        expect(screen.queryByTestId('plot-more-g')).toBeNull();
    });

    it('a card still opens its plot\'s day, and a stopped plot reads "अडचण सांगितली"', () => {
        const onOpen = vi.fn();
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={onOpen} />);
        expect(screen.getByTestId('plot-status-g:g7')).toHaveTextContent('अडचण सांगितली');
        fireEvent.click(screen.getByTestId('plot-card-g:g7'));
        expect(onOpen).toHaveBeenCalledTimes(1);
        expect(onOpen.mock.calls[0][0].plotId).toBe('g7');
    });
});

describe('the tags follow the day card\'s rule', () => {
    it('"अडचण" first (as a flag with a warning-triangle shape), then "बाकी", then "सांगितले" - and सांगितले counts the stopped plots too (२ + ६ = ८)', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        expect(visibleTags('g')).toEqual(['problem', 'left', 'told']);
        expect(screen.getByTestId('plot-group-problem-g')).toHaveTextContent('२ अडचण');
        expect(screen.getByTestId('plot-group-left-g')).toHaveTextContent('१२ बाकी');
        expect(screen.getByTestId('plot-group-told-g')).toHaveTextContent('८ सांगितले');
        expect(screen.getByTestId('plot-group-problem-g').querySelector('svg[data-part="flag"]')).toBeTruthy();
        // colour is not the only signal: the flag is a shape, and the word is there
        expect(screen.getByTestId('plot-group-problem-g').textContent).toContain('अडचण');
    });

    it('a status with no plot is not drawn (a crop with nothing told: only "बाकी")', () => {
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        expect(visibleTags('o')).toEqual(['left']);
        expect(screen.getByTestId('plot-group-left-o')).toHaveTextContent('४ बाकी');
    });
});

describe('the English twin', () => {
    it('says the same things: "Show 14 more", and the arrow has a name for a screen reader', () => {
        lang.value = 'en';
        render(<PlotDayCards cards={cardsOf()} isToday onOpen={vi.fn()} />);
        expect(screen.getByTestId('plot-more-g')).toHaveTextContent('Show 14 more');
        expect(screen.getByTestId('plot-group-fold-g').getAttribute('aria-label')).toBeTruthy();
    });
});
