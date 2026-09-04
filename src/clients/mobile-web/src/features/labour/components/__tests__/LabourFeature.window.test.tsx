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

describe('LabourFeature — Task 17 (R14 superseded): the window is remembered, not reset', () => {
    afterEach(() => {
        cleanup();
        mockUseLabourState.mockReset();
    });

    /**
     * A STATEFUL fake of `useLabourState` — real enough to observe the window
     * value actually surviving navigation, not just assert a call happened.
     * The real hook re-fetches `data` keyed on `timeWindow`; this mirrors
     * that coupling so रमेश's hub row genuinely reads a different ₹ figure
     * per window. `paid`/`advance` are held fixed so both windows resolve to
     * the SAME "द्यायचे" wording — narrowing changes the AMOUNT only; it
     * never flips the category.
     *
     * TASK 13 / R15 — this fixture is a DELIBERATE COUNTERFACTUAL, and saying
     * so is the point. A person's balance is all-time server-side as of R15,
     * precisely because presenting it as a windowed figure was the same
     * defect the money card had, one level down. So no real fetch can
     * produce the per-window rows below any more — a real farmer's hub never
     * shows a different figure per window, regardless of what आढावा is set
     * to.
     *
     * TASK 17 (R14 superseded) — what this fixture now pins is different:
     * Task 12 added a reset so leaving आढावा put the window back to
     * आजपर्यंत, precisely BECAUSE a windowed figure could leak to the hub at
     * the time. R15 already closed that door at the source (see above); the
     * founder has since ruled the window itself should be REMEMBERED, not
     * reset. `LabourFeature` no longer contains any reset effect at all. This
     * fixture is reused, unchanged in shape, because varying `data` with the
     * window is still the most direct way to observe — from outside, via
     * rendered text — whether the window value visible to a screen actually
     * changed underneath. It now proves the opposite of what it proved
     * before: that leaving आढावा does NOT put the window back.
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
    const ALLTIME_LINE = '₹8,800 बाकी'; // 10000 − 1200 − 0
    const TODAY_LINE = '₹1,800 बाकी'; // 3000 − 1200 − 0

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
    it('narrowing to आज on आढावा, then leaving via the back arrow, the window is REMEMBERED — no reset, and आढावा itself reopens on आज', () => {
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

        // TASK 17 (R14 superseded) — NO reset: the window the farmer picked
        // is still in force (this fixture's per-window figure is the
        // deliberate counterfactual described above, kept only because it is
        // the most direct external signal that the value did not change).
        expect(screen.getByText(TODAY_LINE)).toBeInTheDocument();
        expect(screen.queryByText(ALLTIME_LINE)).toBeNull();

        // "Returning to आढावा shows the window he last picked" — the
        // founder's own framing for this reversal, not "back at the default".
        openDashboard();
        rr();
        expect(screen.getByTestId('labour-window-today')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('labour-window-alltime')).toHaveAttribute('aria-selected', 'false');
    });

    // Guards against ANY reset firing while आढावा itself is still the
    // visible screen — the farmer's own in-progress tap must never be
    // reverted while he is still looking at the very screen that owns the
    // control. Trivially true now that no reset effect exists at all, but
    // kept as a regression guard: a future change that reintroduces one
    // (tied to a tap, an interval, anything) would be caught here.
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
    // to hub first. TASK 17 (R14 superseded) inverts this test's own
    // assertion: Task 12's back arrow used to reset-and-pop; now it must
    // pop WITHOUT touching the window at all, on either tap — leaving the
    // whole feature (`onExit`, second tap) carries the choice forward the
    // same as popping to hub does, because persistence lives one layer
    // down in `SessionStore`, untouched by anything in this component.
    it('the back arrow pops off आढावा WITHOUT touching the window; onExit is reachable only from hub afterwards, and the window is never written to on the way out', () => {
        const onExit = vi.fn();
        const setTimeWindow = vi.fn();
        mockUseLabourState.mockReturnValue(hookState('today', setTimeWindow));
        render(<LabourFeature onExit={onExit} />);
        openDashboard();
        setTimeWindow.mockClear();

        fireEvent.click(screen.getByText('मागे'));
        expect(setTimeWindow).not.toHaveBeenCalled();
        expect(onExit).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('मागे'));
        expect(onExit).toHaveBeenCalledTimes(1);
        expect(setTimeWindow).not.toHaveBeenCalled();
    });
});
