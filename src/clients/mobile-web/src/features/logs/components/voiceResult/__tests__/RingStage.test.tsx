// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13, round 2 — MINOR-1) — the full-screen "मला किती समजलं"
 * reveal plays ONCE per recording. The server score is refetched on every sync cycle and is null for a moment
 * when a fetch fails; a score that drops and comes back must never take over the screen again (he may be
 * listening to his clip). Only a NEW recording plays it again.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// The canvas ring itself is the founder's module (tested on its own); here only the stage around it matters.
vi.mock('../../shramsathi/understandingRing', async (orig) => ({
    ...(await orig<typeof import('../../shramsathi/understandingRing')>()),
    UnderstandingRing: (p: { settled?: boolean }) => <div data-testid="understanding-ring" data-settled={p.settled ? 'yes' : 'no'} />,
}));

import RingStage, { forgetPlayedReveals } from '../RingStage';

const stage = (score: number | null, saveKey = 'rec-1') => (
    <RingStage score={score} nodes={[]} variant="cinematic" saveKey={saveKey} onMissedTap={() => undefined} fallback={null} />
);
const phase = () => screen.getByTestId('vr-ring').getAttribute('data-phase');

beforeEach(() => { vi.useFakeTimers(); forgetPlayedReveals(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('RingStage — the reveal plays once per recording', () => {
    it('plays full screen for a new recording with a score', () => {
        render(stage(7));
        expect(phase()).toBe('full');
        expect(screen.getByTestId('vr-ring-backdrop')).toBeTruthy();
    });

    it('a score that drops (failed refetch) and comes back never replays it for the same recording', () => {
        const { rerender } = render(stage(7));
        expect(phase()).toBe('full');
        rerender(stage(null));
        expect(phase()).toBe('small'); // nothing to show: it lands in the card at once
        expect(screen.queryByTestId('vr-ring-backdrop')).toBeNull();
        rerender(stage(7));
        expect(phase()).toBe('small');
        expect(screen.queryByTestId('vr-ring-backdrop')).toBeNull();
    });

    it('a score that arrives late still plays it once; a NEW recording plays it again', () => {
        const { rerender } = render(stage(null));
        expect(phase()).toBe('small');
        rerender(stage(6));
        expect(phase()).toBe('full');
        rerender(stage(null));
        rerender(stage(6));
        expect(phase()).toBe('small');
        rerender(stage(6, 'rec-2'));
        expect(phase()).toBe('full');
    });

    it('opening the same recording again lands settled (no full screen)', () => {
        render(stage(7));
        cleanup();
        render(stage(7));
        expect(phase()).toBe('small');
    });
});

describe('RingStage — round 3 (I13-V2-m4): a score that comes late never covers what he is doing', () => {
    const settled = () => screen.getByTestId('understanding-ring').getAttribute('data-settled');

    it('he already tapped (his clip, the confirm) before the score came: the ring lands settled in its card', () => {
        const { rerender } = render(stage(null));
        fireEvent.pointerDown(document.body);
        rerender(stage(6));
        expect(phase()).toBe('small');
        expect(screen.queryByTestId('vr-ring-backdrop')).toBeNull();
        expect(settled()).toBe('yes');
        rerender(stage(7)); // a later refetch neither replays it nor takes over the screen
        expect(phase()).toBe('small');
        expect(settled()).toBe('yes');
    });

    it('untouched, a late score still plays the reveal once; a tap on an EARLIER recording does not stop a new one', () => {
        const { rerender } = render(stage(null));
        rerender(stage(6));
        expect(phase()).toBe('full');
        expect(settled()).toBe('no');
        cleanup();
        const second = render(stage(null, 'rec-2'));
        fireEvent.pointerDown(document.body);
        second.rerender(stage(null, 'rec-3'));
        second.rerender(stage(5, 'rec-3'));
        expect(phase()).toBe('full');
    });
});
