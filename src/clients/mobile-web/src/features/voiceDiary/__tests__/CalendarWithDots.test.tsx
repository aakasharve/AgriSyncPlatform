// @vitest-environment jsdom
// spec: voice-diary-e2e-2026-05-17 (D.21)
//
// CalendarWithDots — dot density + select behavior. Tests verify:
//   1. Each of the 30 days renders a cell with the correct count attribute.
//   2. Clicking a cell invokes onSelectDate with the matching dateKey.

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import CalendarWithDots from '../components/CalendarWithDots';
import { getDateKey, getDateKeyDaysAgo } from '../../../core/domain/services/DateKeyService';

describe('CalendarWithDots', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders 30 cells with count attribute reflecting countsByDate', () => {
        const today = getDateKey();
        const yesterday = getDateKeyDaysAgo(1);
        const countsByDate: Record<string, number> = {
            [today]: 4,
            [yesterday]: 1,
        };
        render(
            <CalendarWithDots
                countsByDate={countsByDate}
                selectedDateKey={today}
                onSelectDate={() => undefined}
            />,
        );

        const todayCell = screen.getByTestId(`voice-diary-calendar-cell-${today}`);
        expect(todayCell).toBeInTheDocument();
        expect(todayCell.getAttribute('data-count')).toBe('4');

        const yesterdayCell = screen.getByTestId(`voice-diary-calendar-cell-${yesterday}`);
        expect(yesterdayCell.getAttribute('data-count')).toBe('1');

        // A day with no entries reports count 0.
        const sevenDaysAgo = getDateKeyDaysAgo(7);
        expect(
            screen.getByTestId(`voice-diary-calendar-cell-${sevenDaysAgo}`).getAttribute('data-count'),
        ).toBe('0');
    });

    it('invokes onSelectDate with the cell dateKey when clicked', () => {
        const today = getDateKey();
        const onSelectDate = vi.fn();
        render(
            <CalendarWithDots
                countsByDate={{}}
                selectedDateKey={today}
                onSelectDate={onSelectDate}
            />,
        );
        const target = getDateKeyDaysAgo(3);
        fireEvent.click(screen.getByTestId(`voice-diary-calendar-cell-${target}`));
        expect(onSelectDate).toHaveBeenCalledWith(target);
    });
});
