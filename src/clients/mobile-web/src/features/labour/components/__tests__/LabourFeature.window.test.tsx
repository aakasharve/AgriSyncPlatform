// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LabourFeature — the adjustable time window, end to end through the screen
 * stack (Task 11, spec: 2026-08-28-labour-v2-release-1).
 *
 * Two things only this level can prove:
 *   1. The आढावा screen's TITLE no longer names a week. `da07f668` made the
 *      server default all-time, so "या आठवड्याचा आढावा" (this week's review)
 *      was a false heading over the farm's whole history. Founder-approved
 *      replacement: "आढावा".
 *   2. The window the hook holds actually reaches the screen, and the screen's
 *      taps actually reach the hook — the wire, not either end of it.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockUseLabourState = vi.fn();
vi.mock('../../useLabourState', () => ({
    useLabourState: () => mockUseLabourState(),
}));

vi.mock('../../../../core/session/FarmContext', () => ({
    useOptionalFarmContext: () => null,
}));

vi.mock('../../../../application/usecases/sync/VerifyLogCommand', () => ({
    VerifyLogCommand: { enqueue: vi.fn() },
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn() },
}));

import LabourFeature from '../LabourFeature';
import { LABOUR_MOCK } from '../../labourMock';
import type { LabourData } from '../../labour.types';
import type { LabourWindow } from '../../labourWindow';

const hookState = (timeWindow: LabourWindow, setTimeWindow: (w: LabourWindow) => void) => ({
    data: LABOUR_MOCK,
    loading: false,
    error: false,
    refresh: vi.fn(),
    timeWindow,
    setTimeWindow,
});

/** The hub's आढावा tile is the only doorway to the dashboard screen. */
const openDashboard = () => {
    fireEvent.click(screen.getByText('आढावा'));
};

describe('LabourFeature — the आढावा screen no longer claims to be a week', () => {
    afterEach(() => {
        cleanup();
        mockUseLabourState.mockReset();
    });

    it('titles the screen "आढावा", never "या आठवड्याचा आढावा"', () => {
        mockUseLabourState.mockReturnValue(hookState('alltime', vi.fn()));

        render(<LabourFeature onExit={() => {}} />);
        openDashboard();

        expect(screen.getByText('आढावा')).toBeInTheDocument();
        expect(screen.queryByText('या आठवड्याचा आढावा')).toBeNull();
    });

    it('keeps the title fixed while the window changes — the title names the screen, the control names the period', () => {
        for (const window of ['alltime', 'today', 'week', 'month'] as const) {
            mockUseLabourState.mockReturnValue(hookState(window, vi.fn()));
            const { unmount } = render(<LabourFeature onExit={() => {}} />);
            openDashboard();

            expect(screen.getByText('आढावा')).toBeInTheDocument();
            unmount();
        }
    });
});

describe('LabourFeature — the window is wired hook <-> screen', () => {
    afterEach(() => {
        cleanup();
        mockUseLabourState.mockReset();
    });

    it('shows the window the hook currently holds as the selected one', () => {
        mockUseLabourState.mockReturnValue(hookState('week', vi.fn()));

        render(<LabourFeature onExit={() => {}} />);
        openDashboard();

        expect(screen.getByTestId('labour-window-week')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('labour-window-alltime')).toHaveAttribute('aria-selected', 'false');
    });

    it('hands a tapped window back to the hook — the ONE place that re-asks the server', () => {
        const setTimeWindow = vi.fn();
        mockUseLabourState.mockReturnValue(hookState('alltime', setTimeWindow));

        render(<LabourFeature onExit={() => {}} />);
        openDashboard();
        fireEvent.click(screen.getByTestId('labour-window-month'));

        expect(setTimeWindow).toHaveBeenCalledWith('month');
    });
});

