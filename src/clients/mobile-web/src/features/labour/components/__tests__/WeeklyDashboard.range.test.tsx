// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The dashboard's date range, against the founder's 2026-08-31 report:
 * "in आढावा it does not change the date ranges".
 *
 * It did not, and could not. The server sent the window's START only, as a
 * bare ISO date; `isReadableWeekRange` suppressed it (a machine date is not
 * readable to a Marathi reader); so the pill never rendered under any window
 * and no figure ever named the period it covered. The fix carries BOTH real
 * boundaries back from the response that produced the figures — never
 * recomputed on the client, which could drift from what was actually filtered.
 *
 * Revert-proof: restore the single-date `weekLabel` path and the first two
 * tests fail — the pill vanishes, and the two windows stop differing.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WeeklyDashboard from '../WeeklyDashboard';
import type { LabourData } from '../../labourMock';
import { LABOUR_MOCK } from '../../labourMock';

const noop = () => {};
const baseProps = () => ({
    onReview: noop,
    onLedger: noop,
    onToast: vi.fn(),
    timeWindow: 'week' as const,
    onTimeWindowChange: noop,
});

const withWindow = (windowFrom: string, windowTo: string): LabourData => ({
    ...LABOUR_MOCK,
    dashboard: { ...LABOUR_MOCK.dashboard, weekLabel: '', windowFrom, windowTo },
});

describe('WeeklyDashboard — the period every figure covers', () => {
    afterEach(() => cleanup());

    it('states the real window as a readable Marathi range', () => {
        render(<WeeklyDashboard {...baseProps()} data={withWindow('2026-08-24', '2026-08-30')} />);
        expect(screen.getByTestId('weekly-dashboard-week-label')).toHaveTextContent('२४–३० ऑग');
    });

    // The founder's report, as a test: two different windows must not read the
    // same. Before the fix both rendered nothing at all, which is why changing
    // the window appeared to change no dates.
    it('shows a DIFFERENT range for a different window', () => {
        const { unmount } = render(
            <WeeklyDashboard {...baseProps()} data={withWindow('2026-08-24', '2026-08-30')} />,
        );
        const week = screen.getByTestId('weekly-dashboard-week-label').textContent;
        unmount();

        render(<WeeklyDashboard {...baseProps()} data={withWindow('2026-08-01', '2026-08-31')} />);
        const month = screen.getByTestId('weekly-dashboard-week-label').textContent;

        expect(week).not.toBe(month);
        expect(month).toContain('१–३१');
    });

    it('renders no range for आजपर्यंत — unbounded has no period to state, and none is invented', () => {
        render(<WeeklyDashboard {...baseProps()} data={withWindow('', '')} />);
        expect(screen.queryByTestId('weekly-dashboard-week-label')).toBeNull();
    });

    it('never leaks a machine date even when both boundaries are present', () => {
        render(<WeeklyDashboard {...baseProps()} data={withWindow('2026-08-24', '2026-08-30')} />);
        expect(screen.queryByText(/2026-08-24/)).toBeNull();
        expect(screen.queryByText(/2026-08-30/)).toBeNull();
    });

    // The preview path stays intact: mock fixtures carry no boundaries, and
    // their already-readable label is still what renders.
    it('falls back to a readable weekLabel when a fixture has no boundaries', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);
        expect(screen.getByTestId('weekly-dashboard-week-label'))
            .toHaveTextContent(LABOUR_MOCK.dashboard.weekLabel);
    });
});
