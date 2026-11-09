// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the top of the result screen.
 *
 * Founder PLR-D1 round 5: the meter LEADS — Sathi + "श्रम साथीला किती समजले" and the founder's ring on REAL
 * inputs: the SERVER's day score (never computed on the phone) and the ring's own coverage of the plot's day.
 * Behind the existing `understandingMeter` flag, like today's meter: flag off = no ring and no fetch at all.
 * The reveal plays for a NEW recording only.
 * Lane L6b: the founder's ring mode has no tile grid — the ring's red orbs do that job. The tiles stay only where no
 * ring is drawn (flag off, no server score yet, a no-work day), and the orbs' tap stays reachable by a screen reader.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { flags, dayUnderstanding, ringKeys } = vi.hoisted(() => ({
    flags: { understandingMeter: true },
    dayUnderstanding: vi.fn(),
    ringKeys: [] as Array<{ key: unknown; settled: unknown; score: unknown }>,
}));
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k in flags ? flags[k as keyof typeof flags] : t[k as keyof typeof t]) }) };
});
vi.mock('../../../hooks/useDayUnderstanding', () => ({ useDayUnderstanding: (...a: unknown[]) => dayUnderstanding(...a) }));
// The canvas ring itself is the founder's module (tested on its own); here only what is handed to it matters.
vi.mock('../../shramsathi/understandingRing', async (orig) => {
    const real = await orig<typeof import('../../shramsathi/understandingRing')>();
    return {
        ...real,
        UnderstandingRing: (p: { replayKey: unknown; settled: unknown; score: unknown }) => {
            ringKeys.push({ key: p.replayKey, settled: p.settled, score: p.score });
            return <div data-testid="understanding-ring" />;
        },
    };
});

import ResultHero, { type ResultHeroProps } from '../ResultHero';
import { getDateKey } from '../../../../../core/domain/services/DateKeyService';
import { forgetPlayedReveals } from '../RingStage';

const props = (over: Partial<ResultHeroProps> = {}): ResultHeroProps => ({
    farmId: 'farm-1', dayDate: '2026-10-26', savedLogId: 'LOG-1', recordingKey: 'rec-1',
    nodes: [], missing: ['machinery', 'expense'], onTellMore: vi.fn(), onReadMore: vi.fn(), ...over,
});

