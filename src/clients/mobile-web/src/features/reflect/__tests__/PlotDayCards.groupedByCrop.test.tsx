// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-founder-answers-2026-11-23 — founder C1 = B: "A farm with many plots (ABK has 15): plots grouped by crop (Grapes,
 * Pomegranate, Sugarcane, Onion); tap a crop to open its plots. Small farms (Arve 2, Ronge 4) look the same either way. B once a
 * farm has 10 or more plots." And his principle (ABK, Ronge): the screens must NOT get more complicated for bigger farms — the only
 * difference on a big farm is the grouping.
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
import { plotRefsInScope, selectAll, toViewScope } from '../overview/reflectSelection';
import { GROUP_BY_CROP_FROM, groupsByCrop } from '../../context/components/plotSelectorRules';
import type { CropProfile } from '../../../types';
import { TODAY, TODAY_KEY, crop, plot } from './reflectFixtures';

const mk = (id: string, name: string, icon: string, color: string, letter: string, n: number) =>
    crop(id, name, icon, color, Array.from({ length: n }, (_, i) => plot(`${id}${i + 1}`, `${name} ${letter}${i + 1}`)));
const grapes = (n: number) => mk('g', 'द्राक्ष', 'Grapes', 'bg-green-500', 'G', n);
const pom = (n: number) => mk('p', 'डाळिंब', 'Pomegranate', 'bg-red-500', 'P', n);
const cane = (n: number) => mk('s', 'ऊस', 'Sugarcane', 'bg-pink-500', 'S', n);
const onion = (n: number) => mk('o', 'कांदा', 'Onion', 'bg-amber-500', 'O', n);

/** Arve: 2 plots of one crop. Ronge: 4 plots over 2 crops. ABK: 15 plots over 4 crops. */
const ARVE = [grapes(2)];
const RONGE = [grapes(2), pom(2)];
const ABK = [grapes(6), pom(4), cane(3), onion(2)];

const cardsOf = (crops: readonly CropProfile[]) => {
    const scope = toViewScope(crops, selectAll(crops));
    return plotRefsInScope(crops, scope).map(r => buildPlotDayCard(r, [], scope, TODAY_KEY, TODAY, undefined, lang.value));
};
const draw = (crops: readonly CropProfile[]) => render(<PlotDayCards cards={cardsOf(crops)} isToday onOpen={vi.fn()} />);
const plotCount = (crops: readonly CropProfile[]) => crops.reduce((n, c) => n + c.plots.length, 0);
/** Every plot card on screen, full or small (the same card a 4-plot crop draws today). */
const plotCardsShown = () => document.querySelectorAll('[data-testid^="plot-card-"]:not([data-testid="plot-card-farm"])').length;
const foldArrows = () => [...document.querySelectorAll('[data-testid^="plot-group-fold-"]')];
/** Controls that are neither a card, a crop's fold arrow nor "आणखी N दाखवा": a big farm must add none. */
const otherControls = () => [...screen.getByTestId('plot-day-cards').querySelectorAll('button, input, [role="button"]')]
    .filter(el => !/^plot-(card|group-fold|more|hint-speak)-/.test(el.getAttribute('data-testid') ?? ''));

beforeEach(() => { lang.value = 'mr'; });
afterEach(cleanup);

describe('founder C1 = B: plots grouped by crop from 10 plots', () => {
    it('PlotsGroupedByCrop_AtTenOrMore', () => {
        expect(GROUP_BY_CROP_FROM).toBe(10);
        expect(groupsByCrop(9)).toBe(false);
        expect(groupsByCrop(10)).toBe(true);

        // 15 plots over 4 crops: every crop is a group with its photo once in the header — the small crops too — and folded.
        draw(ABK);
        for (const id of ['g', 'p', 's', 'o']) {
            expect(screen.getByTestId(`plot-group-header-${id}`)).toBeInTheDocument();
            expect(screen.getByTestId(`plot-group-fold-${id}`).getAttribute('aria-expanded')).toBe('false');
            expect(screen.queryByTestId(`plot-small-cards-${id}`)).toBeNull();
        }
        // Tap a crop: its plots open.
        fireEvent.click(screen.getByTestId('plot-group-fold-s'));
        expect(screen.getByTestId('plot-group-fold-s').getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('plot-small-cards-s').children).toHaveLength(3);
        cleanup();

        // Exactly 10 plots: grouped. 9 plots: as today (no fold anywhere).
        draw([grapes(4), pom(3), cane(2), onion(1)]);
        expect(foldArrows()).toHaveLength(4);
        cleanup();
        draw([grapes(4), pom(3), cane(2)]);
        expect(foldArrows()).toHaveLength(0);
    });

    it('SameStructure_At2_4_15_Plots', () => {
        const seen: Record<number, { arrows: number; others: number; reachable: number; full: number }> = {};
        for (const farm of [ARVE, RONGE, ABK]) {
            draw(farm);
            const arrows = foldArrows();
            const others = otherControls().length;
            const full = document.querySelectorAll('[data-testid^="plot-card-"] [data-part="title-bar"]').length;
            // Open every crop: every plot of the farm is reachable, each on the same card the app draws today.
            for (const a of arrows) fireEvent.click(a);
            seen[plotCount(farm)] = { arrows: arrows.length, others, reachable: plotCardsShown(), full };
            cleanup();
        }

        // Small farms look exactly as today: no grouping control, every plot a full card.
        expect(seen[2]).toEqual({ arrows: 0, others: 0, reachable: 2, full: 2 });
        expect(seen[4]).toEqual({ arrows: 0, others: 0, reachable: 4, full: 4 });
        // The big farm: the ONLY difference is the grouping (one arrow per crop); no other control is added, and every plot is there.
        expect(seen[15]).toEqual({ arrows: 4, others: 0, reachable: 15, full: 0 });
    });
});
