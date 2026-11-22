// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (founder D-167: the start day is DAY 1 as the farmer reads it; the server's `Day` of a record
 * counts from 0, FarmCompareService.cs:222)
 *
 * The compare tab's "तुमचं स्वतःचं काम" sheet (`compare/OwnWorkSheet.tsx`) says WHEN the record was made: "कधी: दिवस N". N is the server's day plus one -
 * a record made on the start day (server day 0) reads day 1. Same in English. Only the printed number moves; nothing is sent back.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FarmCompareResult } from '../data/compareClient';
import { FARM, PLOT_ID, answerOf } from './compareFixtures';

const enqueue = vi.hoisted(() => vi.fn(async () => 'ok'));

vi.mock('../../../infrastructure/sync/MutationQueue', () => ({ mutationQueue: { enqueue } }));
vi.mock('../../../shared/hooks/useUiPref', () => ({ useUiPref: () => [true, vi.fn(), true] as const }));
vi.mock('../../plannedWork/components/PlanMic', () => ({
    default: () => <button type="button" data-testid="plan-mic">mic</button>,
}));

import { CompareView } from '../CompareView';

/** Opens the "own work" sheet of the one own record of the fixture, whose server day is `day`. */
function openOwn(day: number, language: 'mr' | 'en' = 'mr') {
    const compare = answerOf(a => { a.plots[0].ownWork[0].day = day; });
    const result = { kind: 'compare', compare, source: 'server', asOfUtc: compare.serverTimeUtc } as Extract<FarmCompareResult, { kind: 'compare' }>;
    const plot = compare.plots.find(p => p.plotId === PLOT_ID)!;
    render(<CompareView result={result} plot={plot} farmId={FARM} chip="द्राक्ष · सोनाका" language={language} crops={[]} onChange={() => undefined} />);
    fireEvent.click(screen.getByTestId('compare-tile-work'));
    fireEvent.click(screen.getByTestId('compare-own-row-log-1:work:vine-tying'));
    return screen.getByTestId('compare-own-sheet').textContent ?? '';
}

beforeEach(() => { enqueue.mockClear(); });
afterEach(() => cleanup());

describe('the own-work sheet prints the shown day (server day + 1)', () => {
    it('a record on the start day (server day 0) reads "कधी: दिवस १"', () => {
        const sheet = openOwn(0);

        expect(sheet).toMatch(/कधी: दिवस १(?![०-९])/);
        expect(sheet).not.toContain('दिवस ०');
    });

    it('the fixture\'s record on server day 41 reads day 42', () => {
        const sheet = openOwn(41);

        expect(sheet).toContain('कधी: दिवस ४२');
        expect(sheet).not.toContain('दिवस ४१');
    });

    it('English: server day 0 reads "When: day 1", server day 41 reads "When: day 42"', () => {
        expect(openOwn(0, 'en')).toMatch(/When: day 1(?![0-9])/);
        cleanup();
        expect(openOwn(41, 'en')).toContain('When: day 42');
    });

    it('opening the sheet writes nothing: the number is only printed', () => {
        openOwn(0);

        expect(enqueue).not.toHaveBeenCalled();
    });
});