beforeEach(() => {
    flags.understandingMeter = true;
    ringKeys.length = 0;
    forgetPlayedReveals();
    dayUnderstanding.mockReset();
    dayUnderstanding.mockReturnValue({ score: 7, classification: null, refresh: vi.fn(), isLoading: false, error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ResultHero — the meter leads', () => {
    it('flag ON: Sathi + "श्रम साथीला किती समजले" and the ring, fed the SERVER\'s day score for this farm and day', () => {
        render(<ResultHero {...props()} />);
        expect(screen.getByTestId('vr-hero-line').textContent).toBe('श्रम साथीला किती समजले');
        expect(screen.getByTestId('vr-ring')).toBeTruthy();
        expect(dayUnderstanding).toHaveBeenCalledWith('farm-1', '2026-10-26', expect.stringContaining('LOG-1'));
        expect(ringKeys.at(-1)?.score).toBe(7);
    });

    it('flag OFF: no ring and no score fetch at all — the approved Sathi line instead', () => {
        flags.understandingMeter = false;
        render(<ResultHero {...props()} dayDate={getDateKey()} />);
        expect(screen.queryByTestId('vr-meter')).toBeNull();
        expect(dayUnderstanding).not.toHaveBeenCalled();
        expect(screen.getByTestId('vr-hero-line').textContent).toBe('श्रम सफल मध्ये तुम्ही आज केलेले काम समजून घेत आहे');
        // lane OF fix 1 (L2): a recording saved for a past day names that day, never "आज"
        cleanup();
        render(<ResultHero {...props()} dayDate="2026-10-24" />);
        expect(screen.getByTestId('vr-hero-line').textContent).toBe('श्रम सफल मध्ये तुम्ही २४ ऑक्टो ला केलेले काम समजून घेत आहे');
    });

    it('no server score yet: the gentle pending line, never a 0', () => {
        dayUnderstanding.mockReturnValue({ score: null, classification: null, refresh: vi.fn(), isLoading: true, error: null });
        render(<ResultHero {...props()} />);
        expect(ringKeys.at(-1)?.score).toBeNull();
        expect(screen.queryByTestId('vr-ring-message')).toBeNull();
    });

    it('the reveal plays for a NEW recording only: the same recording opened again lands settled', () => {
        vi.useFakeTimers();
        const first = render(<ResultHero {...props()} />);
        act(() => { vi.advanceTimersByTime(60_000); });
        expect(ringKeys.at(-1)).toMatchObject({ key: 'rec-1', settled: false });
        first.unmount();

        render(<ResultHero {...props()} />);
        expect(ringKeys.at(-1)).toMatchObject({ key: 'rec-1', settled: true }); // seen before: no replay
        cleanup();
        render(<ResultHero {...props({ recordingKey: 'rec-2' })} />);
        expect(ringKeys.at(-1)).toMatchObject({ key: 'rec-2', settled: false });
    });

    it('L6b: with the ring drawn there is NO tile grid (the orbs do it), but each untold part stays a real button', () => {
        const p = props();
        render(<ResultHero {...p} />);
        expect(screen.getByTestId('vr-ring')).toBeTruthy();
        expect(screen.queryByTestId('vr-parts')).toBeNull();
        expect(screen.queryByTestId('vr-tell-hint')).toBeNull();
        // The orbs are drawn on a canvas: a screen reader / keyboard still gets a button per untold part.
        const machinery = screen.getByTestId('vr-untold-machinery');
        expect(machinery.tagName).toBe('BUTTON');
        expect(machinery.className).toContain('sr-only');
        expect(machinery.textContent).toBe('यंत्र — सांगितलं नाही. दाबा आणि बोला');
        expect(screen.getByTestId('vr-untold-expense')).toBeTruthy();
        expect(screen.queryByTestId('vr-untold-crop')).toBeNull();
        fireEvent.click(machinery);
        expect(p.onTellMore).toHaveBeenCalledWith('machinery');
    });

    it('L6b: no ring drawn yet (offline, or the score still on its way): the tiles stand in for it', () => {
        dayUnderstanding.mockReturnValue({ score: null, classification: null, refresh: vi.fn(), isLoading: true, error: null });
        render(<ResultHero {...props()} />);
        expect(screen.getByTestId('vr-parts')).toBeTruthy();
        expect(screen.queryByTestId('vr-parts-untold')).toBeNull();
        cleanup();
        flags.understandingMeter = false; // no ring at all
        render(<ResultHero {...props()} />);
        expect(screen.getByTestId('vr-parts')).toBeTruthy();
    });

    it('L6b: a typed entry\'s ring arrow says "खाली वाचा" — nothing to listen to', () => {
        render(<ResultHero {...props({ typed: true })} />);
        expect(screen.getByTestId('vr-ring-readmore').getAttribute('aria-label')).toBe('खाली वाचा');
        cleanup();
        render(<ResultHero {...props()} />);
        expect(screen.getByTestId('vr-ring-readmore').getAttribute('aria-label')).toBe('खाली वाचा किंवा ऐका');
    });

    it('lists the parts he did NOT mention in red; tapping one asks him to tell it (tiles: no ring drawn)', () => {
        dayUnderstanding.mockReturnValue({ score: null, classification: null, refresh: vi.fn(), isLoading: false, error: null });
        const p = props();
        render(<ResultHero {...p} />);
        const machinery = screen.getByTestId('vr-part-machinery');
        expect(machinery.getAttribute('data-told')).toBe('no');
        expect(machinery.textContent).toContain('सांगितलं नाही');
        expect(screen.getByTestId('vr-part-crop').getAttribute('data-told')).toBe('yes');
        expect(screen.getByTestId('vr-tell-hint').textContent).toBe('दाबा आणि बोला');
        fireEvent.click(machinery);
        expect(p.onTellMore).toHaveBeenCalledWith('machinery');
    });

    it('a part he said but the server could not verify reads "नक्की समजलं नाही" — never "सांगितलं नाही", never a 0 (round 3)', () => {
        flags.understandingMeter = false;
        const p = props({ missing: ['machinery'], unsure: ['labour'] });
        render(<ResultHero {...p} />);
        const labour = screen.getByTestId('vr-part-labour');
        expect(labour.getAttribute('data-told')).toBe('unsure');
        expect(labour.textContent).toContain('नक्की समजलं नाही');
        expect(labour.textContent).not.toContain('सांगितलं नाही');
        expect(labour.textContent).not.toMatch(/[0०]/);
        fireEvent.click(labour); // not a "say it again" button: it would record the same thing twice
        expect(p.onTellMore).not.toHaveBeenCalled();
    });
});
