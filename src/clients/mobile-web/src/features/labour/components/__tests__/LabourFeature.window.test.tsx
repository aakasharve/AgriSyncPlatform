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