describe('LabourFeature — Task 12: the window belongs to आढावा, it must not leak to the hub', () => {
    afterEach(() => {
        cleanup();
        mockUseLabourState.mockReset();
    });

    /**
     * A STATEFUL fake of `useLabourState` — real enough to reproduce the
     * actual leak, not just assert a call happened. The real hook re-fetches
     * `data` (dashboard AND every person's balance) keyed on `timeWindow`;
     * this mirrors that coupling so रमेश's hub row genuinely reads a
     * different ₹ figure per window, exactly like a real narrowed fetch
     * would. `paid`/`advance` are held fixed so both windows resolve to the
     * SAME "द्यायचे" wording — narrowing changes the AMOUNT only, matching
     * what a real narrower period does; it never flips the category.
     */
    const dataForWindow = (window: LabourWindow): LabourData => ({
        ...LABOUR_MOCK,
        people: {
            ...LABOUR_MOCK.people,
            ramesh: {
                ...LABOUR_MOCK.people.ramesh,
                balance: { recorded: window === 'alltime' ? 10000 : 3000, paid: 1200, advance: 0 },
            },
        },
    });
    const ALLTIME_LINE = '₹8,800 द्यायचे'; // 10000 − 1200 − 0
    const TODAY_LINE = '₹1,800 द्यायचे'; // 3000 − 1200 − 0

    /** Renders with a hook fake whose `data`/`timeWindow` genuinely move
     *  together, the way `useLabourState.ts` really behaves. `rr()` re-runs
     *  the render after a state-changing interaction — needed because the
     *  fake mutates a closed-over variable rather than calling a real
     *  `useState` setter. */
    const renderStateful = () => {
        let currentWindow: LabourWindow = 'alltime';
        const setTimeWindow = vi.fn((w: LabourWindow) => { currentWindow = w; });
        mockUseLabourState.mockImplementation(() => ({
            data: dataForWindow(currentWindow),
            loading: false,
            error: false,
            refresh: vi.fn(),
            timeWindow: currentWindow,
            setTimeWindow,
        }));
        const utils = render(<LabourFeature onExit={() => {}} />);
        const rr = () => utils.rerender(<LabourFeature onExit={() => {}} />);
        return { ...utils, rr, setTimeWindow };
    };

    // EXIT PATH 1 — the visible back arrow (the only doorway off आढावा this
    // release actually ships; hardware-back/gesture have no separate code
    // path in this repo to diverge from it — both would have to go through
    // the same `back()`/`stack`, verified by grep: no popstate/BackHandler
    // wiring touches this component at all).
    it('narrowing to आज on आढावा, then leaving via the back arrow, shows the hub the ALL-TIME figure again — and आढावा itself reopens on आजपर्यंत', () => {
        const { rr } = renderStateful();

        // Baseline: the hub opens on आजपर्यंत.
        expect(screen.getByText(ALLTIME_LINE)).toBeInTheDocument();

        openDashboard();
        rr();
        fireEvent.click(screen.getByTestId('labour-window-today'));
        rr();
        expect(screen.getByTestId('labour-window-today')).toHaveAttribute('aria-selected', 'true');

        // Leave आढावा — the visible "मागे" back arrow.
        fireEvent.click(screen.getByText('मागे'));
        rr();

        // THE LEAK: रमेश's hub figure must be all-time again, never आज's.
        expect(screen.getByText(ALLTIME_LINE)).toBeInTheDocument();
        expect(screen.queryByText(TODAY_LINE)).toBeNull();

        // "Returning to आढावा starts at the default again" — one consistent
        // rule, not two (not-persisted, matching Task 11).
        openDashboard();
        rr();
        expect(screen.getByTestId('labour-window-alltime')).toHaveAttribute('aria-selected', 'true');
    });

    // Guards against an over-eager alternate fix (e.g. a reset tied to any
    // window tap, or to an unconditional interval) that would also revert
    // the farmer's OWN in-progress selection while he is still looking at
    // the very screen that owns the control.
    it('does NOT reset while आढावा itself is still the visible screen', () => {
        const setTimeWindow = vi.fn();
        mockUseLabourState.mockReturnValue(hookState('alltime', setTimeWindow));
        render(<LabourFeature onExit={() => {}} />);
        openDashboard();
        setTimeWindow.mockClear();

        fireEvent.click(screen.getByTestId('labour-window-today'));

        expect(setTimeWindow).toHaveBeenCalledWith('today');
        expect(setTimeWindow).not.toHaveBeenCalledWith('alltime');
    });

    // EXIT PATH 2 — `onExit` (leaving the whole Labour feature, not just
    // आढावा). आढावा can only ever be on the stack with hub beneath it
    // (`push({name:'dashboard'})` only fires from hub), so `handleBack` can
    // never reach the `onExit` branch directly FROM आढावा — it always pops
    // to hub first. This test locks that invariant down: the FIRST back-tap
    // (off आढावा) resets and pops, never exits; only a SECOND back-tap (now
    // at hub) reaches `onExit`. If a future change ever let `onExit` fire
    // straight from आढावा, this is the test that would catch it silently
    // skipping the reset.
    it('the back arrow resets-and-pops off आढावा; onExit is reachable only from hub afterwards, never in place of the reset', () => {
        const onExit = vi.fn();
        const setTimeWindow = vi.fn();
        mockUseLabourState.mockReturnValue(hookState('today', setTimeWindow));
        render(<LabourFeature onExit={onExit} />);
        openDashboard();
        setTimeWindow.mockClear();

        fireEvent.click(screen.getByText('मागे'));
        expect(setTimeWindow).toHaveBeenCalledWith('alltime');
        expect(onExit).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('मागे'));
        expect(onExit).toHaveBeenCalledTimes(1);
    });
});
