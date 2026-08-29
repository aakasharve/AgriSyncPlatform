// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WeeklyDashboard — the adjustable time window's SCREEN half (Task 11, spec:
 * 2026-08-28-labour-v2-release-1).
 *
 * WHY THIS FILE EXISTS. `da07f668` flipped the server default from "this week"
 * to all-time, which made this screen's hard-coded `या आठवड्यात` heading an
 * ACTIVELY FALSE label over numbers covering the farm's whole history. The
 * heading must therefore follow the selection, not sit above it — that is the
 * defect these tests pin, not a styling preference.
 *
 * The four windows and their Marathi are founder-approved and closed:
 * आजपर्यंत · आज · हा आठवडा · हा महिना. No fifth label may appear here.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WeeklyDashboard from '../WeeklyDashboard';
import type { LabourData } from '../../labourMock';
import { LABOUR_MOCK } from '../../labourMock';
import { LABOUR_WINDOW_ORDER, LABOUR_WINDOW_LABELS, type LabourWindow } from '../../labourWindow';

const baseProps = (timeWindow: LabourWindow = 'alltime') => ({
    onReview: vi.fn(),
    onLedger: vi.fn(),
    onToast: vi.fn(),
    timeWindow,
    onTimeWindowChange: vi.fn(),
});

describe('WeeklyDashboard — the window control', () => {
    afterEach(() => cleanup());

    it('offers exactly the four founder-approved windows, in order', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);

        const control = screen.getByTestId('labour-window-slider');
        const labels = within(control).getAllByRole('tab').map((b) => b.textContent);
        expect(labels).toEqual(['आजपर्यंत', 'आज', 'हा आठवडा', 'हा महिना']);
    });

    it('opens on आजपर्यंत — marked selected, and the only one so marked', () => {
        render(<WeeklyDashboard {...baseProps('alltime')} data={LABOUR_MOCK} />);

        const selected = within(screen.getByTestId('labour-window-slider'))
            .getAllByRole('tab')
            .filter((b) => b.getAttribute('aria-selected') === 'true');
        expect(selected).toHaveLength(1);
        expect(selected[0]).toHaveTextContent('आजपर्यंत');
    });

    it.each(LABOUR_WINDOW_ORDER)('marks %s as the selected window when it is the one in force', (window) => {
        render(<WeeklyDashboard {...baseProps(window)} data={LABOUR_MOCK} />);

        expect(screen.getByTestId(`labour-window-${window}`)).toHaveAttribute('aria-selected', 'true');
    });

    it.each(LABOUR_WINDOW_ORDER.filter((w) => w !== 'alltime'))(
        'reports the tap on %s upward — the screen never re-fetches on its own',
        (window) => {
            const props = baseProps('alltime');
            render(<WeeklyDashboard {...props} data={LABOUR_MOCK} />);

            fireEvent.click(screen.getByTestId(`labour-window-${window}`));

            expect(props.onTimeWindowChange).toHaveBeenCalledWith(window);
        },
    );

    it.each(LABOUR_WINDOW_ORDER)('re-tapping the window already in force (%s) asks for nothing', (window) => {
        const props = baseProps(window);
        render(<WeeklyDashboard {...props} data={LABOUR_MOCK} />);

        fireEvent.click(screen.getByTestId(`labour-window-${window}`));

        expect(props.onTimeWindowChange).not.toHaveBeenCalled();
    });
});

describe('WeeklyDashboard — the heading follows the window', () => {
    afterEach(() => cleanup());

    it.each(LABOUR_WINDOW_ORDER)('heads the stat grid with the %s label, not a fixed week', (window) => {
        render(<WeeklyDashboard {...baseProps(window)} data={LABOUR_MOCK} />);

        expect(screen.getByTestId('labour-window-heading'))
            .toHaveTextContent(LABOUR_WINDOW_LABELS[window]);
    });

    it('never prints the old hard-coded "या आठवड्यात" heading again, under any window', () => {
        for (const window of LABOUR_WINDOW_ORDER) {
            const { unmount } = render(<WeeklyDashboard {...baseProps(window)} data={LABOUR_MOCK} />);
            // The exact string `da07f668` made false: all-time numbers under a
            // heading that says "this week".
            expect(screen.queryByText('या आठवड्यात')).toBeNull();
            unmount();
        }
    });
});

describe('WeeklyDashboard — तपासायचं is the approval inbox, not a statistic', () => {
    afterEach(() => cleanup());

    // FOUNDER RULING (Task 11): तपासायचं is work waiting on HIM, so it follows
    // the oversight design language — a full-width strip with a count and a
    // chevron — and it is deliberately NOT window-scoped server-side
    // (`GetLabourDataHandler`: "`Pending` deliberately does NOT move with the
    // window"). Both halves are locked below.
    const withPending = (pending: number): LabourData => ({
        ...LABOUR_MOCK,
        dashboard: { ...LABOUR_MOCK.dashboard, pending },
    });

    it('renders तपासायचं as a full-width strip, outside the stat tile grid', () => {
        render(<WeeklyDashboard {...baseProps()} data={LABOUR_MOCK} />);

        const strip = screen.getByTestId('labour-review-strip');
        expect(strip).toHaveTextContent('तपासायचं');
        // It is no longer one of the grid's tiles.
        expect(screen.getByTestId('labour-stat-grid')).not.toContainElement(strip);
    });

    it('opens the review surface on tap', () => {
        const props = baseProps();
        render(<WeeklyDashboard {...props} data={LABOUR_MOCK} />);

        fireEvent.click(screen.getByTestId('labour-review-strip'));

        expect(props.onReview).toHaveBeenCalledTimes(1);
    });

    it('shows the SAME outstanding count under every one of the four windows', () => {
        const counts: string[] = [];
        for (const window of LABOUR_WINDOW_ORDER) {
            const { unmount } = render(<WeeklyDashboard {...baseProps(window)} data={withPending(7)} />);
            counts.push(screen.getByTestId('labour-review-strip-count').textContent ?? '');
            unmount();
        }

        expect(counts).toEqual(['7', '7', '7', '7']);
    });

    it('a genuine zero outstanding still states itself — 0 is a real answer here, not an absence', () => {
        render(<WeeklyDashboard {...baseProps()} data={withPending(0)} />);

        expect(screen.getByTestId('labour-review-strip-count')).toHaveTextContent('0');
    });
});

describe('WeeklyDashboard — absence stays absence under every window', () => {
    afterEach(() => cleanup());

    const withManDays = (manDays: number | null): LabourData => ({
        ...LABOUR_MOCK,
        dashboard: { ...LABOUR_MOCK.dashboard, manDays },
    });

    it.each(LABOUR_WINDOW_ORDER)('renders "—" for an unknown मजूर-दिवस under %s — never 0, never "null"', (window) => {
        render(<WeeklyDashboard {...baseProps(window)} data={withManDays(null)} />);

        const label = screen.getByText('मजूर-दिवस');
        expect(label.previousElementSibling?.textContent).toBe('—');
        expect(screen.queryByText('null')).toBeNull();
    });

    it.each(LABOUR_WINDOW_ORDER)('still renders a genuine 0 as 0 under %s', (window) => {
        render(<WeeklyDashboard {...baseProps(window)} data={withManDays(0)} />);

        const label = screen.getByText('मजूर-दिवस');
        expect(label.previousElementSibling?.textContent).toBe('0');
    });
});
