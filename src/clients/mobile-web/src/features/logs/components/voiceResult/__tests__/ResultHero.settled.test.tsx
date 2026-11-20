// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RWF, founder 2026-11-20: "after the animation I want a direct transcription view") -
 * what the hero does when the ring has settled: the screen's own hand-off when it gives one, the old scroll-to-the-meter when it does not.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { scroll } = vi.hoisted(() => ({ scroll: vi.fn() }));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k === 'understandingMeter' ? true : t[k as keyof typeof t]) }) };
});
vi.mock('../../../hooks/useDayUnderstanding', () => ({ useDayUnderstanding: () => ({ score: 7, classification: null, refresh: vi.fn(), isLoading: false, error: null }) }));
vi.mock('../scrollBelowHeader', () => ({ scrollBelowHeader: scroll }));
vi.mock('../RingStage', () => ({
    default: (p: { onSettled?: () => void }) => <button type="button" data-testid="ring-settle" onClick={() => p.onSettled?.()} />,
    forgetPlayedReveals: () => undefined,
}));

import ResultHero, { type ResultHeroProps } from '../ResultHero';

const props = (over: Partial<ResultHeroProps> = {}): ResultHeroProps => ({
    farmId: 'farm-1', dayDate: '2026-11-20', savedLogId: 'LOG-1', recordingKey: 'rec-1',
    nodes: [], missing: [], onTellMore: vi.fn(), onReadMore: vi.fn(), ...over,
});

afterEach(() => { cleanup(); scroll.mockReset(); });

describe('ResultHero - when the ring has settled', () => {
    it('TheScreensHandOffRuns_AndTheMeterDoesNotScrollToItself', () => {
        const onSettled = vi.fn();
        render(<ResultHero {...props({ onSettled })} />);
        fireEvent.click(screen.getByTestId('ring-settle'));
        expect(onSettled).toHaveBeenCalledTimes(1);
        expect(scroll).not.toHaveBeenCalled();
    });

    it('NoHandOff_KeepsTheOldBehaviour_ScrollToTheMeter', () => {
        render(<ResultHero {...props()} />);
        fireEvent.click(screen.getByTestId('ring-settle'));
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(scroll.mock.calls[0]?.[0]).toBe(screen.getByTestId('vr-meter'));
    });
});
