// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 8) — the meter can be shown WITHOUT its parts grid: the saved screen draws its own
 * eight parts (with his values, the untold ones as real buttons), so `parts={false}` leaves out the tile grid and the
 * screen-reader copies of the red orbs. Everything else is the meter as it is: the SERVER's score only, the pending line
 * while there is none, no projected number (P4). A new file, so the existing ResultHero suites stay untouched.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { flags, dayUnderstanding } = vi.hoisted(() => ({
    flags: { understandingMeter: true },
    dayUnderstanding: vi.fn(),
}));
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k in flags ? flags[k as keyof typeof flags] : t[k as keyof typeof t]) }) };
});
vi.mock('../../../hooks/useDayUnderstanding', () => ({ useDayUnderstanding: (...a: unknown[]) => dayUnderstanding(...a) }));
// The real ring (its light version in jsdom): the pending line is its own fallback.

import ResultHero, { type ResultHeroProps } from '../ResultHero';
import { forgetPlayedReveals } from '../RingStage';

const props = (over: Partial<ResultHeroProps> = {}): ResultHeroProps => ({
    farmId: 'farm-1', dayDate: '2026-10-26', savedLogId: 'LOG-1', recordingKey: 'rec-1',
    nodes: [], missing: ['machinery', 'expense'], onTellMore: vi.fn(), onReadMore: vi.fn(), ...over,
});

beforeEach(() => {
    flags.understandingMeter = true;
    forgetPlayedReveals();
    dayUnderstanding.mockReset();
    dayUnderstanding.mockReturnValue({ score: null, classification: null, refresh: vi.fn(), isLoading: false, error: null });
});
afterEach(() => { cleanup(); });

describe('ResultHero — parts={false} (voice flow v2)', () => {
    it('no server score yet: the pending line stays, and neither the tile grid nor the untold buttons are drawn', () => {
        render(<ResultHero {...props()} parts={false} />);
        expect(screen.getByTestId('vr-meter-pending')).toBeTruthy();
        expect(screen.queryByTestId('vr-parts')).toBeNull();
        expect(screen.queryByTestId('vr-parts-untold')).toBeNull();
        expect(screen.queryByTestId('vr-tell-hint')).toBeNull();
    });

    it('with a server score: the ring is drawn, and no untold-part buttons are added under it', () => {
        dayUnderstanding.mockReturnValue({ score: 6, classification: null, refresh: vi.fn(), isLoading: false, error: null });
        render(<ResultHero {...props()} parts={false} />);
        expect(screen.getByTestId('vr-ring')).toBeTruthy();
        expect(screen.queryByTestId('vr-parts-untold')).toBeNull();
        expect(screen.queryByTestId('vr-parts')).toBeNull();
    });

    it('meter flag off: the Sathi line only, no grid', () => {
        flags.understandingMeter = false;
        render(<ResultHero {...props()} parts={false} />);
        expect(screen.getByTestId('vr-hero-line')).toBeTruthy();
        expect(screen.queryByTestId('vr-parts')).toBeNull();
    });

    it('the default is unchanged: without the prop the grid is drawn as before', () => {
        render(<ResultHero {...props()} />);
        expect(screen.getByTestId('vr-parts')).toBeTruthy();
    });

    it('never shows a projected number ("→ N/10")', () => {
        dayUnderstanding.mockReturnValue({ score: 6, classification: null, refresh: vi.fn(), isLoading: false, error: null });
        const { container } = render(<ResultHero {...props()} parts={false} />);
        expect(container.textContent ?? '').not.toMatch(/→\s*[0-9०-९]/);
    });
});
